import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

import { runtime } from './helpers/runtimeHarness.js';

for (const transport of ['native', 'main']) {
test(`${transport}: network handles and management send the invoking or explicit tab with their exact rule id`, { timeout: 2000 }, async () => {
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
    `, { transport, respond: (message) => {
        if (message.type === 'TAB_OPERATION_REQUEST') return { type: 'TAB_OPERATION_RESPONSE', value: message.operation === 'NEW_TAB' ? { id: 42, url: 'https://page.example' } : [{ id: 43, url: 'https://other.example' }] };
        if (message.type === 'NETWORK_REQUEST') return { type: 'NETWORK_RESPONSE', value: message.operation === 'add' ? { id: `rule-${++nextId}`, ...message.rule } : message.operation === 'list' ? [] : true };
    } });
    assert.deepEqual(Array.from((await instance.completed).return), ['rule-1', 'rule-2']);
    const requests = instance.messages.filter((message) => message.type === 'NETWORK_REQUEST');
    assert.deepEqual(requests.map(({ operation, tabId, ruleId }) => [operation, tabId, ruleId]), [
        ['add', null, undefined], ['list', null, undefined], ['clear', null, undefined], ['remove', null, 'rule-1'],
        ['add', 42, undefined], ['list', 42, undefined], ['clear', 42, undefined], ['remove', 42, 'rule-2'], ['list', 43, undefined]
    ]);
});

test(`${transport}: network response errors reject API calls instead of returning successful handles`, { timeout: 2000 }, async () => {
    const instance = await runtime(`
        const errors = [];
        for (const operation of ['add', 'list', 'clear']) {
            try { await ctx.tabs.this().network[operation]({ match: { url: 'https://api.example/*' }, block: true }); }
            catch (error) { errors.push(error.message); }
        }
        return errors;
    `, { transport, respond: (message) => message.type === 'NETWORK_REQUEST' ? { type: 'NETWORK_RESPONSE', error: `Denied ${message.operation}` } : undefined });
    assert.deepEqual(Array.from((await instance.completed).return), ['Denied add', 'Denied list', 'Denied clear']);
});

}

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
