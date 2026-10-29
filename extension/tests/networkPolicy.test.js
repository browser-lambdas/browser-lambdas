import assert from 'node:assert/strict';
import test from 'node:test';
import { effectiveNetworkAccess } from '../src/shared/networkPolicy.js';
import { authorizeNetworkInvocation, ALLOW_NETWORK_KEY } from '../src/background/networkAccess.js';
import { normalizeProjectCategorySettings, PROJECT_SETTINGS_KEY } from '../src/shared/projectPolicy.js';
import { applyFunctionCodeUpdate } from '../src/shared/functionUpdates.js';
import { registerInvocation, clearTabInvocations } from '../src/background/invocations.js';

test('network access defaults off and global/project restrictions cannot be overridden', () => {
    for (const global of [undefined, false, true, 'true']) {
        for (const project of [undefined, false, true]) {
            for (const item of [undefined, false, true]) {
                assert.equal(effectiveNetworkAccess({ allowNetwork: item }, { allowNetwork: project }, global),
                    global === true && project === true && item !== false,
                    JSON.stringify({ global, project, item }));
            }
        }
    }
});

test('project network settings are booleans and apply only to functions', () => {
    assert.deepEqual(normalizeProjectCategorySettings({ allowNetwork: true }), { allowNetwork: true });
    assert.deepEqual(normalizeProjectCategorySettings({ allowNetwork: true }, 'triggers'), {});
    assert.throws(() => normalizeProjectCategorySettings({ allowNetwork: 'true' }), /Invalid project setting/);
});

test('sync can neither grant network access nor overwrite a local decision', () => {
    const lambdas = [];
    const incoming = { name: 'network-test', project: 'test', func: 'old', allowNetwork: true };
    const created = applyFunctionCodeUpdate(lambdas, incoming);
    assert.equal(created.allowNetwork, undefined);
    created.allowNetwork = false;
    applyFunctionCodeUpdate(lambdas, { ...incoming, func: 'new' });
    assert.equal(created.allowNetwork, false);
    created.allowNetwork = true;
    applyFunctionCodeUpdate(lambdas, { ...incoming, allowNetwork: false });
    assert.equal(created.allowNetwork, true);
});

test('every nested caller needs a current network grant and reads failures reject', async () => {
    const lambdas = [
        { id: 'one', name: 'one', project: 'test', allowNetwork: true },
        { id: 'two', name: 'two', project: 'test' }
    ];
    let global = false;
    let fail = false;
    globalThis.chrome = { storage: { local: { get: async () => {
        if (fail) throw new Error('storage unavailable');
        return {
            local_storage_key_lambdas: JSON.stringify(lambdas),
            [ALLOW_NETWORK_KEY]: global,
            [PROJECT_SETTINGS_KEY]: { test: { functions: { allowNetwork: true } } }
        };
    } } } };
    const invocation = { callers: lambdas.map(({ id, name, project }) => ({ id, name, project })) };
    await assert.rejects(authorizeNetworkInvocation(invocation), /Network rules are disabled.*one/);
    global = true;
    await authorizeNetworkInvocation(invocation);
    lambdas[0].allowNetwork = false;
    await assert.rejects(authorizeNetworkInvocation(invocation), /Network rules are disabled.*one/);
    lambdas[0].allowNetwork = true;
    lambdas.pop();
    await assert.rejects(authorizeNetworkInvocation(invocation), /could not be verified/);
    await assert.rejects(authorizeNetworkInvocation({ callers: [] }), /could not be verified/);
    fail = true;
    await assert.rejects(authorizeNetworkInvocation(invocation), /storage unavailable/);
    delete globalThis.chrome;
});

test('network RPCs verify invocation identity, current grants and target tab ids for every operation', async () => {
    const lambda = { id: 'rpc', name: 'network-rpc', project: 'test', allowNetwork: true, allowedWorlds: ['user_scripts'], urlAllowlistEnabled: false };
    const db = { local_storage_key_lambdas: JSON.stringify([lambda]), [ALLOW_NETWORK_KEY]: true, [PROJECT_SETTINGS_KEY]: { test: { functions: { allowNetwork: true } } } };
    let session = {}, native = [];
    globalThis.chrome = {
        tabs: { get: async (tabId) => {
            if (![10, 11].includes(tabId)) throw new Error('No such tab');
            return { id: tabId, url: 'https://page.example/app' };
        } },
        storage: {
            local: { get: async () => structuredClone(db) },
            session: { get: async () => structuredClone(session), set: async (value) => { session = structuredClone(value); } }
        },
        declarativeNetRequest: {
            getSessionRules: async () => structuredClone(native),
            isRegexSupported: async () => ({ isSupported: true }),
            updateSessionRules: async ({ removeRuleIds = [], addRules = [] }) => {
                native = [...native.filter((rule) => !removeRuleIds.includes(rule.id)), ...structuredClone(addRules)];
            }
        }
    };
    const { handleNetworkRequest, reconcileNetworkPermissions } = await import('../src/background/network.js');
    const { token } = registerInvocation({ lambda, tabId: 10, executionWorld: 'USER_SCRIPT_WORLD', requestId: 'rpc-invocation' });
    const definition = { match: { url: 'https://api.example/*' }, block: true };
    const request = (operation, extra = {}, sourceTabId = 10) => handleNetworkRequest({ id: 'request', invocationToken: token, operation, rule: definition, ruleId: 'unused', ...extra }, sourceTabId);
    try {
        for (const operation of ['add', 'list', 'remove', 'clear']) {
            const forged = await request(operation, { invocationToken: 'forged' });
            assert.match(forged.error, /could not be verified/);
            assert.equal(forged.id, 'request');
            assert.match((await request(operation, {}, 11)).error, /could not be verified/);
            db[ALLOW_NETWORK_KEY] = false;
            assert.match((await request(operation)).error, /Network rules are disabled/);
            db[ALLOW_NETWORK_KEY] = true;
            db[PROJECT_SETTINGS_KEY].test.functions.allowNetwork = false;
            assert.match((await request(operation)).error, /Network rules are disabled/);
            db[PROJECT_SETTINGS_KEY].test.functions.allowNetwork = true;
        }
        for (const tabId of ['10', 1.5, -1, {}, []]) assert.match((await request('list', { tabId })).error, /valid target tab/);
        const current = await request('add', { tabId: null, executionWorld: 'MAIN_WORLD' });
        assert.equal(current.error, undefined);
        assert.deepEqual(native[0].condition.tabIds, [10]);
        const other = await request('add', { tabId: 11 });
        assert.equal(other.error, undefined);
        assert.notEqual(other.value.id, current.value.id);
        assert.deepEqual(native[1].condition.tabIds, [11]);
        assert.equal((await request('list', { tabId: null })).value.length, 1);
        assert.equal((await request('remove', { ruleId: current.value.id, tabId: 11 })).value, false);
        assert.equal((await request('clear', { tabId: null })).value, 1);
        assert.equal((await request('list', { tabId: 11 })).value.length, 1);
        db[ALLOW_NETWORK_KEY] = false;
        assert.equal(await reconcileNetworkPermissions(), 1);
        assert.deepEqual(native, []);
        db[ALLOW_NETWORK_KEY] = true;
        assert.equal((await request('list', { tabId: 11 })).value.length, 0);
        lambda.allowedWorlds = [];
        db.local_storage_key_lambdas = JSON.stringify([lambda]);
        assert.match((await request('list')).error, /could not be verified/);
    } finally {
        clearTabInvocations(10);
        delete globalThis.chrome;
    }
});
