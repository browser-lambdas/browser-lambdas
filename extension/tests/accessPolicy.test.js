import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAccessPolicy, evaluateAccessPolicy, validateAccessPolicy } from '../src/shared/accessPolicy.js';
import { parseStorageRecords } from '../src/shared/storageRecords.js';

test('access requires world, page and the main-world global opt-in', () => {
    for (const executionWorld of ['USER_SCRIPT_WORLD', 'MAIN_WORLD', 'forged', undefined]) {
        for (const allowedWorlds of [[], ['user_scripts'], ['main'], ['user_scripts', 'main']]) {
            for (const url of ['https://example.com/ok', 'https://other.test/', '']) {
                for (const allowMainWorld of [true, false]) {
                    const result = evaluateAccessPolicy({ policy: { allowedWorlds, urlAllowlistEnabled: true, urlPatterns: ['https://example.com/*'] }, executionWorld, url, allowMainWorld });
                    const world = executionWorld === 'MAIN_WORLD' ? 'main' : executionWorld === 'USER_SCRIPT_WORLD' ? 'user_scripts' : null;
                    assert.equal(result.allowed, !!world && allowedWorlds.includes(world) && url === 'https://example.com/ok' && (world !== 'main' || allowMainWorld));
                }
            }
        }
    }
});

test('defaults and malformed policies do not widen grants', () => {
    assert.deepEqual(normalizeAccessPolicy({}), { allowedWorlds: ['user_scripts'], urlAllowlistEnabled: false, urlPatterns: [] });
    for (const allowedWorlds of [[], null, 'main', ['bogus']]) assert.deepEqual(normalizeAccessPolicy({ allowedWorlds }).allowedWorlds, []);
    const evaluate = (urlPatterns, url = 'https://example.com/') => evaluateAccessPolicy({ policy: { urlAllowlistEnabled: true, urlPatterns }, executionWorld: 'USER_SCRIPT_WORLD', url });
    assert.equal(evaluate([]).allowed, false);
    assert.equal(evaluate([' ', '/[/']).allowed, false);
    assert.equal(evaluate(['/[/', '*']).allowed, true);
    assert.equal(evaluate(['*'], '').allowed, false);
    assert.throws(() => validateAccessPolicy({ urlAllowlistEnabled: true, urlPatterns: ['/[/'] }));
});

test('legacy parsing preserves values, IDs, policy absence and duplicates without a write', () => {
    const values = ['', { deep: [1, false, null] }, [1], 0, false, null];
    const raw = JSON.stringify(values.map((value, index) => ({ key: '', value, ...(index ? { id: `id-${index}` } : {}) })));
    const records = parseStorageRecords(raw);
    assert.deepEqual(records.map((record) => record.value), values);
    assert.deepEqual(parseStorageRecords(raw), records);
    assert.deepEqual(parseStorageRecords(JSON.stringify(records)), records);
    assert.equal(Object.hasOwn(records[0], 'allowedWorlds'), false);
    assert.throws(() => parseStorageRecords('{broken'));
    assert.throws(() => parseStorageRecords('{}'));
});

test('URL allowlisting can be disabled without bypassing world permissions or missing context', () => {
    const policy = { allowedWorlds: ['user_scripts', 'main'], urlAllowlistEnabled: false, urlPatterns: ['/[/'] };
    const evaluate = (extra = {}) => evaluateAccessPolicy({ policy, executionWorld: 'USER_SCRIPT_WORLD', url: 'https://anywhere.test/', allowMainWorld: false, ...extra });
    assert.equal(evaluate().allowed, true);
    assert.equal(evaluate({ executionWorld: 'MAIN_WORLD' }).allowed, false);
    assert.equal(evaluate({ executionWorld: 'MAIN_WORLD', allowMainWorld: true }).allowed, true);
    assert.equal(evaluate({ executionWorld: 'unknown' }).allowed, false);
    assert.equal(evaluate({ url: '' }).allowed, false);
    assert.equal(evaluate({ policy: { ...policy, allowedWorlds: [] } }).allowed, false);
    assert.equal(evaluate({ policy: { ...policy, urlAllowlistEnabled: true } }).allowed, false);
    assert.doesNotThrow(() => validateAccessPolicy(policy));
    assert.throws(() => validateAccessPolicy({ ...policy, urlAllowlistEnabled: true }));
    assert.deepEqual(normalizeAccessPolicy(policy).urlPatterns, ['/[/']);
    for (const value of [undefined, null, 'false', 0]) {
        assert.equal(normalizeAccessPolicy({ urlAllowlistEnabled: value }).urlAllowlistEnabled, false);
    }
});

test('absent URL switch defaults off while explicit enabled filtering remains active', () => {
    const request = { policy: { urlPatterns: ['https://old.test/*'] }, executionWorld: 'USER_SCRIPT_WORLD', url: 'https://other.test/' };
    assert.equal(evaluateAccessPolicy(request).allowed, true);
    assert.equal(evaluateAccessPolicy({ ...request, policy: { ...request.policy, urlAllowlistEnabled: true } }).allowed, false);
});
