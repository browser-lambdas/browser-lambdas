export const LOCAL_STORAGE_KEY_WS_PORT = 'local_storage_key_ws_port';
export async function getWsPort() {
    const value = (await chrome.storage.local.get(LOCAL_STORAGE_KEY_WS_PORT))[LOCAL_STORAGE_KEY_WS_PORT];
    return typeof value === 'number' ? value : 4455;
}
