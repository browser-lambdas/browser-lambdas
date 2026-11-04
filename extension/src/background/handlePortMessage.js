import { log, appendActivityLog } from './activityLog.js';
import { verifiedInvocation, finishInvocation, clearTabInvocations, markInvocationReady } from './invocations.js';
import { handleInvocationRequest } from './runtimeRequests.js';

export function handlePortMessage(port, tabId, portMapByTabId) {
    port.onMessage.addListener(async (message) => {
        if (!message || typeof message !== 'object') return;
        try {
            if (message.type === 'HEARTBEAT') {
                const { tabs = [] } = await chrome.storage.local.get('tabs');
                await chrome.storage.local.set({ tabs: tabs.map((tab) => tab.tabId === tabId ? { ...tab, lastSeen: Date.now() } : tab) });
                return;
            }
            if (message.type === 'LAMBDA_READY') {
                markInvocationReady(message.invocationToken, tabId, port.sender.documentId);
                return;
            }
            const invocation = await verifiedInvocation(message.invocationToken, tabId);
            if (!invocation || (invocation.documentId && invocation.documentId !== port.sender.documentId)) {
                throw new Error('The calling function could not be verified or its access was revoked.');
            }
            if (message.type === 'LAMBDA_RESULT') {
                const finished = finishInvocation(message.invocationToken, tabId, invocation.requestId, message.result || {});
                if (finished && invocation.callers.length === 1) {
                    await appendActivityLog('debug', [`Top-level function result completed: requestId=${invocation.requestId}.`], {
                        tabId, uri: port.sender.url || ''
                    });
                }
                return;
            }
            const request = message.type === 'EXECUTE_LAMBDA'
                ? { ...message, type: 'FUNCTION_CALL_REQUEST', id: message.requestId }
                : message;
            const response = await handleInvocationRequest(request, message.invocationToken, tabId);
            if (response) port.postMessage(response);
        } catch (error) {
            log.err('Runtime request failed.', error?.message || String(error));
            const type = message.type === 'EXECUTE_LAMBDA' ? 'FUNCTION_CALL_RESPONSE' : String(message.type).replace(/_REQUEST$/, '_RESPONSE');
            try { port.postMessage({ type, id: message.id || message.requestId, error: error?.message || String(error) }); } catch {}
        }
    });
    port.onDisconnect.addListener(() => {
        if (portMapByTabId.get(tabId) !== port) return;
        clearTabInvocations(tabId);
        portMapByTabId.delete(tabId);
        log.dbg(`Content-script port disconnected: tabId=${tabId}.`);
    });
}
