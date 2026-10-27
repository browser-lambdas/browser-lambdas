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
const sendShellMessage = (message) => shellFrameSession?.ready && shellFrameSession.channel.send(message);
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
    const session = { ready: false, interaction: null };
    shellFrameSession = session;
    try {
        const registration = await chrome.runtime.sendMessage({ type: 'REGISTER_UI_SESSION', surface: 'shell' });
        session.id = registration?.id;
        if (shellFrameSession !== session) {
            if (session.id) await chrome.runtime.sendMessage({ type: 'CANCEL_UI_SESSION', surface: 'shell', id: session.id });
            return;
        }
        if (!registration?.token || !registration.sessionKey) throw new Error('The terminal session could not be created.');
        const frame = document.createElement('iframe');
        session.frame = frame;
        frame.id = SHELL_ID;
        frame.title = 'Browser Lambdas terminal';
        frame.dataset.testid = 'shell';
        Object.assign(frame.style, { position: 'fixed', zIndex: '2147483647', border: '0', borderRadius: '24px', background: '#160e16', colorScheme: 'dark', overflow: 'hidden' });
        const bounds = await getShellPosition(shellPositionScope);
        if (shellFrameSession !== session) return;
        setFrameBounds(frame, frameBounds(bounds));
        const url = new URL(chrome.runtime.getURL(SHELL_PAGE));
        url.hash = registration.id;
        frame.src = url.href;
        frame.addEventListener('load', () => {
            if (shellFrameSession !== session || session.port) return;
            const channel = new MessageChannel();
            session.port = channel.port1;
            session.channel = createSecureChannel({
                port: channel.port1, key: registration.sessionKey, sessionId: registration.id,
                purpose: 'shell', role: 'host', timeoutMs: 2000,
                onMessage: (data) => {
                    if (shellFrameSession !== session) return;
                    if (!session.ready) {
                        if (data?.type !== 'SHELL_READY') throw new Error('The terminal did not become ready.');
                        session.ready = true;
                        clearTimeout(session.timeout);
                        return;
                    }
                    return handleShellFrameMessage(session, data);
                },
                onError: () => {
                    if (shellFrameSession !== session) return;
                    log.err('The encrypted shell connection failed. Reopen the terminal to try again.');
                    removeShell();
                }
            });
            frame.contentWindow.postMessage({ type: 'SHELL_CONNECT', token: registration.token }, url.origin, [channel.port2]);
            session.channel.ready.then(() => session.channel.send({ type: 'INIT', tabId, useHistory })).catch(() => {});
        }, { once: true });
        session.timeout = setTimeout(() => {
            if (shellFrameSession !== session) return;
            log.err('The terminal could not connect. Reopen the terminal to try again.');
            removeShell();
        }, 2000);
        document.body.appendChild(frame);
    } catch {
        if (shellFrameSession !== session) return;
        log.err('The terminal could not open. Reopen the terminal to try again.');
        removeShell();
    }
};
function removeShell() {
    const session = shellFrameSession;
    if (!session) return;
    shellFrameSession = null;
    clearTimeout(session.timeout);
    session.channel?.close();
    session.port?.close();
    session.frame?.remove();
    if (session.id) chrome.runtime.sendMessage({ type: 'CANCEL_UI_SESSION', surface: 'shell', id: session.id }).catch(() => {});
}
