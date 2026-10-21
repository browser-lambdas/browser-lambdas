// This classic script also runs on web pages. Import extension modules only
// when an extension-page reader needs them, never during content-script startup.
let accessPolicyModule;
let storageRecordsModule;
const LOCAL_STORAGE_KEY_LAMBDAS = 'local_storage_key_lambdas';
const LOCAL_STORAGE_KEY_SECRETS = 'local_storage_key_secrets';
const LOCAL_STORAGE_KEY_STORAGE = 'local_storage_key_storage';
const LOCAL_STORAGE_KEY_INPUT_HISTORY = 'local_storage_key_input_history';
const LOCAL_STORAGE_KEY_KEYBINDING = 'local_storage_key_keybinding';
const LOCAL_STORAGE_KEY_THEME = 'local_storage_key_theme';
const LOCAL_STORAGE_KEY_SHELLPOSITION = 'local_storage_key_shellposition';
const LOCAL_STORAGE_KEY_SHELLCSS = 'local_storage_key_shellcss';
const LOCAL_STORAGE_KEY_STICKYSHELL = 'local_storage_key_stickyshell';
const LOCAL_STORAGE_KEY_SHELL_ALWAYS_ON = 'local_storage_key_shell_always_on';
const LOCAL_STORAGE_KEY_BAAH_TOKEN = 'local_storage_key_baah_token';
const LOCAL_STORAGE_KEY_WS_PORT = 'local_storage_key_ws_port';
const LOCAL_STORAGE_KEY_BAAH_REQUIRE_REVIEW = 'local_storage_key_baah_require_review';
const LOCAL_STORAGE_KEY_BAAH_POLL_CHANGES = 'local_storage_key_baah_poll_changes';
const LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_FUNCTIONS = 'local_storage_key_allow_main_world_functions';
const LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_STORAGE = 'local_storage_key_allow_main_world_storage';
const LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_SECRETS = 'local_storage_key_allow_main_world_secrets';
const LOCAL_STORAGE_KEY_BAAH_PENDING_BATCHES = 'local_storage_key_baah_pending_batches';
const LOCAL_STORAGE_KEY_TRIGGERS = 'local_storage_key_triggers';
const DEFAULT_SHELL_POSITION = {
    x: window.innerWidth / 2 - 250,
    y: 40,
    width: 520,
    height: 360
};
const getChromeLocalStorage = async (key) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        return localStorage.getItem(key) ?? undefined;
    }
    const result = await chrome.storage.local.get(key);
    return result[key];
};
const setChromeLocalStorage = async (key, value) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        localStorage.setItem(key, value);
        return;
    }
    await chrome.storage.local.set({ [key]: value });
};
const getLambdas = async () => {
    const stored = await getChromeLocalStorage(LOCAL_STORAGE_KEY_LAMBDAS);
    return stored ? JSON.parse(stored) : [];
};
const getLambda = async (cmd) => {
    const lambdas = await getLambdas();
    const matches = lambdas.filter((l) => l.name.split(/\s+/)[0] === cmd);
    return matches.length === 1 ? matches[0] : null;
};
const storeLambdas = async (lambdas) => {
    await setChromeLocalStorage(LOCAL_STORAGE_KEY_LAMBDAS, JSON.stringify(lambdas));
};
const getInputHistory = async () => {
    const history = await getChromeLocalStorage(LOCAL_STORAGE_KEY_INPUT_HISTORY);
    return Array.isArray(history) ? history : [];
};
const setInputHistory = async (historyArray) => {
    await setChromeLocalStorage(LOCAL_STORAGE_KEY_INPUT_HISTORY, historyArray);
};
const DEFAULT_KEYBINDING = { meta: true, ctrl: false, key: 'k' };
const getKeyBinding = async () => {
    const binding = await getChromeLocalStorage(LOCAL_STORAGE_KEY_KEYBINDING);
    return binding ?? DEFAULT_KEYBINDING;
};
const setKeyBinding = async (binding) => {
    await setChromeLocalStorage(LOCAL_STORAGE_KEY_KEYBINDING, binding);
};
const getTheme = async () => {
    const theme = await getChromeLocalStorage(LOCAL_STORAGE_KEY_THEME);
    return theme ?? 'light';
};
const setTheme = async (theme) => {
    await setChromeLocalStorage(LOCAL_STORAGE_KEY_THEME, theme);
};
const shellPositionKey = (scope = '') => scope
    ? `${LOCAL_STORAGE_KEY_SHELLPOSITION}:${scope}`
    : LOCAL_STORAGE_KEY_SHELLPOSITION;
const setShellPosition = async (position, scope = '') => {
    await setChromeLocalStorage(shellPositionKey(scope), position);
};
const getShellPosition = async (scope = '') => {
    const pos = await getChromeLocalStorage(shellPositionKey(scope));
    if (!pos) {
        return DEFAULT_SHELL_POSITION;
    }
    return {
        x: typeof pos.x === 'number' ? pos.x : DEFAULT_SHELL_POSITION.x,
        y: typeof pos.y === 'number' ? pos.y : DEFAULT_SHELL_POSITION.y,
        width: typeof pos.width === 'number' ? pos.width : DEFAULT_SHELL_POSITION.width,
        height: typeof pos.height === 'number' ? pos.height : DEFAULT_SHELL_POSITION.height
    };
};
const getSecrets = async () => {
    const stored = await getChromeLocalStorage(LOCAL_STORAGE_KEY_SECRETS);
    const secrets = stored ? JSON.parse(stored) : [];
    const { normalizeAccessPolicy } = await (accessPolicyModule ??= import('./accessPolicy.js'));
    return Array.isArray(secrets) ? secrets.map((secret) => ({ ...secret, ...normalizeAccessPolicy(secret) })) : [];
};
const storeSecrets = async (secrets) => {
    await setChromeLocalStorage(LOCAL_STORAGE_KEY_SECRETS, JSON.stringify(secrets));
};
const getStorageItems = async () => {
    const { parseStorageRecords } = await (storageRecordsModule ??= import('./storageRecords.js'));
    return parseStorageRecords(await getChromeLocalStorage(LOCAL_STORAGE_KEY_STORAGE));
};
const mutateStorageItem = async (operation, item, expected) => chrome.runtime.sendMessage({
    type: 'WORKSPACE_STORAGE_MUTATION', operation, item, expected
});
const getAllowMainWorldFunctions = async () => (await getChromeLocalStorage(LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_FUNCTIONS)) === true;
const setAllowMainWorldFunctions = async (enabled) => setChromeLocalStorage(LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_FUNCTIONS, enabled === true);
const getAllowMainWorldStorage = async () => (await getChromeLocalStorage(LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_STORAGE)) === true;
const setAllowMainWorldStorage = async (enabled) => setChromeLocalStorage(LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_STORAGE, enabled === true);
const getTriggers = async () => {
    const stored = await getChromeLocalStorage(LOCAL_STORAGE_KEY_TRIGGERS);
    return stored
        ? JSON.parse(stored).map((t) => {
            const patterns = Array.isArray(t.patterns) ? t.patterns : [];
            return { name: '', commands: [], ...t, patterns };
        })
        : [];
};
const storeTriggers = async (triggers) => {
    await setChromeLocalStorage(LOCAL_STORAGE_KEY_TRIGGERS, JSON.stringify(triggers));
};

const DEFAULT_SHELL_STYLE_CSS = `
#browser-lambdas-shell {
    background: #160e16;
    color: #f7f5f8;
    display: flex;
    flex-direction: column;
    border: 1px solid #2d1b2e;
    border-radius: 24px;
    font-family: 'Fira Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 14px;
    line-height: 1.3;
    padding: 0;
    box-sizing: border-box;
    overflow: hidden;
}
#shell-titlebar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    height: 40px;
    padding: 0 12px;
    border-bottom: 1px solid #2d1b2e;
    cursor: grab;
}
#shell-body {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 12px;
}
#shell-outputs {
    padding: 0 2px 0 0;
    background: #160e16;
}
#shell-input-wrap {
    position: relative;
    display: flex;
    align-items: center;
    padding: 0;
    margin-bottom: 6px;
    background: #160e16;
}
#shell-input-wrap > span {
    color: #ddffd0;
    margin-right: 1ch;
}
#shell-input {
    flex: 1;
    border: none;
    outline: none;
    background: #160e16;
    color: #f7f5f8;
    font: inherit;
    line-height: inherit;
    padding: 0;
}
#shell-suggestions {
    background: #160e16;
    color: #f7f5f8;
    border: 1px solid #2d1b2e;
    border-radius: 8px;
}
.shell-icon-button {
    background: transparent;
    color: #f7f5f8;
    border-radius: 6px;
}
.shell-icon-button:hover {
    background: #2d1b2e;
}
.shell-position-menu {
    border: 1px solid #2d1b2e;
    background: #160e16;
}
.shell-position-menu button {
    color: #f7f5f8;
}
.shell-position-menu button:hover {
    background: #2d1b2e;
}
        `.trim();
const isLegacyGlassShellStyle = (css = '') => css.includes('background: rgba(255, 255, 255, 0.08)') && css.includes('backdrop-filter: blur(12px)') && css.includes('#shell-titlebar {}');
const getShellThemes = async () => {
    const stored = await getChromeLocalStorage(LOCAL_STORAGE_KEY_SHELLCSS);
    const themes = stored ? JSON.parse(stored) : [];
    return themes.map((theme) => ({
        id: theme.id || crypto.randomUUID(),
        project: '',
        ...theme,
        css: isLegacyGlassShellStyle(theme.css) ? DEFAULT_SHELL_STYLE_CSS : theme.css
    }));
};
const storeShellThemes = async (themes) => {
    await setChromeLocalStorage(LOCAL_STORAGE_KEY_SHELLCSS, JSON.stringify(themes));
};
const getSelectedShellTheme = async () => {
    const themes = await getShellThemes();
    return themes.find((t) => t.selected);
};
const setSelectedShellTheme = async (name) => {
    const themes = await getShellThemes();
    const updated = themes.map((t) => ({
        ...t,
        selected: t.name === name
    }));
    await storeShellThemes(updated);
};
const clearSelectedShellTheme = async () => {
    const themes = await getShellThemes();
    const updated = themes.map((t) => ({
        ...t,
        selected: false
    }));
    await storeShellThemes(updated);
};
const addShellTheme = async (theme) => {
    const themes = await getShellThemes();
    themes.push(theme);
    await storeShellThemes(themes);
};
const deleteShellTheme = async (name) => {
    const themes = await getShellThemes();
    const updated = themes.filter((t) => t.name !== name || t.protected);
    await storeShellThemes(updated);
};
const getStickyShell = async () => {
    const val = await getChromeLocalStorage(LOCAL_STORAGE_KEY_STICKYSHELL);
    return val === true;
};
const setStickyShell = async (enabled) => {
    await setChromeLocalStorage(LOCAL_STORAGE_KEY_STICKYSHELL, enabled);
};
const getTabShellHistory = async (tabId) => {
    const logs = await getChromeLocalStorage(String(tabId));
    return Array.isArray(logs) ? logs : [];
};
const updateTabShellHistory = async (tabId, logs) => {
    await setChromeLocalStorage(String(tabId), logs);
};
const clearTabShellHistory = async (tabId) => {
    if (chrome?.storage?.local) {
        await chrome.storage.local.remove(String(tabId));
    }
};
async function getShellAlwaysOn() {
    return ((await chrome.storage.local.get(LOCAL_STORAGE_KEY_SHELL_ALWAYS_ON))[LOCAL_STORAGE_KEY_SHELL_ALWAYS_ON] ?? false);
}
async function setShellAlwaysOn(enabled) {
    await chrome.storage.local.set({ [LOCAL_STORAGE_KEY_SHELL_ALWAYS_ON]: enabled });
}
async function getAllowMainWorldSecrets() {
    return (await getChromeLocalStorage(LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_SECRETS)) === true;
}
async function setAllowMainWorldSecrets(enabled) {
    await setChromeLocalStorage(LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_SECRETS, Boolean(enabled));
}
async function getBaahToken() {
    return ((await chrome.storage.local.get(LOCAL_STORAGE_KEY_BAAH_TOKEN))[LOCAL_STORAGE_KEY_BAAH_TOKEN] ??
        'not-found');
}
async function setBaahToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    await chrome.storage.local.set({
        [LOCAL_STORAGE_KEY_BAAH_TOKEN]: token,
        local_storage_key_baah_token_created_at: Date.now()
    });
}
async function deleteBaahToken() {
    await chrome.storage.local.remove([LOCAL_STORAGE_KEY_BAAH_TOKEN, 'local_storage_key_baah_token_created_at']);
}
const getWsPort = async () => {
    const port = await getChromeLocalStorage(LOCAL_STORAGE_KEY_WS_PORT);
    return typeof port === 'number' ? port : 4455;
};
const setWsPort = async (port) => {
    await setChromeLocalStorage(LOCAL_STORAGE_KEY_WS_PORT, port);
};
const getBaahRequireReview = async () => {
    const stored = await getChromeLocalStorage(LOCAL_STORAGE_KEY_BAAH_REQUIRE_REVIEW);
    return stored !== false;
};
const setBaahRequireReview = async (enabled) => {
    await setChromeLocalStorage(LOCAL_STORAGE_KEY_BAAH_REQUIRE_REVIEW, Boolean(enabled));
};
const getBaahPollChanges = async () => {
    const stored = await getChromeLocalStorage(LOCAL_STORAGE_KEY_BAAH_POLL_CHANGES);
    return stored !== false;
};
const setBaahPollChanges = async (enabled) => {
    await setChromeLocalStorage(LOCAL_STORAGE_KEY_BAAH_POLL_CHANGES, Boolean(enabled));
};
const getBaahPendingBatches = async () => {
    const stored = await getChromeLocalStorage(LOCAL_STORAGE_KEY_BAAH_PENDING_BATCHES);
    if (!stored) return [];
    const parsed = typeof stored === 'string' ? JSON.parse(stored) : stored;
    return Array.isArray(parsed) ? parsed : [];
};
const storeBaahPendingBatches = async (batches) => {
    await setChromeLocalStorage(LOCAL_STORAGE_KEY_BAAH_PENDING_BATCHES, JSON.stringify(batches));
};
function hashString(value) {
    let hash = 0;
    const text = String(value ?? '');
    for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    return `h${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
function itemAction(previous, previousValue, incomingValue) {
    if (!previous) return 'create';
    return previousValue === incomingValue ? 'unchanged' : 'update';
}
const normalizeProject = (project) => project || 'default';
const setFromManifest = (manifest, key, fallback) => {
    const values = manifest && Array.isArray(manifest[key]) ? manifest[key] : fallback;
    return new Set((values || []).filter(Boolean));
};
const stageBaahPushBatch = async (batch) => {
    const [lambdas, styles, triggers] = await Promise.all([getLambdas(), getShellThemes(), getTriggers()]);
    const { normalizeAccessPolicy } = await (accessPolicyModule ??= import('./accessPolicy.js'));
    const project = normalizeProject(batch.project);
    const incomingByType = {
        lambdas: batch.items.filter((item) => item.type === 'lambda').map((item) => item.filename),
        styles: batch.items.filter((item) => item.type === 'style').map((item) => item.filename),
        triggers: batch.items.filter((item) => item.type === 'trigger').map((item) => item.name)
    };
    const manifest = batch.manifest || {};
    const pushedNames = {
        lambdas: setFromManifest(manifest, 'lambdas', incomingByType.lambdas),
        styles: setFromManifest(manifest, 'styles', incomingByType.styles),
        triggers: setFromManifest(manifest, 'triggers', incomingByType.triggers)
    };
    const items = batch.items.map((item) => {
        const itemProject = normalizeProject(item.project || batch.project);
        if (item.type === 'lambda') {
            const previous = lambdas.find((lambda) => lambda.name === item.filename && normalizeProject(lambda.project) === itemProject);
            const previousWorld = previous?.world || 'USER_SCRIPT';
            const previousValue = previous?.func;
            const incomingValue = item.bundle;
            return { id: crypto.randomUUID(), type: 'lambda', name: item.filename, sourcePath: item.sourcePath || (item.filename + '.js'), project: itemProject, previous: previous ? { id: previous.id, name: previous.name, project: previous.project, func: previous.func, world: previousWorld, ...normalizeAccessPolicy(previous), hash: hashString(previousValue) } : null, incoming: { name: item.filename, project: itemProject, func: item.bundle, world: previousWorld, ...normalizeAccessPolicy(previous || {}), hash: hashString(incomingValue) }, action: itemAction(previous, previousValue, incomingValue) };
        }
        if (item.type === 'style') {
            const previous = styles.find((style) => style.name === item.filename && normalizeProject(style.project) === itemProject);
            return { id: crypto.randomUUID(), type: 'style', name: item.filename, project: itemProject, previous: previous ? { name: previous.name, project: previous.project, css: previous.css, selected: previous.selected, hash: hashString(previous.css) } : null, incoming: { name: item.filename, project: itemProject, css: item.content, hash: hashString(item.content) }, action: itemAction(previous, previous?.css, item.content) };
        }
        const previous = triggers.find((trigger) => trigger.name === item.name && normalizeProject(trigger.project) === itemProject);
        const previousValue = JSON.stringify({ patterns: previous?.patterns || [], commands: previous?.commands || [] });
        const incomingValue = JSON.stringify({ patterns: item.patterns || [], commands: item.commands || [] });
        return { id: crypto.randomUUID(), type: 'trigger', name: item.name, project: itemProject, previous: previous ? { id: previous.id, name: previous.name, project: previous.project, patterns: previous.patterns || [], commands: previous.commands || [], hash: hashString(previousValue) } : null, incoming: { name: item.name, project: itemProject, patterns: item.patterns || [], commands: item.commands || [], hash: hashString(incomingValue) }, action: itemAction(previous, previousValue, incomingValue) };
    });
    for (const lambda of lambdas) {
        if (Array.isArray(manifest.lambdas) && normalizeProject(lambda.project) === project && !pushedNames.lambdas.has(lambda.name)) {
            items.push({ id: crypto.randomUUID(), type: 'lambda', name: lambda.name, sourcePath: lambda.name + '.js', project, previous: { id: lambda.id, name: lambda.name, project: lambda.project, func: lambda.func, world: lambda.world || 'USER_SCRIPT', ...normalizeAccessPolicy(lambda), hash: hashString(lambda.func) }, incoming: null, action: 'delete' });
        }
    }
    for (const style of styles) {
        if (Array.isArray(manifest.styles) && normalizeProject(style.project) === project && !pushedNames.styles.has(style.name)) {
            items.push({ id: crypto.randomUUID(), type: 'style', name: style.name, project, previous: { name: style.name, project: style.project, css: style.css, selected: style.selected, hash: hashString(style.css) }, incoming: null, action: 'delete' });
        }
    }
    for (const trigger of triggers) {
        if (Array.isArray(manifest.triggers) && normalizeProject(trigger.project) === project && !pushedNames.triggers.has(trigger.name)) {
            const previousValue = JSON.stringify({ patterns: trigger.patterns || [], commands: trigger.commands || [] });
            items.push({ id: crypto.randomUUID(), type: 'trigger', name: trigger.name, project, previous: { id: trigger.id, name: trigger.name, project: trigger.project, patterns: trigger.patterns || [], commands: trigger.commands || [], hash: hashString(previousValue) }, incoming: null, action: 'delete' });
        }
    }
    const staged = { id: batch.id, project, receivedAt: Date.now(), source: 'baah push', status: 'pending', counts: { ...batch.counts, deletes: items.filter((item) => item.action === 'delete').length }, items };
    await storeBaahPendingBatches([staged]);
    return staged;
};
