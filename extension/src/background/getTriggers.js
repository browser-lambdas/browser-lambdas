import { log } from './activityLog.js';
export const LOCAL_STORAGE_KEY_TRIGGERS = 'local_storage_key_triggers';
const getChromeLocalStorage = async (key) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        log.err(`Unable to read trigger data: chrome.storage.local is unavailable (key="${key}").`);
        return undefined;
    }
    const result = await chrome.storage.local.get(key);
    return result[key];
};
export const getTriggers = async () => {
    const stored = await getChromeLocalStorage(LOCAL_STORAGE_KEY_TRIGGERS);
    return stored
        ? JSON.parse(stored).map((t) => {
            const patterns = Array.isArray(t.patterns) ? t.patterns : [];
            return { name: '', commands: [], ...t, patterns };
        })
        : [];
};
export const storeTriggers = async (triggers) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        log.err('Unable to persist trigger data: chrome.storage.local is unavailable.');
        return;
    }
    await chrome.storage.local.set({ [LOCAL_STORAGE_KEY_TRIGGERS]: JSON.stringify(triggers) });
};
