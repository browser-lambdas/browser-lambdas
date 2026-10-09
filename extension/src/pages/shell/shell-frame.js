const shellParams = new URLSearchParams(location.hash.slice(1));
const shellParentOrigin = shellParams.get('parentOrigin');
let shellPort = null;
let shellNonce = null;
function executeCommand(command) { shellPort?.postMessage({ type: 'EXECUTE', command }); }
const shellSendPointer = (type, event, extra = {}) => shellPort?.postMessage({ type, pointerId: event.pointerId, screenX: event.screenX, screenY: event.screenY, ...extra });
window.addEventListener('message', (event) => {
    if (event.source !== parent || event.origin !== shellParentOrigin || event.data?.type !== 'SHELL_CONNECT' || event.data.nonce !== shellNonce || shellPort) return;
    shellPort = event.ports[0];
    if (!shellPort) return;
    shellPort.onmessage = ({ data }) => {
        if (data?.type === 'SHELL_OUTPUT') renderShellOutput(data.level, data.values);
        else if (data?.type === 'CLEAR_HISTORY') window.clearShellUiHistory?.();
        else if (data?.type === 'FOCUS') document.getElementById('shell-input')?.focus();
    };
    shellPort.start();
    showShell(event.data.tabId, event.data.useHistory).then(secureShellUi);
});
function renderShellOutput(level, values) {
    const output = document.getElementById('shell-outputs');
    if (!output) return;
    const line = document.createElement('p');
    line.dataset.testid = 'shell-output-line';
    line.textContent = `${level === 'warn' ? 'WARN: ' : ''}${(Array.isArray(values) ? values : []).map(String).join(' ')}`;
    output.appendChild(line);
    output.closest('#shell-body').scrollTop = output.closest('#shell-body').scrollHeight;
}
function secureShellUi() {
    const root = document.getElementById('browser-lambdas-shell');
    const title = document.getElementById('shell-titlebar');
    let escapeDismissedSuggestions = false;
    root.style.cssText += ';inset:0!important;width:100%!important;height:100%!important;transform:none!important';
    document.addEventListener('keydown', (event) => {
        if (event.isTrusted && event.key === 'Escape') {
            const suggestions = document.getElementById('shell-suggestions');
            if (suggestions?.style.display === 'block') {
                escapeDismissedSuggestions = true;
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }, true);
    document.addEventListener('keyup', (event) => {
        if (event.isTrusted && event.key === 'Escape') {
            if (escapeDismissedSuggestions) {
                escapeDismissedSuggestions = false;
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            setTimeout(() => shellPort?.postMessage({ type: 'CLOSE' }), 0);
        }
    }, true);
    document.addEventListener('click', (event) => {
        if (event.target.closest('[aria-label="Close shell"]')) { event.stopImmediatePropagation(); shellPort.postMessage({ type: 'CLOSE' }); }
        const button = event.target.closest('#shell-position-menu button');
        if (button) { event.stopImmediatePropagation(); shellPort.postMessage({ type: 'PLACE', placement: button.textContent.replace('Place on ', '') }); }
    }, true);
    const bind = (element, kind, direction = '', shouldStart = () => true) => {
        element.addEventListener('pointerdown', (event) => { if (event.button !== 0 || !shouldStart(event)) return; event.preventDefault(); element.setPointerCapture(event.pointerId); shellSendPointer('INTERACTION_START', event, { kind, direction }); });
        element.addEventListener('pointermove', (event) => element.hasPointerCapture(event.pointerId) && shellSendPointer('INTERACTION_MOVE', event));
        for (const type of ['pointerup', 'pointercancel']) element.addEventListener(type, (event) => shellSendPointer('INTERACTION_END', event));
    };
    bind(title, 'drag', '', (event) => !event.target.closest('.shell-controls'));
    for (const edge of root.querySelectorAll('.shell-resize-edge')) bind(edge, 'resize', edge.dataset.direction);
}
if (shellParentOrigin) {
    chrome.runtime.sendMessage({ type: 'CLAIM_SHELL_TOKEN' }, (response) => {
        shellNonce = response?.token;
        if (shellNonce) parent.postMessage({ type: 'SHELL_READY', nonce: shellNonce }, shellParentOrigin);
    });
}
