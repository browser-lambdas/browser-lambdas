import assert from 'node:assert/strict';
import test from 'node:test';
import { handlePopupMenuSession } from '../src/background/popupMenuSessions.js';

const content = { id: 'extension', tab: { id: 7 }, frameId: 0, documentId: 'page-document', url: 'https://example.com/page' };
function request(message, sender) {
    let response;
    handlePopupMenuSession(message, sender, (value) => { response = value; });
    return response;
}
function frame(id, extra = {}) {
    return { id: 'extension', tab: { id: 7 }, frameId: 2, url: `chrome-extension://extension/popup-menu.html#${id}`, ...extra };
}
function setup(t) {
    globalThis.chrome = { runtime: { id: 'extension', getURL: (path) => `chrome-extension://extension/${path}` } };
    t.mock.timers.enable({ apis: ['setTimeout'] });
}

test('menu sessions are restricted to their tab, frame page and one claim', (t) => {
    setup(t);
    const session = request({ type: 'REGISTER_POPUP_MENU' }, content);
    assert.ok(session.token);
    for (const sender of [content, frame(session.id, { tab: { id: 8 } }), frame(session.id, { id: 'other-extension' }),
        frame(session.id, { url: 'chrome-extension://extension/shell.html' }), frame(session.id, { frameId: 0 })]) {
        assert.ok(request({ type: 'CLAIM_POPUP_MENU', id: session.id }, sender).error);
    }
    assert.deepEqual(request({ type: 'CLAIM_POPUP_MENU', id: session.id }, frame(session.id)), {
        token: session.token, parentOrigin: 'https://example.com'
    });
    assert.ok(request({ type: 'CLAIM_POPUP_MENU', id: session.id }, frame(session.id)).error);
});

test('untrusted registration, expired sessions and cancelled sessions fail closed', (t) => {
    setup(t);
    for (const sender of [frame('unknown'), { ...content, id: 'other-extension' }, { ...content, frameId: 1 }, { ...content, documentId: undefined }]) {
        assert.ok(request({ type: 'REGISTER_POPUP_MENU' }, sender).error);
    }
    const expired = request({ type: 'REGISTER_POPUP_MENU' }, content);
    t.mock.timers.tick(3000);
    assert.ok(request({ type: 'CLAIM_POPUP_MENU', id: expired.id }, frame(expired.id)).error);
    const cancelled = request({ type: 'REGISTER_POPUP_MENU' }, content);
    request({ type: 'CANCEL_POPUP_MENU', id: cancelled.id }, content);
    assert.ok(request({ type: 'CLAIM_POPUP_MENU', id: cancelled.id }, frame(cancelled.id)).error);
    const kept = request({ type: 'REGISTER_POPUP_MENU' }, content);
    request({ type: 'CANCEL_POPUP_MENU', id: kept.id }, { ...content, documentId: 'other-document' });
    assert.equal(request({ type: 'CLAIM_POPUP_MENU', id: kept.id }, frame(kept.id)).token, kept.token);
});
