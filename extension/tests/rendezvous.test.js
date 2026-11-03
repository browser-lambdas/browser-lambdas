import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { compileRuntime } from './helpers/runtimeHarness.js';

test('qToken rendezvous matches both endpoints and ignores unrelated messages', { timeout: 2000 }, async () => {
    const listeners = new Set(), announcements = [], results = [], timers = new Map();
    const channels = new Map();
    let privateListener, timerId = 0, complete;
    const finished = new Promise(resolve => { complete = resolve; });
    const window = {
        addEventListener(_type, listener) { listeners.add(listener); },
        removeEventListener(_type, listener) { listeners.delete(listener); },
        postMessage(data, target, ports = []) { announcements.push({ data, target, ports }); }
    };
    const bgPort = {
        onDisconnect: { addListener() {} }, onMessage: { addListener(listener) { privateListener = listener; } },
        postMessage(message) {
            results.push(message);
            if (message.type === 'LAMBDA_RESULT') complete();
        }
    };
    const sandbox = createContext({
        window, crypto,
        log: { dbg() {}, err() {} },
        setInterval() {}, clearInterval() {},
        setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
        clearTimeout(id) { timers.delete(id); },
        chrome: { runtime: {
            connect: () => bgPort,
            onMessage: { addListener() {} },
            sendMessage(_message, callback) { callback({ tabId: 1 }); }
        } },
        MessageChannel: class {
            constructor() {
                this.port1 = { close() {} }; this.port2 = { close() {} };
                this.port1.peer = this.port2; this.port2.peer = this.port1;
            }
        },
        createSecureChannel(options) {
            channels.set(options.port, options);
            return {
                ready: Promise.resolve(), close() {},
                send(message) { return Promise.resolve(channels.get(options.port.peer).onMessage(message)); }
            };
        }
    });
    runInContext(readFileSync(new URL('../src/content/messages.js', import.meta.url), 'utf8'), sandbox);
    const credentials = {
        qToken: 'question', aToken: 'answer', handshakeId: 'handshake',
        sessionKey: 'private-session-key', requestId: 'invocation', nestedDepth: 0
    };
    const secureSource = readFileSync(new URL('../src/shared/secureChannel.js', import.meta.url), 'utf8');
    const template = compileRuntime('return 42;', credentials).replace(secureSource, 'const createSecureChannel = globalThis.createSecureChannel;');
    await runInContext(template, sandbox);
    const dispatch = async (data, source = window, ports = []) => {
        for (const listener of [...listeners]) await listener({ data, source, ports });
    };
    await dispatch({ type: 'qToken', qToken: credentials.qToken }, {});
    await dispatch({ type: 'qToken', qToken: 'wrong-token' });
    await dispatch({ type: 'unrelated', qToken: credentials.qToken });
    await dispatch({ type: 'aToken', aToken: 'wrong-token' });
    assert.equal(announcements.length, 0, 'unrelated messages must not advance the rendezvous');
    await privateListener({ type: 'BACKGROUND_INIT_HANDSHAKE', ...credentials, invocationToken: 'trusted' });
    assert.equal(announcements[0].data.type, 'qToken');
    assert.equal(announcements[0].data.qToken, credentials.qToken);
    await dispatch(announcements[0].data);
    assert.equal(announcements[1].data.type, 'aToken');
    assert.equal(announcements[1].data.aToken, credentials.aToken);
    await dispatch(announcements[1].data);
    const transfer = announcements[2];
    assert.equal(transfer.data.type, 'CONTENT_SCRIPT_HANDSHAKE');
    assert.equal(transfer.ports.length, 1);
    await dispatch(transfer.data, window, transfer.ports);
    await finished;
    assert.equal(results.at(-1).result.return, 42);
    assert.equal(timers.size, 0, 'authenticated readiness clears the startup deadline');
    assert.equal(announcements.every(({ data }) => !('sessionKey' in data)), true);
});

test('full MAIN result survives real encrypted MessageChannel delivery and receiver cleanup', { timeout: 3000 }, async context => {
    const { MessageChannel: NativeMessageChannel } = await import('node:worker_threads');
    const ports = [];
    class MessageChannel extends NativeMessageChannel {
        constructor() { super(); ports.push(this.port1, this.port2); }
    }
    context.after(() => { disconnect?.(); ports.forEach(port => port.close()); });
    const { credentials, flush } = await import('./helpers/runtimeHarness.js');
    const setup = credentials('real-channel');
    const listeners = new Set(), messages = [], output = [];
    let privateListener, disconnect, resolve;
    const finished = new Promise(done => { resolve = done; });
    const window = {
        addEventListener(_type, listener) { listeners.add(listener); },
        removeEventListener(_type, listener) { listeners.delete(listener); },
        postMessage(data, _target, ports = []) {
            queueMicrotask(() => { for (const listener of [...listeners]) listener({ source: window, data, ports }); });
        }
    };
    const sandbox = createContext({ window, crypto, MessageChannel, TextEncoder, TextDecoder, atob, btoa,
        setTimeout, clearTimeout, setInterval, clearInterval,
        appendShellOutput: (_level, values) => output.push(...values),
        log: { dbg() {}, err() {}, info() {} },
        chrome: { runtime: {
            connect: () => ({ onDisconnect: { addListener(listener) { disconnect = listener; } }, onMessage: { addListener(listener) { privateListener = listener; } },
                postMessage(message) { messages.push(structuredClone(message)); if (message.type === 'LAMBDA_RESULT') resolve(message); } }),
            onMessage: { addListener() {} }, sendMessage: (_message, done) => done({ tabId: 1 })
        } }
    });
    runInContext(readFileSync(new URL('../src/shared/secureChannel.js', import.meta.url), 'utf8'), sandbox);
    runInContext(readFileSync(new URL('../src/content/messages.js', import.meta.url), 'utf8'), sandbox);
    await runInContext(compileRuntime('for (let i = 0; i < 20; i++) console.log("output-" + i); return 42;', setup), sandbox);
    await privateListener({ type: 'BACKGROUND_INIT_HANDSHAKE', ...setup, invocationToken: 'trusted', executionWorld: 'MAIN_WORLD' });
    const result = await finished;
    await flush();
    assert.equal(result.result.return, 42);
    assert.equal(result.id, 'real-channel');
    assert.equal(messages.filter(message => message.type === 'LAMBDA_RESULT').length, 1);
    assert.deepEqual(output, Array.from({ length: 20 }, (_, index) => `output-${index}`));
    assert.equal(runInContext('runtimeHandshakes.size + channelToPort.size', sandbox), 0);
});
