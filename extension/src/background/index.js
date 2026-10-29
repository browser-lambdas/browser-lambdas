import { log } from './activityLog.js';
import { handleRuntimeMessage } from './handleRuntimeMessage.js';
import { handlePortMessage } from './handlePortMessage.js';
import { networkRules, reconcileNetworkPermissions } from './network.js';
const portMapByTabId = new Map();
const requestToPortMap = new Map();
reconcileNetworkPermissions().catch((error) => log.err('Network rule recovery failed.', error));
chrome.storage.onChanged.addListener((changes, area) => {
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
    if (details.frameId === 0) expireNetworkRules(details.tabId, details.url);
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.url) expireNetworkRules(tabId, change.url);
});
chrome.tabs.onRemoved.addListener((tabId) => expireNetworkRules(tabId, null));
chrome.runtime.onMessage.addListener(handleRuntimeMessage);
chrome.runtime.onConnect.addListener((port) => {
    const tabId = port.sender?.tab?.id;
    if (tabId != null) {
        portMapByTabId.set(tabId, port);
        log.dbg(`Content-script port connected: tabId=${tabId}.`);
        chrome.storage.local.get('tabs').then(({ tabs = [] }) => {
            const updated = tabs.map((t) => t.tabId === tabId ? { ...t, portConnected: true, lastSeen: Date.now() } : t);
            if (!updated.find((t) => t.tabId === tabId)) {
                updated.push({ tabId, portConnected: true, lastSeen: Date.now() });
            }
            chrome.storage.local.set({ tabs: updated });
        });
    }
    handlePortMessage(port, tabId, portMapByTabId, requestToPortMap);
});
