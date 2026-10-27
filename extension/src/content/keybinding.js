const registerKeyBinding = async (tabId, useHistory) => {
    const shortcut = await getKeyBinding();
    log.dbg(`Shell shortcut registered: key="${shortcut.key}", tabId=${tabId}, history=${useHistory}.`);
    document.addEventListener('keydown', async (event) => {
        if (!event.isTrusted)
            return;
        if (!await getKeyBindingEnabled())
            return;
        const currentShortcut = await getKeyBinding();
        if (event.metaKey === Boolean(currentShortcut.meta) &&
            event.ctrlKey === Boolean(currentShortcut.ctrl) &&
            event.key.toLowerCase() === currentShortcut.key) {
            log.dbg(`Shell shortcut activated: tabId=${tabId}.`);
            event.preventDefault();
            showShell(tabId, useHistory);
        }
    });
};
