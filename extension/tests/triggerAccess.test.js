import assert from 'node:assert/strict';
import test from 'node:test';
import { runTriggers } from '../src/background/runTriggers.js';
import { executeLambda } from '../src/background/executeLambda.js';
import { applyTriggerDefinitionUpdate } from '../src/shared/triggerUpdates.js';
import { finishInvocation, clearTabInvocations } from '../src/background/invocations.js';

const triggerKey = 'local_storage_key_triggers';
let db, injections, pageUrl, afterInjection;
const functionItem = (extra = {}) => ({ id: 'f', name: 'target', func: 'console.log("PRIVATE_CODE");', world: 'MAIN', allowedWorlds: ['user_scripts', 'main'], urlAllowlistEnabled: true, urlPatterns: ['*'], ...extra });
const triggerItem = (extra = {}) => ({ id: 't', name: 'trigger', patterns: ['https://example.com/*'], commands: ['target'], allowedWorlds: ['user_scripts', 'main'], ...extra });
function setup(trigger = triggerItem(), fn = functionItem()) {
    clearTabInvocations(1);
    db = {
        [triggerKey]: JSON.stringify([trigger]),
        local_storage_key_lambdas: JSON.stringify([fn]),
        local_storage_key_allow_main_world_functions: true,
        local_storage_key_allow_main_world_triggers: true
    };
    injections = []; pageUrl = 'https://example.com/page'; afterInjection = () => {};
    const inject = async (args) => { injections.push(args); afterInjection(); return [{}]; };
    globalThis.chrome = {
        storage: { local: { get: async (key) => ({ [key]: db[key] }), set: async (value) => Object.assign(db, value) } },
        tabs: { get: async () => ({ url: pageUrl }), sendMessage: async (tabId, context) => {
            finishInvocation(context.invocationToken, tabId, context.requestId);
        } },
        scripting: { executeScript: inject }, userScripts: { execute: inject }
    };
}

test('main-world trigger commands use function gates and ignore obsolete trigger world gates', async () => {
    for (const triggerGlobal of [true, false]) for (const functionGlobal of [true, false]) {
        for (const triggerMain of [true, false]) for (const functionMain of [true, false]) {
            setup(triggerItem({ commands: ['@main-world target'], allowedWorlds: triggerMain ? ['main'] : ['user_scripts'] }), functionItem({ allowedWorlds: functionMain ? ['main'] : ['user_scripts'] }));
            db.local_storage_key_allow_main_world_triggers = triggerGlobal;
            db.local_storage_key_allow_main_world_functions = functionGlobal;
            await runTriggers(1, pageUrl);
            assert.equal(injections.length, functionGlobal && functionMain ? 1 : 0);
            assert.doesNotMatch(JSON.stringify(db.activityLogs || []), /PRIVATE_CODE/);
        }
    }
});

test('prefixes use function permissions regardless of obsolete trigger world fields', async () => {
    setup(triggerItem({ allowedWorlds: ['user_scripts'], commands: ['target', '@main-world target', '@user-world target'] }));
    await runTriggers(1, pageUrl);
    assert.deepEqual(injections.map((entry) => entry.world), ['MAIN', 'MAIN', 'USER_SCRIPT']);
    for (const command of ['target', '@main-world target', '@user-world target']) {
        setup(triggerItem({ allowedWorlds: ['main'], commands: [command] }), functionItem({ allowedWorlds: ['user_scripts'] }));
        await runTriggers(1, pageUrl);
        assert.deepEqual(injections.map((entry) => entry.world), command.startsWith('@user-world') ? ['USER_SCRIPT'] : []);
    }
});

test('trigger commands wait for the matching authenticated result before continuing', async () => {
    setup(triggerItem({ commands: ['target', '@user-world target'] }));
    let first;
    let started;
    const ready = new Promise((resolve) => { started = resolve; });
    chrome.tabs.sendMessage = async (tabId, context) => {
        if (!first) { first = context; started(); }
        else finishInvocation(context.invocationToken, tabId, context.requestId);
    };
    const running = runTriggers(1, pageUrl);
    await ready;
    await new Promise(setImmediate);
    assert.equal(injections.length, 1);
    assert.equal(finishInvocation('wrong-token', 1, first.requestId), false);
    assert.equal(finishInvocation(first.invocationToken, 2, first.requestId), false);
    assert.equal(finishInvocation(first.invocationToken, 1, 'wrong-request'), false);
    await new Promise(setImmediate);
    assert.equal(injections.length, 1);
    assert.equal(finishInvocation(first.invocationToken, 1, first.requestId, { return: 'done' }), true);
    await running;
    assert.deepEqual(injections.map((entry) => entry.world), ['MAIN', 'USER_SCRIPT']);
    assert.equal(finishInvocation(first.invocationToken, 1, first.requestId), false);
});

test('runtime errors, blocked commands, injection failures and disconnected tabs stop the remaining commands', async () => {
    for (const failure of ['runtime', 'blocked', 'injection', 'disconnect']) {
        setup(triggerItem({ commands: ['target', '@user-world target'] }));
        if (failure === 'blocked') db.local_storage_key_lambdas = JSON.stringify([functionItem({ allowedWorlds: [] })]);
        if (failure === 'injection') chrome.scripting.executeScript = async (args) => { injections.push(args); throw new Error('injection failed'); };
        chrome.tabs.sendMessage = async (tabId, context) => {
            if (failure === 'disconnect') clearTabInvocations(tabId);
            else finishInvocation(context.invocationToken, tabId, context.requestId, { error: 'runtime failed' });
        };
        await runTriggers(1, pageUrl);
        assert.equal(injections.length, failure === 'blocked' ? 0 : 1, failure);
    }
});

test('legacy trigger world fields never restrict otherwise permitted functions', async () => {
    const legacy = { id: 't', name: 'trigger', patterns: ['*'], commands: ['target'] };
    setup(legacy, functionItem({ world: 'USER_SCRIPT' }));
    db.local_storage_key_allow_main_world_triggers = false;
    db.local_storage_key_allow_main_world_functions = false;
    await runTriggers(1, pageUrl);
    assert.equal(injections.length, 1);
    for (const allowedWorlds of [undefined, [], null, 'main']) {
        setup(triggerItem({ allowedWorlds }));
        db.local_storage_key_allow_main_world_triggers = false;
        await runTriggers(1, pageUrl);
        assert.equal(injections.length, 1);
    }
});

test('both page policies are enforced against the current tab, not only the dispatch URL', async () => {
    setup(); pageUrl = 'https://other.test/';
    await runTriggers(1, 'https://example.com/old-page');
    assert.equal(injections.length, 0);
    setup(triggerItem(), functionItem({ urlAllowlistEnabled: true, urlPatterns: ['https://other.test/*'] }));
    await runTriggers(1, pageUrl);
    assert.equal(injections.length, 0);
    for (const patterns of [[], ['/[/'], null]) {
        setup(triggerItem({ patterns }));
        await runTriggers(1, pageUrl);
        assert.equal(injections.length, 0);
    }
    setup(); chrome.tabs.get = async () => { throw new Error('tab gone'); };
    await runTriggers(1, pageUrl);
    assert.equal(injections.length, 0);
});

test('revocation, removal and changed commands take effect before the next dispatch', async () => {
    for (const change of ['delete', 'enabled', 'function-world', 'global', 'project', 'pages', 'commands']) {
        setup(triggerItem({ commands: ['target', '@main-world target'] }));
        afterInjection = () => {
            const triggers = JSON.parse(db[triggerKey]);
            if (change === 'delete') triggers.splice(0);
            if (change === 'enabled') triggers[0].enabled = false;
            if (change === 'function-world') db.local_storage_key_lambdas = JSON.stringify([functionItem({ allowedWorlds: [] })]);
            if (change === 'project') db.local_storage_key_project_settings = { default: { triggers: { enabled: false } } };
            if (change === 'global') db.local_storage_key_allow_main_world_functions = false;
            if (change === 'pages') triggers[0].patterns = [];
            if (change === 'commands') triggers[0].commands = ['target'];
            db[triggerKey] = JSON.stringify(triggers);
        };
        await runTriggers(1, pageUrl);
        assert.equal(injections.length, 1, change);
    }
});

test('direct function execution does not inherit unrelated trigger restrictions', async () => {
    setup(triggerItem({ allowedWorlds: [] }));
    db.local_storage_key_allow_main_world_triggers = false;
    await executeLambda(1, 'target', 'direct');
    assert.equal(injections.length, 1);
});

test('CLI definition updates preserve local automatic execution and ignore incoming grants', () => {
    for (const allowedWorlds of [[], ['main'], ['user_scripts'], null]) {
        const original = triggerItem({ allowedWorlds, enabled: false, project: 'project' });
        const records = [structuredClone(original)];
        applyTriggerDefinitionUpdate(records, { name: 'trigger', project: 'project', patterns: ['https://updated.test/*'], commands: ['next'], enabled: true, allowedWorlds: ['user_scripts', 'main'] });
        assert.deepEqual(records[0], { ...original, patterns: ['https://updated.test/*'], commands: ['next'] });
    }
    const records = [];
    const created = applyTriggerDefinitionUpdate(records, { name: 'new', patterns: ['*'], commands: ['target'], allowedWorlds: ['main'] });
    assert.equal(Object.hasOwn(created, 'allowedWorlds'), false);
    assert.equal(created.enabled, true);
    assert.equal(Object.hasOwn(created, 'urlPatterns'), false);
    assert.deepEqual(created.patterns, ['*']);
});

test('trigger paths remain mandatory even if stored data includes an allowlist-off flag', async () => {
    setup(triggerItem({ urlAllowlistEnabled: false }));
    pageUrl = 'https://other.test/';
    await runTriggers(1, 'https://example.com/initial');
    assert.equal(injections.length, 0);
});
