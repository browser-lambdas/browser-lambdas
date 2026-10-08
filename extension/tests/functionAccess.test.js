import assert from 'node:assert/strict';
import test from 'node:test';
import { executeLambda } from '../src/background/executeLambda.js';
import { runTriggers } from '../src/background/runTriggers.js';
import { applyFunctionCodeUpdate } from '../src/shared/functionUpdates.js';

let db, injected, handshakes;
const lambda = (extra = {}) => ({ id: 'f', name: 'test', func: 'console.log("PRIVATE_CODE");', allowedWorlds: ['user_scripts'], urlAllowlistEnabled: true, urlPatterns: ['https://example.com/*'], ...extra });
function setup(lambdas = [lambda()]) {
    db = { local_storage_key_lambdas: JSON.stringify(lambdas) };
    injected = []; handshakes = [];
    globalThis.chrome = {
        storage: { local: { get: async (key) => ({ [key]: db[key] }), set: async (value) => Object.assign(db, value) } },
        tabs: { get: async (id) => ({ url: id === 1 ? 'https://example.com/page' : 'https://other.test/' }), sendMessage: async (...args) => handshakes.push(args) },
        scripting: { executeScript: async (args) => { injected.push(args); return [{}]; } },
        userScripts: { execute: async (args) => { injected.push(args); return [{}]; } }
    };
}

test('function authorization precedes injection and handshake for every world/page combination', async () => {
    for (const prefix of ['', '@main-world ', '@user-world ']) {
        for (const world of ['MAIN', 'USER_SCRIPT']) {
            for (const allowedWorlds of [[], ['user_scripts'], ['main'], ['user_scripts', 'main']]) {
                for (const global of [false, true]) {
                    for (const tabId of [1, 2]) {
                        setup([lambda({ world, allowedWorlds })]);
                        db.local_storage_key_allow_main_world_functions = global;
                        const available = [allowedWorlds.includes('user_scripts') && 'USER_SCRIPT', global && allowedWorlds.includes('main') && 'MAIN'].filter(Boolean);
                        const resolved = available.includes(world) ? world : available[0] || world;
                        const main = prefix === '@main-world ' || (!prefix && resolved === 'MAIN');
                        const allowed = tabId === 1 && allowedWorlds.includes(main ? 'main' : 'user_scripts') && (!main || global);
                        const result = await executeLambda(tabId, `${prefix}test`, 'request');
                        assert.equal(result?.started !== false, allowed);
                        assert.equal(injected.length, allowed ? 1 : 0);
                        assert.equal(handshakes.length, allowed ? 1 : 0);
                        if (allowed) assert.equal(injected[0].world, main ? 'MAIN' : 'USER_SCRIPT');
                        else assert.doesNotMatch(result.error, /PRIVATE_CODE/);
                    }
                }
            }
        }
    }
});

test('enabled empty or malformed page policies, missing tabs and explicit denial never execute', async () => {
    for (const item of [lambda({ urlAllowlistEnabled: true, urlPatterns: [] }), lambda({ urlAllowlistEnabled: true, urlPatterns: ['/[/'] }), lambda({ allowedWorlds: null })]) {
        setup([item]);
        assert.equal((await executeLambda(1, 'test', 'id')).started, false);
        assert.equal(injected.length, 0);
    }
    setup(); chrome.tabs.get = async () => { throw new Error('closed tab'); };
    assert.equal((await executeLambda(1, 'test', 'id')).started, false);
});

test('nested and trigger calls enforce the target function policy and target tab', async () => {
    setup();
    assert.equal((await executeLambda(2, 'test', 'nested', 1)).started, false);
    assert.equal(injected.length, 0);
    db.local_storage_key_triggers = JSON.stringify([{ id: 'trigger', name: 'trigger', patterns: ['*'], commands: ['test'] }]);
    await runTriggers(2, 'https://other.test/');
    assert.equal(injected.length, 0);
    await runTriggers(1, 'https://example.com/page');
    assert.equal(injected.length, 1);
    db.local_storage_key_lambdas = JSON.stringify([lambda({ urlAllowlistEnabled: true, urlPatterns: [] })]);
    assert.equal((await executeLambda(1, 'test', 'next', 1)).started, false);
    assert.equal(injected.length, 1);
});

test('conflicts and pending-review locks never inject diagnostic code', async () => {
    setup([lambda(), lambda({ id: 'second', project: 'other' })]);
    assert.match((await executeLambda(1, 'test', 'id')).error, /name conflict/);
    assert.equal(injected.length, 0);
    setup();
    db.local_storage_key_baah_pending_batches = JSON.stringify([{ items: [{ type: 'lambda', name: 'test', action: 'update' }] }]);
    assert.match((await executeLambda(1, 'test', 'id')).error, /locked/);
    assert.equal(injected.length, 0);
});

test('CLI auto-apply and reviewed code updates preserve current local permissions', () => {
    const original = lambda({ world: 'MAIN', allowedWorlds: [], urlAllowlistEnabled: true, urlPatterns: ['https://restricted.test/*'], project: 'project' });
    const collection = [structuredClone(original)];
    applyFunctionCodeUpdate(collection, { name: 'test', project: 'project', func: 'updated', allowedWorlds: ['main'], urlAllowlistEnabled: true, urlPatterns: ['*'], world: 'USER_SCRIPT' });
    assert.deepEqual(collection[0], { ...original, func: 'updated' });
    const created = applyFunctionCodeUpdate(collection, { name: 'new', project: 'project', func: 'new', allowedWorlds: ['main'], urlAllowlistEnabled: true, urlPatterns: ['*'], world: 'MAIN' });
    assert.deepEqual(created.allowedWorlds, ['user_scripts']);
    assert.deepEqual(created.urlPatterns, []);
    assert.equal(created.world, 'USER_SCRIPT');
    assert.equal(collection.length, 2);
});

test('function allowlist switch permits other pages while preserving world restrictions and CLI settings', async () => {
    const configured = lambda({ urlAllowlistEnabled: false, urlPatterns: ['https://restricted.test/*'] });
    setup([configured]);
    await executeLambda(2, 'test', 'allowed');
    assert.equal(injected.length, 1);
    assert.equal((await executeLambda(2, '@main-world test', 'blocked')).started, false);
    const records = [configured];
    applyFunctionCodeUpdate(records, { name: 'test', func: 'new', urlAllowlistEnabled: true });
    assert.equal(records[0].urlAllowlistEnabled, false);
    db.local_storage_key_lambdas = JSON.stringify([{ ...records[0], urlAllowlistEnabled: true }]);
    assert.equal((await executeLambda(2, 'test', 'restricted')).started, false);
});
