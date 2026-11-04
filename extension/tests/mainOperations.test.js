import { backgroundBrowser } from './helpers/backgroundBrowser.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { handleMainRequest } from '../src/background/mainOperations.js';
import { registerInvocation, verifiedInvocation, finishInvocation } from '../src/background/invocations.js';

const lambda = { id: 'main', name: 'main', project: 'tools', func: '', allowedWorlds: ['user_scripts', 'main'], urlAllowlistEnabled: false };
async function setup() {
    const browser = backgroundBrowser([lambda]);
    browser.db.local_storage_key_allow_main_world_functions = true;
    const current = registerInvocation({ lambda, tabId: 1, documentId: 'doc-1', executionWorld: 'USER_SCRIPT_WORLD', requestId: 'request' });
    const invocation = await verifiedInvocation(current.token, 1);
    assert.ok(invocation);
    const calls = [];
    chrome.scripting.executeScript = async (options) => {
        calls.push(options);
        return [{ documentId: 'doc-1', result: await options.func(...options.args) }];
    };
    const request = message => handleMainRequest({ id: 'operation', operation: 'get', path: 'app', ...message }, invocation, current.token);
    const close = () => finishInvocation(current.token, 1, 'request');
    return { browser, current, invocation, calls, request, close };
}

test('MAIN get/call target the authorized document and preserve plain snapshots and method receiver', async () => {
    const instance = await setup();
    globalThis.window = { app: { value: 2, sum(n) { return Promise.resolve({ sum: this.value + n }); } } };
    assert.deepEqual((await instance.request({ operation: 'call', path: 'app.sum', args: [3] })).value, { sum: 5 });
    assert.equal((await instance.request({ path: 'app.value' })).value, 2);
    assert.deepEqual(instance.calls[0].target, { tabId: 1, documentIds: ['doc-1'] });
    assert.equal(instance.calls[0].world, 'MAIN');
    instance.close(); delete globalThis.window;
});

test('MAIN snapshots reject executable, lossy and cyclic values without invoking getters', async () => {
    const instance = await setup();
    let getterCalls = 0;
    const accessor = Object.defineProperty({}, 'secret', { enumerable: true, get() { getterCalls++; return 1; } });
    const circular = {}; circular.self = circular;
    const values = [() => 1, NaN, Infinity, 1n, Symbol('x'), new Date(), [1, , 3], accessor, circular, { [Symbol('x')]: 1 }];
    for (const value of values) {
        globalThis.window = { app: value };
        assert.match((await instance.request({})).error, /plain JSON|dense arrays/);
        assert.match((await instance.request({ operation: 'call', path: 'app', args: [value] })).error, /plain JSON|dense arrays/);
    }
    assert.equal(getterCalls, 0);
    globalThis.window = { app: undefined };
    assert.equal((await instance.request({})).value, undefined);
    instance.close(); delete globalThis.window;
});

test('MAIN validates operations and callbacks before browser injection', async () => {
    const instance = await setup();
    for (const message of [
        { operation: 'unknown' }, { path: '' }, { path: 'app..value' },
        { operation: 'call', args: {} }, { operation: 'run', source: '' }, { operation: 'run', source: null }
    ]) assert.ok((await instance.request(message)).error);
    assert.equal(instance.calls.length, 0);
    instance.close();
});

test('MAIN callback receives only explicit data and no worker lexical authority', async () => {
    const instance = await setup();
    let injected;
    chrome.userScripts.execute = async options => {
        injected = options;
        return [{ documentId: 'doc-1', result: await runInNewContext(options.js[0].code, {}) }];
    };
    const result = await instance.request({ operation: 'run', source: 'arg => ({ value: arg.value, ctx: typeof ctx, grant: typeof connectionGrant, worker: typeof invocation })', arg: { value: 7 } });
    assert.deepEqual(result.value, { value: 7, ctx: 'undefined', grant: 'undefined', worker: 'undefined' });
    assert.deepEqual(injected.target, { tabId: 1, documentIds: ['doc-1'] });
    assert.equal(injected.world, 'MAIN');
    instance.close();
});

test('MAIN default is denied and policy changes block the browser operation', async () => {
    for (const change of [
        browser => { delete browser.db.local_storage_key_allow_main_world_functions; },
        browser => { browser.db.local_storage_key_lambdas = JSON.stringify([{ ...lambda, allowedWorlds: ['user_scripts'] }]); },
        browser => { browser.db.local_storage_key_project_settings = { tools: { functions: { mainWorld: false } } }; }
    ]) {
        const instance = await setup();
        change(instance.browser);
        assert.match((await instance.request({})).error, /MAIN access blocked/);
        assert.equal(instance.calls.length, 0);
        instance.close();
    }
});

test('MAIN discards late results after invocation end and rejects wrong-document results', async () => {
    const instance = await setup();
    let resolve, started;
    const began = new Promise(done => { started = done; });
    chrome.scripting.executeScript = () => { started(); return new Promise(done => { resolve = done; }); };
    const pending = instance.request({});
    await began;
    instance.close();
    resolve([{ documentId: 'doc-1', result: { ok: true, defined: true, json: '42' } }]);
    assert.match((await pending).error, /invocation ended/);
    const next = await setup();
    chrome.scripting.executeScript = async () => [{ documentId: 'replacement', result: { ok: true, defined: true, json: '42' } }];
    assert.match((await next.request({})).error, /target document/);
    next.close();
});

test('MAIN browser failures and deadlines reject without retrying effects', async context => {
    const instance = await setup();
    let calls = 0;
    chrome.scripting.executeScript = async () => { calls++; throw new Error('Cannot access document'); };
    assert.match((await instance.request({})).error, /Cannot access document/);
    context.mock.timers.enable({ apis: ['setTimeout'] });
    let started;
    const began = new Promise(done => { started = done; });
    chrome.scripting.executeScript = () => { calls++; started(); return new Promise(() => {}); };
    const pending = instance.request({});
    await began;
    context.mock.timers.tick(30000);
    assert.match((await pending).error, /timed out.*effects may already have occurred/);
    assert.equal(calls, 2);
    instance.close();
});
