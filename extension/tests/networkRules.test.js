import assert from 'node:assert/strict';
import test from 'node:test';
import { createNetworkRules, normalizeNetworkRule, compileNetworkRule } from '../src/background/networkRules.js';

function browser() {
    let saved = {}, native = [];
    const tabs = new Map([[1, { url: 'https://page.example/app' }], [2, { url: 'https://page.example/app' }]]);
    return {
        tabs: { get: async (id) => { if (!tabs.has(id)) throw new Error('Missing tab'); return tabs.get(id); } },
        storage: { session: {
            get: async () => structuredClone(saved),
            set: async (value) => { saved = structuredClone(value); }
        } },
        declarativeNetRequest: {
            getSessionRules: async () => structuredClone(native),
            isRegexSupported: async () => ({ isSupported: true }),
            updateSessionRules: async ({ removeRuleIds = [], addRules = [] }) => {
                native = [...native.filter((r) => !removeRuleIds.includes(r.id)), ...structuredClone(addRules)];
            }
        },
        native: () => native, saved: () => saved, tabData: tabs
    };
}
function fixture() {
    const api = browser();
    // Failure injection wraps actual mutation boundaries, rather than the manager.
    for (const [owner, method, failure] of [[api.declarativeNetRequest, 'updateSessionRules', 'failRules'], [api.storage.session, 'set', 'failStorage']]) {
        const original = owner[method];
        owner[method] = async (...args) => { if (api[failure]) throw new Error(failure); return original(...args); };
    }
    return { api, rules: createNetworkRules(api) };
}
const redirect = (port = 3000, path = '*') => ({ match: { url: `https://api.example/${path}` }, redirect: `http://localhost:${port}/*` });

test('wildcard redirects capture the suffix and query; literal targets replace the whole URL', () => {
    const native = compileNetworkRule(normalizeNetworkRule(redirect()), { nativeId: 1, tabId: 1, priority: 1 });
    const match = new RegExp(native.condition.regexFilter).exec('https://api.example/users?page=2');
    assert.equal(match[1], 'users?page=2');
    assert.equal(native.action.redirect.regexSubstitution, 'http://localhost:3000/\\1');
    const literal = compileNetworkRule(normalizeNetworkRule({ ...redirect(), redirect: 'https://local.example/exact' }), { nativeId: 2, tabId: 1, priority: 2 });
    assert.deepEqual(literal.action.redirect, { url: 'https://local.example/exact' });
    assert.equal(new RegExp(native.condition.regexFilter).test('https://evil.example/?url=https://api.example/users'), false);
});

test('normalization ignores object order, header casing and method order', () => {
    const a = normalizeNetworkRule({ match: { url: 'https://api.example/*', methods: ['POST', 'get', 'GET'] }, request: { headers: { set: { 'X-B': 'b', 'X-A': 'a' } } } });
    const b = normalizeNetworkRule({ request: { headers: { set: { 'x-a': 'a', 'x-b': 'b' } } }, match: { methods: ['get', 'post'], url: 'https://api.example/*' } });
    assert.deepEqual(a, b);
});

for (const rule of [
    { ...redirect(), block: true }, { ...redirect(), response: { body: {} } },
    { match: { url: 'api.example/*' }, block: true }, { ...redirect(), priority: 10 },
    { ...redirect(), match: { url: 'https://*.example/*' } },
    { ...redirect(), match: { url: 'https://api.example/*/*' } },
    { match: { url: 'https://api.example/' }, redirect: 'https://other.example/*' },
    { ...redirect(), match: { url: 'https://api.example/*', methods: [] } },
    { match: { url: 'https://api.example/*' }, request: { headers: { set: { 'X-A': 'x\r\ny' } } } },
    { match: { url: 'https://api.example/*' }, request: { headers: { set: { 'X-A': 'a' }, remove: ['x-a'] } } }
]) test(`invalid rule rejects: ${JSON.stringify(rule)}`, () => assert.throws(() => normalizeNetworkRule(rule)));

test('identical and simultaneous additions share one installed rule per tab', async () => {
    const { api, rules } = fixture();
    const [a, b] = await Promise.all([rules.add(1, redirect()), rules.add(1, redirect())]);
    assert.equal(a.id, b.id);
    assert.equal(api.native().length, 1);
    const other = await rules.add(2, redirect());
    assert.notEqual(other.id, a.id);
    assert.equal((await rules.list(1)).length, 1);
});

test('same match replaces the whole rule; stale handles cannot remove or revive it', async () => {
    const { rules } = fixture();
    const a = await rules.add(1, { match: redirect().match, request: { headers: { set: { 'X-Debug': 'true', 'X-Client': 'baah' } } } });
    const b = await rules.add(1, { match: redirect().match, request: { headers: { set: { 'X-Debug': 'false' } } } });
    assert.notEqual(a.id, b.id);
    assert.deepEqual((await rules.list(1))[0].request.headers.set, { 'x-debug': 'false' });
    assert.equal(await rules.remove(1, a.id), false);
    assert.equal(await rules.remove(1, b.id), true);
    assert.deepEqual(await rules.list(1), []);
    assert.equal(await rules.remove(1, b.id), false);
});

test('overlapping matches coexist; duplicates do not change their precedence', async () => {
    const { api, rules } = fixture();
    const broad = await rules.add(1, redirect());
    const narrow = await rules.add(1, redirect(4000, 'users/*'));
    await rules.add(1, redirect());
    assert.equal((await rules.list(1)).length, 2);
    assert.ok(api.native()[1].priority > api.native()[0].priority);
    await rules.remove(1, narrow.id);
    assert.equal((await rules.list(1))[0].id, broad.id);
});

test('failed browser or metadata replacement preserves the previous rule', async () => {
    const { api, rules } = fixture();
    const a = await rules.add(1, redirect());
    for (const failure of ['failRules', 'failStorage']) {
        api[failure] = true;
        await assert.rejects(rules.add(1, redirect(4000)));
        api[failure] = false;
        assert.equal((await rules.list(1))[0].id, a.id);
        assert.equal(api.native().length, 1);
        assert.equal(api.native()[0].action.redirect.regexSubstitution, 'http://localhost:3000/\\1');
    }
});

test('clear is tab-wide, isolates other tabs and invalidates handles', async () => {
    const { rules } = fixture();
    const a = await rules.add(1, redirect());
    await rules.add(1, redirect(4000, 'users/*'));
    await rules.add(2, redirect());
    assert.equal(await rules.clear(1), 2);
    assert.equal(await rules.remove(1, a.id), false);
    assert.equal(await rules.clear(1), 0);
    assert.equal((await rules.list(2)).length, 1);
});

test('same-origin navigation and worker restart retain rules; origin changes and closure remove them', async () => {
    const { api, rules } = fixture();
    const a = await rules.add(1, redirect());
    await rules.navigation(1, 'https://page.example/another');
    assert.equal((await createNetworkRules(api).list(1))[0].id, a.id);
    await rules.navigation(1, 'https://page.example:444/another');
    assert.deepEqual(await rules.list(1), []);
    await rules.add(1, redirect());
    api.tabData.delete(1);
    await rules.navigation(1, null);
    assert.equal(api.native().length, 0);
});

test('restart removes orphaned browser rules rather than silently adopting them', async () => {
    const { api, rules } = fixture();
    await rules.add(1, redirect());
    await api.declarativeNetRequest.updateSessionRules({ addRules: [{ id: 999, priority: 999, action: { type: 'block' }, condition: { tabIds: [1] } }] });
    await createNetworkRules(api).list(1);
    assert.equal(api.native().length, 1);
});

test('navigation cleanup never reinstalls expired rules when metadata storage fails', async () => {
    const { api, rules } = fixture();
    await rules.add(1, redirect());
    api.failStorage = true;
    await assert.rejects(rules.navigation(1, 'https://other.example/'));
    assert.deepEqual(api.native(), []);
    api.failStorage = false;
    assert.deepEqual(await rules.list(1), []);
});

test('restart accepts browser rules whose property order differs from the compiler output', async () => {
    const { api, rules } = fixture();
    const a = await rules.add(1, redirect());
    const installed = api.native()[0];
    await api.declarativeNetRequest.updateSessionRules({ removeRuleIds: [installed.id], addRules: [{ condition: installed.condition, action: installed.action, priority: installed.priority, id: installed.id }] });
    assert.equal((await createNetworkRules(api).list(1))[0].id, a.id);
});

test('startup recovery removes orphaned rules before any navigation or network operation', async () => {
    const { api, rules } = fixture();
    await rules.add(1, redirect());
    await api.declarativeNetRequest.updateSessionRules({ addRules: [{ id: 999, priority: 999, action: { type: 'block' }, condition: { tabIds: [1] } }] });
    await createNetworkRules(api).ready();
    assert.equal(api.native().length, 1);
    assert.equal(api.native()[0].id, 1);
});

test('revoking access removes only affected installers and never restores expired rules on storage failure', async () => {
    const { api, rules } = fixture();
    await rules.add(1, redirect(), { callers: [{ id: 'a', project: 'a' }] });
    const other = await rules.add(2, redirect(), { callers: [{ id: 'b', project: 'b' }] });
    assert.equal(await rules.prune((record) => record.callers?.[0].project === 'b'), 1);
    assert.equal((await rules.list(2))[0].id, other.id);
    assert.deepEqual(await rules.list(1), []);
    api.failStorage = true;
    await assert.rejects(rules.prune(() => false));
    assert.deepEqual(api.native(), []);
    api.failStorage = false;
    assert.deepEqual(await rules.list(2), []);
});

test('access revoked while installation is pending rejects and removes its native effect', async () => {
    const { api, rules } = fixture();
    let checks = 0;
    await assert.rejects(rules.add(1, redirect(), { callers: [{ id: 'a' }], authorize: async () => {
        if (++checks > 1) throw new Error('Access revoked');
    } }), /Access revoked/);
    assert.deepEqual(api.native(), []);
});
