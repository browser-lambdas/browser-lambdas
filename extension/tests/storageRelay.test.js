import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { content } from './helpers/contentHarness.js';
import { credentials, flush } from './helpers/runtimeHarness.js';

async function connect(instance, id = 'channel') {
    const setup = { type: 'BACKGROUND_INIT_HANDSHAKE', ...credentials(id), invocationToken: `trusted-${id}`, executionWorld: 'MAIN_WORLD' };
    await instance.fromBackground(setup);
    await instance.fromWindow({ type: 'aToken', aToken: setup.aToken });
    return setup;
}

test('MAIN relay accepts credentials only on its private Port and overwrites forged identity', async () => {
    const instance = content({ respond: message => ({ type: message.type.replace('_REQUEST', '_RESPONSE'), value: true }) });
    await instance.fromTab({ type: 'BACKGROUND_INIT_HANDSHAKE', ...credentials('public') });
    assert.equal(instance.announcements.length, 0);
    assert.equal(instance.state().handshakes, 0);
    await connect(instance);
    for (const type of ['GET_SECRET_REQUEST', 'GET_STORAGE_REQUEST', 'SET_STORAGE_REQUEST', 'NETWORK_REQUEST', 'MAIN_REQUEST']) {
        await instance.deliver('channel', { type, id: type, key: 'key', invocationToken: 'forged', executionWorld: 'USER_SCRIPT_WORLD' });
        assert.equal(instance.forwarded.at(-1).executionWorld, 'MAIN_WORLD');
        assert.equal(instance.forwarded.at(-1).invocationToken, 'trusted-channel');
        assert.equal(instance.forwarded.at(-1).id, type);
    }
    await instance.deliver('channel', { type: 'FUNCTION_CALL_REQUEST', id: 'nested', userInput: 'helper', invocationToken: 'forged' });
    assert.equal(instance.forwarded.at(-1).type, 'EXECUTE_LAMBDA');
    assert.equal(instance.forwarded.at(-1).invocationToken, 'trusted-channel');
    await instance.deliver('channel', { type: 'LAMBDA_RESULT', id: 'forged', result: { return: 1 } });
    assert.equal(instance.forwarded.at(-1).id, 'channel');
    assert.equal(instance.forwarded.at(-1).invocationToken, 'trusted-channel');
    assert.equal(instance.channels.get('channel').closed, true);
});

test('shared persistence loads as a classic content script without eager module imports', async () => {
    const source = await readFile(new URL('../src/shared/storage.js', import.meta.url), 'utf8');
    vm.runInNewContext(source, { window: { innerWidth: 1000, innerHeight: 700 } });
    await flush();
});

for (const ready of [false, true]) {
    test(`MAIN startup deadline ${ready ? 'clears on readiness' : 'fails without readiness'}`, async () => {
        const instance = content();
        await connect(instance);
        assert.equal(instance.time.timers.size, 1, 'key proof alone does not establish runtime readiness');
        if (ready) await instance.deliver('channel', { type: 'LAMBDA_READY' });
        await instance.time.advance(1000);
        if (ready) {
            assert.equal(instance.channels.get('channel').closed, false);
            assert.deepEqual(instance.forwarded.map(message => message.type), ['LAMBDA_READY']);
        } else {
            const result = instance.forwarded.at(-1);
            assert.equal(result.type, 'LAMBDA_RESULT');
            assert.equal(result.id, 'channel');
            assert.equal(result.invocationToken, 'trusted-channel');
            assert.match(result.result.error, /runtime connection/);
            assert.equal(instance.channels.get('channel').closed, true);
            instance.channels.get('channel').options.onError(new Error('late failure'));
            assert.equal(instance.forwarded.filter(message => message.type === 'LAMBDA_RESULT').length, 1);
        }
        assert.equal(instance.time.timers.size, 0);
    });
}

test('finishing one MAIN invocation cancels only its pending work; Port loss cleans the rest', async () => {
    const instance = content();
    for (const id of ['one', 'two']) {
        await connect(instance, id);
        await instance.deliver(id, { type: 'LAMBDA_READY' });
    }
    const pending = instance.deliver('one', { type: 'GET_STORAGE_REQUEST', id: 'pending' });
    await instance.deliver('one', { type: 'TAB_OPERATION_REQUEST', id: 'tab', operation: 'NEW_TAB' });
    assert.equal(instance.state().pending, 1);
    await instance.fromBackground({ type: 'RUNTIME_FINISHED', requestId: 'one', error: 'Access revoked' });
    await pending;
    assert.equal(instance.channels.get('one').closed, true);
    assert.deepEqual(instance.channels.get('one').messages, [{ type: 'RUNTIME_CLOSED', error: 'Access revoked' }]);
    assert.equal(instance.channels.get('two').closed, false);
    assert.deepEqual({ ...instance.state() }, { channels: 1, handshakes: 1, requests: 0, pending: 0 });
    await instance.disconnect();
    assert.equal(instance.channels.get('two').closed, true);
    assert.deepEqual({ ...instance.state() }, { channels: 0, handshakes: 0, requests: 0, pending: 0 });
    assert.equal(instance.time.timers.size, 0);
});
