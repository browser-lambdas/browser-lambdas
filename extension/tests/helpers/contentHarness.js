import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { event, clock, flush } from './runtimeHarness.js';

export function content({ respond } = {}) {
    const time = clock(), background = event(), tab = event(), disconnected = event();
    const listeners = new Set(), forwarded = [], announcements = [], channels = new Map(), outputs = [];
    const port = {
        onMessage: background, onDisconnect: disconnected,
        postMessage(message) {
            forwarded.push(structuredClone(message));
            if (respond) queueMicrotask(async () => {
                const result = await respond(message);
                if (result) await background.emit({ id: message.id, ...result });
            });
        }
    };
    const window = {
        addEventListener(_type, listener) { listeners.add(listener); },
        postMessage(data, target, ports) { announcements.push({ data: structuredClone(data), target, ports }); }
    };
    const context = createContext({
        ...time, window, crypto,
        log: { dbg() {}, err() {}, info() {} },
        appendShellOutput: (level, values) => outputs.push({ level, values }),
        chrome: { runtime: { connect: () => port, onMessage: tab, sendMessage(_message, callback) { callback({ tabId: 1 }); } } },
        MessageChannel: class { constructor() { this.port1 = {}; this.port2 = {}; } },
        createSecureChannel(options) {
            const channel = { options, messages: [], closed: false,
                ready: Promise.resolve(), send: async (message) => { channel.messages.push(structuredClone(message)); },
                close() { channel.closed = true; }
            };
            channels.set(options.sessionId, channel);
            return channel;
        }
    });
    runInContext(readFileSync(new URL('../../src/content/messages.js', import.meta.url), 'utf8'), context);
    return {
        time, forwarded, announcements, channels, outputs,
        fromBackground: (message) => background.emit(message),
        fromTab: (message) => tab.emit(message, {}, () => {}),
        fromWindow: async (data, source = window) => { await Promise.all([...listeners].map((listener) => listener({ data, source }))); await flush(); },
        deliver: (requestId, message) => channels.get(requestId).options.onMessage(message),
        disconnect: async () => { await disconnected.emit(); await flush(); },
        state: () => runInContext('({ channels: channelToPort.size, handshakes: runtimeHandshakes.size, requests: requestToChannel.size, pending: runtimeBackgroundRequests.size })', context)
    };
}
