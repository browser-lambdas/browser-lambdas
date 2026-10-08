import { appendActivityLog, log } from './activityLog.js';
import { handleItemAccess } from './itemAccess.js';
import { executeLambda } from './executeLambda.js';
async function waitUntilTabReady(tabId, timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const { tabs = [] } = await chrome.storage.local.get('tabs');
        const tab = tabs.find((t) => t.tabId === tabId && t.portConnected);
        if (tab)
            return;
        await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Timeout waiting for content script to connect in tab ${tabId}`);
}
export function handlePortMessage(port, tabId, portMapByTabId, requestToPortMap) {
    port.onMessage.addListener(async (msg) => {
        if (msg.type === 'HEARTBEAT') {
            if (tabId != null) {
                chrome.storage.local.get('tabs').then(({ tabs = [] }) => {
                    const updated = tabs.map((t) => t.tabId === tabId ? { ...t, lastSeen: Date.now() } : t);
                    chrome.storage.local.set({ tabs: updated });
                });
            }
            return;
        }
        log.dbg(`Port message received: type=${msg.type || 'unknown'}, tabId=${tabId ?? 'none'}, requestId=${msg.id || msg.requestId || 'none'}.`);
        switch (msg.type) {
            case 'GET_SECRET_REQUEST':
            case 'GET_STORAGE_REQUEST':
            case 'SET_STORAGE_REQUEST': {
                port.postMessage(await handleItemAccess(msg, tabId));
                break;
            }
            case 'EXECUTE_LAMBDA': {
                const { tabId, userInput, requestId, depth = 0 } = msg;
                if (tabId != null) {
                    portMapByTabId.set(tabId, port);
                    requestToPortMap.set(requestId, { port, type: 'FUNCTION_CALL_REQUEST' });
                }
                let result;
                try {
                    result = await executeLambda(tabId, userInput, requestId, depth);
                }
                catch (error) {
                    result = { started: false, error: error?.message || String(error) };
                }
                if (result?.started === false) {
                    const entry = requestToPortMap.get(requestId);
                    if (entry) {
                        entry.port.postMessage({
                            type: 'FUNCTION_CALL_RESPONSE',
                            id: requestId,
                            value: undefined,
                            error: result.error
                        });
                        requestToPortMap.delete(requestId);
                    }
                }
                break;
            }
            case 'LAMBDA_RESULT': {
                const { id, result } = msg;
                const entry = requestToPortMap.get(id);
                if (entry) {
                    const { port, type } = entry;
                    const responseType = type === 'TAB_OPERATION_REQUEST' ? 'TAB_OPERATION_RESPONSE' : 'FUNCTION_CALL_RESPONSE';
                    port.postMessage({
                        type: responseType,
                        id,
                        value: result.return,
                        error: result.error
                    });
                    requestToPortMap.delete(id);
                }
                else {
                    await appendActivityLog('debug', [`Top-level function result completed: requestId=${id}.`], {
                        tabId,
                        uri: tabId == null ? '' : (await chrome.tabs.get(tabId).catch(() => null))?.url || ''
                    });
                }
                break;
            }
            case 'TAB_OPERATION_REQUEST': {
                const { id, operation, options } = msg;
                if (id && tabId != null) {
                    portMapByTabId.set(tabId, port);
                    requestToPortMap.set(id, { port, type: 'TAB_OPERATION_REQUEST' });
                }
                switch (operation) {
                    case 'NEW_TAB': {
                        const tab = await chrome.tabs.create({
                            url: options.url ?? 'about:blank',
                            active: options.active ?? false
                        });
                        const newTabId = tab.id;
                        log.dbg(`Tab created for function request: tabId=${newTabId}, url="${options.url ?? 'about:blank'}", active=${options.active ?? false}.`);
                        const { tabs = [] } = await chrome.storage.local.get('tabs');
                        tabs.push({
                            tabId: newTabId,
                            portConnected: false,
                            lastSeen: Date.now()
                        });
                        await chrome.storage.local.set({ tabs });
                        // about:blank does not receive the extension content script, so
                        // waiting for a port connection there leaves ctx.tabs.new()
                        // unresolved even though the tab was created successfully.
                        if ((options.url ?? 'about:blank') !== 'about:blank')
                            await waitUntilTabReady(newTabId, 5000);
                        const createdTab = await chrome.tabs.get(newTabId).catch(() => tab);
                        port.postMessage({
                            type: 'TAB_OPERATION_RESPONSE',
                            id,
                            value: {
                                id: newTabId,
                                // Chrome may report an empty URL before navigation commits.
                                url: createdTab.url || createdTab.pendingUrl || options.url || 'about:blank',
                                title: createdTab.title ?? ''
                            }
                        });
                        break;
                    }
                    case 'FOCUS_TAB': {
                        await chrome.tabs.update(options.tabId, { active: true });
                        port.postMessage({ type: 'TAB_OPERATION_RESPONSE', id, value: true });
                        break;
                    }
                    case 'CLOSE_TAB': {
                        await chrome.tabs.remove(options.tabId);
                        port.postMessage({ type: 'TAB_OPERATION_RESPONSE', id, value: true });
                        break;
                    }
                    case 'GET_ALL_TABS': {
                        const tabs = await chrome.tabs.query({});
                        const simpleTabs = tabs.map((t) => ({
                            id: t.id,
                            url: t.url,
                            title: t.title
                        }));
                        port.postMessage({ type: 'TAB_OPERATION_RESPONSE', id, value: simpleTabs });
                        break;
                    }
                    default: {
                        log.err(`Tab operation rejected: unsupported operation="${operation}" (requestId=${id}).`);
                        port.postMessage({ type: 'TAB_OPERATION_RESPONSE', id, value: false });
                    }
                }
                break;
            }
        }
    });
    port.onDisconnect.addListener(() => {
        if (tabId != null) {
            portMapByTabId.delete(tabId);
            log.dbg(`Content-script port disconnected: tabId=${tabId}.`);
        }
    });
}
