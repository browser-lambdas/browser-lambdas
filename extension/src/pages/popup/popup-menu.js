const menuRegistration = chrome.runtime.sendMessage({ type: 'CLAIM_UI_SESSION', surface: 'menu', id: location.hash.slice(1) });
let menuPort = null;
let menuChannel = null;
let menuReady = false;
let menuResizeObserver = null;
window.addEventListener('message', async (event) => {
    if (event.source !== parent || event.data?.type !== 'POPUP_MENU_CONNECT' || !event.ports[0] || menuPort) return;
    const registration = await menuRegistration;
    if (menuPort || !registration?.token || !registration.sessionKey || event.origin !== registration.parentOrigin || event.data.token !== registration.token) return;
    menuPort = event.ports[0];
    const menu = document.querySelector('.bl-menu');
    menuChannel = createSecureChannel({ port: menuPort, key: registration.sessionKey, sessionId: location.hash.slice(1), purpose: 'menu', role: 'client', timeoutMs: 2000,
        onMessage: (data) => {
            if (data?.type !== 'STATUS') return;
            const warning = document.querySelector('.bl-warning');
            warning.textContent = data.error ? `⚠️ Script execution blocked: ${data.error}` : '';
            warning.hidden = !data.error;
        },
        onError: () => {
            menuReady = false;
            menu.hidden = true;
            menuResizeObserver?.disconnect();
        }
    });
    menuChannel.ready.then(() => {
        menuReady = true;
        menu.hidden = false;
        menuChannel.send({ type: 'READY' });
        menuResizeObserver = new ResizeObserver(() => menuChannel.send({ type: 'RESIZE', height: Math.ceil(menu.getBoundingClientRect().height) }));
        menuResizeObserver.observe(menu);
        menu.querySelector('button').focus();
    }).catch(() => {});
});
document.addEventListener('click', (event) => {
    if (!event.isTrusted || !menuReady) return;
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action) menuChannel.send({ type: 'ACTION', action });
});
document.addEventListener('keyup', (event) => {
    if (event.isTrusted && event.key === 'Escape') {
        event.preventDefault();
        setTimeout(() => { if (menuReady) menuChannel.send({ type: 'ACTION', action: 'close' }); }, 0);
    }
});
