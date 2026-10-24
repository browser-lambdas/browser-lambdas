import { isWorkspaceSender, mutateWorkspaceStorage } from './storageRepository.js';
import { saveProjectSettings } from '../shared/projectPolicy.js';
import { SCRIPT_STATUS_CACHE_KEY } from './constants.js';
import { executeLambda } from './executeLambda.js';
import { runTriggers } from './runTriggers.js';
import { handleUiSession } from './uiSessions.js';
import { appendActivityLog, log } from './activityLog.js';
// Track which documents already executed triggers to avoid duplicates per page load
const triggeredDocs = new Set();
const SCRIPT_STATUS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const getScriptStatusCache = async () => {
    const raw = (await chrome.storage.local.get(SCRIPT_STATUS_CACHE_KEY))[SCRIPT_STATUS_CACHE_KEY];
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                return parsed;
            }
        }
        catch (error) {
            log.err('Failed to parse script status cache.', error);
        }
    }
    return {};
};
const setScriptStatusCache = async (cache) => {
    await chrome.storage.local.set({
        [SCRIPT_STATUS_CACHE_KEY]: JSON.stringify(cache)
    });
};
export function handleRuntimeMessage(message, sender, sendResponse) {
    const uiSession = handleUiSession(message, sender, sendResponse);
    if (uiSession !== undefined) return uiSession;
    if (message?.type === 'WORKSPACE_PROJECT_SETTINGS_UPDATE') {
        if (!isWorkspaceSender(sender)) {
            sendResponse({ success: false, error: 'Project settings can only be changed in the workspace.' });
            return false;
        }
        saveProjectSettings(message).then(sendResponse).catch(() => sendResponse({ success: false, error: 'Project settings could not be saved. Check the URL patterns; existing settings were preserved.' }));
        return true;
    }
    if (message?.type === 'WORKSPACE_STORAGE_MUTATION') {
        if (!isWorkspaceSender(sender)) {
            sendResponse({ success: false, error: 'Storage administration is only available in the workspace.' });
            return false;
        }
        mutateWorkspaceStorage(message).then(sendResponse).catch(() => sendResponse({
            success: false, error: 'Storage could not be saved. Check the item and page patterns; existing data was preserved.'
        }));
        return true;
    }

    if ('type' in message && message.type === 'ACTIVITY_LOG') {
        appendActivityLog(
            ['debug', 'error', 'info'].includes(message.level) ? message.level : 'info',
            [message.message],
            { tabId: sender.tab?.id, uri: sender.tab?.url || sender.url || '' }
        ).then(() => sendResponse({ success: true }));
        return true;
    }
    const messageKind = message.action || message.type || 'unknown';
    log.dbg(`Runtime message received: kind=${messageKind}, tabId=${sender.tab?.id ?? 'none'}.`);
    if ('action' in message && message.action === 'OPEN_POPUP_MENU') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tabId = message.tabId ?? tabs[0]?.id;
            if (!tabId) {
                sendResponse({ success: false, error: 'No active tab found.' });
                return;
            }
            chrome.tabs.sendMessage(tabId, { action: 'OPEN_POPUP_MENU' }, (response) => {
                if (chrome.runtime.lastError) {
                    sendResponse({ success: false, error: chrome.runtime.lastError.message });
                    return;
                }
                sendResponse(response || { success: false, error: 'The menu did not respond.' });
            });
        });
        return true;
    }
    if ('action' in message && message.action === 'OPEN_EXTENSION_PAGE') {
        chrome.tabs
            .create({ url: chrome.runtime.getURL(message.path) })
            .then(() => sendResponse({ success: true }))
            .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;
    }
    if ('action' in message && message.action === 'OPEN_SHELL') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'OPEN_SHELL' });
            }
        });
        return true;
    }
    if ('action' in message && message.action === 'EXECUTE_LAMBDA') {
        const { userInput, requestId } = message;
        executeLambda(sender.tab.id, userInput, requestId)
            .then((result) => sendResponse({
                success: result?.started !== false,
                error: result?.error
            }))
            .catch((err) => sendResponse({ success: false, error: err.message }));
        return true;
    }
    if ('type' in message && message.type === 'GET_TAB_ID') {
        sendResponse({ tabId: sender.tab?.id });
        const docId = sender.documentId;
        if (docId && sender.tab?.id && sender.tab.url && !triggeredDocs.has(docId)) {
            triggeredDocs.add(docId);
            setTimeout(() => {
                runTriggers(sender.tab.id, sender.tab.url).catch((err) => log.err(`Automatic trigger evaluation failed: tabId=${sender.tab.id}, url="${sender.tab.url}".`, err));
            }, 500);
        }
        return false;
    }
    if ('action' in message && message.action === 'TEST_SCRIPT_INJECTION') {
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            const tabId = message.tabId ?? tabs[0]?.id;
            if (!tabId) {
                sendResponse({ success: false, error: 'No active tab found.' });
                return;
            }
            const scriptStatusCache = await getScriptStatusCache();
            const cached = scriptStatusCache[message.url];
            if (cached && Date.now() - cached.checkedAt < SCRIPT_STATUS_CACHE_TTL_MS) {
                sendResponse({ success: cached.allowed, error: cached.error });
                return;
            }
            let scriptAllowed = false;
            let scriptError = '';
            try {
                const results = await chrome.scripting.executeScript({
                    target: { tabId },
                    world: 'MAIN',
                    func: () => {
                        try {
                            new Function('return true')();
                            return true;
                        }
                        catch {
                            return false;
                        }
                    }
                });
                scriptAllowed = results.some((result) => result.result === true);
                if (!scriptAllowed) {
                    scriptError =
                        'This page appears to block dynamic code execution (for example via Content Security Policy).';
                }
            }
            catch (error) {
                scriptAllowed = false;
                scriptError =
                    error instanceof Error ? error.message : 'Failed to run script injection test.';
                log.err(`Script injection capability check failed: tabId=${tabId}, url="${message.url}".`, error);
            }
            scriptStatusCache[message.url] = {
                allowed: scriptAllowed,
                checkedAt: Date.now(),
                error: scriptError || undefined
            };
            await setScriptStatusCache(scriptStatusCache);
            sendResponse({ success: scriptAllowed, error: scriptError || undefined });
        });
        return true;
    }
}
