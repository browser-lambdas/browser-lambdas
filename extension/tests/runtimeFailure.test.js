import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

test('runtime channel failure settles pending new-tab and KV requests without aborting cleanup', { timeout: 2000 }, async () => {
    const requestsStarted = deferred(), runtimeFinished = deferred();
    const listeners = new Set();
    const messages = [];
    let options;
    const window = {
        addEventListener(_type, listener) { listeners.add(listener); },
        removeEventListener(_type, listener) { listeners.delete(listener); },
        postMessage() {}
    };
    const sandbox = createContext({
        window, crypto,
        finishRuntime: runtimeFinished.resolve,
        stubSecureChannel(config) {
            options = config;
            return {
                ready: Promise.resolve(), close() {},
                send(message) {
                    messages.push(message);
                    if (messages.filter((value) => ['TAB_OPERATION_REQUEST', 'GET_STORAGE_REQUEST'].includes(value.type)).length === 2) requestsStarted.resolve();
                    return Promise.resolve();
                }
            };
        }
    });
    let source = readFileSync(new URL('../src/background/template.js', import.meta.url), 'utf8')
        .replace('__SECURE_CHANNEL_SOURCE__;', 'const createSecureChannel = globalThis.stubSecureChannel;')
        .replace('PLACEHOLDER_ARGS', '{}')
        .replace('PLACEHOLDER_FUNC', `
            const results = await Promise.all([ctx.tabs.new('https://example.com'), ctx.kv.get('pending-key')]);
            globalThis.runtimeValues = results;
            globalThis.finishRuntime();
            return results;
        `);
    for (const [placeholder, value] of Object.entries({
        __Q_TOKEN__: 'q', __A_TOKEN__: 'a', __HANDSHAKE_ID__: 'handshake',
        __SESSION_KEY__: 'unused-stub-key', __REQUEST_ID__: 'invocation', __NESTED_DEPTH__: 0
    })) source = source.replace(placeholder, JSON.stringify(value));
    await runInContext(source, sandbox);
    for (const listener of [...listeners]) listener({ source: window, data: { type: 'CONTENT_SCRIPT_HANDSHAKE', handshakeId: 'handshake' }, ports: [{ close() {} }] });
    await requestsStarted.promise;
    assert.equal(messages.some((message) => message.type === 'LAMBDA_RESULT'), false, 'lambda is waiting on both requests');
    assert.doesNotThrow(() => options.onError(new Error('authenticated channel failed')));
    await runtimeFinished.promise;
    assert.deepEqual(Array.from(sandbox.runtimeValues), [undefined, undefined]);
    // The failure cleanup removes resolver entries, so repeated failure notification is harmless.
    assert.doesNotThrow(() => options.onError(new Error('duplicate failure')));
});
