import assert from 'node:assert/strict';
import test from 'node:test';
import { handleItemAccess } from '../src/background/itemAccess.js';
import { mutateWorkspaceStorage, isWorkspaceSender } from '../src/background/storageRepository.js';
import { handleRuntimeMessage } from '../src/background/handleRuntimeMessage.js';

const key = 'local_storage_key_storage';
const globalKey = 'local_storage_key_allow_main_world_storage';
let db;
let url;
let failWrite;
function reset(records = []) {
    db = { [key]: JSON.stringify(records) };
    url = 'https://example.com/page';
    failWrite = false;
    globalThis.chrome = {
        runtime: { id: 'extension', getURL: (path) => `chrome-extension://extension/${path}` },
        tabs: { get: async () => ({ url }) },
        storage: { local: {
            get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((name) => [name, structuredClone(db[name])])),
            set: async (values) => { if (failWrite && Object.hasOwn(values, key)) { failWrite = false; throw new Error('write failed'); } Object.assign(db, structuredClone(values)); }
        } }
    };
}
const item = (overrides = {}) => ({ id: 'one', key: 'foo', value: 'PRIVATE_VALUE', allowedWorlds: ['user_scripts'], urlAllowlistEnabled: true, urlPatterns: ['https://example.com/*'], ...overrides });
const request = (write, overrides = {}) => handleItemAccess({ type: write ? 'SET_STORAGE_REQUEST' : 'GET_STORAGE_REQUEST', id: 'request-id', key: 'foo', value: 'PROPOSED_PRIVATE_VALUE', executionWorld: 'USER_SCRIPT_WORLD', ...overrides }, 1);

test('reads/writes enforce policy without leaking or changing values on denial', async () => {
    for (const write of [false, true]) {
        for (const overrides of [{ executionWorld: 'MAIN_WORLD' }, { executionWorld: 'forged' }]) {
            reset([item()]);
            const before = db[key];
            const result = await request(write, overrides);
            assert.equal(result.value, write ? false : null);
            assert.equal(result.id, 'request-id');
            assert.equal(db[key], before);
            assert.ok(result.error);
            assert.doesNotMatch(JSON.stringify(db.activityLogs), /PRIVATE_VALUE/);
        }
        reset([item()]); url = 'https://other.test/';
        assert.equal((await request(write)).value, write ? false : null);
    }
    reset([item({ allowedWorlds: ['main'] })]);
    db[globalKey] = true;
    assert.equal((await request(true, { executionWorld: 'MAIN_WORLD' })).value, true);
    const saved = JSON.parse(db[key])[0];
    assert.equal(saved.id, 'one');
    assert.deepEqual(saved.allowedWorlds, ['main']);
    db[globalKey] = false;
    assert.equal((await request(false, { executionWorld: 'MAIN_WORLD' })).value, null);
});

test('either world can create keys without automatic URL restrictions', async () => {
    for (const executionWorld of ['USER_SCRIPT_WORLD', 'MAIN_WORLD']) {
        reset(); db[globalKey] = true;
        assert.equal((await request(true, { executionWorld })).value, true);
        const created = JSON.parse(db[key])[0];
        assert.equal(created.urlAllowlistEnabled, false);
        assert.deepEqual(created.urlPatterns, []);
        url = 'https://other.test/';
        for (const readerWorld of ['USER_SCRIPT_WORLD', 'MAIN_WORLD']) {
            assert.equal((await request(false, { executionWorld: readerWorld })).value, 'PROPOSED_PRIVATE_VALUE');
            assert.equal((await request(true, { executionWorld: readerWorld })).value, true);
        }
        assert.equal(JSON.parse(db[key]).length, 1);
    }
    reset(); url = 'file:///test';
    assert.equal((await request(true)).value, true);
});

test('creation retains global and verified-context checks and cannot bypass existing grants', async () => {
    for (const executionWorld of ['forged', undefined]) {
        reset(); db[globalKey] = true;
        assert.equal((await request(true, { executionWorld })).value, false);
        assert.equal(db[key], '[]');
    }
    reset();
    assert.equal((await request(true, { executionWorld: 'MAIN_WORLD' })).value, false);
    assert.equal(db[key], '[]');
    reset(); url = '';
    assert.equal((await request(true)).value, false);
    assert.equal(db[key], '[]');
    reset([item({ urlAllowlistEnabled: true, urlPatterns: [] }), item({ id: 'duplicate' })]);
    assert.equal((await request(true)).value, false);
    assert.equal(JSON.parse(db[key]).length, 2);
});

test('JSON values survive runtime and policy-only edits; concurrent writes preserve unrelated records', async () => {
    reset();
    const values = [null, false, 0, { nested: [1, 'two'] }, ['three'], '{invalid-json'];
    const results = await Promise.all(values.map((value, index) => request(true, { key: `key-${index}`, value })));
    assert.ok(results.every((result) => result.value));
    for (let index = 0; index < values.length; index++) {
        assert.deepEqual((await request(false, { key: `key-${index}` })).value, values[index]);
    }
    let expected = JSON.parse(db[key])[3];
    assert.equal((await mutateWorkspaceStorage({ operation: 'update', expected, item: { ...expected, urlAllowlistEnabled: true, urlPatterns: ['*'] } })).success, true);
    assert.deepEqual(JSON.parse(db[key])[3].value, values[3]);
    expected = JSON.parse(db[key])[3];
    assert.equal((await mutateWorkspaceStorage({ operation: 'update', expected, item: { ...expected, value: 'edited text' } })).success, true);
    assert.equal(JSON.parse(db[key])[3].value, 'edited text');
    assert.equal(JSON.parse(db[key]).length, values.length);
});

test('stale updates/deletes conflict; queue survives failures and malformed collections', async () => {
    reset([item()]);
    const expected = item();
    await request(true);
    for (const operation of ['update', 'delete']) {
        const result = await mutateWorkspaceStorage({ operation, expected, item: { ...expected, value: 'stale' } });
        assert.equal(result.conflict, true);
    }
    failWrite = true;
    assert.equal((await request(true)).value, false);
    assert.equal((await request(true)).value, true);
    db[key] = '{"PRIVATE_VALUE": broken';
    assert.equal((await request(true)).value, false);
    assert.equal(db[key], '{"PRIVATE_VALUE": broken');
    assert.doesNotMatch(JSON.stringify(db.activityLogs), /PRIVATE_VALUE/);
    db[key] = '[]';
    assert.equal((await request(true)).value, true);
});

test('workspace administration verifies exact sender URL and rejects content-script callers', () => {
    reset();
    assert.equal(isWorkspaceSender({ id: 'extension', url: 'chrome-extension://extension/workspace.html#storage' }), true);
    for (const sender of [{ id: 'extension', url: 'https://example.com/' }, { id: 'other', url: 'chrome-extension://extension/workspace.html' }, { id: 'extension', url: 'chrome-extension://extension/settings.html' }]) {
        assert.equal(isWorkspaceSender(sender), false);
        let response;
        assert.equal(handleRuntimeMessage({ type: 'WORKSPACE_STORAGE_MUTATION', operation: 'delete', expected: item() }, sender, (value) => { response = value; }), false);
        assert.equal(response.success, false);
    }
});

test('missing storage and stored null have different response metadata', async () => {
    reset([item({ value: null })]);
    assert.equal((await request(false)).found, true);
    assert.equal((await request(false, { key: 'absent' })).found, false);
});

test('storage and secrets honor disabled allowlists and storage writes retain that choice', async () => {
    reset([item({ urlAllowlistEnabled: false, urlPatterns: ['https://restricted.test/*'] })]);
    assert.equal((await request(false)).value, 'PRIVATE_VALUE');
    assert.equal((await request(true)).value, true);
    assert.equal(JSON.parse(db[key])[0].urlAllowlistEnabled, false);
    assert.deepEqual(JSON.parse(db[key])[0].urlPatterns, ['https://restricted.test/*']);
    assert.equal((await request(false, { executionWorld: 'MAIN_WORLD' })).value, null);
    db.local_storage_key_secrets = JSON.stringify([item({ urlAllowlistEnabled: false, urlPatterns: [] })]);
    assert.equal((await handleItemAccess({ type: 'GET_SECRET_REQUEST', id: 'secret', key: 'foo', executionWorld: 'USER_SCRIPT_WORLD' }, 1)).value, 'PRIVATE_VALUE');
    const expected = JSON.parse(db[key])[0];
    await mutateWorkspaceStorage({ operation: 'update', expected, item: { ...expected, urlAllowlistEnabled: true } });
    assert.equal((await request(false)).value, null);
});


test('former read/write grants collapse to shared permission without widening access', async () => {
    for (const world of ['user_scripts', 'main']) for (const read of [false, true]) for (const write of [false, true]) {
        reset([item({ allowedReadWorlds: read ? [world] : [], allowedWriteWorlds: write ? [world] : [] })]);
        db[globalKey] = true;
        const executionWorld = world === 'main' ? 'MAIN_WORLD' : 'USER_SCRIPT_WORLD';
        assert.equal((await request(false, { executionWorld })).value, read && write ? 'PRIVATE_VALUE' : null);
        assert.equal((await request(true, { executionWorld })).value, read && write);
        const saved = JSON.parse(db[key])[0];
        if (read && write) {
            assert.deepEqual(saved.allowedWorlds, [world]);
            assert.equal(Object.hasOwn(saved, 'allowedReadWorlds'), false);
            assert.equal(Object.hasOwn(saved, 'allowedWriteWorlds'), false);
        }
        url = 'https://other.test/';
        assert.equal((await request(true, { executionWorld })).value, false);
        assert.equal((await request(false, { executionWorld })).value, null);
        url = 'https://example.com/page';
        if (world === 'main') {
            db[globalKey] = false;
            assert.equal((await request(true, { executionWorld })).value, false);
            assert.equal((await request(false, { executionWorld })).value, null);
        }
    }
});

test('workspace replaces former operation grants with a shared world toggle', async () => {
    reset([item({ allowedReadWorlds: ['user_scripts'], allowedWriteWorlds: [] })]);
    const expected = JSON.parse(db[key])[0];
    const result = await mutateWorkspaceStorage({ operation: 'update', expected, item: { id: expected.id, key: expected.key, value: expected.value, allowedWorlds: ['main'], urlAllowlistEnabled: false } });
    assert.deepEqual(result.item.allowedWorlds, ['main']);
    assert.equal(Object.hasOwn(result.item, 'allowedReadWorlds'), false);
    assert.equal(Object.hasOwn(result.item, 'allowedWriteWorlds'), false);
    assert.equal((await request(false)).value, null);
    db[globalKey] = true;
    assert.equal((await request(true, { executionWorld: 'MAIN_WORLD' })).value, true);
    assert.equal((await request(false, { executionWorld: 'MAIN_WORLD' })).value, 'PROPOSED_PRIVATE_VALUE');
    reset([item({ allowedReadWorlds: null, allowedWriteWorlds: 'user_scripts' })]);
    assert.equal((await request(false)).value, null);
    assert.equal((await request(true)).value, false);
});
