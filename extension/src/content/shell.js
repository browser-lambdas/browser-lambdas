const SHELL_ID = 'browser-lambdas-shell';
const SHELL_PAGE = 'shell.html';
let shellFrameSession = null;

const frameBounds = (value) => {
    const minWidth = Math.min(320, window.innerWidth);
    const minHeight = Math.min(220, window.innerHeight);
    const width = Math.min(Math.max(minWidth, value.width), window.innerWidth);
    const height = Math.min(Math.max(minHeight, value.height), window.innerHeight);
    return {
        x: Math.min(Math.max(0, value.x), Math.max(0, window.innerWidth - width)),
        y: Math.min(Math.max(0, value.y), Math.max(0, window.innerHeight - height)),
        width,
        height
    };
};
const setFrameBounds = (frame, bounds) => {
    frame.style.left = `${bounds.x}px`;
    frame.style.top = `${bounds.y}px`;
    frame.style.width = `${bounds.width}px`;
    frame.style.height = `${bounds.height}px`;
};
const currentFrameBounds = (frame) => {
    const rect = frame.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
};
const shellPositionScope = location.href.split('#')[0];
const persistFrameBounds = (frame) => setShellPosition(currentFrameBounds(frame), shellPositionScope);
const sendShellMessage = (message) => shellFrameSession?.ready && shellFrameSession.port.postMessage(message);
const appendShellOutput = (level, values) => sendShellMessage({ type: 'SHELL_OUTPUT', level, values: values.map(String) });

const placeShellFrame = async (frame, placement) => {
    const margin = 20;
    const sideWidth = Math.max(320, Math.floor(innerWidth * 0.35));
    const rowHeight = Math.max(220, Math.floor(innerHeight * 0.4));
    const bounds = placement === 'left' ? { x: margin, y: margin, width: sideWidth, height: innerHeight - margin * 2 }
        : placement === 'right' ? { x: innerWidth - sideWidth - margin, y: margin, width: sideWidth, height: innerHeight - margin * 2 }
        : placement === 'top' ? { x: margin, y: margin, width: innerWidth - margin * 2, height: rowHeight }
        : { x: margin, y: innerHeight - rowHeight - margin, width: innerWidth - margin * 2, height: rowHeight };
    setFrameBounds(frame, frameBounds(bounds));
    await persistFrameBounds(frame);
};
const moveShellFrame = (session, message) => {
    const active = session.interaction;
    if (!active || active.pointerId !== message.pointerId)
        return;
    const dx = message.screenX - active.screenX;
    const dy = message.screenY - active.screenY;
    let { x, y, width, height } = active.bounds;
    if (active.kind === 'drag') {
        x += dx; y += dy;
    } else {
        if (active.direction.includes('right')) width = Math.max(320, width + dx);
        if (active.direction.includes('bottom')) height = Math.max(220, height + dy);
        if (active.direction.includes('left')) { const next = Math.max(320, width - dx); x += width - next; width = next; }
        if (active.direction.includes('top')) { const next = Math.max(220, height - dy); y += height - next; height = next; }
    }
    setFrameBounds(session.frame, frameBounds({ x, y, width, height }));
};
const handleShellFrameMessage = async (session, message) => {
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'EXECUTE' && typeof message.command === 'string') executeCommand(message.command);
    else if (message.type === 'CLOSE') removeShell();
    else if (message.type === 'PLACE' && ['left', 'right', 'top', 'bottom'].includes(message.placement)) await placeShellFrame(session.frame, message.placement);
    else if (message.type === 'INTERACTION_START' && ['drag', 'resize'].includes(message.kind)) {
        session.interaction = { ...message, bounds: currentFrameBounds(session.frame) };
    } else if (message.type === 'INTERACTION_MOVE') moveShellFrame(session, message);
    else if (message.type === 'INTERACTION_END' && session.interaction?.pointerId === message.pointerId) {
        session.interaction = null;
        await persistFrameBounds(session.frame);
    }
};
const showShell = async (tabId, useHistory = false) => {
    if (shellFrameSession) { sendShellMessage({ type: 'FOCUS' }); return; }
    const frame = document.createElement('iframe');
    const nonce = crypto.randomUUID();
    await chrome.runtime.sendMessage({ type: 'REGISTER_SHELL_TOKEN', token: nonce });
    frame.id = SHELL_ID;
    frame.title = 'Browser Lambdas shell';
    frame.dataset.testid = 'shell';
    Object.assign(frame.style, { position: 'fixed', zIndex: '2147483647', border: '0', borderRadius: '24px', background: '#160e16', colorScheme: 'dark', overflow: 'hidden' });
    setFrameBounds(frame, frameBounds(await getShellPosition(shellPositionScope)));
    const url = new URL(chrome.runtime.getURL(SHELL_PAGE));
    url.hash = new URLSearchParams({ parentOrigin: location.origin }).toString();
    frame.src = url.href;
    const channel = new MessageChannel();
    const session = { frame, port: channel.port1, nonce, ready: false, interaction: null };
    shellFrameSession = session;
    channel.port1.onmessage = ({ data }) => shellFrameSession === session && void handleShellFrameMessage(session, data);
    channel.port1.start();
    const extensionOrigin = new URL(chrome.runtime.getURL('/')).origin;
    const ready = (event) => {
        if (event.source !== frame.contentWindow || event.origin !== extensionOrigin || event.data?.type !== 'SHELL_READY' || event.data.nonce !== nonce) return;
        window.removeEventListener('message', ready);
        frame.contentWindow.postMessage({ type: 'SHELL_CONNECT', nonce, tabId, useHistory }, extensionOrigin, [channel.port2]);
        session.ready = true;
    };
    session.readyListener = ready;
    window.addEventListener('message', ready);
    document.body.appendChild(frame);
};
function removeShell() {
    if (!shellFrameSession) return;
    window.removeEventListener('message', shellFrameSession.readyListener);
    shellFrameSession.port.close();
    shellFrameSession.frame.remove();
    shellFrameSession = null;
}
