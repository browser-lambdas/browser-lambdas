import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

async function runtime(code, respond) {
    const completed = deferred(), networkStarted = deferred();
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
                    if (message.type === 'LAMBDA_RESULT') completed.resolve(message.result);
                    if (message.type === 'NETWORK_REQUEST') networkStarted.resolve();
                    const response = respond?.(message);
                    if (response) queueMicrotask(() => options.onMessage({ id: message.id, ...response }));
                    return Promise.resolve();
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
    return { messages, options, completed: completed.promise, networkStarted: networkStarted.promise };
}

test('network handles and management send the invoking or explicit tab with their exact rule id', { timeout: 2000 }, async () => {
    let nextId = 0;
    const instance = await runtime(`
        const current = ctx.tabs.this().network;
        const rule = await current.add({ match: { url: 'https://api.example/*' }, block: true });
        await current.list(); await current.clear(); await rule.remove();
        const other = await ctx.tabs.new('https://page.example');
        const otherRule = await other.network.add({ match: { url: 'https://api.example/*' }, block: true });
        await other.network.list(); await other.network.clear(); await otherRule.remove();
        const [listed] = await ctx.tabs.all(); await listed.network.list();
        return [rule.id, otherRule.id];
    `, (message) => {
        if (message.type === 'TAB_OPERATION_REQUEST') return { type: 'TAB_OPERATION_RESPONSE', value: message.operation === 'NEW_TAB' ? { id: 42, url: 'https://page.example' } : [{ id: 43, url: 'https://other.example' }] };
        if (message.type === 'NETWORK_REQUEST') return { type: 'NETWORK_RESPONSE', value: message.operation === 'add' ? { id: `rule-${++nextId}`, ...message.rule } : message.operation === 'list' ? [] : true };
    });
    assert.deepEqual(Array.from((await instance.completed).return), ['rule-1', 'rule-2']);
    const requests = instance.messages.filter((message) => message.type === 'NETWORK_REQUEST');
    assert.deepEqual(requests.map(({ operation, tabId, ruleId }) => [operation, tabId, ruleId]), [
        ['add', null, undefined], ['list', null, undefined], ['clear', null, undefined], ['remove', null, 'rule-1'],
        ['add', 42, undefined], ['list', 42, undefined], ['clear', 42, undefined], ['remove', 42, 'rule-2'], ['list', 43, undefined]
    ]);
});

test('network response errors reject API calls instead of returning successful handles', { timeout: 2000 }, async () => {
    const instance = await runtime(`
        const errors = [];
        for (const operation of ['add', 'list', 'clear']) {
            try { await ctx.tabs.this().network[operation]({ match: { url: 'https://api.example/*' }, block: true }); }
            catch (error) { errors.push(error.message); }
        }
        return errors;
    `, (message) => message.type === 'NETWORK_REQUEST' ? { type: 'NETWORK_RESPONSE', error: `Denied ${message.operation}` } : undefined);
    assert.deepEqual(Array.from((await instance.completed).return), ['Denied add', 'Denied list', 'Denied clear']);
});

test('channel failure rejects pending and subsequent network calls, leaving legacy calls settled', { timeout: 2000 }, async () => {
    const instance = await runtime(`
        const pending = ctx.tabs.this().network.list();
        const kv = ctx.kv.get('pending');
        const errors = [];
        try { await pending; } catch (error) { errors.push(error.message); }
        try { await ctx.tabs.this().network.clear(); } catch (error) { errors.push(error.message); }
        return { errors, legacySettled: await kv === undefined };
    `);
    await instance.networkStarted;
    instance.options.onError(new Error('Authenticated connection failed'));
    const result = (await instance.completed).return;
    assert.deepEqual(Array.from(result.errors), ['Authenticated connection failed', 'Authenticated connection failed']);
    assert.equal(result.legacySettled, true);
    assert.equal(instance.messages.filter((message) => message.type === 'NETWORK_REQUEST').length, 1);
});

test('background-port closure returns each pending request its own response type', { timeout: 2000 }, async () => {
    let disconnect;
    let closed = false;
    const context = createContext({
        crypto, log: { dbg() {}, err() {} }, setInterval: () => 1, clearInterval() {},
        chrome: { runtime: { connect: () => ({
            postMessage() { if (closed) throw new Error('Port is closed'); },
            onMessage: { addListener() {} },
            onDisconnect: { addListener(callback) { disconnect = callback; } }
        }) } }
    });
    runInContext(`${readFileSync(new URL('../src/content/messages.js', import.meta.url), 'utf8')}\nglobalThis.request = sendToBackground;`, context);
    const types = ['GET_STORAGE', 'GET_SECRET', 'SET_STORAGE', 'NETWORK'];
    const requests = types.map((type, index) => context.request({ type: `${type}_REQUEST`, id: String(index) }));
    closed = true;
    disconnect();
    const results = await Promise.all(requests);
    assert.deepEqual(results.map(({ type }) => type), types.map((type) => `${type}_RESPONSE`));
    assert.ok(results.every(({ error }) => /background connection closed/.test(error)));
    const later = await context.request({ type: 'NETWORK_REQUEST', id: 'later' });
    assert.equal(later.type, 'NETWORK_RESPONSE');
    assert.equal(later.error, 'Port is closed');
});
