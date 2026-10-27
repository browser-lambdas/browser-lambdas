import { escapeHtml } from './html.js';
import { settingSource } from '../shared/settingSource.js';

const categories = ['functions', 'triggers', 'styles'];
const mounted = new WeakMap();

export function updateProjectSettingsGlobals(globals) {
  document.querySelectorAll('[data-project-settings]').forEach((container) => mounted.get(container)?.(globals));
}

export function mountProjectSettings(container, { project, view, settings, globals = {}, onChange, onRetry, error }) {
  const projectName = String(project || 'default');
  let selected = categories.includes(view.category) ? view.category : 'functions';
  const prefix = container.dataset.projectSettings;
  container.setAttribute('aria-label', `Project settings for ${projectName}`);
  container.innerHTML = `<header class="project-settings-header"><h2>Project settings</h2><p class="project-settings-name">${escapeHtml(projectName)}</p></header>
    ${error ? `<p class="form-error" role="alert">${escapeHtml(error)} <button type="button" class="security-project-link" data-retry-save>Retry</button></p>` : ''}
    <div class="project-settings-tabs" role="tablist" aria-label="Project resource settings">${categories.map((name) => `<button type="button" role="tab" id="${prefix}-tab-${name}" aria-controls="${prefix}-panel" data-category="${name}">${name[0].toUpperCase() + name.slice(1)}</button>`).join('')}</div>
    <div id="${prefix}-panel" class="project-settings-panel" role="tabpanel"></div>`;
  const panel = container.querySelector('.project-settings-panel');

  function state() {
    settings[selected] ||= {};
    return { values: settings[selected] };
  }

  function defaults() {
    return {
      mode: 'USER_SCRIPT', enabled: true, userWorld: true, mainWorld: mainAllowed(),
      restrictUrls: false, urlPatterns: '', poll: globals.baahPollChanges !== false,
      review: globals.baahRequireReview !== false, lock: false
    };
  }

  function mainAllowed() {
    return globals.allowMainWorldFunctions === true;
  }

  function globalSettingLink(key) {
    const section = { mainWorld: 'main-world-functions', poll: 'baah-poll', review: 'baah-review' }[key];
    return section ? `<a href="settings.html#${section}" target="_blank" rel="noopener">global settings</a>` : '';
  }

  function value(key) {
    if (blocked(key)) return defaults()[key];
    return state().values[key] ?? defaults()[key];
  }

  function blocked(key) {
    return ((key === 'mainWorld' && !mainAllowed()) || (key === 'review' && globals.baahRequireReview !== false) || (key === 'poll' && globals.baahPollChanges === false));
  }

  function row(key, label, description = '', select = false) {
    const id = `${prefix}-${key}`;
    return `<div class="project-settings-row" data-setting-row="${key}"><div class="project-settings-label"><label for="${id}">${label}</label>${description ? `<p>${description}</p>` : ''}<div class="project-settings-source"><span data-source="${key}" id="${id}-source"></span></div></div>${select ? `<select id="${id}" data-setting="${key}" data-testid="project-settings-${key}" aria-describedby="${id}-source"><option value="USER_SCRIPT">User world</option><option value="MAIN">Main world</option></select>` : `<input type="checkbox" role="switch" class="project-settings-switch" id="${id}" data-setting="${key}" data-testid="project-settings-${key}" aria-describedby="${id}-source">`}</div>`;
  }

  function renderPanel() {
    container.querySelectorAll('[role="tab"]').forEach((tab) => {
      const current = tab.dataset.category === selected;
      tab.setAttribute('aria-selected', String(current));
      tab.tabIndex = current ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', `${prefix}-tab-${selected}`);
    const enabledLabel = selected === 'styles' ? 'Enable styles in this project' : 'Enable automatic trigger execution in this project';
    const enabledDescription = selected === 'styles' ? 'Allow styles in this project to be applied to the terminal.' : 'Allow triggers in this project to run automatically when their URL patterns match.';
    panel.innerHTML = `${selected === 'functions' ? row('mode', 'Default execution world', 'Select the world functions in this project use by default.', true) : ''}
      <section class="project-settings-group" aria-labelledby="${prefix}-execution"><h3 id="${prefix}-execution">Execution</h3><div class="project-settings-section">
        ${selected === 'functions' ? '' : row('enabled', enabledLabel, enabledDescription)}
        ${selected === 'functions' ? row('userWorld', 'Enable function execution in user world', 'Allow functions in this project to run in a JavaScript context isolated from the target page’s own JavaScript. This barrier helps protect storage items and secrets from page scripts.') + row('mainWorld', 'Enable function execution in main world', 'Allow functions in this project to run in the target page’s own JavaScript context. This carries additional risk because page scripts can interfere with execution and access exposed data.') : ''}
        ${selected === 'styles' ? '' : `${row('restrictUrls', 'Only allow execution on specific URLs', `Filter which paths ${selected} in this project can run on.`)}
        <div class="project-settings-urls" hidden><label for="${prefix}-urlPatterns">Allowed URLs</label><textarea id="${prefix}-urlPatterns" data-setting="urlPatterns" data-testid="project-settings-urlPatterns" rows="4" spellcheck="false" placeholder="https://*.example.com/*" aria-describedby="${prefix}-url-help"></textarea><p id="${prefix}-url-help">One glob or /regular expression/ per line. An empty list blocks execution on all URLs.</p><div class="project-settings-source"><span data-source="urlPatterns"></span></div></div>
        `}
      </div></section>
      <section class="project-settings-group" aria-labelledby="${prefix}-updates"><h3 id="${prefix}-updates">Updates</h3><div class="project-settings-section">
        ${row('poll', 'Poll for updates', `Sync ${selected} in this project with updates pushed using baah push.`)}${row('review', 'Require review', 'Review updates pushed with baah push before applying them.')}${row('lock', 'Lock synced updates', 'Keep installed resources and reject incoming additions, edits, and deletions.')}
      </div></section>`;
    refresh();
  }

  function refresh() {
    panel.querySelectorAll('[data-setting]').forEach((control) => {
      const key = control.dataset.setting;
      control.dataset.paneId = prefix;
      control.dataset.projectField = key;
      if (control.type === 'checkbox') control.checked = value(key);
      else if (control.value !== value(key)) control.value = value(key);
      control.disabled = blocked(key);
    });
    panel.querySelectorAll('[data-source]').forEach((source) => {
      const key = source.dataset.source;
      const link = globalSettingLink(key);
      source.innerHTML = settingSource({ value: value(key),
        controlled: blocked(key) ? link : '',
        warning: key === 'mainWorld' && blocked(key) ? `Main world execution is disabled in ${link}`
          : key === 'review' && blocked(key) ? `Required by ${link}`
          : key === 'poll' && blocked(key) ? `Polling is disabled by ${link}` : '' });
      source.parentElement.hidden = !source.innerHTML;
    });
    const mode = panel.querySelector('[data-setting="mode"]');
    if (mode) {
      const worlds = [['USER_SCRIPT', 'User world', value('userWorld')], ['MAIN', 'Main world', value('mainWorld')]];
      const enabled = worlds.some(([, , allowed]) => allowed);
      mode.innerHTML = enabled ? worlds.map(([world, label, allowed]) => `<option value="${world}" ${allowed ? '' : 'disabled'}>${label}${!allowed && value('mode') === world ? ' (disabled)' : ''}</option>`).join('')
        : '<option value="" selected disabled>Disabled</option>';
      if (enabled) mode.value = value('mode');
      mode.disabled = !enabled;
      mode.title = enabled ? '' : 'No execution worlds enabled';
    }
    const urls = panel.querySelector('.project-settings-urls');
    if (urls) urls.hidden = !value('restrictUrls');
  }

  container.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.hasAttribute('data-retry-save')) onRetry?.();
    if (target.dataset.category) { selected = target.dataset.category; view.category = selected; renderPanel(); }
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
    onChange();
    refresh();
  });
  renderPanel();
  if (view.setting) {
    const control = panel.querySelector(`[data-setting="${view.setting}"]`);
    control?.scrollIntoView({ block: 'center' });
    control?.focus();
    delete view.setting;
  }
  mounted.set(container, (nextGlobals) => {
    globals = { ...globals, ...nextGlobals };
    refresh();
  });
}
