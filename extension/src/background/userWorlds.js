const PREFIX = 'lambda-';
const CSP = "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'";
const worlds = new Map();
let recovery;
let queue = Promise.resolve();
const serialize = (action) => {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
};

export function recoverUserWorlds() {
    if (!chrome.userScripts?.getWorldConfigurations) return Promise.resolve();
    recovery ||= (async () => {
        const configurations = await chrome.userScripts.getWorldConfigurations();
        await Promise.all(configurations.filter((world) => world.worldId?.startsWith(PREFIX))
            .map((world) => chrome.userScripts.resetWorldConfiguration(world.worldId)));
        // Chrome falls back here when its per-document named-world limit is reached.
        await chrome.userScripts.configureWorld({ messaging: false, csp: CSP });
    })().catch((error) => { recovery = null; throw error; });
    return recovery;
}

export async function configureUserWorld(lambda, callers) {
    if (!chrome.userScripts?.execute || !chrome.userScripts?.configureWorld) {
        throw new Error('User-script execution is not enabled. Enable Allow User Scripts for this extension.');
    }
    await recoverUserWorlds();
    const identity = JSON.stringify([lambda.id, lambda.name, lambda.project || 'default', lambda.func, callers]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
    const worldId = PREFIX + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    await serialize(async () => {
        if (!worlds.has(worldId)) {
            await chrome.userScripts.configureWorld({ worldId, messaging: true, csp: CSP });
            worlds.set(worldId, 0);
        }
        worlds.set(worldId, worlds.get(worldId) + 1);
    });
    return worldId;
}

export function releaseUserWorld(worldId) {
    return serialize(async () => {
        const references = worlds.get(worldId);
        if (references > 1) worlds.set(worldId, references - 1);
        else {
            worlds.delete(worldId);
            try { await chrome.userScripts.resetWorldConfiguration(worldId); }
            catch { /* Recovery removes configurations left by termination or revoked browser access. */ }
        }
    });
}

export async function checkUserWorld(tabId, documentId, worldId) {
    const results = await chrome.userScripts.execute({
        target: { tabId, documentIds: [documentId] }, world: 'USER_SCRIPT', worldId,
        js: [{ code: '(() => { try { const port = chrome.runtime.connect({ name: "world-preflight" }); port.disconnect(); return true; } catch { return false; } })()' }]
    });
    if (results.length !== 1 || results[0].documentId !== documentId || results[0].result !== true) {
        throw new Error('The browser cannot provide another isolated function world on this page. Reload the page and try again.');
    }
}
