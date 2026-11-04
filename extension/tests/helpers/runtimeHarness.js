import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { lambdafy } from '../../src/background/lambdafy.js';

export const flush = () => new Promise((resolve) => setImmediate(resolve));
export const deferred = () => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
};
export const event = () => {
    const listeners = new Set();
    return {
        addListener: (listener) => listeners.add(listener),
        removeListener: (listener) => listeners.delete(listener),
        emit: (...args) => Promise.all([...listeners].map((listener) => listener(...args)))
    };
};
export function clock() {
    let now = 0, id = 0;
    const timers = new Map(), intervals = new Map();
    return {
        timers, intervals,
        setTimeout(callback, delay) { timers.set(++id, { at: now + delay, callback }); return id; },
        clearTimeout: (id) => timers.delete(id),
        setInterval(callback, delay) { intervals.set(++id, { delay, callback }); return id; },
        clearInterval: (id) => intervals.delete(id),
        async advance(duration) {
            const target = now + duration;
            while (true) {
                const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
                if (!next) break;
                const [key, timer] = next;
                now = timer.at;
                timers.delete(key);
                timer.callback();
                await flush();
            }
            now = target;
            await flush();
        }
    };
}

const secureSource = readFileSync(new URL('../../src/shared/secureChannel.js', import.meta.url), 'utf8');
export const credentials = (requestId = 'invocation') => ({
    qToken: `question-${requestId}`, aToken: `answer-${requestId}`, handshakeId: `handshake-${requestId}`,
    sessionKey: Buffer.alloc(32, 7).toString('base64'), requestId, nestedDepth: 0
});

export function compileRuntime(code, context) {
    // The compiler's background logger needs storage even when its output runs in a VM.
    globalThis.chrome ||= { storage: { local: { get: async () => ({}), set: async () => {} } } };
    return lambdafy(code, 'test', context);
}

export async function runtime(code, { transport = 'native', respond, globals = {}, autoBind = true, beforeSend } = {}) {
    const time = clock(), finished = deferred(), captured = deferred();
    const messages = [], windowMessages = [], listeners = new Set(), waiters = [];
    const onMessage = event(), onDisconnect = event();
    let channelOptions, closed = false;
    const record = (message) => {
        const copy = structuredClone(message);
        messages.push(copy);
        if (copy.type === 'LAMBDA_RESULT') finished.resolve(copy.result);
        for (const waiter of waiters) if (messages.filter((entry) => entry.type === waiter.type).length >= waiter.count) waiter.resolve(copy);
        if (message.type === 'BIND_INVOCATION' && autoBind) queueMicrotask(() => onMessage.emit({ type: 'INVOCATION_BOUND' }));
        if (respond) queueMicrotask(async () => {
            const response = await respond(copy);
            if (response && !closed) receive({ id: message.id, ...response });
        });
    };
    const port = {
        onMessage, onDisconnect,
        postMessage(message) { if (closed) throw new Error('Port is closed'); beforeSend?.(message); record(message); },
        disconnect() { if (!closed) { closed = true; onDisconnect.emit(); } }
    };
    const receive = (message) => transport === 'native' ? onMessage.emit(structuredClone(message)) : channelOptions.onMessage(structuredClone(message));
    const window = {
        addEventListener(_type, listener) { listeners.add(listener); },
        removeEventListener(_type, listener) { listeners.delete(listener); },
        postMessage(data) { windowMessages.push(structuredClone(data)); }
    };
    const sandbox = createContext({
        window, crypto, TextEncoder, TextDecoder, atob, btoa,
        ...time, ...globals,
        captureRuntime: (value) => captured.resolve(structuredClone(value)),
        chrome: { runtime: { connect: () => port } },
        stubSecureChannel(options) {
            channelOptions = options;
            return { ready: Promise.resolve(), send: async (message) => { beforeSend?.(message); record(message); }, close() { closed = true; } };
        }
    });
    const context = { ...credentials(), ...(transport === 'native' ? { connectionGrant: 'one-use-grant' } : {}) };
    const source = compileRuntime(code, context).replace(secureSource, 'const createSecureChannel = globalThis.stubSecureChannel;');
    await runInContext(source, sandbox);
    if (transport === 'main') {
        for (const listener of [...listeners]) listener({ source: window, data: { type: 'CONTENT_SCRIPT_HANDSHAKE', handshakeId: context.handshakeId }, ports: [{ close() { closed = true; } }] });
    }
    await flush();
    return {
        messages, windowMessages, time, sandbox, receive,
        completed: finished.promise, captured: captured.promise,
        waitFor(type, count = 1) {
            if (messages.filter((entry) => entry.type === type).length >= count) return Promise.resolve(messages.find((entry) => entry.type === type));
            return new Promise((resolve) => waiters.push({ type, count, resolve }));
        },
        async disconnect(error = 'Transport disconnected') {
            if (transport === 'native') { await receive({ type: 'RUNTIME_CLOSED', error }); port.disconnect(); }
            else channelOptions.onError(new Error(error));
            await flush();
        },
        async dispose() {
            if (transport === 'native') port.disconnect();
            else channelOptions?.onError(new Error('Test cleanup'));
            await flush();
        }
    };
}
