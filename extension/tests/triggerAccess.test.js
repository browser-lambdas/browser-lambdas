import assert from 'node:assert/strict';
import test from 'node:test';
import { runTriggers } from '../src/background/runTriggers.js';
import { executeLambda } from '../src/background/executeLambda.js';
import { applyTriggerDefinitionUpdate } from '../src/shared/triggerUpdates.js';

const triggerKey = 'local_storage_key_triggers';
let db, injections, pageUrl, afterInjection;
const functionItem = (extra = {}) => ({ id: 'f', name: 'target', func: 'console.log("PRIVATE_CODE");', world: 'MAIN', allowedWorlds: ['user_scripts', 'main'], urlAllowlistEnabled: true, urlPatterns: ['*'], ...extra });
const triggerItem = (extra = {}) => ({ id: 't', name: 'trigger', patterns: ['https://example.com/*'], commands: ['target'], allowedWorlds: ['user_scripts', 'main'], ...extra });
function setup(trigger = triggerItem(), fn = functionItem()) {
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
        tabs: { get: async () => ({ url: pageUrl }), sendMessage: async () => {} },
        scripting: { executeScript: inject }, userScripts: { execute: inject }
    };
}

test('main-world trigger commands require both categories and both item grants', async () => {
    for (const triggerGlobal of [true, false]) for (const functionGlobal of [true, false]) {
        for (const triggerMain of [true, false]) for (const functionMain of [true, false]) {
            setup(triggerItem({ commands: ['@main-world target'], allowedWorlds: triggerMain ? ['main'] : ['user_scripts'] }), functionItem({ allowedWorlds: functionMain ? ['main'] : ['user_scripts'] }));
            db.local_storage_key_allow_main_world_triggers = triggerGlobal;
            db.local_storage_key_allow_main_world_functions = functionGlobal;
            await runTriggers(1, pageUrl);
            assert.equal(injections.length, triggerGlobal && functionGlobal && triggerMain && functionMain ? 1 : 0);
            assert.doesNotMatch(JSON.stringify(db.activityLogs || []), /PRIVATE_CODE/);
        }
    }
});

test('prefixes resolve before trigger authorization; denied commands do not prevent allowed commands', async () => {
    setup(triggerItem({ allowedWorlds: ['user_scripts'], commands: ['target', '@main-world target', '@user-world target'] }));
    await runTriggers(1, pageUrl);
    assert.deepEqual(injections.map((entry) => entry.world), ['USER_SCRIPT']);
    setup(triggerItem({ allowedWorlds: ['main'], commands: ['target', '@main-world target', '@user-world target'] }), functionItem({ world: 'USER_SCRIPT' }));
    await runTriggers(1, pageUrl);
    assert.deepEqual(injections.map((entry) => entry.world), ['MAIN']);
});

test('legacy triggers preserve pages and default to user-script-only access', async () => {
    const legacy = { id: 't', name: 'trigger', patterns: ['*'], commands: ['target'] };
    setup(legacy, functionItem({ world: 'USER_SCRIPT' }));
    db.local_storage_key_allow_main_world_triggers = false;
    db.local_storage_key_allow_main_world_functions = false;
    await runTriggers(1, pageUrl);
    assert.equal(injections.length, 1);
    setup(legacy);
    await runTriggers(1, pageUrl);
    assert.equal(injections.length, 0);
    for (const allowedWorlds of [[], null, 'main']) {
        setup(triggerItem({ allowedWorlds }));
        await runTriggers(1, pageUrl);
        assert.equal(injections.length, 0);
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
    for (const change of ['delete', 'world', 'global', 'pages', 'commands']) {
        setup(triggerItem({ commands: ['target', '@main-world target'] }));
        afterInjection = () => {
            const triggers = JSON.parse(db[triggerKey]);
            if (change === 'delete') triggers.splice(0);
            if (change === 'world') triggers[0].allowedWorlds = [];
            if (change === 'global') db.local_storage_key_allow_main_world_triggers = false;
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

test('CLI definition updates preserve local worlds and ignore incoming world grants', () => {
    for (const allowedWorlds of [[], ['main'], ['user_scripts'], null]) {
        const original = triggerItem({ allowedWorlds, project: 'project' });
        const records = [structuredClone(original)];
        applyTriggerDefinitionUpdate(records, { name: 'trigger', project: 'project', patterns: ['https://updated.test/*'], commands: ['next'], allowedWorlds: ['user_scripts', 'main'] });
        assert.deepEqual(records[0], { ...original, patterns: ['https://updated.test/*'], commands: ['next'] });
    }
    const records = [];
    const created = applyTriggerDefinitionUpdate(records, { name: 'new', patterns: ['*'], commands: ['target'], allowedWorlds: ['main'] });
    assert.deepEqual(created.allowedWorlds, ['user_scripts']);
    assert.equal(Object.hasOwn(created, 'urlPatterns'), false);
    assert.deepEqual(created.patterns, ['*']);
});

test('trigger paths remain mandatory even if stored data includes an allowlist-off flag', async () => {
    setup(triggerItem({ urlAllowlistEnabled: false }));
    pageUrl = 'https://other.test/';
    await runTriggers(1, 'https://example.com/initial');
    assert.equal(injections.length, 0);
});
