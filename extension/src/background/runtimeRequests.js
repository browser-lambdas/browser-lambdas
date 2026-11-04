import { appendActivityLog } from './activityLog.js';
import { verifiedInvocation, invocationActive } from './invocations.js';
import { handleItemAccess } from './itemAccess.js';
import { handleNetworkRequest } from './network.js';
import { handleMainRequest } from './mainOperations.js';
import { executeLambda } from './executeLambda.js';
import { postToContent } from './contentPorts.js';

async function waitUntilTabReady(tabId) {
    const start = Date.now();
    while (Date.now() - start < 5000) {
        const { tabs = [] } = await chrome.storage.local.get('tabs');
        if (tabs.some((tab) => tab.tabId === tabId && tab.portConnected)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('The new page did not connect. Check its URL and reload it.');
}

const responseType = (type) => type.replace(/_REQUEST$/, '_RESPONSE');

export async function handleInvocationRequest(message, token, tabId) {
    const response = { type: responseType(message.type), id: message.id };
    try {
        const invocation = await verifiedInvocation(token, tabId);
        if (!invocation) throw new Error('The calling function could not be verified or its access was revoked. Run the function again.');
        const msg = { ...message, invocationToken: token, executionWorld: invocation.executionWorld };
        let value;
        switch (msg.type) {
            case 'HEARTBEAT': return null;
            case 'SHELL_OUTPUT':
                if (!['log', 'warn', 'error', 'info', 'debug'].includes(msg.level) || !Array.isArray(msg.values)) throw new Error('Invalid terminal output.');
                try { postToContent(tabId, invocation.documentId, { type: 'SHELL_OUTPUT', level: msg.level, values: msg.values.map(String) }); }
                catch { /* A lambda may run without an open terminal or page UI. */ }
                return null;
            case 'ACTIVITY_LOG':
                await appendActivityLog(['debug', 'error', 'info'].includes(msg.level) ? msg.level : 'info', [String(msg.message)], { tabId, uri: (await chrome.tabs.get(tabId)).url || '' });
                return null;
            case 'GET_SECRET_REQUEST':
            case 'GET_STORAGE_REQUEST':
            case 'SET_STORAGE_REQUEST': {
                const result = await handleItemAccess(msg, tabId);
                if (!(await verifiedInvocation(token, tabId))) throw new Error('Function access was revoked before the response was delivered.');
                return result;
            }
            case 'NETWORK_REQUEST': return handleNetworkRequest(msg, tabId);
            case 'MAIN_REQUEST': return handleMainRequest(msg, invocation, token);
            case 'FUNCTION_CALL_REQUEST': {
                if (typeof msg.userInput !== 'string' || (msg.tabId != null && !Number.isInteger(msg.tabId))) throw new Error('Invalid nested function request.');
                const execution = await executeLambda(msg.tabId ?? tabId, msg.userInput, crypto.randomUUID(), invocation.callers.length, null, invocation.callers);
                if (execution.started === false) throw new Error(execution.error);
                const result = await execution.completion;
                if (result.error) throw new Error(result.error);
                value = result.return;
                break;
            }
            case 'TAB_OPERATION_REQUEST': {
                const options = msg.options || {};
                switch (msg.operation) {
                    case 'CLOSE_CURRENT_TAB':
                        await chrome.tabs.remove(tabId);
                        value = true;
                        break;
                    case 'NEW_TAB': {
                        if (options.url != null && typeof options.url !== 'string') throw new Error('Invalid tab URL.');
                        const tab = await chrome.tabs.create({ url: options.url ?? 'about:blank', active: options.active === true });
                        if ((options.url ?? 'about:blank') !== 'about:blank') await waitUntilTabReady(tab.id);
                        const current = await chrome.tabs.get(tab.id).catch(() => tab);
                        value = { id: tab.id, url: current.url || current.pendingUrl || options.url || 'about:blank', title: current.title || '' };
                        break;
                    }
                    case 'FOCUS_TAB':
                    case 'CLOSE_TAB':
                        if (!Number.isInteger(options.tabId) || options.tabId < 0) throw new Error('Invalid tab ID.');
                        if (msg.operation === 'FOCUS_TAB') await chrome.tabs.update(options.tabId, { active: true });
                        else await chrome.tabs.remove(options.tabId);
                        value = true;
                        break;
                    case 'GET_ALL_TABS':
                        value = (await chrome.tabs.query({})).map(({ id, url, title }) => ({ id, url, title }));
                        break;
                    default: throw new Error('Unsupported tab operation.');
                }
                break;
            }
            default: throw new Error('Unsupported runtime operation.');
        }
        if (!invocationActive(token, invocation) || !(await verifiedInvocation(token, tabId))) throw new Error('The function connection ended or access was revoked.');
        return { ...response, value };
    } catch (error) {
        return { ...response, error: error?.message || String(error) };
    }
}
