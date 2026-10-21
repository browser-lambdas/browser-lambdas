const menuRegistration = chrome.runtime.sendMessage({ type: 'CLAIM_POPUP_MENU', id: location.hash.slice(1) });
let menuPort = null;
window.addEventListener('message', async (event) => {
    if (event.source !== parent || event.data?.type !== 'POPUP_MENU_CONNECT' || !event.ports[0] || menuPort) return;
    const registration = await menuRegistration;
    if (menuPort || !registration?.token || event.origin !== registration.parentOrigin || event.data.token !== registration.token) return;
    menuPort = event.ports[0];
    menuPort.onmessage = ({ data }) => {
        if (data?.type !== 'STATUS') return;
        const warning = document.querySelector('.bl-warning');
        warning.textContent = data.error ? `⚠️ Script execution blocked: ${data.error}` : '';
        warning.hidden = !data.error;
    };
    menuPort.start();
    const menu = document.querySelector('.bl-menu');
    menu.hidden = false;
    menuPort.postMessage({ type: 'READY' });
    new ResizeObserver(() => menuPort.postMessage({ type: 'RESIZE', height: Math.ceil(menu.getBoundingClientRect().height) })).observe(menu);
    menu.querySelector('button').focus();
});
document.addEventListener('click', (event) => {
    if (!event.isTrusted || !menuPort) return;
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action) menuPort.postMessage({ type: 'ACTION', action });
});
document.addEventListener('keyup', (event) => {
    if (event.isTrusted && event.key === 'Escape') {
        event.preventDefault();
        setTimeout(() => menuPort?.postMessage({ type: 'ACTION', action: 'close' }), 0);
    }
});
