import assert from 'node:assert/strict';
import test from 'node:test';
import { createTutorial } from '../src/background/tutorial.js';
import { tutorialResources, TUTORIAL_STATUS_KEY, TUTORIAL_PROJECT } from '../src/shared/tutorial.js';

const keys = {
    lambdas: 'local_storage_key_lambdas', storage: 'local_storage_key_storage',
    secrets: 'local_storage_key_secrets', triggers: 'local_storage_key_triggers',
    styles: 'local_storage_key_shellcss'
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
test('tutorial is opt-in and creation preserves existing resources and safe permissions', async t => {
    const existing = { id: 'existing', name: 'personal', project: 'other', func: 'user code' };
    const settings = { other: { functions: { userWorld: false } } };
    const store = setup(t, {
        [keys.lambdas]: JSON.stringify([existing]),
        [keys.storage]: JSON.stringify([{ id: 'mine', key: 'tutorial-progress', value: 2 }]),
        [keys.triggers]: JSON.stringify([{ id: 'mine', name: 'personal-trigger', project: 'other' }]),
        local_storage_key_project_settings: settings,
        local_storage_key_allow_main_world_functions: false
    });
    assert.equal(store.writes(), 0);
    const outcomes = await Promise.allSettled([createTutorial(), createTutorial()]);
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(outcomes.find(result => result.status === 'rejected').reason.message, /already been created/);
    assert.equal(store.writes(), 1);
    assert.deepEqual(store.items('lambdas')[0], existing);
    assert.deepEqual(store.state.local_storage_key_project_settings, settings);
    assert.equal(store.state.local_storage_key_allow_main_world_functions, false);
    assert.deepEqual(store.items('storage'), [{ id: 'mine', key: 'tutorial-progress', value: 2 }]);
    assert.deepEqual(store.items('triggers'), [{ id: 'mine', name: 'personal-trigger', project: 'other' }]);
    assert.deepEqual(store.items('lambdas').slice(1).map(item => item.name), ['quiz']);
    assert.equal(store.items('secrets').length, 1);
    for (const item of [...store.items('lambdas').slice(1), ...store.items('secrets')]) {
        assert.deepEqual(item.allowedWorlds, ['user_scripts']);
        assert.equal(item.urlAllowlistEnabled, true);
        assert.deepEqual(item.urlPatterns, ['https://browser-lambdas.dev/*', 'https://www.browser-lambdas.dev/*']);
    }
    for (const item of store.items('secrets')) {
        assert.equal(item.projectsEnabled, true);
        assert.deepEqual(item.allowedProjects, [TUTORIAL_PROJECT]);
    }
    assert.equal(store.writes(), 1);
});

test('tutorial naming collisions leave existing data unchanged', async t => {
    const collisions = [
        { [keys.lambdas]: JSON.stringify([{ id: 'mine', name: 'quiz', project: 'other', func: 'mine' }]) },
        { [keys.secrets]: JSON.stringify([{ id: 'mine', key: 'tutorial-quiz', value: 'private' }]) },
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

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function runtime({ section = 'ctx', command = 'reply', input = 'ctx.kv.get()', secret = tutorialResources().secrets[0].value } = {}) {
    const output = [], secretReads = [];
    const ctx = {
        args: { all: () => ({ 0: command, 1: input }) },
        secrets: { get: async key => { secretReads.push(key); return secret; } }
    };
    const document = { querySelector: () => section ? { dataset: { category: section } } : null };
    const body = tutorialResources().lambdas[0].func;
    return { run: () => new AsyncFunction('ctx', 'console', 'document', body)(ctx, { log: message => output.push(message) }, document), output, secretReads };
}

test('quiz defaults to usage and lets secret failures reach the runtime', async () => {
    for (const command of [undefined, '', 'unknown']) {
        const usage = runtime({ command: command ?? '' });
        await usage.run();
        assert.match(usage.output[0], /Use quiz me/);
        assert.deepEqual(usage.secretReads, []);
    }
    const missing = runtime({ secret: null });
    await assert.rejects(missing.run(), TypeError);
    assert.deepEqual(missing.secretReads, ['tutorial-quiz']);
    assert.deepEqual(missing.output, []);
    const invalid = runtime({ secret: '{invalid' });
    await assert.rejects(invalid.run(), SyntaxError);
});

test('quiz reads each section hint and answer from one secret without KV or saved progress', async () => {
    const quizzes = JSON.parse(tutorialResources().secrets[0].value);
    assert.deepEqual(Object.keys(quizzes).sort(), ['baah', 'ctx', 'demo', 'intro', 'llms', 'quick-start', 'security']);
    for (const [section, { hint, answer }] of Object.entries(quizzes)) {
        const showHint = runtime({ section, command: 'me' });
        await showHint.run();
        assert.equal(showHint.output[0], 'Hint: ' + hint);
        const wrong = runtime({ section, input: 'wrong' });
        await wrong.run();
        assert.equal(wrong.output[0], 'Not quite! Try again.\n\nHint: ' + hint);
        const missing = runtime({ section, input: '' });
        await missing.run();
        assert.match(missing.output[0], /Not quite/);
        const correct = runtime({ section, input: '  ' + answer.toUpperCase() + '  ' });
        await correct.run();
        await correct.run();
        assert.equal(correct.output.length, 2);
        assert.ok(correct.output.every(message => message.startsWith('Correct!')));
    }
    const custom = runtime({ secret: JSON.stringify({ ctx: { hint: 'Custom hint', answer: 'custom answer' } }), input: 'Custom answer' });
    await custom.run();
    assert.match(custom.output[0], /Correct!/);
    assert.deepEqual(custom.secretReads, ['tutorial-quiz']);
});
