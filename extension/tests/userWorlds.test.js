import { backgroundBrowser, tick } from './helpers/backgroundBrowser.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { executeLambda } from '../src/background/executeLambda.js';

const lambda = { id: 'f', name: 'test', project: 'tools', func: 'return 1;', allowedWorlds: ['user_scripts'], urlAllowlistEnabled: false };
let moduleId = 0;
async function worldsFixture(initial = []) {
    const configurations = new Map(initial.map((configuration) => [configuration.worldId, configuration]));
    const configured = [], reset = [], injected = [];
    globalThis.chrome = { userScripts: {
        getWorldConfigurations: async () => [...configurations.values()],
        configureWorld: async (configuration) => { configured.push(configuration); configurations.set(configuration.worldId, configuration); },
        resetWorldConfiguration: async (id) => { reset.push(id); configurations.delete(id); },
        execute: async (args) => { injected.push(args); return [{ documentId: 'doc', result: true }]; }
    } };
    const module = await import(`../src/background/userWorlds.js?world-tests=${moduleId++}`);
    return { ...module, configurations, configured, reset, injected };
}

test('worker recovery removes stale lambda configurations and disables default-world messaging', async () => {
    const worlds = await worldsFixture([{ worldId: 'lambda-stale', messaging: true }, { worldId: 'another-tool', messaging: true }]);
    await Promise.all([worlds.recoverUserWorlds(), worlds.recoverUserWorlds()]);
    assert.deepEqual(worlds.reset, ['lambda-stale']);
    assert.equal(worlds.configurations.has('another-tool'), true);
    assert.equal(worlds.configured.filter((entry) => !entry.worldId).length, 1);
    assert.equal(worlds.configurations.get(undefined).messaging, false);
});

test('concurrent calls reuse their named world until the final reference is released', async () => {
    const worlds = await worldsFixture();
    const ids = await Promise.all(Array.from({ length: 3 }, () => worlds.configureUserWorld(lambda, [])));
    assert.equal(new Set(ids).size, 1);
    assert.match(ids[0], /^lambda-[0-9a-f]{64}$/);
    assert.equal(worlds.configured.filter((entry) => entry.worldId === ids[0]).length, 1);
    await worlds.releaseUserWorld(ids[0]); await worlds.releaseUserWorld(ids[0]);
    assert.deepEqual(worlds.reset, []);
    await worlds.releaseUserWorld(ids[0]);
    assert.deepEqual(worlds.reset, [ids[0]]);
    await worlds.configureUserWorld(lambda, []);
    assert.equal(worlds.configured.filter((entry) => entry.worldId === ids[0]).length, 2);
    await worlds.releaseUserWorld(ids[0]);
});

test('function identity, code and complete caller ancestry separate security boundaries', async () => {
    const worlds = await worldsFixture();
    const ancestor = { id: 'parent', name: 'parent', project: 'trusted', tabId: 1, documentId: 'doc', executionWorld: 'USER_SCRIPT_WORLD' };
    const variants = [
        [lambda, []], [{ ...lambda, id: 'different' }, []],
        [{ ...lambda, name: 'different' }, []], [{ ...lambda, project: 'other' }, []],
        [{ ...lambda, func: 'return 2;' }, []], [lambda, [ancestor]],
        [lambda, [{ ...ancestor, project: 'untrusted' }]],
        [lambda, [{ ...ancestor, documentId: 'new-document' }]],
        [lambda, [ancestor, { ...ancestor, id: 'grandparent' }]]
    ];
    const ids = await Promise.all(variants.map(([item, callers]) => worlds.configureUserWorld(item, callers)));
    assert.equal(new Set(ids).size, variants.length);
    const repeated = await worlds.configureUserWorld({ ...lambda }, []);
    assert.equal(repeated, ids[0]);
    await worlds.releaseUserWorld(repeated);
    await Promise.all(ids.map(worlds.releaseUserWorld));
});

test('preflight is credential-free and requires exact browser document and messaging success', async () => {
    const worlds = await worldsFixture();
    const worldId = await worlds.configureUserWorld(lambda, []);
    await worlds.checkUserWorld(1, 'doc', worldId);
    assert.deepEqual(worlds.injected[0].target, { tabId: 1, documentIds: ['doc'] });
    assert.equal(worlds.injected[0].worldId, worldId);
    assert.doesNotMatch(worlds.injected[0].js[0].code, /connectionGrant|sessionKey|return 1/);
    for (const result of [[], [{ documentId: 'other', result: true }], [{ documentId: 'doc', result: false }], [{ documentId: 'doc', error: 'denied' }], [{ documentId: 'doc', result: true }, { documentId: 'doc', result: true }]]) {
        chrome.userScripts.execute = async () => result;
        await assert.rejects(worlds.checkUserWorld(1, 'doc', worldId), /Reload the page/);
    }
    await worlds.releaseUserWorld(worldId);
});

test('world fallback fails before injecting lambda code or grants and never switches to MAIN', async () => {
    const browser = backgroundBrowser([lambda]);
    browser.preflightResult = false;
    await assert.rejects(executeLambda(1, 'test', 'fallback'), /Reload the page/);
    assert.equal(browser.preflights.length, 1);
    assert.equal(browser.injections.length, 0);
    assert.equal(browser.handshakes.length, 0);
    assert.equal(browser.nativePorts.length, 0);
    await tick();
    const remaining = await chrome.userScripts.getWorldConfigurations();
    assert.equal(remaining.some((entry) => entry.worldId === browser.preflights[0].worldId), false);
});

test('missing user-script support rejects without a weaker execution fallback', async () => {
    const worlds = await worldsFixture();
    delete chrome.userScripts.configureWorld;
    await assert.rejects(worlds.configureUserWorld(lambda, []), /Enable Allow User Scripts/);
    assert.equal(worlds.injected.length, 0);
});
