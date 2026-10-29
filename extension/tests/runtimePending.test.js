import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const flush = () => new Promise((resolve) => setImmediate(resolve));

async function runtime(code, send) {
    const listeners = new Set(), messages = [];
    let options;
    const window = {
        addEventListener(_type, listener) { listeners.add(listener); },
        removeEventListener(_type, listener) { listeners.delete(listener); },
        postMessage() {}
    };
    const sandbox = createContext({
        window, crypto,
        stubSecureChannel(config) {
            options = config;
            return {
                ready: Promise.resolve(), close() {},
                send(message) {
                    messages.push(message);
                    return send?.(message) || Promise.resolve();
                }
            };
        }
    });
    let source = readFileSync(new URL('../src/background/template.js', import.meta.url), 'utf8')
        .replace('__SECURE_CHANNEL_SOURCE__;', 'const createSecureChannel = globalThis.stubSecureChannel;')
        .replace('PLACEHOLDER_ARGS', '{}').replace('PLACEHOLDER_FUNC', code);
    for (const [key, value] of Object.entries({
        __Q_TOKEN__: 'q', __A_TOKEN__: 'a', __HANDSHAKE_ID__: 'handshake',
        __SESSION_KEY__: 'unused', __REQUEST_ID__: 'invocation', __NESTED_DEPTH__: 0
    })) source = source.replace(key, JSON.stringify(value));
    await runInContext(source, sandbox);
    for (const listener of [...listeners]) listener({ source: window, data: { type: 'CONTENT_SCRIPT_HANDSHAKE', handshakeId: 'handshake' }, ports: [{ close() {} }] });
    await flush();
    return {
        messages, options, sandbox,
        requests: () => messages.filter((message) => message.type.endsWith('_REQUEST')),
        result: () => messages.find((message) => message.type === 'LAMBDA_RESULT')?.result,
        async respond(request, value, error) {
            await options.onMessage({ type: request.type.replace('_REQUEST', '_RESPONSE'), id: request.id, value, error });
            await flush();
        }
    };
}

test('unawaited ctx requests delay completion until their response arrives', { timeout: 2000 }, async (t) => {
    for (const [call, value] of [
        ["ctx.kv.set('key', 'value')", true],
        ["ctx.kv.get('key')", 'value'],
        ["ctx.secrets.get('key')", 'secret'],
        ["ctx.run('child')", 'child result'],
        ["ctx.tabs.new('https://example.com')", { id: 42 }],
        ['ctx.tabs.all()', [{ id: 42 }]],
        ['ctx.tabs.this().close()', true],
        ["ctx.tabs.this().network.add({ match: { url: 'https://example.com/*' }, block: true })", { id: 'rule' }],
        ['ctx.tabs.this().network.list()', []],
        ['ctx.tabs.this().network.clear()', true]
    ]) {
        await t.test(call, async () => {
            const instance = await runtime(`${call}; return 'done';`);
            assert.equal(instance.requests().length, 1);
            assert.equal(instance.result(), undefined, 'completion must wait for the response');
            await instance.respond(instance.requests()[0], value);
            assert.equal(instance.result()?.return, 'done');
        });
    }
});

test('completion drains requests started by earlier request callbacks', { timeout: 2000 }, async () => {
    const instance = await runtime(`
        ctx.tabs.new('https://example.com').then((tab) => tab.focus()).then(() => ctx.kv.set('key', 'value'));
        return 'done';
    `);
    await instance.respond(instance.requests()[0], { id: 42 });
    assert.equal(instance.requests()[1].operation, 'FOCUS_TAB');
    assert.equal(instance.result(), undefined);
    await instance.respond(instance.requests()[1], true);
    assert.equal(instance.requests()[2].type, 'SET_STORAGE_REQUEST');
    assert.equal(instance.result(), undefined);
    await instance.respond(instance.requests()[2], true);
    assert.equal(instance.result()?.return, 'done');
});

test('a rejected unawaited network call still waits for other requests', { timeout: 2000 }, async () => {
    const instance = await runtime(`
        ctx.tabs.this().network.add({});
        ctx.kv.set('key', 'value');
        return 'done';
    `);
    await instance.respond(instance.requests()[0], undefined, 'Network access denied');
    assert.equal(instance.result(), undefined);
    await instance.respond(instance.requests()[1], true);
    assert.equal(instance.result()?.return, 'done');
});

test('channel failure releases pending requests and subsequent legacy requests', { timeout: 2000 }, async () => {
    const instance = await runtime(`
        ctx.tabs.new().then((tab) => { globalThis.tab = tab; return ctx.kv.get('later'); });
        ctx.kv.set('key', 'value');
        ctx.tabs.this().network.add({});
        return 'done';
    `);
    assert.equal(instance.requests().length, 3);
    assert.equal(instance.result(), undefined);
    instance.options.onError(new Error('Channel failed'));
    await flush();
    assert.equal(instance.result()?.return, 'done');
    assert.equal(instance.sandbox.tab, undefined);
    assert.equal(instance.requests().length, 3, 'no requests are sent after channel failure');
    assert.doesNotThrow(() => instance.options.onError(new Error('Duplicate failure')));
});

test('send failures settle legacy requests and reject network requests', { timeout: 2000 }, async () => {
    const instance = await runtime(`
        globalThis.values = await Promise.all([ctx.kv.get('key'), ctx.tabs.new()]);
        try { await ctx.tabs.this().network.add({}); }
        catch (error) { globalThis.error = error.message; }
        return 'done';
    `, (message) => message.type.endsWith('_REQUEST') ? Promise.reject(new Error('Send failed')) : undefined);
    assert.deepEqual(Array.from(instance.sandbox.values), [undefined, undefined]);
    assert.equal(instance.sandbox.error, 'Send failed');
    assert.equal(instance.result()?.return, 'done');
});
