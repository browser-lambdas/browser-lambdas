const app = document.getElementById('app');
let cleanupBaahSync = null;

const settingKeys = [
  LOCAL_STORAGE_KEY_KEYBINDING,
  LOCAL_STORAGE_KEY_STICKYSHELL,
  LOCAL_STORAGE_KEY_SHELL_ALWAYS_ON,
  LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_FUNCTIONS,
  LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_STORAGE,
  LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_SECRETS,
  LOCAL_STORAGE_KEY_BAAH_REQUIRE_REVIEW,
  LOCAL_STORAGE_KEY_BAAH_POLL_CHANGES,
  LOCAL_STORAGE_KEY_WS_PORT,
];

const state = {
  keybinding: { meta: true, ctrl: false, key: 'k' },
  stickyShell: false,
  alwaysOn: false,
  allowMainWorldSecrets: false,
  allowMainWorldStorage: false,
  allowMainWorldFunctions: false,
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
  return `<button type="button" class="toggle" data-state="${pressed ? 'on' : 'off'}" data-action="${action}" aria-label="${escapeHtml(label)}" aria-pressed="${pressed}" ${extraAttrs}></button>`;
}

const mainWorldCategories = [
  { label: 'functions', field: 'allowMainWorldFunctions', save: setAllowMainWorldFunctions },
  { label: 'storage', field: 'allowMainWorldStorage', save: setAllowMainWorldStorage },
  { label: 'secrets', field: 'allowMainWorldSecrets', save: setAllowMainWorldSecrets }
];

function renderSettings() {
  return `<div class="settings-scroll">
    <main class="settings-card">
      <header class="settings-section settings-header">
        <h1 class="settings-page-title">${lucideIcon('settings')}<span>Settings</span></h1>
        <p>Manage your shell, CLI connections, and security.</p>
      </header>

      <section class="settings-section" aria-labelledby="shell-settings">
        <h2 class="settings-group-title" id="shell-settings">Shell</h2>
        <div class="settings-block settings-control-row">
          <div class="settings-control-copy">
            <h3 class="section-title"><label for="shell-keybinding">Key binding</label></h3>
            <p class="section-description">Choose a shortcut to toggle the shell.</p>
            <p class="hint">Press a key combination to set a shortcut.</p>
          </div>
          <input id="shell-keybinding" class="text-input keybinding ${state.capturingKeybinding ? 'capturing' : ''}" type="text" value="${escapeHtml(keybindingDisplayText())}" data-action="keybinding" readonly />
        </div>
        <div class="toggle-row"><div>Keep Output History</div>${toggle('Keep Output History', state.stickyShell, 'toggle-sticky')}</div>
        <div class="toggle-row"><div>Always Show Shell</div>${toggle('Always Show Shell', state.alwaysOn, 'toggle-always-on')}</div>
        <div class="settings-block settings-control-row">
          <div class="settings-control-copy">
            <h3 class="section-title">Clear shell history</h3>
            <p class="section-description">Clear output and command history from all open tabs.</p>
          </div>
          ${button('Clear', 'clear-history', { icon: lucideIcon('trash') })}
        </div>
      </section>

      <section class="settings-section" aria-labelledby="baah-cli-settings">
        <h2 class="settings-group-title" id="baah-cli-settings">Baah CLI</h2>
        <div class="settings-block">
          <h3 class="section-title">Token</h3>
          <p class="section-description">Copy this token when setting up a browser connection with baah init or baah set. Deleting it invalidates existing CLI connections.</p>
          <div class="token-actions">
            ${state.baahToken ? `
              <label class="token-status"><input type="checkbox" checked disabled> Token created!</label>
              ${state.baahTokenCreatedAt ? `<time datetime="${escapeHtml(new Date(state.baahTokenCreatedAt).toISOString())}">(${escapeHtml(new Date(state.baahTokenCreatedAt).toLocaleString())})</time>` : '<span>(creation date unavailable)</span>'}
              ${button(state.copied ? 'Copied!' : 'Copy', 'copy-token', { icon: lucideIcon(state.copied ? 'check' : 'clipboard') })}
              ${button('Delete', 'delete-token', { icon: lucideIcon('trash') })}
            ` : `<span>No tokens yet.</span>${button('Create new', 'generate-token', { icon: lucideIcon('plus') })}`}
          </div>
        </div>
        <div class="settings-block">
          <h3 class="section-title">Polling</h3>
          <p class="section-description">Receive project updates pushed using baah push.</p>
          <div class="toggle-row" id="baah-poll"><div>Poll for updates</div>${toggle('Poll for updates', state.baahPollChanges, 'toggle-baah-poll')}</div>
          <div class="toggle-row"><label for="baah-port">Port</label><input id="baah-port" class="text-input numeric" type="text" inputmode="numeric" value="${escapeHtml(state.wsPort)}" data-action="ws-port" /></div>
        </div>
        <div class="settings-block">
          <h3 class="section-title">Review</h3>
          <p class="section-description">Review updates pushed with baah push before applying them. Turning this off lets any local process with your baah token replace functions, styles, and triggers without review.</p>
          <div class="toggle-row" id="baah-review"><div>Require review</div>${toggle('Require review', state.baahRequireReview, 'toggle-baah-review')}</div>
        </div>
      </section>

      <section class="settings-section" aria-labelledby="security-settings">
        <h2 class="settings-group-title" id="security-settings">Security</h2>
        <div class="settings-block">
          <h3 class="section-title">Main world execution</h3>
          <p class="section-description">Main-world code shares a JavaScript environment with the page and can expose storage and secrets to untrusted scripts. Each item must also allow the main world and the current page.</p>
          ${mainWorldCategories.map(({ label, field }) => `<div class="toggle-row" id="main-world-${label}"><div>Allow main world execution of ${label}</div>${toggle(`Allow main world execution of ${label}`, state[field], `toggle-main-world-${label}`, `data-testid="allow-main-world-${label}"`)}</div>`).join('')}
        </div>
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
  document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'center' });
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

  await loadSettings();
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
      await loadSettings();
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
  await loadSettings();
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
  if (area === 'local' && settingKeys.some((key) => Object.hasOwn(changes, key))) {
    await loadSettings();
    render();
  }

  if (area === 'local' && (changes.local_storage_key_baah_token || changes.local_storage_key_baah_token_created_at)) {
    await loadBaahToken();
    state.copied = false;
    render();
  }
});
