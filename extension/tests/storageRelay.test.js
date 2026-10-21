import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('secure content relay overwrites forged execution worlds on all item requests', async () => {
    const source = await readFile(new URL('../src/content/messages.js', import.meta.url), 'utf8');
    for (const world of ['USER_SCRIPT_WORLD', 'MAIN_WORLD']) {
        let runtimeListener, windowListener, responseListener, port;
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
            encrypt: async (msg) => msg, decrypt: async (msg) => msg,
            MessageChannel: class { constructor() { port = this.port1 = { postMessage() {}, close() {} }; this.port2 = {}; } }
        };
        vm.runInNewContext(source, sandbox);
        runtimeListener({ type: 'BACKGROUND_INIT_HANDSHAKE', aToken: 'token', requestId: 'channel', handshakeLambdaToken: 'lambda', executionWorld: world }, {}, () => {});
        await windowListener({ source: window, data: { type: 'aToken', aToken: 'token' } });
        await port.onmessage({ data: { type: 'HANDSHAKE_LAMBDA', token: 'lambda' } });
        for (const type of ['GET_SECRET_REQUEST', 'GET_STORAGE_REQUEST', 'SET_STORAGE_REQUEST']) {
            await port.onmessage({ data: { type, id: type, key: 'key', executionWorld: world === 'MAIN_WORLD' ? 'USER_SCRIPT_WORLD' : 'MAIN_WORLD' } });
            assert.equal(forwarded.at(-1).executionWorld, world);
            assert.equal(forwarded.at(-1).id, type);
        }
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
        let runtimeListener, windowListener, responseListener, port, closed = false;
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
            encrypt: async (msg) => msg, decrypt: async (msg) => msg,
            MessageChannel: class { constructor() { port = this.port1 = { postMessage() {}, close() { closed = true; } }; this.port2 = {}; } }
        });
        runtimeListener({ type: 'BACKGROUND_INIT_HANDSHAKE', aToken: 'token', requestId: 'channel', handshakeLambdaToken: 'lambda', invocationToken: 'trusted-invocation' }, {}, () => {});
        await windowListener({ source: window, data: { type: 'aToken', aToken: 'token' } });
        await port.onmessage({ data: { type: 'HANDSHAKE_LAMBDA', token: 'lambda' } });
        assert.equal(timers.size, 1, 'authenticating the client must not cancel the readiness deadline');
        if (ready) {
            await port.onmessage({ data: { type: 'LAMBDA_READY' } });
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
