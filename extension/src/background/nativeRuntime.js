import { consumeConnectionGrant, verifiedInvocation, invocationActive, watchInvocation, finishInvocation, markInvocationReady } from './invocations.js';
import { handleInvocationRequest } from './runtimeRequests.js';
import { postToContent } from './contentPorts.js';
import { appendActivityLog } from './activityLog.js';

export function connectUserScript(port) {
    let binding = null;
    let closed = false;
    let bindingStarted = false;
    let bound = false;
    let runtimeFinished = false;
    let notifications = Promise.resolve();
    const requests = new Set();
    const send = (message) => {
        if (!closed) port.postMessage(message);
    };
    const close = (error) => {
        if (closed) return;
        try { send({ type: 'RUNTIME_CLOSED', error: error || 'The function connection closed.' }); } catch {}
        closed = true;
        clearTimeout(deadline);
        try { port.disconnect(); } catch {}
        if (binding && !runtimeFinished) {
            try { postToContent(binding.invocation.tabId, binding.invocation.documentId, { type: 'SHELL_OUTPUT', level: 'warn', values: [error || 'The function connection closed. Reload the page and try again.'] }); } catch {}
            appendActivityLog('error', [error || 'The function connection closed.'], { tabId: binding.invocation.tabId, uri: port.sender.url }).catch(() => {});
        }
        if (binding) finishInvocation(binding.token, binding.invocation.tabId, binding.invocation.requestId, { error: error || 'The function connection closed.' });
    };
    const deadline = setTimeout(() => close('The function connection timed out.'), 5000);
    port.onDisconnect.addListener(() => close('The background connection closed. Run the function again.'));
    port.onMessage.addListener(async (message) => {
        try {
            if (closed || !message || typeof message !== 'object') return close('Invalid runtime message.');
            if (!bound) {
                if (bindingStarted || message.type !== 'BIND_INVOCATION' || typeof message.grant !== 'string'
                    || port.sender?.id !== chrome.runtime.id || port.sender?.frameId !== 0) return close('Invalid connection grant.');
                bindingStarted = true;
                binding = consumeConnectionGrant(message.grant, port.sender);
                if (!binding || !(await verifiedInvocation(binding.token, binding.invocation.tabId))) return close('Invalid or expired connection grant.');
                if (closed || !invocationActive(binding.token, binding.invocation)) return close('The function invocation ended.');
                watchInvocation(binding.token, (result) => {
                    if (result.error) close(result.error);
                    else {
                        closed = true;
                        clearTimeout(deadline);
                        try { port.disconnect(); } catch {}
                    }
                });
                clearTimeout(deadline);
                bound = true;
                notifications = appendActivityLog('debug', [`Native function channel established: requestId=${binding.invocation.requestId}.`], { tabId: binding.invocation.tabId, uri: port.sender.url }).catch(() => {});
                send({ type: 'INVOCATION_BOUND' });
                return;
            }
            const { token, invocation } = binding;
            if (!invocationActive(token, invocation)) return close('The function invocation ended.');
            if (message.type === 'LAMBDA_READY') {
                markInvocationReady(token);
                return;
            }
            if (message.type === 'LAMBDA_RESULT') {
                // A final result must not overtake console output still being forwarded.
                await notifications;
                if (!(await verifiedInvocation(token, invocation.tabId))) return close('Function access was revoked.');
                runtimeFinished = true;
                finishInvocation(token, invocation.tabId, invocation.requestId, message.result && typeof message.result === 'object' ? message.result : {});
                if (invocation.callers.length === 1) appendActivityLog('debug', [`Top-level function result completed: requestId=${invocation.requestId}.`], { tabId: invocation.tabId, uri: port.sender.url }).catch(() => {});
                return;
            }
            if (!['HEARTBEAT', 'SHELL_OUTPUT', 'ACTIVITY_LOG', 'GET_SECRET_REQUEST', 'GET_STORAGE_REQUEST', 'SET_STORAGE_REQUEST', 'NETWORK_REQUEST', 'FUNCTION_CALL_REQUEST', 'TAB_OPERATION_REQUEST', 'MAIN_REQUEST'].includes(message.type)) return close('Unsupported runtime operation.');
            if (['SHELL_OUTPUT', 'ACTIVITY_LOG'].includes(message.type)) {
                notifications = notifications.then(() => handleInvocationRequest(message, token, invocation.tabId)).then((response) => {
                    if (response?.error) close(response.error);
                }).catch((error) => close(error?.message || 'Runtime output failed.'));
                return;
            }
            const expectsReply = message.type.endsWith('_REQUEST');
            if (expectsReply && (typeof message.id !== 'string' || !message.id || requests.has(message.id))) return close('Invalid or duplicate runtime request.');
            if (expectsReply) requests.add(message.id);
            const response = await handleInvocationRequest(message, token, invocation.tabId);
            if (response && !closed) send(response);
            requests.delete(message.id);
            if (message.type === 'HEARTBEAT' && response?.error) close(response.error);
        } catch (error) { close(error?.message || 'The function connection failed.'); }
    });
}
