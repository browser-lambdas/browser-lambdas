import { generateSessionKey } from './generateSessionKey.js';

const sessions = new Map();
const pages = { menu: 'popup-menu.html', shell: 'shell.html' };

export function handleUiSession(message, sender, sendResponse) {
    if (!['REGISTER_UI_SESSION', 'CLAIM_UI_SESSION', 'CANCEL_UI_SESSION'].includes(message?.type)) return undefined;
    const surface = message.surface;
    if (!Object.hasOwn(pages, surface)) {
        sendResponse({ error: 'Unknown extension interface.' });
        return false;
    }
    const tabId = sender.tab?.id;
    const url = sender.url ? new URL(sender.url) : null;
    const contentSender = sender.id === chrome.runtime.id && tabId != null && sender.frameId === 0
        && sender.documentId && url && url.protocol !== 'chrome-extension:';
    if (message.type === 'REGISTER_UI_SESSION') {
        if (!contentSender) {
            sendResponse({ error: 'The interface must be opened by the page content script.' });
            return false;
        }
        generateSessionKey().then((sessionKey) => {
            const id = crypto.randomUUID();
            const token = crypto.randomUUID();
            sessions.set(id, { surface, tabId, token, sessionKey, parentOrigin: url.origin, documentId: sender.documentId });
            setTimeout(() => sessions.delete(id), 3000);
            sendResponse({ id, token, sessionKey });
        }).catch(() => sendResponse({ error: 'The encrypted interface session could not be created.' }));
        return true;
    }
    const session = sessions.get(message.id);
    if (message.type === 'CANCEL_UI_SESSION') {
        if (contentSender && session?.surface === surface && session.tabId === tabId && session.documentId === sender.documentId) sessions.delete(message.id);
        sendResponse({ success: true });
        return false;
    }
    if (sender.id !== chrome.runtime.id || tabId == null || !(sender.frameId > 0)
        || !url || `${url.protocol}//${url.host}${url.pathname}` !== chrome.runtime.getURL(pages[surface]) || url.hash !== `#${message.id}`
        || !session || session.surface !== surface || session.tabId !== tabId) {
        sendResponse({ error: 'The interface session could not be verified.' });
        return false;
    }
    sessions.delete(message.id);
    sendResponse({ token: session.token, sessionKey: session.sessionKey, parentOrigin: session.parentOrigin });
    return false;
}
