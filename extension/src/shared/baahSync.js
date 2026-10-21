const WS_LOCK_KEY = 'local_storage_key_ws_lock';
const LAMBDA_FUNCTIONS_KEY = 'local_storage_key_lambdas';
const STYLES_KEY = 'local_storage_key_shellcss';
const TRIGGERS_KEY = 'local_storage_key_triggers';
const LOOPBACK_HOST = '127.0.0.1';
const AUTH_PROTOCOL_VERSION = 1;
const MAX_PUSH_MESSAGE_BYTES = 50 * 1024 * 1024;

function initBaahSync() {
    let socket = null;
    let handshakeComplete = false;
    let updateQueue = Promise.resolve();
    let messageQueue = Promise.resolve();
    let sharedSecret;
    let sessionKeys = null;
    let expectedSequence = 1;
    let sendSequence = 1;
    let wsPort = 4455;
    let pollHandle = 0;
    let tabId;
    let activeBatch = null;

    const textEncoder = new TextEncoder();
    const base64UrlFromBytes = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const bytesFromBase64Url = (value) => {
        const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
        return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    };
    const randomBase64Url = (length) => base64UrlFromBytes(crypto.getRandomValues(new Uint8Array(length)));
    const canonical = (value) => {
        if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
        if (value && typeof value === 'object') {
            return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
        }
        return JSON.stringify(value);
    };
    async function importHmacKey(secret) {
        return crypto.subtle.importKey('raw', textEncoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    }
    async function hmac(secret, value) {
        const key = await importHmacKey(secret);
        const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(canonical(value)));
        return base64UrlFromBytes(new Uint8Array(signature));
    }
    function safeEqual(a, b) {
        if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
        let diff = 0;
        for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
        return diff === 0;
    }
    async function hkdfKey(extensionNonce, cliNonce, info, usages) {
        const baseKey = await crypto.subtle.importKey('raw', textEncoder.encode(sharedSecret), 'HKDF', false, ['deriveKey']);
        return crypto.subtle.deriveKey({
            name: 'HKDF',
            hash: 'SHA-256',
            salt: textEncoder.encode(`${extensionNonce}:${cliNonce}`),
            info: textEncoder.encode(info)
        }, baseKey, { name: 'AES-GCM', length: 256 }, false, usages);
    }
    async function deriveSessionKeys(extensionNonce, cliNonce) {
        return {
            cliToExtension: await hkdfKey(extensionNonce, cliNonce, 'baah-sync-v1 cli-to-extension aes-256-gcm', ['decrypt']),
            extensionToCli: await hkdfKey(extensionNonce, cliNonce, 'baah-sync-v1 extension-to-cli reserved', ['encrypt'])
        };
    }
    async function handleHandshakeMessage(msg) {
        const extensionNonce = socket?._baahExtensionNonce;
        if (msg.type !== 'auth-challenge' || msg.version !== AUTH_PROTOCOL_VERSION || !extensionNonce || Math.abs(Date.now() - msg.timestamp) > 30000) {
            log.err(`Sync authentication rejected: invalid challenge metadata (protocolVersion=${msg.version ?? 'missing'}).`);
            socket.close();
            return;
        }
        const expected = await hmac(sharedSecret, {
            type: 'auth-challenge',
            version: msg.version,
            keyId: msg.keyId,
            extensionNonce,
            cliNonce: msg.cliNonce,
            timestamp: msg.timestamp
        });
        if (!safeEqual(msg.mac, expected)) {
            log.err(`Sync authentication rejected: challenge signature verification failed (keyId="${msg.keyId || 'missing'}").`);
            socket.close();
            return;
        }
        const responseMac = await hmac(sharedSecret, {
            type: 'auth-response',
            version: AUTH_PROTOCOL_VERSION,
            keyId: msg.keyId,
            extensionNonce,
            cliNonce: msg.cliNonce,
            challengeMac: msg.mac
        });
        sessionKeys = await deriveSessionKeys(extensionNonce, msg.cliNonce);
        socket.send(JSON.stringify({ type: 'auth-response', version: AUTH_PROTOCOL_VERSION, keyId: msg.keyId, mac: responseMac }));
        handshakeComplete = true;
        log.dbg(`Sync authentication completed: keyId="${msg.keyId}".`);
    }
    async function openPushMessage(rawMessage) {
        if (rawMessage.length > MAX_PUSH_MESSAGE_BYTES) {
            log.err(`Sync message rejected: payload size ${rawMessage.length} bytes exceeds the ${MAX_PUSH_MESSAGE_BYTES}-byte limit.`);
            socket.close();
            return null;
        }
        const envelope = JSON.parse(rawMessage);
        if (envelope.type !== 'sync-message' || envelope.sequence !== expectedSequence || !envelope.iv || !envelope.ct || !envelope.tag || !sessionKeys) {
            log.err(`Sync message rejected: invalid envelope or sequence (expectedSequence=${expectedSequence}, receivedSequence=${envelope.sequence ?? 'missing'}).`);
            socket.close();
            return null;
        }
        try {
            const aad = textEncoder.encode(canonical({ type: 'sync-message', sequence: envelope.sequence }));
            const iv = bytesFromBase64Url(envelope.iv);
            const ciphertext = bytesFromBase64Url(envelope.ct);
            const tag = bytesFromBase64Url(envelope.tag);
            const encrypted = new Uint8Array(ciphertext.length + tag.length);
            encrypted.set(ciphertext, 0);
            encrypted.set(tag, ciphertext.length);
            const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, sessionKeys.cliToExtension, encrypted);
            expectedSequence += 1;
            return JSON.parse(new TextDecoder().decode(decrypted));
        }
        catch (error) {
            log.err(`Sync message rejected: authentication, decryption, or JSON parsing failed (sequence=${envelope.sequence}).`, error);
            socket.close();
            return null;
        }
    }
    async function sealPushMessage(payload) {
        const sequence = sendSequence;
        sendSequence += 1;
        const aad = textEncoder.encode(canonical({ type: 'sync-message', sequence }));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = textEncoder.encode(JSON.stringify(payload));
        const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, sessionKeys.extensionToCli, encoded));
        const tagLength = 16;
        const ciphertext = encrypted.slice(0, encrypted.length - tagLength);
        const tag = encrypted.slice(encrypted.length - tagLength);
        return { type: 'sync-message', sequence, iv: base64UrlFromBytes(iv), ct: base64UrlFromBytes(ciphertext), tag: base64UrlFromBytes(tag) };
    }
    async function sendBatchAck(payload) {
        if (!socket || socket.readyState !== WebSocket.OPEN || !sessionKeys) return;
        socket.send(JSON.stringify(await sealPushMessage(payload)));
    }
    function pushDebug(label, details = {}) {
        log.dbg(`Sync batch ${label}.`, {
            expectedSequence,
            sendSequence,
            hasActiveBatch: Boolean(activeBatch),
            activeBatchId: activeBatch?.id || null,
            activeCounts: activeBatch?.counts || null,
            ...details
        });
    }
    function rejectBatch(batchId, reason, details = {}) {
        pushDebug(`rejecting batch: ${reason}`, { batchId, ...details });
        sendBatchAck({
            type: 'batch-rejected',
            batchId: batchId || activeBatch?.id || 'unknown',
            reason,
            debug: {
                expectedSequence,
                activeBatchId: activeBatch?.id || null,
                messageType: details.messageType || null
            }
        });
        activeBatch = null;
    }
    async function createActiveBatchFromMessage(msg) {
        activeBatch = {
            id: msg.batchId,
            project: msg.project || 'default',
            expectedCounts: msg.counts || {},
            counts: { lambdas: 0, styles: 0, triggers: 0 },
            manifest: msg.manifest || null,
            items: []
        };
        pushDebug('started batch', { batchId: activeBatch.id, project: activeBatch.project, expectedCounts: activeBatch.expectedCounts });
    }
    async function isActiveBatchMessage(msg) {
        if (!activeBatch) {
            rejectBatch(msg.batchId, 'received item outside an active batch', { messageType: msg.type });
            return false;
        }
        if (msg.batchId !== activeBatch.id) {
            rejectBatch(msg.batchId, 'received item for the wrong batch', { messageType: msg.type });
            return false;
        }
        return true;
    }
    function tryConnect() {
        if (socket &&
            (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
            return;
        }
        try {
            socket = new WebSocket(`ws://${LOOPBACK_HOST}:${wsPort}`);
        }
        catch {
            setTimeout(tryConnect, 1000);
            return;
        }
        const connectingSocket = socket;
        socket.onopen = async () => {
            handshakeComplete = false;
            expectedSequence = 1;
            sendSequence = 1;
            sessionKeys = null;
            activeBatch = null;
            const extensionNonce = randomBase64Url(32);
            socket._baahExtensionNonce = extensionNonce;
            socket.send(JSON.stringify({
                type: 'auth-hello',
                version: AUTH_PROTOCOL_VERSION,
                keyId: 'default',
                extensionNonce,
                timestamp: Date.now()
            }));
        };
        socket.onmessage = async (event) => {
            if (!handshakeComplete) {
                await handleHandshakeMessage(JSON.parse(event.data));
                return;
            }
            messageQueue = messageQueue.then(async () => {
            const msg = await openPushMessage(event.data);
            if (!msg) return;
            pushDebug('received message', { messageType: msg.type, batchId: msg.batchId || null });
            if (msg.type === 'batch-start') {
                if (activeBatch) {
                    rejectBatch(msg.batchId, 'received batch-start before previous batch ended', { messageType: msg.type });
                    return;
                }
                if (!msg.batchId || typeof msg.batchId !== 'string') {
                    rejectBatch(msg.batchId, 'missing batch ID', { messageType: msg.type });
                    return;
                }
                await createActiveBatchFromMessage(msg);
                return;
            }
            if (msg.type === 'lambda') {
                if (!(await isActiveBatchMessage(msg))) return;
                const { filename, sourcePath, bundle, project = activeBatch.project } = msg;
                activeBatch.counts.lambdas += 1;
                activeBatch.items.push({ type: 'lambda', project: project || 'default', filename, sourcePath, bundle });
            }
            if (msg.type === 'style') {
                if (!(await isActiveBatchMessage(msg))) return;
                const { filename, content, project = activeBatch.project } = msg;
                activeBatch.counts.styles += 1;
                activeBatch.items.push({ type: 'style', project: project || 'default', filename, content });
            }
            if (msg.type === 'trigger') {
                if (!(await isActiveBatchMessage(msg))) return;
                const { name, patterns, commands, project = activeBatch.project } = msg;
                activeBatch.counts.triggers += 1;
                activeBatch.items.push({ type: 'trigger', project: project || 'default', name, patterns, commands });
            }
            if (msg.type === 'batch-end') {
                if (!(await isActiveBatchMessage(msg))) return;
                const completedBatch = activeBatch;
                activeBatch = null;
                const expected = completedBatch.expectedCounts;
                if ((expected.lambdas ?? completedBatch.counts.lambdas) !== completedBatch.counts.lambdas || (expected.styles ?? completedBatch.counts.styles) !== completedBatch.counts.styles || (expected.triggers ?? completedBatch.counts.triggers) !== completedBatch.counts.triggers) {
                    rejectBatch(completedBatch.id, 'batch item counts did not match manifest');
                    return;
                }
                updateQueue = updateQueue.then(async () => {
                    const [{ applyFunctionCodeUpdate }, { applyTriggerDefinitionUpdate }, { newStyle }] = await Promise.all([
                        import('./functionUpdates.js'), import('./triggerUpdates.js'), import('./records.js')
                    ]);
                    const policy = await readBatchPolicy();
                    const stored = await chrome.storage.local.get([LAMBDA_FUNCTIONS_KEY, STYLES_KEY, TRIGGERS_KEY]);
                    const collections = {
                        functions: JSON.parse(stored[LAMBDA_FUNCTIONS_KEY] || '[]'),
                        styles: JSON.parse(stored[STYLES_KEY] || '[]'),
                        triggers: JSON.parse(stored[TRIGGERS_KEY] || '[]')
                    };
                    if (checkBatchPolicy(batchTargets(completedBatch, collections), policy)) {
                        await stageCompletedBatch(completedBatch);
                        return;
                    }
                    applyBatchToCollections(completedBatch, collections, { applyFunctionCodeUpdate, applyTriggerDefinitionUpdate, newStyle });
                    await chrome.storage.local.set({
                        [LAMBDA_FUNCTIONS_KEY]: JSON.stringify(collections.functions),
                        [STYLES_KEY]: JSON.stringify(collections.styles),
                        [TRIGGERS_KEY]: JSON.stringify(collections.triggers)
                    });
                    await sendBatchAck({ type: 'batch-applied', batchId: completedBatch.id, status: 'applied', counts: completedBatch.counts });
                    log.dbg(`Sync batch applied: batchId=${completedBatch.id}, project="${completedBatch.project}".`);
                    socket?.close(1000, 'push applied');
                }).catch(async (error) => {
                    log.err(`Sync batch rejected: ${error.message}`, error);
                    await sendBatchAck({ type: 'batch-rejected', batchId: completedBatch.id, reason: error.message });
                    socket?.close(1000, 'push rejected');
                });
            }
            }).catch((error) => {
                log.err('Failed to process a sync message; the connection will be closed.', error);
                socket?.close();
            });
        };
        socket.onclose = () => {
            if (socket !== connectingSocket) return;
            handshakeComplete = false;
            messageQueue = Promise.resolve();
            sessionKeys = null;
            expectedSequence = 1;
            sendSequence = 1;
            activeBatch = null;
            socket = null;
        };
        socket.onerror = () => {
            socket.close();
        };
    }
    async function stageCompletedBatch(batch) {
        await stageBaahPushBatch({ id: batch.id, project: batch.project, counts: batch.counts, manifest: batch.manifest, items: batch.items });
        window.dispatchEvent(new CustomEvent('baah-pending-batches-updated'));
        log.dbg(`Sync batch staged for review: batchId=${batch.id}, project="${batch.project}".`);
        await sendBatchAck({ type: 'batch-received', batchId: batch.id, status: 'pending-review', counts: batch.counts });
        socket?.close(1000, 'push staged for review');
    }
    function batchTargets(batch, collections) {
        const targets = new Map();
        const add = (project, category) => targets.set(JSON.stringify([project || 'default', category]), { project: project || 'default', category });
        const categories = { lambda: 'functions', style: 'styles', trigger: 'triggers' };
        for (const item of batch.items) add(item.project || batch.project, categories[item.type]);
        const project = batch.project || 'default';
        for (const [category, manifestKey] of [['functions', 'lambdas'], ['styles', 'styles'], ['triggers', 'triggers']]) {
            if (!Array.isArray(batch.manifest?.[manifestKey])) continue;
            const keep = new Set(batch.manifest[manifestKey]);
            if (collections[category].some((item) => (item.project || 'default') === project && !keep.has(item.name))) add(project, category);
        }
        return [...targets.values()];
    }
    async function readBatchPolicy() {
        const { getProjectSettings, getProjectCategorySettings } = await import('./projectPolicy.js');
        const [settings, baahPollChanges, baahRequireReview] = await Promise.all([
            getProjectSettings(), getBaahPollChanges(), getBaahRequireReview()
        ]);
        return { settings, baahPollChanges, baahRequireReview, getProjectCategorySettings };
    }
    function checkBatchPolicy(targets, { settings, baahPollChanges, baahRequireReview, getProjectCategorySettings }) {
        if (!baahPollChanges) throw new Error('Polling is disabled globally.');
        let requireReview = baahRequireReview;
        for (const { project, category } of targets) {
            const policy = getProjectCategorySettings(settings, project, category, { baahPollChanges, baahRequireReview });
            if (policy.lock) throw new Error(`${category} updates are locked for project "${project}".`);
            if (!policy.poll) throw new Error(`Polling is disabled for ${category} in project "${project}".`);
            requireReview ||= policy.review;
        }
        return requireReview;
    }
    function applyBatchToCollections(batch, collections, { applyFunctionCodeUpdate, applyTriggerDefinitionUpdate, newStyle }) {
        for (const item of batch.items) {
            const project = item.project || batch.project || 'default';
            if (item.type === 'lambda') applyFunctionCodeUpdate(collections.functions, { name: item.filename, project, func: item.bundle });
            if (item.type === 'trigger') applyTriggerDefinitionUpdate(collections.triggers, { name: item.name, project, patterns: item.patterns, commands: item.commands });
            if (item.type === 'style') {
                const existing = collections.styles.find((style) => style.name === item.filename && (style.project || 'default') === project);
                if (existing) existing.css = item.content;
                else collections.styles.push(newStyle(item.filename, item.content, project));
            }
        }
        const project = batch.project || 'default';
        for (const [category, manifestKey] of [['functions', 'lambdas'], ['styles', 'styles'], ['triggers', 'triggers']]) {
            if (!Array.isArray(batch.manifest?.[manifestKey])) continue;
            const keep = new Set(batch.manifest[manifestKey]);
            collections[category] = collections[category].filter((item) => (item.project || 'default') !== project || keep.has(item.name));
        }
    }
    async function acquireLock() {
        const now = Date.now();
        const { [WS_LOCK_KEY]: lock } = await chrome.storage.local.get(WS_LOCK_KEY);
        if (!lock || lock.tabId === tabId || now - lock.timestamp > 4000) {
            await chrome.storage.local.set({ [WS_LOCK_KEY]: { tabId, timestamp: now } });
            const { [WS_LOCK_KEY]: newLock } = await chrome.storage.local.get(WS_LOCK_KEY);
            return newLock?.tabId === tabId;
        }
        return false;
    }
    async function checkLock() {
        if (!sharedSecret || sharedSecret === 'not-found') return;
        const poll = await getBaahPollChanges();
        if (!poll) {
            socket?.close(1000, 'polling disabled');
            return;
        }
        if (await acquireLock()) {
            if (!socket) {
                tryConnect();
            }
        }
        else if (socket) {
            socket.close();
            socket = null;
        }
    }
    const onTokenChanged = (changes, area) => {
        if (area !== 'local') return;
        if (changes.local_storage_key_baah_token) {
            sharedSecret = changes.local_storage_key_baah_token.newValue || 'not-found';
            socket?.close();
        }
        const nextPort = changes.local_storage_key_ws_port?.newValue;
        if (typeof nextPort === 'number' && Number.isInteger(nextPort) && nextPort >= 1 && nextPort <= 65535 && nextPort !== wsPort) {
            wsPort = nextPort;
            handshakeComplete = false;
            sessionKeys = null;
            activeBatch = null;
            const oldSocket = socket;
            socket = null;
            oldSocket?.close(1000, 'WebSocket port changed');
            void checkLock();
        }
    };
    chrome.storage.onChanged.addListener(onTokenChanged);
    (async () => {
        tabId = (await chrome.tabs.getCurrent())?.id;
        wsPort = await getWsPort();
        sharedSecret = await getBaahToken();
        await checkLock();
        pollHandle = window.setInterval(checkLock, 1000);
    })();
    return () => {
        chrome.storage.onChanged.removeListener(onTokenChanged);
        clearInterval(pollHandle);
        socket?.close();
        chrome.storage.local.get(WS_LOCK_KEY).then((res) => {
            const lock = res[WS_LOCK_KEY];
            if (lock?.tabId === tabId) {
                chrome.storage.local.remove(WS_LOCK_KEY);
            }
        });
    };
}
