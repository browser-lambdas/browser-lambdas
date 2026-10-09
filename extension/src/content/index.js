chrome.runtime.sendMessage({ type: 'GET_TAB_ID' }, async (response) => {
    const tabId = response?.tabId;
    if (typeof tabId !== 'number')
        return;
    const sticky = await getStickyShell();
    const alwaysOn = await getShellAlwaysOn();
    // Always register keybinding so user can open manually
    registerKeyBinding(tabId, sticky);
    if (alwaysOn) {
        showShell(tabId, sticky);
        return;
    }
});
