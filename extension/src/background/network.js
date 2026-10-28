import { createNetworkRules } from './networkRules.js';
import { verifiedInvocation } from './invocations.js';
import { authorizeNetworkInvocation, loadNetworkAccessPolicy } from './networkAccess.js';

export const networkRules = createNetworkRules(chrome);

export async function reconcileNetworkPermissions() {
    let authorize;
    try { authorize = await loadNetworkAccessPolicy(); }
    catch (error) {
        await networkRules.prune(() => false);
        throw error;
    }
    return networkRules.prune((record) => {
        try { authorize(record.callers); return true; }
        catch { return false; }
    });
}

export async function handleNetworkRequest(message, sourceTabId) {
    try {
        const invocation = await verifiedInvocation(message.invocationToken, sourceTabId);
        if (!invocation) throw new Error('Network access denied: the calling function could not be verified or its access was revoked.');
        await authorizeNetworkInvocation(invocation);
        const tabId = message.tabId ?? sourceTabId;
        if (!Number.isInteger(tabId) || tabId < 0) throw new Error('A valid target tab is required.');
        let value;
        switch (message.operation) {
            case 'add': value = await networkRules.add(tabId, message.rule, {
                callers: invocation.callers, authorize: () => authorizeNetworkInvocation(invocation)
            }); break;
            case 'list': value = await networkRules.list(tabId); break;
            case 'remove':
                if (typeof message.ruleId !== 'string') throw new Error('A network rule handle is required.');
                value = await networkRules.remove(tabId, message.ruleId);
                break;
            case 'clear': value = await networkRules.clear(tabId); break;
            default: throw new Error('Unsupported network operation.');
        }
        return { type: 'NETWORK_RESPONSE', id: message.id, value };
    } catch (error) {
        return { type: 'NETWORK_RESPONSE', id: message.id, error: error?.message || String(error) };
    }
}
