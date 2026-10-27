chrome.runtime.sendMessage({ type: 'GET_TAB_ID' }, async (response) => {
    const tabId = response?.tabId;
    if (typeof tabId !== 'number')
        return;
    const sticky = await getStickyShell();
    const alwaysOn = await getShellAlwaysOn();
    // Keep the listener so changes also apply to tabs that are already open.
    registerKeyBinding(tabId, sticky);
    if (alwaysOn) {
        showShell(tabId, sticky);
        return;
    }
});
