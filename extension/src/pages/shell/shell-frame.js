const shellRegistration = chrome.runtime.sendMessage({ type: 'CLAIM_UI_SESSION', surface: 'shell', id: location.hash.slice(1) });
let shellPort = null;
let shellChannel = null;
let shellReady = false;
let shellFailed = false;
let shellInitialized = false;
let shellPolicyModules;
window.getAllowedShellTheme = async () => {
    const theme = await getSelectedShellTheme();
    if (!theme) return null;
    const { getProjectSettings, evaluateProjectAccess } = await (shellPolicyModules ??= import('../../shared/projectPolicy.js'));
    if (!evaluateProjectAccess({ settings: await getProjectSettings(), project: theme.project, category: 'styles' }).allowed) return null;
    return theme;
};
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.local_storage_key_project_settings || changes.local_storage_key_shellcss)) void refreshShellTheme();
});
const sendShellAction = (message) => shellReady && shellChannel.send(message);
function executeCommand(command) { sendShellAction({ type: 'EXECUTE', command }); }
const shellSendPointer = (type, event, extra = {}) => sendShellAction({ type, pointerId: event.pointerId, screenX: event.screenX, screenY: event.screenY, ...extra });
window.addEventListener('message', async (event) => {
    if (event.source !== parent || event.data?.type !== 'SHELL_CONNECT' || !event.ports[0] || shellPort) return;
    const registration = await shellRegistration;
    if (shellPort || !registration?.token || !registration.sessionKey || event.origin !== registration.parentOrigin || event.data.token !== registration.token) return;
    shellPort = event.ports[0];
    shellChannel = createSecureChannel({
        port: shellPort, key: registration.sessionKey, sessionId: location.hash.slice(1),
        purpose: 'shell', role: 'client', timeoutMs: 2000,
        onMessage: async (data) => {
            if (!shellInitialized) {
                if (data?.type !== 'INIT') throw new Error('The shell did not receive its initialization.');
                shellInitialized = true;
                await showShell(data.tabId, data.useHistory);
                if (shellFailed) { document.getElementById('browser-lambdas-shell')?.remove(); return; }
                secureShellUi();
                shellReady = true;
                shellChannel.send({ type: 'SHELL_READY' });
                return;
            }
            if (!shellReady) throw new Error('The shell is not ready.');
            if (data?.type === 'SHELL_OUTPUT') renderShellOutput(data.level, data.values);
            else if (data?.type === 'CLEAR_HISTORY') window.clearShellUiHistory?.();
            else if (data?.type === 'FOCUS') document.getElementById('shell-input')?.focus();
        },
        onError: () => {
            shellFailed = true;
            shellReady = false;
            document.getElementById('browser-lambdas-shell')?.remove();
        }
    });
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
            setTimeout(() => sendShellAction({ type: 'CLOSE' }), 0);
        }
    }, true);
    document.addEventListener('click', (event) => {
        if (!event.isTrusted || !shellReady) { event.preventDefault(); event.stopImmediatePropagation(); return; }
        if (event.target.closest('[aria-label="Close shell"]')) { event.stopImmediatePropagation(); sendShellAction({ type: 'CLOSE' }); }
        const button = event.target.closest('#shell-position-menu button');
        if (button) { event.stopImmediatePropagation(); sendShellAction({ type: 'PLACE', placement: button.textContent.replace('Place on ', '') }); }
    }, true);
    const bind = (element, kind, direction = '', shouldStart = () => true) => {
        element.addEventListener('pointerdown', (event) => { if (!event.isTrusted || !shellReady || event.button !== 0 || !shouldStart(event)) return; event.preventDefault(); element.setPointerCapture(event.pointerId); shellSendPointer('INTERACTION_START', event, { kind, direction }); });
        element.addEventListener('pointermove', (event) => event.isTrusted && element.hasPointerCapture(event.pointerId) && shellSendPointer('INTERACTION_MOVE', event));
        for (const type of ['pointerup', 'pointercancel']) element.addEventListener(type, (event) => event.isTrusted && shellSendPointer('INTERACTION_END', event));
    };
    bind(title, 'drag', '', (event) => !event.target.closest('.shell-controls'));
    for (const edge of root.querySelectorAll('.shell-resize-edge')) bind(edge, 'resize', edge.dataset.direction);
}
