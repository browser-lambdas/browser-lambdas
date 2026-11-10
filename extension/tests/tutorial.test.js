import assert from 'node:assert/strict';
import test from 'node:test';
import { createTutorial, updateTutorial } from '../src/background/tutorial.js';
import { tutorialResources, TUTORIAL_STATUS_KEY, TUTORIAL_VERSION_KEY, TUTORIAL_VERSION, TUTORIAL_PROJECT } from '../src/shared/tutorial.js';

const keys = {
    lambdas: 'local_storage_key_lambdas', storage: 'local_storage_key_storage',
    secrets: 'local_storage_key_secrets', triggers: 'local_storage_key_triggers',
    styles: 'local_storage_key_shellcss', archive: 'local_storage_key_tutorial_archive'
};
const clone = value => structuredClone(value);
function setup(t, initial = {}) {
    const state = clone(initial);
    let writes = 0, failWrite = false;
    const previous = globalThis.chrome;
    globalThis.chrome = { storage: { local: {
        get: async names => Object.fromEntries((typeof names === 'string' ? [names] : names).filter(name => Object.hasOwn(state, name)).map(name => [name, clone(state[name])])),
        set: async values => {
            if (failWrite) throw new Error('Storage unavailable');
            writes++;
            Object.assign(state, clone(values));
        }
    } } };
    t.after(() => { globalThis.chrome = previous; });
    return { state, items: name => JSON.parse(state[keys[name]] ?? '[]'), writes: () => writes, fail: value => { failWrite = value; } };
}
function installed(version, extra = {}) {
    return { [TUTORIAL_STATUS_KEY]: 'created', [TUTORIAL_VERSION_KEY]: version, ...extra };
}

test('tutorial is opt-in and creation preserves existing resources and safe permissions', async t => {
    const existing = { id: 'existing', name: 'personal', project: 'other', func: 'user code' };
    const settings = { other: { functions: { userWorld: false } } };
    const store = setup(t, {
        [keys.lambdas]: JSON.stringify([existing]),
        local_storage_key_project_settings: settings,
        local_storage_key_allow_main_world_functions: false
    });
    await updateTutorial();
    assert.equal(store.writes(), 0);
    const outcomes = await Promise.allSettled([createTutorial(), createTutorial()]);
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(outcomes.find(result => result.status === 'rejected').reason.message, /already been created/);
    assert.equal(store.writes(), 1);
    assert.deepEqual(store.items('lambdas')[0], existing);
    assert.deepEqual(store.state.local_storage_key_project_settings, settings);
    assert.equal(store.state.local_storage_key_allow_main_world_functions, false);
    assert.equal(store.items('storage')[0].value, null);
    assert.deepEqual(store.items('secrets').map(item => item.value), ['ctx.kv.get()', 'baah', 'llms.txt']);
    for (const item of [...store.items('lambdas').slice(1), ...store.items('storage'), ...store.items('secrets')]) {
        assert.deepEqual(item.allowedWorlds, ['user_scripts']);
        assert.equal(item.urlAllowlistEnabled, true);
        assert.deepEqual(item.urlPatterns, ['https://browser-lambdas.dev/*', 'https://www.browser-lambdas.dev/*']);
    }
    for (const item of [...store.items('storage'), ...store.items('secrets')]) {
        assert.equal(item.projectsEnabled, true);
        assert.deepEqual(item.allowedProjects, [TUTORIAL_PROJECT]);
    }
    await updateTutorial();
    assert.equal(store.writes(), 1);
});

test('tutorial naming collisions leave existing data unchanged', async t => {
    const collisions = [
        { [keys.lambdas]: JSON.stringify([{ id: 'mine', name: 'begin', project: 'other', func: 'mine' }]) },
        { [keys.storage]: JSON.stringify([{ id: 'mine', key: 'tutorial-progress', value: 2 }]) },
        { [keys.secrets]: JSON.stringify([{ id: 'mine', key: 'tutorial-answer-2', value: 'private' }]) },
        { local_storage_key_project_settings: { [TUTORIAL_PROJECT]: { functions: { userWorld: false } } } }
    ];
    for (const initial of collisions) await t.test(Object.keys(initial)[0], async t => {
        const store = setup(t, initial);
        await assert.rejects(createTutorial(), /already in use/);
        assert.deepEqual(store.state, initial);
        assert.equal(store.writes(), 0);
    });
});

test('invalid records and failed creation preserve data and leave the mutation queue usable', async t => {
    await t.test('invalid collection', async t => {
        const initial = { [keys.lambdas]: '{invalid' };
        const store = setup(t, initial);
        await assert.rejects(createTutorial(), /could not be read/);
        assert.deepEqual(store.state, initial);
        assert.equal(store.writes(), 0);
    });
    await t.test('failed write can be retried', async t => {
        const store = setup(t);
        store.fail(true);
        await assert.rejects(createTutorial(), /Storage unavailable/);
        assert.deepEqual(store.state, {});
        store.fail(false);
        assert.equal((await createTutorial()).success, true);
        assert.equal(store.writes(), 1);
    });
});

test('legacy upgrade archives edited hunt records and preserves unrelated resources and demo choices', async t => {
    const old = { id: 'old', name: 'check-site', project: TUTORIAL_PROJECT, func: 'edited hunt body', allowedWorlds: [] };
    const demo = { id: 'demo', name: 'deactivate-demo', project: TUTORIAL_PROJECT, func: 'custom demo helper', allowedWorlds: [] };
    const unrelated = { id: 'other', name: 'check-site', project: 'other', func: 'unrelated' };
    const oldStorage = { id: 'visits', key: 'tutorial-visited', value: ['https://browser-lambdas.dev/#args'] };
    const oldSecret = { id: 'location', key: 'tutorial-location', value: 'private location' };
    const oldTrigger = { id: 'auto', name: 'auto-check', project: TUTORIAL_PROJECT, commands: ['check-site'], enabled: true };
    const demoTrigger = { id: 'demo-trigger', name: 'deactivate-demo', project: TUTORIAL_PROJECT, commands: ['deactivate-demo'], enabled: false };
    const store = setup(t, installed(3, {
        [keys.lambdas]: JSON.stringify([old, demo, unrelated]), [keys.storage]: JSON.stringify([oldStorage]),
        [keys.secrets]: JSON.stringify([oldSecret]), [keys.triggers]: JSON.stringify([oldTrigger, demoTrigger])
    }));
    await updateTutorial();
    assert.deepEqual(store.items('lambdas').find(item => item.id === demo.id), demo);
    assert.deepEqual(store.items('lambdas').find(item => item.id === unrelated.id), unrelated);
    assert.deepEqual(store.items('triggers'), [demoTrigger]);
    assert.deepEqual(store.state[keys.archive], [{ version: 3, lambdas: [old], triggers: [oldTrigger], storage: [oldStorage], secrets: [oldSecret] }]);
    assert.deepEqual(store.items('storage').map(item => [item.key, item.value]), [['tutorial-progress', null]]);
    assert.equal(store.items('secrets').length, 3);
    const saved = clone(store.state);
    await updateTutorial();
    assert.deepEqual(store.state, saved);
    assert.equal(store.writes(), 1);
});

test('quiz upgrade moves answers into secrets while keeping progress and function policies', async t => {
    const answer = { id: 'answer', name: 'answer', project: TUTORIAL_PROJECT, func: 'edited answer body', allowedWorlds: [], urlAllowlistEnabled: true, urlPatterns: ['https://browser-lambdas.dev/#args'] };
    const progress = { id: 'progress', key: 'tutorial-progress', value: 2, allowedWorlds: [] };
    const store = setup(t, installed(4, { [keys.lambdas]: JSON.stringify([answer]), [keys.storage]: JSON.stringify([progress]) }));
    await updateTutorial();
    const updated = store.items('lambdas')[0];
    assert.deepEqual({ ...updated, func: answer.func }, answer);
    assert.ok(updated.func.includes('ctx.secrets.get('));
    assert.deepEqual(store.items('storage'), [progress]);
    assert.deepEqual(store.state[keys.archive], [{ version: 4, lambdas: [answer] }]);
    assert.deepEqual(store.items('secrets').map(item => item.value), ['ctx.kv.get()', 'baah', 'llms.txt']);
});

test('quiz upgrade conflicts and failed writes preserve progress and the previous answer function', async t => {
    const initial = installed(4, {
        [keys.lambdas]: JSON.stringify([{ id: 'answer', name: 'answer', project: TUTORIAL_PROJECT, func: 'old body' }]),
        [keys.storage]: JSON.stringify([{ id: 'progress', key: 'tutorial-progress', value: 1 }])
    });
    await t.test('secret key collision', async t => {
        const saved = { ...initial, [keys.secrets]: JSON.stringify([{ id: 'mine', key: 'tutorial-answer-1', value: 'custom' }]) };
        const store = setup(t, saved);
        await assert.rejects(updateTutorial(), /already in use/);
        assert.deepEqual(store.state, saved);
    });
    await t.test('storage failure', async t => {
        const store = setup(t, initial);
        store.fail(true);
        await assert.rejects(updateTutorial(), /Storage unavailable/);
        assert.deepEqual(store.state, initial);
        store.fail(false);
        await updateTutorial();
        assert.equal(store.state[TUTORIAL_VERSION_KEY], TUTORIAL_VERSION);
        assert.equal(store.items('storage')[0].value, 1);
    });
});

test('first-answer update changes only the untouched default and never resets quiz progress', async t => {
    for (const value of ['ctx.kv', 'custom answer']) await t.test(value, async t => {
        const original = { id: 'answer-secret', key: 'tutorial-answer-1', value, allowedWorlds: [] };
        const initial = installed(5, {
            [keys.secrets]: JSON.stringify([original]), [keys.storage]: JSON.stringify([{ id: 'progress', key: 'tutorial-progress', value: 2 }]),
            [keys.lambdas]: JSON.stringify([{ id: 'answer', name: 'answer', project: TUTORIAL_PROJECT, func: 'custom body' }])
        });
        const store = setup(t, initial);
        await updateTutorial();
        assert.deepEqual(store.items('secrets'), [{ ...original, value: value === 'ctx.kv' ? 'ctx.kv.get()' : value }]);
        assert.equal(store.state[keys.storage], initial[keys.storage]);
        assert.equal(store.state[keys.lambdas], initial[keys.lambdas]);
        const saved = clone(store.state);
        await updateTutorial();
        assert.deepEqual(store.state, saved);
        assert.equal(store.writes(), 1);
    });
});

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function runtime(name, { progress = 0, input = 'ctx.kv.get()', secret = null, allowWrite = true } = {}) {
    const output = [], writes = [], secretReads = [];
    const ctx = {
        args: { all: () => ({ 0: input }) },
        kv: { get: async () => progress, set: async (key, value) => { writes.push([key, value]); return allowWrite; } },
        secrets: { get: async key => { secretReads.push(key); return secret; } }
    };
    const body = tutorialResources().lambdas.find(item => item.name === name).func;
    return { run: () => new AsyncFunction('ctx', 'console', body)(ctx, { log: message => output.push(message) }), output, writes, secretReads };
}

test('answer requires the current secret and never advances on missing secrets or denied writes', async () => {
    const missing = runtime('answer');
    await assert.rejects(missing.run(), /answer secret is unavailable/);
    assert.deepEqual(missing.secretReads, ['tutorial-answer-1']);
    assert.deepEqual(missing.writes, []);
    assert.deepEqual(missing.output, []);
    const denied = runtime('answer', { secret: 'ctx.kv.get()', allowWrite: false });
    await assert.rejects(denied.run(), /progress could not be saved/);
    assert.deepEqual(denied.output, []);
    const startDenied = runtime('begin', { allowWrite: false });
    await assert.rejects(startDenied.run(), /hunt could not start/);
    assert.deepEqual(startDenied.output, []);
});

test('answer uses the stored secret rather than an embedded answer and reads no future answer', async () => {
    const wrong = runtime('answer', { secret: 'custom answer' });
    await wrong.run();
    assert.match(wrong.output[0], /Not quite/);
    assert.ok(!wrong.output[0].includes('custom answer'));
    assert.deepEqual(wrong.writes, []);
    const correct = runtime('answer', { progress: 1, input: 'Custom answer', secret: 'custom answer' });
    await correct.run();
    assert.deepEqual(correct.secretReads, ['tutorial-answer-2']);
    assert.deepEqual(correct.writes, [['tutorial-progress', 2]]);
});
