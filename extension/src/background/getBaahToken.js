import { log } from './activityLog.js';
export const LOCAL_STORAGE_KEY_BAAH_TOKEN = 'local_storage_key_baah_token';
const getChromeLocalStorage = async (key) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        log.err(`Unable to read extension storage: chrome.storage.local is unavailable (key="${key}").`);
        return undefined;
    }
    const result = await chrome.storage.local.get(key);
    return result[key];
};
export async function getBaahToken() {
    return ((await chrome.storage.local.get(LOCAL_STORAGE_KEY_BAAH_TOKEN))[LOCAL_STORAGE_KEY_BAAH_TOKEN] ??
        'not-found');
}
