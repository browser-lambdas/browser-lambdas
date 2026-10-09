import { log } from './activityLog.js';
export const LOCAL_STORAGE_KEY_LAMBDAS = 'local_storage_key_lambdas';
export const LOCAL_STORAGE_KEY_BAAH_PENDING_BATCHES = 'local_storage_key_baah_pending_batches';
export const LOCAL_STORAGE_KEY_SECRETS = 'local_storage_key_secrets';
export const LOCAL_STORAGE_KEY_STORAGE = 'local_storage_key_storage';
export const LOCAL_STORAGE_KEY_INPUT_HISTORY = 'local_storage_key_input_history';
export const LOCAL_STORAGE_KEY_KEYBINDING = 'local_storage_key_keybinding';
export const LOCAL_STORAGE_KEY_THEME = 'local_storage_key_theme';
export const LOCAL_STORAGE_KEY_SHELLPOSITION = 'local_storage_key_shellposition';
const getChromeLocalStorage = async (key) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        log.err(`Unable to read function data: chrome.storage.local is unavailable (key="${key}").`);
        return undefined;
    }
    const result = await chrome.storage.local.get(key);
    return result[key];
};
const setChromeLocalStorage = async (key, value) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        log.err(`Unable to persist function data: chrome.storage.local is unavailable (key="${key}").`);
        return;
    }
    await chrome.storage.local.set({ [key]: value });
};
export const getLambdas = async () => {
    const stored = await getChromeLocalStorage(LOCAL_STORAGE_KEY_LAMBDAS);
    return stored ? JSON.parse(stored) : [];
};
export const findLambdas = async (name) => {
    const lambdas = await getLambdas();
    return lambdas.filter((l) => l.name.split(/\s+/)[0] === name);
};
export const getLambda = async (name) => {
    const matches = await findLambdas(name);
    return matches.length === 1 ? matches[0] : null;
};
export const isLambdaPending = async (name) => {
    const stored = await getChromeLocalStorage(LOCAL_STORAGE_KEY_BAAH_PENDING_BATCHES);
    if (!stored) return false;
    try {
        const batches = typeof stored === 'string' ? JSON.parse(stored) : stored;
        return batches.some((batch) => (batch.items || []).some((item) => item.type === 'lambda' && item.name === name && item.action !== 'unchanged'));
    }
    catch {
        return false;
    }
};
export const storeLambdas = async (lambdas) => {
    await setChromeLocalStorage(LOCAL_STORAGE_KEY_LAMBDAS, JSON.stringify(lambdas));
};
