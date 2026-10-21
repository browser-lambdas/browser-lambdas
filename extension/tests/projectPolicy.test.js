import assert from 'node:assert/strict';
import test from 'node:test';
import {
    PROJECT_SETTINGS_KEY, normalizeProjectCategorySettings, getProjectSettings,
    getProjectCategorySettings, evaluateProjectAccess, saveProjectSettings
} from '../src/shared/projectPolicy.js';

test('unset project values inherit safe globals without mutating saved settings', () => {
    const settings = {};
    const functions = getProjectCategorySettings(settings, '', 'functions');
    assert.deepEqual(functions, {
        enabled: true, userWorld: true, mainWorld: false, mode: undefined,
        restrictUrls: false, urlPatterns: [], poll: true, review: true, lock: false
    });
    for (const category of ['triggers', 'styles']) {
        const policy = getProjectCategorySettings(settings, 'project', category, { baahPollChanges: false, baahRequireReview: false });
        assert.equal(policy.enabled, true);
        assert.equal(policy.poll, false);
        assert.equal(policy.review, false);
        assert.equal(Object.hasOwn(policy, 'mainWorld'), false);
    }
    assert.deepEqual(settings, {});
});

test('project permissions can restrict global settings and can never relax them', () => {
    const settings = { project: { functions: { userWorld: false, mainWorld: true, poll: true, review: false } } };
    const denied = getProjectCategorySettings(settings, 'project', 'functions', {
        allowMainWorldFunctions: false, baahPollChanges: false, baahRequireReview: true,
        allowProjectOverrides: true
    });
    assert.equal(denied.enabled, false);
    assert.equal(denied.mainWorld, false);
    assert.equal(denied.poll, false);
    assert.equal(denied.review, true);
    settings.project.functions = { mainWorld: false, poll: false, review: true };
    const restricted = getProjectCategorySettings(settings, 'project', 'functions', {
        allowMainWorldFunctions: true, baahPollChanges: true, baahRequireReview: false
    });
    assert.equal(restricted.mainWorld, false);
    assert.equal(restricted.poll, false);
    assert.equal(restricted.review, true);
});

test('legacy disabled functions stay disabled and obsolete category fields are discarded', () => {
    assert.deepEqual(normalizeProjectCategorySettings({ enabled: false, mainWorld: true }, 'functions'), { userWorld: false, mainWorld: false });
    assert.deepEqual(normalizeProjectCategorySettings({ enabled: true, allowedWorlds: [] }, 'triggers'), { enabled: true });
    assert.deepEqual(normalizeProjectCategorySettings({ userWorld: false, mainWorld: false, mode: 'MAIN' }, 'styles'), {});
    assert.deepEqual(normalizeProjectCategorySettings({ restrictUrls: true, urlPatterns: '/[/', enabled: false }, 'styles'), { enabled: false });
});

test('enabled project URL filters enforce glob, regex, empty-list, and world restrictions', () => {
    const settings = { project: { functions: { restrictUrls: true, urlPatterns: ['https://example.com/allowed/*', '/\\/regex-path$/'] } } };
    const access = (url, executionWorld = 'USER_SCRIPT_WORLD') => evaluateProjectAccess({ settings, project: 'project', category: 'functions', url, executionWorld });
    assert.equal(access('https://example.com/allowed/one').allowed, true);
    assert.equal(access('https://example.com/regex-path').allowed, true);
    assert.equal(access('https://example.com/denied').allowed, false);
    assert.equal(access('https://example.com/allowed/one', 'MAIN_WORLD').allowed, false);
    settings.project.functions.urlPatterns = [];
    assert.equal(access('https://example.com/allowed/one').allowed, false);
    settings.project.functions.restrictUrls = false;
    assert.equal(access('https://example.com/denied').allowed, true);
    assert.throws(() => normalizeProjectCategorySettings({ urlPatterns: '/[/' }), /Invalid regular expression/);
    assert.throws(() => normalizeProjectCategorySettings({ poll: 'true' }), /Invalid project setting/);
});

function storage(initial = {}) {
    let saved = structuredClone(initial);
    let fail = false;
    globalThis.chrome = { storage: { local: {
        get: async () => ({ [PROJECT_SETTINGS_KEY]: structuredClone(saved) }),
        set: async (values) => {
            if (fail) { fail = false; throw new Error('storage unavailable'); }
            saved = structuredClone(values[PROJECT_SETTINGS_KEY]);
        }
    } } };
    return { read: () => saved, failNext: () => { fail = true; } };
}

test('serialized project saves preserve other projects and reject stale snapshots', async () => {
    const db = storage();
    const results = await Promise.all([
        saveProjectSettings({ project: 'one', settings: { functions: { userWorld: false } }, expected: {} }),
        saveProjectSettings({ project: 'two', settings: { styles: { enabled: false } }, expected: {} })
    ]);
    assert.ok(results.every((result) => result.success));
    assert.deepEqual(db.read(), { one: { functions: { userWorld: false } }, two: { styles: { enabled: false } } });
    const before = structuredClone(db.read());
    const conflict = await saveProjectSettings({ project: 'one', settings: { functions: { userWorld: true } }, expected: {} });
    assert.equal(conflict.conflict, true);
    assert.deepEqual(db.read(), before);
});

test('failed writes and invalid data preserve settings and do not poison the save queue', async () => {
    const initial = { one: { functions: { userWorld: false } } };
    const db = storage(initial);
    db.failNext();
    await assert.rejects(saveProjectSettings({ project: 'two', settings: { styles: { enabled: false } }, expected: {} }), /storage unavailable/);
    assert.deepEqual(db.read(), initial);
    await assert.rejects(saveProjectSettings({ project: 'two', settings: { functions: { urlPatterns: '/[/' } }, expected: {} }));
    assert.deepEqual(db.read(), initial);
    const next = await saveProjectSettings({ project: 'two', settings: { triggers: { poll: false } }, expected: {} });
    assert.equal(next.success, true);
    assert.deepEqual(db.read().one, initial.one);
    const invalid = storage({ one: null });
    await assert.rejects(getProjectSettings(), /Saved project settings are invalid/);
    assert.deepEqual(invalid.read(), { one: null });
});
