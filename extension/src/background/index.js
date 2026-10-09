import { log } from './activityLog.js';
import { handleRuntimeMessage } from './handleRuntimeMessage.js';
import { handlePortMessage } from './handlePortMessage.js';
const portMapByTabId = new Map();
const requestToPortMap = new Map();
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
