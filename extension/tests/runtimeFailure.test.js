import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime, flush } from './helpers/runtimeHarness.js';

for (const transport of ['native', 'main']) {
    test(`${transport}: loss rejects pending and future calls and clears runtime timers`, { timeout: 2000 }, async () => {
        const instance = await runtime(`
            const pending = Promise.allSettled([
                ctx.tabs.new('https://example.com'), ctx.kv.get('pending'),
                ctx.tabs.this().network.list(), ctx.main.get('app.state')
            ]);
            const results = await pending;
            const future = await Promise.allSettled([ctx.kv.get('later'), ctx.tabs.this().network.clear()]);
            captureRuntime([...results, ...future].map(({status, reason}) => ({status, error: reason?.message})));
        `, { transport });
        await instance.waitFor('MAIN_REQUEST');
        assert.equal(instance.messages.some(message => message.type === 'LAMBDA_RESULT'), false);
        await instance.disconnect('Authenticated connection failed');
        const values = await instance.captured;
        assert.equal(values.length, 6);
        assert.ok(values.every(value => value.status === 'rejected' && value.error === 'Authenticated connection failed'));
        assert.equal(instance.messages.filter(message => message.type === 'GET_STORAGE_REQUEST').length, 1);
        assert.equal(instance.messages.filter(message => message.type === 'NETWORK_REQUEST').length, 1);
        assert.equal(instance.time.timers.size, 0);
        assert.equal(instance.time.intervals.size, 0);
        await instance.disconnect('Duplicate failure');
    });

    test(`${transport}: resource denial preserves null/false while network and MAIN reject`, { timeout: 2000 }, async () => {
        const instance = await runtime(`
            const get = await ctx.kv.get('denied');
            const set = await ctx.kv.set('denied', 1);
            const failures = await Promise.allSettled([ctx.tabs.this().network.list(), ctx.main.get('app')]);
            return { get, set, failures: failures.map(result => result.reason.message) };
        `, { transport, respond: message => {
            const types = { GET_STORAGE_REQUEST: 'GET_STORAGE_RESPONSE', SET_STORAGE_REQUEST: 'SET_STORAGE_RESPONSE', NETWORK_REQUEST: 'NETWORK_RESPONSE', MAIN_REQUEST: 'MAIN_RESPONSE' };
            if (types[message.type]) return { type: types[message.type], value: message.type === 'GET_STORAGE_REQUEST' ? null : false, error: 'Access denied' };
        } });
        assert.deepEqual((await instance.completed).return, { get: null, set: false, failures: ['Access denied', 'Access denied'] });
        await instance.dispose();
    });
}

test('native runtime waits for binding and sends no window traffic', { timeout: 2000 }, async () => {
    const instance = await runtime('return 42;', { autoBind: false });
    assert.deepEqual(instance.messages.map(message => message.type), ['BIND_INVOCATION']);
    await instance.receive({ type: 'INVOCATION_BOUND' });
    assert.equal((await instance.completed).return, 42);
    assert.deepEqual(instance.windowMessages, []);
    await flush();
    await instance.dispose();
});
