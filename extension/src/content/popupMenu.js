const MENU_HOST_ID = 'browser-lambdas-popup-menu-host';
let popupMenuSession = null;
const removePopupMenu = () => {
    const session = popupMenuSession;
    if (!session) return;
    popupMenuSession = null;
    clearTimeout(session.timeout);
    document.removeEventListener('mousedown', session.outsideClick, true);
    session.channel?.close();
    session.port?.close();
    session.frame?.remove();
    if (session.id) chrome.runtime.sendMessage({ type: 'CANCEL_UI_SESSION', surface: 'menu', id: session.id }).catch(() => {});
    session.finish({ success: false, error: 'The menu was closed before it connected.' });
};
const togglePopupMenu = async () => {
    if (popupMenuSession) {
        removePopupMenu();
        return { success: true };
    }
    let finish;
    const connected = new Promise((resolve) => { finish = resolve; });
    const session = { finish, ready: false };
    popupMenuSession = session;
    try {
        const registration = await chrome.runtime.sendMessage({ type: 'REGISTER_UI_SESSION', surface: 'menu' });
        session.id = registration?.id;
        if (popupMenuSession !== session) {
            if (session.id) await chrome.runtime.sendMessage({ type: 'CANCEL_UI_SESSION', surface: 'menu', id: session.id });
            return connected;
        }
        if (!registration?.id || !registration.token || !registration.sessionKey) throw new Error('The menu session could not be created.');
        const frame = document.createElement('iframe');
        session.frame = frame;
        frame.id = MENU_HOST_ID;
        frame.title = 'Browser Lambdas menu';
        Object.assign(frame.style, {
            position: 'fixed', top: '12px', right: '16px', zIndex: '2147483647',
            width: 'min(220px, calc(100vw - 24px))', height: '320px', maxHeight: 'calc(100vh - 24px)',
            border: '0', borderRadius: '24px', background: 'transparent', colorScheme: 'dark',
            boxShadow: '0 18px 40px rgba(0, 0, 0, 0.45)'
        });
        const url = new URL(chrome.runtime.getURL('popup-menu.html'));
        url.hash = registration.id;
        frame.src = url.href;
        frame.addEventListener('load', () => {
            if (popupMenuSession !== session || session.port) return;
            const channel = new MessageChannel();
            session.port = channel.port1;
            session.channel = createSecureChannel({
                port: channel.port1, key: registration.sessionKey, sessionId: registration.id,
                purpose: 'menu', role: 'host', timeoutMs: 2000,
                onMessage: (data) => {
                    if (popupMenuSession !== session) return;
                    if (!session.ready && data?.type !== 'READY') throw new Error('The menu did not authenticate.');
                    if (data?.type === 'READY' && !session.ready) {
                        session.ready = true;
                        clearTimeout(session.timeout);
                        finish({ success: true });
                        chrome.runtime.sendMessage({ action: 'TEST_SCRIPT_INJECTION', url: location.hostname, tabId }, (response) => {
                            if (popupMenuSession !== session) return;
                            const error = chrome.runtime.lastError?.message || (response?.success === true ? '' : response?.error || 'Script execution is unavailable.');
                            session.channel.send({ type: 'STATUS', error });
                        });
                        return;
                    }
                    if (!session.ready) return;
                    if (data?.type === 'RESIZE' && Number.isFinite(data.height)) {
                        frame.style.height = `${Math.max(100, Math.min(1000, data.height))}px`;
                    } else if (data?.type === 'ACTION') {
                        const paths = { workspace: 'workspace.html#functions', activity: `workspace.html?activityTabId=${tabId}#activity`, settings: 'settings.html' };
                        if (Object.hasOwn(paths, data.action)) chrome.runtime.sendMessage({ action: 'OPEN_EXTENSION_PAGE', path: paths[data.action] });
                        else if (data.action === 'shell') {
                            removePopupMenu();
                            showShell(tabId, false);
                        } else if (data.action === 'close') removePopupMenu();
                    }
                },
                onError: () => {
                    if (popupMenuSession !== session) return;
                    finish({ success: false, error: 'The encrypted menu connection failed. Try opening the menu again.' });
                    log.err('The encrypted menu connection failed. Try opening the menu again.');
                    removePopupMenu();
                }
            });
            // The token never appears in the page DOM or a message delivered to the website.
            frame.contentWindow.postMessage({ type: 'POPUP_MENU_CONNECT', token: registration.token }, url.origin, [channel.port2]);
        }, { once: true });
        session.outsideClick = (event) => {
            if (event.isTrusted && event.target !== frame) removePopupMenu();
        };
        document.addEventListener('mousedown', session.outsideClick, true);
        session.timeout = setTimeout(() => {
            if (popupMenuSession !== session) return;
            finish({ success: false, error: 'The menu could not connect. Use the extension popup or try again.' });
            removePopupMenu();
        }, 2000);
        document.body.appendChild(frame);
    } catch (error) {
        finish({ success: false, error: error?.message || 'The menu could not open.' });
        if (popupMenuSession === session) removePopupMenu();
    }
    return connected;
};
