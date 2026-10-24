import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('secure content relay overwrites forged execution worlds and invocation tokens', async () => {
    const source = await readFile(new URL('../src/content/messages.js', import.meta.url), 'utf8');
    for (const world of ['USER_SCRIPT_WORLD', 'MAIN_WORLD']) {
        let runtimeListener, windowListener, responseListener, deliver;
        const forwarded = [];
        const window = { addEventListener: (type, listener) => { windowListener = listener; }, postMessage: () => {} };
        const bgPort = {
            onDisconnect: { addListener() {} }, onMessage: { addListener(listener) { responseListener = listener; } },
            postMessage(msg) { forwarded.push(msg); responseListener({ type: msg.type.replace('_REQUEST', '_RESPONSE'), id: msg.id, value: true }); }
        };
        const sandbox = {
            window, chrome: { runtime: { connect: () => bgPort, onMessage: { addListener(listener) { runtimeListener = listener; } }, sendMessage: (_msg, callback) => callback({ tabId: 1 }) } },
            log: { dbg() {}, err() {} }, crypto: { randomUUID: () => 'id' },
            setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {},
            createSecureChannel(options) { deliver = options.onMessage; return { ready: Promise.resolve(), send() {}, close() {} }; },
            MessageChannel: class { constructor() { this.port1 = {}; this.port2 = {}; } }
        };
        vm.runInNewContext(source, sandbox);
        runtimeListener({ type: 'BACKGROUND_INIT_HANDSHAKE', aToken: 'token', requestId: 'channel', invocationToken: 'trusted-invocation', executionWorld: world }, {}, () => {});
        await windowListener({ source: window, data: { type: 'aToken', aToken: 'token' } });
        for (const type of ['GET_SECRET_REQUEST', 'GET_STORAGE_REQUEST', 'SET_STORAGE_REQUEST']) {
            await deliver({ type, id: type, key: 'key', invocationToken: 'forged-invocation', executionWorld: world === 'MAIN_WORLD' ? 'USER_SCRIPT_WORLD' : 'MAIN_WORLD' });
            assert.equal(forwarded.at(-1).executionWorld, world);
            assert.equal(forwarded.at(-1).invocationToken, 'trusted-invocation');
            assert.equal(forwarded.at(-1).id, type);
        }
        await deliver({ type: 'FUNCTION_CALL_REQUEST', id: 'nested', userInput: 'helper', invocationToken: 'forged-invocation' });
        assert.equal(forwarded.at(-1).type, 'EXECUTE_LAMBDA');
        assert.equal(forwarded.at(-1).invocationToken, 'trusted-invocation');
        await deliver({ type: 'LAMBDA_RESULT', id: 'forged-request', invocationToken: 'forged-invocation', result: { return: 1 } });
        assert.equal(forwarded.at(-1).id, 'channel');
        assert.equal(forwarded.at(-1).invocationToken, 'trusted-invocation');
    }
});

test('shared persistence loads as a classic content script without eager module imports', async () => {
    const source = await readFile(new URL('../src/shared/storage.js', import.meta.url), 'utf8');
    // No import callback: eager imports here would reject on ordinary web pages.
    vm.runInNewContext(source, { window: { innerWidth: 1000, innerHeight: 700 } });
    await new Promise((resolve) => setImmediate(resolve));
});

test('startup watchdog waits for authenticated runtime readiness and reports missing readiness', async () => {
    const source = await readFile(new URL('../src/content/messages.js', import.meta.url), 'utf8');
    for (const ready of [false, true]) {
        let runtimeListener, windowListener, responseListener, deliver, closed = false;
        let timerId = 0;
        const timers = new Map();
        const forwarded = [];
        const window = { addEventListener: (_type, listener) => { windowListener = listener; }, postMessage() {} };
        const bgPort = {
            onDisconnect: { addListener() {} }, onMessage: { addListener(listener) { responseListener = listener; } },
            postMessage(msg) { forwarded.push(msg); responseListener({ id: msg.id }); }
        };
        vm.runInNewContext(source, {
            window, chrome: { runtime: { connect: () => bgPort, onMessage: { addListener(listener) { runtimeListener = listener; } }, sendMessage: (_msg, callback) => callback({ tabId: 1 }) } },
            log: { dbg() {}, err() {} }, crypto: { randomUUID: () => 'id' },
            setInterval() {}, clearInterval() {},
            setTimeout(callback) { timers.set(++timerId, callback); return timerId; }, clearTimeout(id) { timers.delete(id); },
            createSecureChannel(options) { deliver = options.onMessage; return { ready: Promise.resolve(), send() {}, close() { closed = true; } }; },
            MessageChannel: class { constructor() { this.port1 = {}; this.port2 = {}; } }
        });
        runtimeListener({ type: 'BACKGROUND_INIT_HANDSHAKE', aToken: 'token', requestId: 'channel', invocationToken: 'trusted-invocation' }, {}, () => {});
        await windowListener({ source: window, data: { type: 'aToken', aToken: 'token' } });
        assert.equal(timers.size, 1, 'authenticating the client must not cancel the readiness deadline');
        if (ready) {
            await deliver({ type: 'LAMBDA_READY' });
            assert.equal(timers.size, 0);
            assert.equal(closed, false);
            assert.equal(forwarded.length, 0);
        } else {
            [...timers.values()][0]();
            const result = forwarded.at(-1);
            assert.equal(result.type, 'LAMBDA_RESULT');
            assert.equal(result.id, 'channel');
            assert.equal(result.invocationToken, 'trusted-invocation');
            assert.match(result.result.error, /runtime connection/);
            assert.equal(closed, true);
        }
    }
});
