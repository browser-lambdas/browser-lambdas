import { escapeHtml } from './html.js';

const categories = ['functions', 'triggers', 'styles'];
const drafts = new Map();
const mounted = new WeakMap();

export function updateProjectSettingsGlobals(globals) {
  document.querySelectorAll('[data-project-settings]').forEach((container) => mounted.get(container)?.(globals));
}

export function mountProjectSettings(container, { project, view, globals = {} }) {
  const projectName = String(project || 'default');
  if (!drafts.has(projectName)) drafts.set(projectName, {});
  const projectDraft = drafts.get(projectName);
  let selected = categories.includes(view.category) ? view.category : 'functions';
  const prefix = container.dataset.projectSettings;
  container.setAttribute('aria-label', `Project settings for ${projectName}`);
  container.innerHTML = `<header class="project-settings-header"><h2>Project settings</h2><p class="project-settings-name">${escapeHtml(projectName)}</p></header>
    <p class="project-settings-preview">UI preview — changes here are not applied. Drafts clear on reload.</p>
    <div class="project-settings-tabs" role="tablist" aria-label="Project resource settings">${categories.map((name) => `<button type="button" role="tab" id="${prefix}-tab-${name}" aria-controls="${prefix}-panel" data-category="${name}">${name[0].toUpperCase() + name.slice(1)}</button>`).join('')}</div>
    <div id="${prefix}-panel" class="project-settings-panel" role="tabpanel"></div>`;
  const panel = container.querySelector('.project-settings-panel');

  function state() {
    projectDraft[selected] ||= { values: {}, open: {} };
    return projectDraft[selected];
  }

  function defaults() {
    return {
      mode: 'USER_SCRIPT', enabled: true, userWorld: true, mainWorld: false,
      restrictUrls: false, urlPatterns: '', poll: globals.baahPollChanges !== false,
      review: globals.baahRequireReview !== false, lock: false
    };
  }

  function mainAllowed() {
    return Boolean(selected === 'triggers' ? globals.allowMainWorldTriggers : globals.allowMainWorldFunctions);
  }

  function value(key) {
    if (key === 'mainWorld' && !mainAllowed()) return false;
    if (key === 'review' && globals.baahRequireReview !== false) return true;
    return state().values[key] ?? defaults()[key];
  }

  function blocked(key) {
    return (key === 'mainWorld' && !mainAllowed()) || (key === 'review' && globals.baahRequireReview !== false);
  }

  function row(key, label, description = '', select = false) {
    const id = `${prefix}-${key}`;
    return `<div class="project-settings-row" data-setting-row="${key}"><div class="project-settings-label"><label for="${id}">${label}</label>${description ? `<p>${description}</p>` : ''}<div class="project-settings-source"><span data-source="${key}" id="${id}-source"></span><button type="button" class="project-settings-reset" data-reset="${key}" data-testid="project-settings-reset-${key}" aria-label="Reset ${label.toLowerCase()} to inherited value" hidden>Reset</button></div></div>${select ? `<select id="${id}" data-setting="${key}" data-testid="project-settings-${key}" aria-describedby="${id}-source"><option value="USER_SCRIPT">User world</option><option value="MAIN">Main world</option></select>` : `<input type="checkbox" role="switch" class="project-settings-switch" id="${id}" data-setting="${key}" data-testid="project-settings-${key}" aria-describedby="${id}-source">`}</div>`;
  }

  function renderPanel() {
    container.querySelectorAll('[role="tab"]').forEach((tab) => {
      const current = tab.dataset.category === selected;
      tab.setAttribute('aria-selected', String(current));
      tab.tabIndex = current ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', `${prefix}-tab-${selected}`);
    const enabledLabel = selected === 'styles' ? 'Apply styles' : selected === 'triggers' ? 'Run triggers automatically' : 'Enable functions';
    panel.innerHTML = `${selected === 'functions' ? row('mode', 'Default execution mode', '', true) : ''}
      <details data-section="access" ${state().open.access ? 'open' : ''}><summary><span>Access</span><span class="project-settings-summary" data-summary="access"></span></summary><div class="project-settings-section">
        ${row('enabled', enabledLabel)}
        ${selected === 'styles' ? '' : row('userWorld', 'Enable in user world') + row('mainWorld', 'Enable in main world')}
        ${row('restrictUrls', 'Only allow on specific URLs')}
        <div class="project-settings-urls" hidden><label for="${prefix}-urlPatterns">Allowed URLs</label><textarea id="${prefix}-urlPatterns" data-setting="urlPatterns" data-testid="project-settings-urlPatterns" rows="4" spellcheck="false" placeholder="https://*.example.com/*" aria-describedby="${prefix}-url-help"></textarea><p id="${prefix}-url-help">One glob or /regular expression/ per line. An empty list blocks every URL.</p><div class="project-settings-source"><span data-source="urlPatterns"></span><button type="button" class="project-settings-reset" data-reset="urlPatterns" data-testid="project-settings-reset-urlPatterns" aria-label="Reset allowed URLs to inherited value" hidden>Reset</button></div></div>
      </div></details>
      <details data-section="updates" ${state().open.updates ? 'open' : ''}><summary><span>Updates</span><span class="project-settings-summary" data-summary="updates"></span></summary><div class="project-settings-section">
        ${row('poll', 'Check for changes')}${row('review', 'Require review')}${row('lock', 'Lock synced updates', 'Keep installed resources and reject incoming additions, edits, and deletions.')}
      </div></details>`;
    panel.querySelectorAll('details').forEach((details) => {
      const currentState = state();
      details.addEventListener('toggle', () => { currentState.open[details.dataset.section] = details.open; });
    });
    refresh();
  }

  function refresh() {
    panel.querySelectorAll('[data-setting]').forEach((control) => {
      const key = control.dataset.setting;
      if (control.type === 'checkbox') control.checked = value(key);
      else if (control.value !== value(key)) control.value = value(key);
      control.disabled = blocked(key);
    });
    panel.querySelectorAll('[data-source]').forEach((source) => {
      const key = source.dataset.source;
      if (key === 'mainWorld' && !mainAllowed()) {
        source.innerHTML = `Disabled globally · <a href="settings.html#main-world-${selected}" target="_blank" rel="noopener">Open global setting</a>`;
      } else if (key === 'review' && globals.baahRequireReview !== false) {
        source.textContent = 'Required globally';
      } else {
        source.textContent = Object.hasOwn(state().values, key) ? 'Customized for this project' : ['poll', 'review'].includes(key) ? 'Using global setting' : 'Using built-in default';
      }
      const reset = panel.querySelector(`[data-reset="${key}"]`);
      if (reset) reset.hidden = blocked(key) || !Object.hasOwn(state().values, key);
    });
    const mode = panel.querySelector('[data-setting="mode"]');
    if (mode) {
      mode.querySelector('[value="USER_SCRIPT"]').disabled = !value('userWorld');
      mode.querySelector('[value="MAIN"]').disabled = !value('mainWorld');
      const conflict = !value('enabled') || (value('mode') === 'MAIN' ? !value('mainWorld') : !value('userWorld'));
      if (conflict) panel.querySelector('[data-source="mode"]').textContent = 'This mode is blocked by the access settings.';
    }
    panel.querySelector('.project-settings-urls').hidden = !value('restrictUrls');
    const worlds = [value('userWorld') && 'User world', value('mainWorld') && 'Main world'].filter(Boolean).join(' + ') || 'No execution worlds';
    const patterns = value('urlPatterns').split('\n').filter((line) => line.trim()).length;
    const urls = value('restrictUrls') ? patterns ? `${patterns} URL ${patterns === 1 ? 'pattern' : 'patterns'}` : 'All URLs blocked' : 'All permitted URLs';
    panel.querySelector('[data-summary="access"]').textContent = `${value('enabled') ? selected === 'triggers' ? 'Automatic execution on' : 'Enabled' : 'Disabled'}${selected === 'styles' ? '' : ` · ${worlds}`} · ${urls}`;
    panel.querySelector('[data-summary="updates"]').textContent = value('lock') ? 'Synced updates locked' : `${value('poll') ? 'Checking for changes' : 'Checking paused'} · ${value('review') ? 'Review required' : 'Review off'}`;
  }

  container.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.category) { selected = target.dataset.category; view.category = selected; renderPanel(); }
    if (target.dataset.reset) {
      const control = panel.querySelector(`[data-setting="${target.dataset.reset}"]`);
      delete state().values[target.dataset.reset];
      refresh();
      control?.focus();
    }
  });
  container.querySelector('[role="tablist"]').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = categories.indexOf(selected);
    selected = event.key === 'Home' ? categories[0] : event.key === 'End' ? categories.at(-1) : categories[(index + (event.key === 'ArrowRight' ? 1 : 2)) % categories.length];
    view.category = selected;
    renderPanel();
    container.querySelector(`[data-category="${selected}"]`).focus();
  });
  panel.addEventListener('input', (event) => {
    const control = event.target.closest('[data-setting]');
    if (!control || control.disabled) return;
    state().values[control.dataset.setting] = control.type === 'checkbox' ? control.checked : control.value;
    refresh();
  });
  renderPanel();
  mounted.set(container, (nextGlobals) => {
    globals = { ...globals, ...nextGlobals };
    refresh();
  });
}
