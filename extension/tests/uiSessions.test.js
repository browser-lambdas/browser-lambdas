import assert from 'node:assert/strict';
import test from 'node:test';
import { handleUiSession } from '../src/background/uiSessions.js';

const content = { id: 'extension', tab: { id: 7 }, frameId: 0, documentId: 'page-document', url: 'https://example.com/page' };
function request(message, sender) {
    return new Promise((resolve) => handleUiSession({ surface: 'menu', ...message }, sender, resolve));
}
function frame(id, extra = {}) {
    return { id: 'extension', tab: { id: 7 }, frameId: 2, url: `chrome-extension://extension/popup-menu.html#${id}`, ...extra };
}
function setup(t) {
    globalThis.chrome = { runtime: { id: 'extension', getURL: (path) => `chrome-extension://extension/${path}` } };
    t.mock.timers.enable({ apis: ['setTimeout'] });
}

test('menu sessions are restricted to their tab, frame page and one claim', async (t) => {
    setup(t);
    const session = await request({ type: 'REGISTER_UI_SESSION' }, content);
    assert.ok(session.token);
    assert.equal(Buffer.from(session.sessionKey, 'base64').length, 32);
    for (const sender of [content, frame(session.id, { tab: { id: 8 } }), frame(session.id, { id: 'other-extension' }),
        frame(session.id, { url: 'chrome-extension://extension/shell.html' }), frame(session.id, { frameId: 0 })]) {
        assert.ok((await request({ type: 'CLAIM_UI_SESSION', id: session.id }, sender)).error);
    }
    assert.deepEqual(await request({ type: 'CLAIM_UI_SESSION', id: session.id }, frame(session.id)), {
        token: session.token, sessionKey: session.sessionKey, parentOrigin: 'https://example.com'
    });
    assert.ok((await request({ type: 'CLAIM_UI_SESSION', id: session.id }, frame(session.id))).error);
});

test('untrusted registration, expired sessions and cancelled sessions fail closed', async (t) => {
    setup(t);
    for (const sender of [frame('unknown'), { ...content, id: 'other-extension' }, { ...content, frameId: 1 }, { ...content, documentId: undefined }]) {
        assert.ok((await request({ type: 'REGISTER_UI_SESSION' }, sender)).error);
    }
    const expired = await request({ type: 'REGISTER_UI_SESSION' }, content);
    t.mock.timers.tick(3000);
    assert.ok((await request({ type: 'CLAIM_UI_SESSION', id: expired.id }, frame(expired.id))).error);
    const cancelled = await request({ type: 'REGISTER_UI_SESSION' }, content);
    await request({ type: 'CANCEL_UI_SESSION', id: cancelled.id }, content);
    assert.ok((await request({ type: 'CLAIM_UI_SESSION', id: cancelled.id }, frame(cancelled.id))).error);
    const kept = await request({ type: 'REGISTER_UI_SESSION' }, content);
    await request({ type: 'CANCEL_UI_SESSION', id: kept.id }, { ...content, documentId: 'other-document' });
    assert.equal((await request({ type: 'CLAIM_UI_SESSION', id: kept.id }, frame(kept.id))).token, kept.token);
});

test('shell and menu credentials cannot cross surfaces and every session gets a fresh key', async (t) => {
    setup(t);
    const menu = await request({ type: 'REGISTER_UI_SESSION' }, content);
    const shell = await request({ type: 'REGISTER_UI_SESSION', surface: 'shell' }, content);
    assert.notEqual(menu.sessionKey, shell.sessionKey);
    assert.ok((await request({ type: 'REGISTER_UI_SESSION', surface: '__proto__' }, content)).error);
    const shellFrame = { ...frame(shell.id), url: `chrome-extension://extension/shell.html#${shell.id}` };
    assert.ok((await request({ type: 'CLAIM_UI_SESSION', surface: 'menu', id: shell.id }, shellFrame)).error);
    assert.ok((await request({ type: 'CLAIM_UI_SESSION', surface: 'shell', id: menu.id }, { ...shellFrame, url: `chrome-extension://extension/shell.html#${menu.id}` })).error);
    assert.equal((await request({ type: 'CLAIM_UI_SESSION', surface: 'shell', id: shell.id }, shellFrame)).sessionKey, shell.sessionKey);
    assert.equal((await request({ type: 'CLAIM_UI_SESSION', id: menu.id }, frame(menu.id))).sessionKey, menu.sessionKey);
});
