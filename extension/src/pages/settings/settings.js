const app = document.getElementById('app');
let cleanupBaahSync = null;

const state = {
  keybinding: { meta: true, ctrl: false, key: 'k' },
  stickyShell: false,
  alwaysOn: false,
  allowMainWorldSecrets: false,
  allowMainWorldStorage: false,
  allowMainWorldFunctions: false,
  allowMainWorldTriggers: false,
  baahRequireReview: true,
  baahPollChanges: true,
  wsPort: 4455,
  baahToken: '',
  baahTokenCreatedAt: null,
  copied: false,
  capturingKeybinding: false,
  notice: ''
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatKeybinding(binding) {
  return [binding.meta ? 'Cmd' : '', binding.ctrl ? 'Ctrl' : '', binding.key.toUpperCase()]
    .filter(Boolean)
    .join(' + ');
}

function keybindingDisplayText() {
  return state.capturingKeybinding ? 'Press a key combination...' : formatKeybinding(state.keybinding);
}




function button(label, action, options = {}) {
  const disabled = options.disabled ? 'disabled' : '';
  const title = options.title ? `title="${escapeHtml(options.title)}"` : '';
  return `<button class="link-button ${options.className || ''}" data-action="${action}" ${disabled} ${title}>${options.icon ? `<span class="button-icon">${options.icon}</span>` : ''}${label}</button>`;
}

function toggle(label, pressed, action, extraAttrs = '') {
  return `<button class="toggle" data-state="${pressed ? 'on' : 'off'}" data-action="${action}" aria-pressed="${pressed}" ${extraAttrs}>${label}</button>`;
}

const mainWorldCategories = [
  { label: 'functions', field: 'allowMainWorldFunctions', save: setAllowMainWorldFunctions },
  { label: 'storage', field: 'allowMainWorldStorage', save: setAllowMainWorldStorage },
  { label: 'triggers', field: 'allowMainWorldTriggers', save: setAllowMainWorldTriggers },
  { label: 'secrets', field: 'allowMainWorldSecrets', save: setAllowMainWorldSecrets }
];

function renderSettings() {
  return `<div class="settings-scroll">
    <main class="settings-card">
      <section class="settings-section settings-header">
        <h1 class="settings-page-title">${lucideIcon('settings')}<span>Settings</span></h1>
        <p>Manage your shell settings here</p>
      </section>

      <section class="settings-section">
        <h2 class="section-title">Connection token</h2>
        <p class="section-description">Copy this token when setting up a browser connection with baah init or baah set. Deleting it invalidates existing CLI connections.</p>
        <div class="token-actions">
          ${state.baahToken ? `
            <label class="token-status"><input type="checkbox" checked disabled> Token created!</label>
            ${state.baahTokenCreatedAt ? `<time datetime="${escapeHtml(new Date(state.baahTokenCreatedAt).toISOString())}">(${escapeHtml(new Date(state.baahTokenCreatedAt).toLocaleString())})</time>` : '<span>(creation date unavailable)</span>'}
            ${button(state.copied ? 'Copied!' : 'Copy', 'copy-token', { icon: lucideIcon(state.copied ? 'check' : 'clipboard') })}
            ${button('Delete', 'delete-token', { icon: lucideIcon('trash') })}
          ` : `<span>No tokens yet..</span>${button('Create new', 'generate-token', { icon: lucideIcon('plus') })}`}
        </div>
      </section>

      <section class="settings-section">
        <p class="section-title">WebSocket Port</p>
        <p class="section-description">Port used for baah push.</p>
        <input class="text-input numeric" type="text" inputmode="numeric" value="${escapeHtml(state.wsPort)}" data-action="ws-port" />
      </section>

      <section class="settings-section">
        <p class="section-title">Baah Push Review</p>
        <p class="section-description">Require manual review before applying pushed lambdas, styles, and triggers. Turning this off means any local process with your baah token can replace them without review.</p>
        <div class="toggle-row"><span>Require Review</span>${toggle(state.baahRequireReview ? 'On' : 'Off', state.baahRequireReview, 'toggle-baah-review')}</div>
        <div class="toggle-row"><span>Poll changes</span>${toggle(state.baahPollChanges ? 'On' : 'Off', state.baahPollChanges, 'toggle-baah-poll')}</div>
      </section>

      <section class="settings-section">
        <p class="section-title">Main world execution</p>
        <p class="section-description">Main-world code shares a JavaScript environment with the page and can expose storage and secrets to untrusted scripts. Each item must also allow the main world and the current page.</p>
        ${mainWorldCategories.map(({ label, field }) => `<div class="toggle-row" id="main-world-${label}"><span>Allow main world execution of ${label}</span>${toggle(state[field] ? 'On' : 'Off', state[field], `toggle-main-world-${label}`, `data-testid="allow-main-world-${label}"`)}</div>`).join('')}
      </section>

      <section class="settings-section">
        <p class="section-title">Keybinding</p>
        <p class="section-description">Define a custom shortcut to toggle the shell. Try something like Cmd + K or Ctrl + Shift + T.</p>
        <input class="text-input keybinding ${state.capturingKeybinding ? 'capturing' : ''}" type="text" value="${escapeHtml(keybindingDisplayText())}" data-action="keybinding" readonly />
        <p class="hint">Press a key combination to set a shortcut</p>
      </section>

      <section class="settings-section">
        <p class="section-title">Feature Toggles</p>
        <p class="section-description">Toggle shell behavior options like keeping output history or forcing the shell to stay visible.</p>
        <div class="toggle-row"><span>Keep Output History</span>${toggle(state.stickyShell ? 'On' : 'Off', state.stickyShell, 'toggle-sticky')}</div>
        <div class="toggle-row"><span>Always Show Shell</span>${toggle(state.alwaysOn ? 'On' : 'Off', state.alwaysOn, 'toggle-always-on')}</div>
      </section>

      <section class="settings-section">
        <p class="section-title">Shell History</p>
        <p class="section-description">Clear history for the current tab's shell session.</p>
        <div class="fit">${button('Clear', 'clear-history', { icon: lucideIcon('trash') })}</div>
      </section>

      ${state.notice ? `<p class="notice">${escapeHtml(state.notice)}</p>` : ''}
    </main>
  </div>`;
}

function render() {
  const scrollTop = document.querySelector('.settings-scroll')?.scrollTop || 0;
  app.innerHTML = `<div class="settings-shell">${renderAppNav({ settingsActive: true })}${renderSettings()}</div>`;
  document.querySelector('.settings-scroll')?.scrollTo({ top: scrollTop });
}

function scrollToLinkedSetting() {
  const category = mainWorldCategories.find(({ label }) => location.hash === `#main-world-${label}`);
  if (!category) return;
  document.getElementById(`main-world-${category.label}`)?.scrollIntoView({ block: 'center' });
}

window.addEventListener('hashchange', scrollToLinkedSetting);

async function loadBaahToken() {
  const values = await chrome.storage.local.get(['local_storage_key_baah_token', 'local_storage_key_baah_token_created_at']);
  const token = values.local_storage_key_baah_token || 'not-found';
  state.baahToken = token === 'not-found' ? '' : token;
  const createdAt = values.local_storage_key_baah_token_created_at;
  state.baahTokenCreatedAt = typeof createdAt === 'number' && Number.isFinite(new Date(createdAt).getTime()) ? createdAt : null;
}

async function loadSettings() {
  state.keybinding = await getKeyBinding();
  state.stickyShell = await getStickyShell();
  state.alwaysOn = await getShellAlwaysOn();
  state.allowMainWorldSecrets = await getAllowMainWorldSecrets();
  state.allowMainWorldStorage = await getAllowMainWorldStorage();
  state.allowMainWorldFunctions = await getAllowMainWorldFunctions();
  state.allowMainWorldTriggers = await getAllowMainWorldTriggers();
  state.baahRequireReview = await getBaahRequireReview();
  state.baahPollChanges = await getBaahPollChanges();
  await loadBaahToken();
  state.wsPort = await getWsPort();
}

async function clearShellHistory() {
  const tabs = await chrome.tabs.query({});
  const stored = await chrome.storage.local.get(null);
  const historyKeys = Object.keys(stored).filter((key) => /^\d+$/.test(key));
  if (historyKeys.length > 0) await chrome.storage.local.remove(historyKeys);
  await Promise.all(tabs.map(async (tab) => {
    if (typeof tab.id !== 'number') return;
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'CLEAR_SHELL_HISTORY' });
    }
    catch {
      // Tabs without an extension content script are not eligible shell tabs.
    }
  }));
  await setInputHistory([]);
  state.notice = 'All shell histories cleared.';
}

async function copyToken() {
  try {
    if (!state.baahToken) return;
    await navigator.clipboard.writeText(state.baahToken);
    state.notice = '';
    state.copied = true;
    render();
    window.setTimeout(() => {
      state.copied = false;
      render();
    }, 800);
  } catch {
    state.copied = false;
    state.notice = 'Unable to copy the token. Please try again.';
    log.err('Failed to copy the token to the clipboard.');
  }
}

app.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;
  if (action === 'ws-port') return;
  if (action === 'keybinding') {
    state.capturingKeybinding = true;
    render();
    return;
  }

  if (action === 'copy-token') await copyToken();
  if (action === 'generate-token') {
    await setBaahToken();
    await loadBaahToken();
    state.copied = false;
    state.notice = '';
  }
  if (action === 'delete-token') {
    await deleteBaahToken();
    await loadBaahToken();
    state.copied = false;
    state.notice = '';
  }
  if (action === 'toggle-sticky') {
    state.stickyShell = !state.stickyShell;
    await setStickyShell(state.stickyShell);
  }
  if (action === 'toggle-always-on') {
    state.alwaysOn = !state.alwaysOn;
    await setShellAlwaysOn(state.alwaysOn);
  }
  const category = mainWorldCategories.find(({ label }) => action === `toggle-main-world-${label}`);
  if (category) {
    state[category.field] = !state[category.field];
    await category.save(state[category.field]);
  }
  if (action === 'toggle-baah-review') {
    state.baahRequireReview = !state.baahRequireReview;
    await setBaahRequireReview(state.baahRequireReview);
  }
  if (action === 'toggle-baah-poll') {
    state.baahPollChanges = !state.baahPollChanges;
    await setBaahPollChanges(state.baahPollChanges);
  }
  if (action === 'clear-history') await clearShellHistory();

  render();
});

app.addEventListener('input', (event) => {
  const target = event.target;
  if (!target?.dataset?.action) return;

  if (target.dataset.action === 'ws-port') {
    // Keep the field mounted while the user types. Rendering on every input
    // event replaces the input element and drops focus after one character.
    state.wsPort = target.value;
  }
});

app.addEventListener('change', async (event) => {
  const target = event.target;
  if (target?.dataset?.action !== 'ws-port') return;

  const rawValue = target.value.trim();
  if (/^\d+$/.test(rawValue)) {
    const value = Number(rawValue);
    if (value >= 1 && value <= 65535) {
      state.wsPort = value;
      await setWsPort(value);
      render();
      return;
    }
  }

  state.wsPort = await getWsPort();
  render();
});

window.addEventListener('keydown', async (event) => {
  const target = event.target;
  if (!state.capturingKeybinding && target?.dataset?.action !== 'keybinding') return;

  event.preventDefault();

  if (event.key === 'Escape') {
    state.capturingKeybinding = false;
    render();
    return;
  }

  if (['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return;

  state.keybinding = {
    meta: event.metaKey,
    ctrl: event.ctrlKey,
    key: event.key.toLowerCase()
  };
  state.capturingKeybinding = false;
  await setKeyBinding(state.keybinding);
  render();
});

(async () => {
  await loadSettings();
  cleanupBaahSync = typeof initBaahSync === 'function' ? initBaahSync() : null;
  render();
  scrollToLinkedSetting();
})();

window.addEventListener('beforeunload', () => cleanupBaahSync?.());

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local' && (changes[LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_TRIGGERS] || changes[LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_FUNCTIONS] || changes[LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_STORAGE] || changes[LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_SECRETS])) {
    if (changes[LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_TRIGGERS]) state.allowMainWorldTriggers = changes[LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_TRIGGERS].newValue === true;
    if (changes[LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_FUNCTIONS]) state.allowMainWorldFunctions = changes[LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_FUNCTIONS].newValue === true;
    if (changes[LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_STORAGE]) state.allowMainWorldStorage = changes[LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_STORAGE].newValue === true;
    if (changes[LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_SECRETS]) state.allowMainWorldSecrets = changes[LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_SECRETS].newValue === true;
    render();
  }

  if (area === 'local' && (changes.local_storage_key_baah_token || changes.local_storage_key_baah_token_created_at)) {
    await loadBaahToken();
    state.copied = false;
    render();
  }
});
