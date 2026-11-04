import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime, flush } from './helpers/runtimeHarness.js';

async function pendingRuntime(code, options) {
    const instance = await runtime(code, options);
    return {
        ...instance,
        requests: () => instance.messages.filter(message => message.type.endsWith('_REQUEST')),
        result: () => instance.messages.find(message => message.type === 'LAMBDA_RESULT')?.result,
        async respond(request, value, error) {
            await instance.receive({ type: request.type.replace('_REQUEST', '_RESPONSE'), id: request.id, value, error });
            await flush();
        }
    };
}

for (const transport of ['native', 'main']) {
    test(`${transport}: unawaited ctx requests delay completion until their response arrives`, { timeout: 2000 }, async t => {
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
            ['ctx.tabs.this().network.clear()', true],
            ["ctx.main.get('app.theme')", 'dark'],
            ["ctx.main.call('app.navigate', '/inbox')", true],
            ['ctx.main.run(() => 42)', 42]
        ]) {
            await t.test(call, async () => {
                const instance = await pendingRuntime(`${call}; return 'done';`, { transport });
                try {
                    assert.equal(instance.requests().length, 1);
                    assert.equal(instance.result(), undefined, 'completion must wait for the response');
                    await instance.respond(instance.requests()[0], value);
                    assert.equal((await instance.completed).return, 'done');
                } finally { await instance.dispose(); }
            });
        }
    });

    test(`${transport}: completion drains requests started by API wrapper callbacks`, { timeout: 2000 }, async t => {
        for (const [call, value, operation] of [
            ["ctx.tabs.new('https://example.com').then(tab => tab.focus())", { id: 42 }, 'FOCUS_TAB'],
            ['ctx.tabs.all().then(([tab]) => tab.close())', [{ id: 42 }], 'CLOSE_TAB'],
            ['ctx.tabs.this().network.add({}).then(rule => rule.remove())', { id: 'rule' }, 'remove'],
            ["ctx.main.call('app.navigate').then(() => ctx.main.get('app.route'))", true, 'get'],
            ["ctx.main.run(() => 42).then(() => ctx.main.get('app.route'))", 42, 'get']
        ]) {
            await t.test(call, async () => {
                const instance = await pendingRuntime(`${call}.then(() => ctx.kv.set('key', 'value')); return 'done';`, { transport });
                try {
                    await instance.respond(instance.requests()[0], value);
                    assert.equal(instance.requests().length, 2);
                    assert.equal(instance.requests()[1].operation, operation);
                    assert.equal(instance.result(), undefined);
                    await instance.respond(instance.requests()[1], true);
                    assert.equal(instance.requests()[2].type, 'SET_STORAGE_REQUEST');
                    assert.equal(instance.result(), undefined);
                    await instance.respond(instance.requests()[2], true);
                    assert.equal((await instance.completed).return, 'done');
                } finally { await instance.dispose(); }
            });
        }
    });

    test(`${transport}: a rejected unawaited network call still waits for other requests`, { timeout: 2000 }, async () => {
        const instance = await pendingRuntime(`
            ctx.tabs.this().network.add({});
            ctx.kv.set('key', 'value');
            return 'done';
        `, { transport });
        try {
            await instance.respond(instance.requests()[0], undefined, 'Network access denied');
            assert.equal(instance.result(), undefined);
            await instance.respond(instance.requests()[1], true);
            assert.equal((await instance.completed).return, 'done');
        } finally { await instance.dispose(); }
    });

    test(`${transport}: connection loss rejects pending and subsequent requests without reporting success`, { timeout: 2000 }, async () => {
        const instance = await pendingRuntime(`
            const results = await Promise.allSettled([
                ctx.tabs.new(), ctx.kv.set('key', 'value'), ctx.tabs.this().network.add({})
            ]);
            const [later] = await Promise.allSettled([ctx.kv.get('later')]);
            captureRuntime([...results, later].map(result => ({ status: result.status, error: result.reason.message })));
            return 'done';
        `, { transport });
        assert.equal(instance.requests().length, 3);
        assert.equal(instance.result(), undefined);
        await instance.disconnect('Channel failed');
        assert.deepEqual(await instance.captured, Array.from({ length: 4 }, () => ({ status: 'rejected', error: 'Channel failed' })));
        assert.equal(instance.requests().length, 3, 'no requests are sent after connection loss');
        assert.equal(instance.result(), undefined);
        assert.equal(instance.time.intervals.size, 0);
        await instance.disconnect('Duplicate failure');
    });

    test(`${transport}: send failures reject resource, tab, network and MAIN calls`, { timeout: 2000 }, async () => {
        const instance = await pendingRuntime(`
            const results = await Promise.allSettled([
                ctx.kv.get('key'), ctx.tabs.new(), ctx.tabs.this().network.add({}), ctx.main.call('app.navigate')
            ]);
            return results.map(result => ({ status: result.status, error: result.reason.message }));
        `, { transport, beforeSend(message) {
            if (message.type.endsWith('_REQUEST')) throw new Error('Send failed');
        } });
        try {
            assert.deepEqual((await instance.completed).return, Array.from({ length: 4 }, () => ({ status: 'rejected', error: 'Send failed' })));
        } finally { await instance.dispose(); }
    });

    test(`${transport}: unawaited MAIN argument failures do not interrupt other pending requests`, { timeout: 2000 }, async () => {
        const instance = await pendingRuntime(`
            ctx.main.run('invalid callback');
            ctx.main.call('app.navigate', () => 1);
            ctx.kv.set('key', 'value');
            return 'done';
        `, { transport });
        try {
            assert.equal(instance.requests().length, 1);
            assert.equal(instance.result(), undefined);
            await instance.respond(instance.requests()[0], true);
            assert.equal((await instance.completed).return, 'done');
        } finally { await instance.dispose(); }
    });
}
