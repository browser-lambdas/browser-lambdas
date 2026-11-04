globalThis.chrome ||= {};
const { connectUserScript } = await import('../../src/background/nativeRuntime.js');
import { clearTabInvocations, finishInvocation, markInvocationReady } from '../../src/background/invocations.js';
import { contentPorts } from '../../src/background/contentPorts.js';

const configurations = new Map();
export const tick = () => new Promise(setImmediate);
export function fakePort(sender = {}) {
    const messages = [], listeners = [], disconnectListeners = [];
    return {
        sender, messages, disconnected: false,
        onMessage: { addListener: (fn) => listeners.push(fn) },
        onDisconnect: { addListener: (fn) => disconnectListeners.push(fn) },
        postMessage(message) { if (this.disconnected) throw new Error('Port disconnected'); messages.push(message); },
        async receive(message) { await Promise.all(listeners.map((fn) => fn(message))); },
        disconnect() { if (this.disconnected) return; this.disconnected = true; for (const fn of disconnectListeners) fn(); }
    };
}

export function backgroundBrowser(lambdas = []) {
    clearTabInvocations(1); clearTabInvocations(2); contentPorts.clear();
    const harness = {
        db: { local_storage_key_lambdas: JSON.stringify(lambdas) },
        injections: [], preflights: [], handshakes: [], nativePorts: [], outputs: [],
        urls: new Map([[1, 'https://example.com/page'], [2, 'https://other.test/']]),
        afterInjection: () => {}, onRuntime: null, preflightResult: true
    };
    const sender = (tabId) => ({ id: 'test-extension', tab: { id: tabId }, frameId: 0, documentId: `doc-${tabId}`, url: harness.urls.get(tabId) });
    for (const tabId of [1, 2]) contentPorts.set(tabId, {
        sender: sender(tabId), postMessage(message) {
            if (message.type !== 'BACKGROUND_INIT_HANDSHAKE') { harness.outputs.push(message); return; }
            harness.handshakes.push([tabId, message]);
            markInvocationReady(message.invocationToken, tabId, message.documentId);
            if (harness.onRuntime) harness.onRuntime({ tabId, context: message });
            else finishInvocation(message.invocationToken, tabId, message.requestId);
        }
    });
    const inject = async (args) => {
        const documentId = args.target.documentIds[0];
        const code = args.js?.[0]?.code;
        if (code?.includes('world-preflight')) {
            harness.preflights.push(args);
            return [{ documentId, result: harness.preflightResult }];
        }
        harness.injections.push(args);
        harness.afterInjection(args);
        if (args.world === 'USER_SCRIPT') {
            const grant = JSON.parse(code.match(/const connectionGrant\s*=\s*("[^"]+"|null)/)[1]);
            const port = fakePort(sender(args.target.tabId));
            harness.nativePorts.push(port);
            connectUserScript(port);
            await port.receive({ type: 'BIND_INVOCATION', grant });
            if (!port.disconnected) {
                await port.receive({ type: 'LAMBDA_READY' });
                if (harness.onRuntime) await harness.onRuntime({ tabId: args.target.tabId, port, grant });
                else await port.receive({ type: 'LAMBDA_RESULT', result: {} });
            }
        }
        return [{ documentId }];
    };
    globalThis.chrome = {
        runtime: { id: 'test-extension' },
        storage: { local: {
            get: async (key) => typeof key === 'string' ? { [key]: harness.db[key] } : { ...harness.db },
            set: async (value) => Object.assign(harness.db, value)
        } },
        tabs: { get: async (id) => ({ id, url: harness.urls.get(id) }), sendMessage: async () => { throw new Error('Credentials must use a private Port'); } },
        webNavigation: { getFrame: async ({ tabId }) => ({ documentId: `doc-${tabId}`, url: harness.urls.get(tabId) }) },
        scripting: { executeScript: inject },
        userScripts: {
            execute: inject,
            configureWorld: async (configuration) => configurations.set(configuration.worldId, { ...configuration }),
            resetWorldConfiguration: async (worldId) => configurations.delete(worldId),
            getWorldConfigurations: async () => [...configurations.values()]
        }
    };
    return harness;
}
