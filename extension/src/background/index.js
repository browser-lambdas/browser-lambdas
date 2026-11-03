import { log } from './activityLog.js';
import { handleRuntimeMessage } from './handleRuntimeMessage.js';
import { handlePortMessage } from './handlePortMessage.js';
import { networkRules, reconcileNetworkPermissions } from './network.js';
import { contentPorts as portMapByTabId } from './contentPorts.js';
import { connectUserScript } from './nativeRuntime.js';
import { recoverUserWorlds } from './userWorlds.js';
import { clearDocumentInvocations, clearTabInvocations, revokeInvalidInvocations } from './invocations.js';
recoverUserWorlds().catch((error) => log.err('User-script world recovery failed.', error));
reconcileNetworkPermissions().catch((error) => log.err('Network rule recovery failed.', error));
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ['local_storage_key_allow_main_world_functions', 'local_storage_key_lambdas', 'local_storage_key_project_settings'].some((key) => changes[key])) {
        revokeInvalidInvocations().catch((error) => log.err('Function permission cleanup failed.', error));
    }
    if (area === 'local' && ['local_storage_key_allow_network', 'local_storage_key_lambdas', 'local_storage_key_project_settings'].some((key) => changes[key])) {
        reconcileNetworkPermissions().catch((error) => log.err('Network permission cleanup failed.', error));
    }
});
const expireNetworkRules = (tabId, url) => {
    networkRules.navigation(tabId, url).catch((error) => log.err('Network rule cleanup failed.', error));
};
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId === 0) expireNetworkRules(details.tabId, details.url);
});
chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId === 0) {
        clearDocumentInvocations(details.tabId, details.documentId);
        expireNetworkRules(details.tabId, details.url);
    }
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.url) expireNetworkRules(tabId, change.url);
});
chrome.tabs.onRemoved.addListener((tabId) => {
    clearTabInvocations(tabId);
    expireNetworkRules(tabId, null);
});
chrome.runtime.onMessage.addListener(handleRuntimeMessage);
chrome.runtime.onUserScriptConnect.addListener(connectUserScript);
chrome.runtime.onConnect.addListener((port) => {
    const tabId = port.sender?.tab?.id;
    if (tabId != null && port.sender.id === chrome.runtime.id && port.sender.frameId === 0
        && port.sender.documentId && port.name === 'content-script'
        && !port.sender.url?.startsWith(chrome.runtime.getURL(''))) {
        portMapByTabId.set(tabId, port);
        log.dbg(`Content-script port connected: tabId=${tabId}.`);
        chrome.storage.local.get('tabs').then(({ tabs = [] }) => {
            const updated = tabs.map((t) => t.tabId === tabId ? { ...t, portConnected: true, lastSeen: Date.now() } : t);
            if (!updated.find((t) => t.tabId === tabId)) {
                updated.push({ tabId, portConnected: true, lastSeen: Date.now() });
            }
            chrome.storage.local.set({ tabs: updated });
        });
        handlePortMessage(port, tabId, portMapByTabId);
    } else port.disconnect();
});
