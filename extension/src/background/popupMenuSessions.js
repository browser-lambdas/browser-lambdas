const sessions = new Map();
const menuPage = () => chrome.runtime.getURL('popup-menu.html');

export function handlePopupMenuSession(message, sender, sendResponse) {
    if (!['REGISTER_POPUP_MENU', 'CLAIM_POPUP_MENU', 'CANCEL_POPUP_MENU'].includes(message?.type)) return undefined;
    const tabId = sender.tab?.id;
    const url = sender.url ? new URL(sender.url) : null;
    const contentSender = sender.id === chrome.runtime.id && tabId != null && sender.frameId === 0
        && sender.documentId && url && url.protocol !== 'chrome-extension:';
    if (message.type === 'REGISTER_POPUP_MENU') {
        if (!contentSender) {
            sendResponse({ error: 'The menu must be opened by the page content script.' });
            return false;
        }
        const id = crypto.randomUUID();
        const token = crypto.randomUUID();
        sessions.set(id, { tabId, token, parentOrigin: url.origin, documentId: sender.documentId });
        setTimeout(() => sessions.delete(id), 3000);
        sendResponse({ id, token });
        return false;
    }
    const session = sessions.get(message.id);
    if (message.type === 'CANCEL_POPUP_MENU') {
        if (contentSender && session?.tabId === tabId && session.documentId === sender.documentId) sessions.delete(message.id);
        sendResponse({ success: true });
        return false;
    }
    if (sender.id !== chrome.runtime.id || tabId == null || !(sender.frameId > 0)
        || !url || `${url.protocol}//${url.host}${url.pathname}` !== menuPage() || url.hash !== `#${message.id}`
        || !session || session.tabId !== tabId) {
        sendResponse({ error: 'The menu session could not be verified.' });
        return false;
    }
    sessions.delete(message.id);
    sendResponse({ token: session.token, parentOrigin: session.parentOrigin });
    return false;
}
