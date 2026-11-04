import { backgroundBrowser, fakePort, tick } from './helpers/backgroundBrowser.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { connectUserScript } from '../src/background/nativeRuntime.js';
import { registerInvocation, issueConnectionGrant, finishInvocation, clearDocumentInvocations } from '../src/background/invocations.js';
import { executeLambda } from '../src/background/executeLambda.js';

const lambda = { id: 'f', name: 'test', project: 'tools', func: 'return 1;', allowedWorlds: ['user_scripts'], urlAllowlistEnabled: false };
const sender = (changes = {}) => ({ id: 'test-extension', tab: { id: 1 }, frameId: 0, documentId: 'doc-1', url: 'https://example.com/page', ...changes });
function invocation(requestId = 'request', item = lambda) {
    const registered = registerInvocation({ lambda: item, tabId: 1, documentId: 'doc-1', executionWorld: 'USER_SCRIPT_WORLD', requestId });
    return { ...registered, requestId, grant: issueConnectionGrant(registered.token) };
}
async function bind(current, metadata = sender()) {
    const port = fakePort(metadata);
    connectUserScript(port);
    await port.receive({ type: 'BIND_INVOCATION', grant: current.grant });
    return port;
}
const closed = (port, pattern) => {
    assert.equal(port.disconnected, true);
    assert.match(port.messages.find((message) => message.type === 'RUNTIME_CLOSED').error, pattern);
};

test('native binding rejects absent, ended and reused grants', async () => {
    backgroundBrowser([lambda]);
    const absent = await bind({ grant: 'not-issued' });
    closed(absent, /grant/);
    const ended = invocation('ended');
    finishInvocation(ended.token, 1, ended.requestId);
    closed(await bind(ended), /grant/);
    const current = invocation();
    const accepted = await bind(current);
    assert.equal(accepted.messages[0].type, 'INVOCATION_BOUND');
    closed(await bind(current), /grant/);
    await accepted.receive({ type: 'LAMBDA_RESULT', result: { return: 'done' } });
    assert.deepEqual(await current.completion, { return: 'done' });
});

test('browser identity binds the grant to extension, tab, frame and document', async () => {
    backgroundBrowser([lambda]);
    for (const invalid of [{ id: 'other-extension' }, { tab: { id: 2 } }, { frameId: 1 }, { documentId: 'old-doc' }]) {
        const current = invocation(JSON.stringify(invalid));
        closed(await bind(current, sender(invalid)), /grant/);
        const correct = await bind(current);
        assert.equal(correct.messages[0].type, 'INVOCATION_BOUND');
        correct.disconnect();
        await current.completion;
    }
});

test('prebind operations and content-script administration never enter the runtime dispatcher', async () => {
    const browser = backgroundBrowser([lambda]);
    for (const type of ['GET_SECRET_REQUEST', 'LAMBDA_RESULT', 'CONTENT_SCRIPT_CONNECTED']) {
        const port = fakePort(sender()); connectUserScript(port);
        await port.receive({ type, id: 'forged' });
        closed(port, /grant/);
    }
    const current = invocation(); const port = await bind(current);
    await port.receive({ type: 'CONTENT_SCRIPT_CONNECTED', tabId: 99 });
    closed(port, /Unsupported/);
    assert.equal(browser.nativePorts.length, 0);
    assert.match((await current.completion).error, /Unsupported/);
});

test('request bodies cannot replace the bound caller authority', async () => {
    const privileged = { ...lambda, id: 'trusted', name: 'trusted', project: 'trusted' };
    const browser = backgroundBrowser([lambda, privileged]);
    browser.db.local_storage_key_secrets = JSON.stringify([{ key: 'restricted', value: 'DO_NOT_DISCLOSE', allowedWorlds: ['user_scripts'], projectsEnabled: true, allowedProjects: ['trusted'], functionsEnabled: true, allowedFunctions: ['trusted/trusted'] }]);
    const current = invocation(); const other = invocation('trusted', privileged); const port = await bind(current);
    await port.receive({ type: 'GET_SECRET_REQUEST', id: 'read', key: 'restricted', invocationToken: other.token, executionWorld: 'MAIN_WORLD', project: 'trusted', callers: [{ name: 'trusted', project: 'trusted' }] });
    const response = port.messages.find((message) => message.id === 'read');
    assert.equal(response.value, null);
    assert.match(response.error, /calling project|calling function/);
    assert.doesNotMatch(JSON.stringify(port.messages), /DO_NOT_DISCLOSE/);
    port.disconnect(); finishInvocation(other.token, 1, other.requestId);
});

test('concurrent invocations keep independent Ports, results and cleanup', async () => {
    backgroundBrowser([lambda]);
    const first = invocation('first'), second = invocation('second');
    const one = await bind(first), two = await bind(second);
    await one.receive({ type: 'LAMBDA_READY' }); await two.receive({ type: 'LAMBDA_READY' });
    assert.deepEqual(await first.ready, { started: true });
    one.disconnect();
    assert.match((await first.completion).error, /connection closed/);
    assert.equal(two.disconnected, false);
    await two.receive({ type: 'LAMBDA_RESULT', result: { return: 2 } });
    assert.deepEqual(await second.completion, { return: 2 });
    assert.equal(two.disconnected, true);
});

test('terminal output drains before completion closes the native Port', async () => {
    const browser = backgroundBrowser([lambda]);
    const current = invocation(); const port = await bind(current);
    const get = chrome.storage.local.get;
    let unblock;
    let held = false;
    const gate = new Promise((resolve) => { unblock = resolve; });
    chrome.storage.local.get = async (key) => {
        if (key === 'local_storage_key_lambdas' && !held) { held = true; await gate; }
        return get(key);
    };
    let completed = false;
    current.completion.then(() => { completed = true; });
    const output = port.receive({ type: 'SHELL_OUTPUT', level: 'log', values: ['last output'] });
    const result = port.receive({ type: 'LAMBDA_RESULT', result: { return: 'done' } });
    await tick();
    assert.equal(held, true);
    assert.equal(completed, false);
    assert.equal(port.disconnected, false);
    unblock();
    await Promise.all([output, result]);
    assert.deepEqual(await current.completion, { return: 'done' });
    assert.deepEqual(browser.outputs.find((entry) => entry.type === 'SHELL_OUTPUT').values, ['last output']);
    assert.equal(port.disconnected, true);
});

test('navigation and revoked function permissions close active invocations without fallback', async () => {
    const browser = backgroundBrowser([lambda]);
    const current = invocation(); const port = await bind(current);
    clearDocumentInvocations(1, 'new-document');
    closed(port, /page changed/);
    assert.match((await current.completion).error, /page changed/);
    const revoked = invocation('revoked'); const active = await bind(revoked);
    browser.db.local_storage_key_lambdas = JSON.stringify([{ ...lambda, allowedWorlds: [] }]);
    await active.receive({ type: 'HEARTBEAT' });
    closed(active, /revoked/);
    assert.equal(browser.injections.length, 0);
});

test('unbound connections time out and native startup removes unused grants', async (t) => {
    const browser = backgroundBrowser([lambda]);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const unbound = fakePort(sender()); connectUserScript(unbound);
        t.mock.timers.tick(5000); closed(unbound, /timed out/);
        browser.onRuntime = () => {};
        // Hold readiness too: the helper normally sends it after binding.
        const execute = chrome.userScripts.execute;
        let grant;
        chrome.userScripts.execute = async (args) => {
            const code = args.js[0].code;
            if (code.includes('world-preflight')) return execute(args);
            browser.injections.push(args);
            grant = JSON.parse(code.match(/const connectionGrant\s*=\s*("[^"]+")/)[1]);
            return [{ documentId: 'doc-1' }];
        };
        const running = executeLambda(1, 'test', 'timeout');
        for (let n = 0; n < 20 && !grant; n++) await tick();
        assert.ok(grant);
        t.mock.timers.tick(5000);
        const failed = await running;
        assert.equal(failed.started, false);
        assert.match(failed.error, /timed out/);
        closed(await bind({ grant }), /grant/);
        assert.equal(browser.injections.filter((entry) => entry.world === 'MAIN').length, 0);
    } finally { t.mock.timers.reset(); }
});


test('disabling native world messaging revokes an already connected Port', async () => {
    backgroundBrowser([lambda]);
    await chrome.userScripts.configureWorld({ worldId: 'configured-world', messaging: true });
    const current = registerInvocation({ lambda, tabId: 1, documentId: 'doc-1', worldId: 'configured-world', executionWorld: 'USER_SCRIPT_WORLD', requestId: 'world-revoked' });
    current.grant = issueConnectionGrant(current.token);
    const port = await bind(current);
    assert.equal(port.messages[0].type, 'INVOCATION_BOUND');
    await chrome.userScripts.configureWorld({ worldId: 'configured-world', messaging: false });
    await port.receive({ type: 'HEARTBEAT' });
    closed(port, /revoked/);
    assert.match((await current.completion).error, /revoked/);
    await chrome.userScripts.resetWorldConfiguration('configured-world');
});
