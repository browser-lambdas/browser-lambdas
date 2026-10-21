log.dbg('Content script initialized.');
let tabId = null;
const USER_SCRIPT_WORLD = 'USER_SCRIPT_WORLD';
const MAIN_WORLD = 'MAIN_WORLD';
const channelToPort = new Map();
const requestToChannel = new Map();
// Send a message to the background script. This will be redefined if the
// `chrome` runtime is available. Typing the parameter avoids `any` errors when
// used elsewhere.
let sendToBackground = async () => {
    throw new Error('Chrome runtime not available.');
};
if (typeof chrome !== 'undefined' && chrome.runtime?.connect) {
    const bgPort = chrome.runtime.connect();
    const pending = new Map();
    const heartbeat = setInterval(() => {
        try {
            bgPort.postMessage({ type: 'HEARTBEAT' });
        }
        catch (err) {
            log.err('Background-port heartbeat failed.', err);
        }
    }, 1000);
    bgPort.onDisconnect.addListener(() => clearInterval(heartbeat));
    bgPort.onMessage.addListener(async (msg) => {
        if (msg.type === 'FUNCTION_CALL_RESPONSE' ||
            msg.type === 'TAB_OPERATION_RESPONSE') {
            const channelId = requestToChannel.get(msg.id);
            if (channelId) {
                const entry = channelToPort.get(channelId);
                if (entry) {
                    const { port, sessionKey } = entry;
                    const encrypted = await encrypt({ type: msg.type, id: msg.id, value: msg.value, error: msg.error }, sessionKey);
                    port.postMessage(encrypted);
                }
                else {
                    log.err(`Unable to relay response: lambda channel is unavailable (channelId=${channelId}, requestId=${msg.id}).`);
                }
                requestToChannel.delete(msg.id);
            }
            else {
                log.err(`Unable to relay response: no lambda channel is registered (requestId=${msg.id}).`);
            }
            return;
        }
        if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
        }
    });
    sendToBackground = (msg) => new Promise((resolve) => {
        msg.id = msg.id || crypto.randomUUID();
        pending.set(msg.id, resolve);
        log.dbg(`Forwarding request to background: type=${msg.type || msg.action || 'unknown'}, requestId=${msg.id}.`);
        bgPort.postMessage(msg);
    });
}
const handleFunctionCall = async (msg, sessionKey, channelId) => {
    log.dbg(`Forwarding nested function request: requestId=${msg.id}, targetTabId=${msg.tabId ?? tabId ?? 'none'}.`);
    try {
        requestToChannel.set(msg.id, channelId);
        await sendToBackground({
            type: 'EXECUTE_LAMBDA',
            tabId: msg.tabId ?? tabId,
            requestId: msg.id,
            userInput: msg.userInput,
            invocationToken: channelToPort.get(channelId)?.invocationToken
        });
    }
    catch (e) {
        log.err(`Failed to forward nested function request: requestId=${msg.id}.`, e);
        const entry = channelToPort.get(channelId);
        const resp = await encrypt({ type: 'FUNCTION_CALL_RESPONSE', id: msg.id, value: undefined, error: e.message }, sessionKey);
        entry.port.postMessage(resp);
    }
};
if (typeof window !== 'undefined') {
    const handshakeMap = new Map();
    const failHandshake = (hs) => {
        clearTimeout(hs.timeout);
        handshakeMap.delete(hs.aToken);
        channelToPort.get(hs.requestId)?.port.close();
        channelToPort.delete(hs.requestId);
        const error = 'The function could not establish its runtime connection.';
        log.err(`Function handshake failed: requestId=${hs.requestId}.`);
        sendToBackground({ type: 'LAMBDA_RESULT', id: hs.requestId, result: { error }, invocationToken: hs.invocationToken })
            .catch((err) => log.err('Unable to report the failed function handshake.', err));
    };
    if (typeof chrome !== 'undefined') {
        chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
            if (msg.type === 'BACKGROUND_INIT_HANDSHAKE') {
                log.dbg(`Function handshake initiated: requestId=${msg.requestId}.`);
                const hs = { ...msg };
                hs.timeout = setTimeout(() => failHandshake(hs), 1000);
                handshakeMap.set(msg.aToken, hs);
                window.postMessage({ type: 'CONTENT_SCRIPT_INIT', qToken: msg.qToken }, '*');
            }
            if (msg.action === 'OPEN_SHELL') {
                // When triggered from the background script we
                // don't use history by default.
                showShell(tabId ?? -1, false);
            }
            if (msg.action === 'CLEAR_SHELL_HISTORY') {
                sendShellMessage({ type: 'CLEAR_HISTORY' });
                sendResponse({ success: true });
            }
            if (msg.action === 'OPEN_POPUP_MENU') {
                togglePopupMenu().then(sendResponse).catch(() => sendResponse({ success: false, error: 'The menu could not open.' }));
                return true;
            }
        });
        chrome.runtime.sendMessage({ type: 'GET_TAB_ID' }, (res) => {
            tabId = res?.tabId ?? null;
        });
    }
    window.addEventListener('message', async (ev) => {
        if (ev.source !== window || ev.data?.type !== 'aToken')
            return;
        const hs = handshakeMap.get(ev.data.aToken);
        if (!hs)
            return;
        handshakeMap.delete(ev.data.aToken);
        const channelId = hs.requestId;
        const sessionKey = hs.sessionKey;
        const handshakeId = hs.handshakeId;
        const handshakeLambdaToken = hs.handshakeLambdaToken;
        const handshakeContentToken = hs.handshakeContentToken;
        const chan = new MessageChannel();
        const port = chan.port1;
        channelToPort.set(channelId, { port, sessionKey, invocationToken: hs.invocationToken });
        log.dbg(`Opening secure function channel: requestId=${channelId}.`);
        window.postMessage({ type: 'CONTENT_SCRIPT_HANDSHAKE', handshakeId }, '*', [chan.port2]);
        let done = false;
        port.onmessage = async ({ data }) => {
            let msg;
            try {
                msg = await decrypt(data, sessionKey);
            }
            catch (err) {
                log.err(`Secure function message could not be decrypted: requestId=${channelId}.`, err);
                failHandshake(hs);
                return;
            }
            if (!done) {
                if (msg.type === 'HANDSHAKE_LAMBDA' && msg.token === handshakeLambdaToken) {
                    done = true;
                    const resp = await encrypt({ type: 'HANDSHAKE_CONTENT', token: handshakeContentToken }, sessionKey);
                    log.dbg(`Secure function channel established: requestId=${channelId}.`);
                    port.postMessage(resp);
                    return;
                }
                return;
            }
            // Only the trusted background handshake supplies caller identity.
            msg.invocationToken = hs.invocationToken;
            msg.executionWorld = hs.executionWorld;
            switch (msg.type) {
                case 'LAMBDA_READY':
                    clearTimeout(hs.timeout);
                    break;
                case 'SHELL_OUTPUT':
                    appendShellOutput(msg.level, Array.isArray(msg.values) ? msg.values : []);
                    break;
                case 'ACTIVITY_LOG':
                    (log[msg.level === 'error' ? 'err' : msg.level === 'debug' ? 'dbg' : 'info'] || log.info)(msg.message);
                    break;
                case 'FUNCTION_CALL_REQUEST':
                    await handleFunctionCall(msg, sessionKey, channelId);
                    break;
                case 'TAB_OPERATION_REQUEST':
                    log.dbg(`Forwarding tab operation: operation=${msg.operation}, requestId=${msg.id}.`);
                    requestToChannel.set(msg.id, channelId);
                    sendToBackground(msg);
                    break;
                case 'LAMBDA_RESULT':
                    msg.id = hs.requestId;
                    await sendToBackground(msg);
                    channelToPort.delete(channelId);
                    break;
                case 'GET_SECRET_REQUEST':
                case 'GET_STORAGE_REQUEST':
                case 'SET_STORAGE_REQUEST': {
                    const r = await sendToBackground(msg);
                    const e = await encrypt(r, sessionKey);
                    port.postMessage(e);
                    break;
                }
            }
        };
    });
}
const executeCommand = async (userInput) => {
    if (typeof chrome !== 'undefined') {
        const requestId = crypto.randomUUID();
        const [first = '', second = ''] = userInput.trim().split(/\s+/);
        const executionPrefix = first.toLowerCase();
        const execution = executionPrefix === '@main-world'
            ? MAIN_WORLD
            : USER_SCRIPT_WORLD;
        const hasExecutionPrefix = executionPrefix === '@user-world' || executionPrefix === '@main-world';
        const command = hasExecutionPrefix ? second : first;
        log.dbg(`Function execution submitted: lambda="${command || 'missing'}", host="${execution}", tabId=${tabId ?? 'unknown'}, requestId=${requestId}.`);
        chrome.runtime.sendMessage({
            action: 'EXECUTE_LAMBDA',
            userInput,
            requestId
        }, (response) => {
            if (chrome.runtime.lastError) {
                log.err(`Function execution response failed: lambda="${command || 'missing'}", host="${execution}", requestId=${requestId}.`, chrome.runtime.lastError.message);
                return;
            }
            if (response?.success === false) {
                appendShellOutput('warn', [response.error || 'Lambda execution failed.']);
                log.dbg(`Function execution rejected: lambda="${command || 'missing'}", host="${execution}", requestId=${requestId}.`, response.error || 'Lambda execution failed.');
            }
        });
    }
};
