const createSecureChannel = ({ port, key, sessionId, purpose, role, timeoutMs = 1000, onMessage, onError }) => {
    if (!sessionId || !purpose || !['host', 'client'].includes(role)) throw new Error('Invalid secure channel configuration.');
    const encoder = new TextEncoder();
    const decode = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
    const encode = (value) => btoa(String.fromCharCode(...new Uint8Array(value)));
    const outgoingDirection = role === 'host' ? 'host->client' : 'client->host';
    const incomingDirection = role === 'host' ? 'client->host' : 'host->client';
    const context = ['browser-lambdas-channel', 1, purpose, sessionId];
    const additionalData = (direction, seq) => encoder.encode(JSON.stringify([...context, direction, seq]));
    const keys = (async () => {
        const raw = decode(key);
        if (raw.length !== 32) throw new Error('Invalid secure channel key.');
        const master = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
        const derive = (direction) => crypto.subtle.deriveKey({
            name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(JSON.stringify(context)), info: encoder.encode(direction)
        }, master, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        return { outgoing: await derive(outgoingDirection), incoming: await derive(incomingDirection) };
    })();
    let closed = false;
    let failing = false;
    let authenticated = false;
    let sentHello = false;
    let receivedHello = false;
    let outgoingSequence = 0;
    let incomingSequence = 0;
    let outgoingQueue = Promise.resolve();
    let incomingQueue = Promise.resolve();
    let failureTimeout;
    let resolveReady, rejectReady;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    ready.catch(() => {});
    const close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timeout);
        clearTimeout(failureTimeout);
        port.onmessage = null;
        port.onmessageerror = null;
        port.close();
        if (!authenticated) rejectReady(new Error('Secure channel closed before authentication.'));
    };
    const fail = (notifyPeer = true) => {
        if (closed || failing) return;
        failing = true;
        clearTimeout(timeout);
        const finish = () => {
            if (closed) return;
            close();
            onError(new Error('Secure channel authentication or message validation failed.'));
        };
        if (!notifyPeer) { finish(); return; }
        // Report failure with the independent outgoing key, without waiting indefinitely on crypto.
        failureTimeout = setTimeout(finish, 100);
        sendFrame({ kind: 'close' }).then(finish);
    };
    const markReady = () => {
        if (!closed && !failing && sentHello && receivedHello) {
            authenticated = true;
            clearTimeout(timeout);
            resolveReady();
        }
    };
    const sendFrame = (payload) => {
        outgoingQueue = outgoingQueue.then(async () => {
            const { outgoing } = await keys;
            if (closed || (failing && payload.kind !== 'close')) return;
            if (!Number.isSafeInteger(outgoingSequence)) throw new Error('Secure channel sequence exhausted.');
            const seq = outgoingSequence++;
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: additionalData(outgoingDirection, seq) }, outgoing, encoder.encode(JSON.stringify(payload)));
            if (!closed && (!failing || payload.kind === 'close')) port.postMessage({ v: 1, seq, iv: encode(iv), ct: encode(ct) });
        }).catch(fail);
        return outgoingQueue;
    };
    const timeout = setTimeout(fail, timeoutMs);
    port.onmessage = ({ data }) => {
        incomingQueue = incomingQueue.then(async () => {
            if (closed || failing) return;
            if (data?.v !== 1 || !Number.isSafeInteger(data.seq) || data.seq !== incomingSequence
                || typeof data.iv !== 'string' || typeof data.ct !== 'string') throw new Error('Invalid secure channel envelope.');
            const iv = decode(data.iv);
            if (iv.length !== 12) throw new Error('Invalid secure channel IV.');
            const { incoming } = await keys;
            const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: additionalData(incomingDirection, data.seq) }, incoming, decode(data.ct));
            if (closed || failing) return;
            const message = JSON.parse(new TextDecoder().decode(plaintext));
            incomingSequence++;
            if (message?.kind === 'close') { fail(false); return; }
            if (!receivedHello) {
                if (message?.kind !== 'hello') throw new Error('Missing secure channel proof.');
                receivedHello = true;
                markReady();
                return;
            }
            if (message?.kind !== 'data') throw new Error('Unexpected secure channel message.');
            await ready;
            if (!closed && !failing) {
                // Nested requests need later inbound responses while their handlers are still running.
                Promise.resolve(onMessage(message.value)).catch(fail);
            }
        }).catch(fail);
    };
    port.onmessageerror = fail;
    port.start();
    sendFrame({ kind: 'hello' }).then(() => { sentHello = true; markReady(); });
    return {
        ready,
        send: (payload) => ready.then(() => { if (!closed && !failing) return sendFrame({ kind: 'data', value: payload }); }).catch(fail),
        close
    };
};
