import { escapeHtml } from '../workspace/html.js';
import { getProjectSettings, evaluateProjectAccess } from '../../shared/projectPolicy.js';
import { mountTerminalPreview } from '../shared/terminalPreview.js';

const themeName = (theme) => theme ? `${theme.project || 'default'} / ${theme.name || 'Untitled style'}` : 'Built-in default';
const allowed = (theme, settings) => !theme || evaluateProjectAccess({ settings, project: theme.project, category: 'styles' }).allowed;

export function createTerminalThemePicker() {
  let root;
  let themes = [];
  let projects = {};
  let prompt = '>';
  let expanded = false;
  let query = '';
  let previewId = null;
  let saving = false;
  let loaded = false;
  let loadError = '';
  let notice = '';
  let readId = 0;

  const current = () => themes.find((theme) => theme.selected);
  const preview = () => themes.find((theme) => theme.id === previewId);
  const matches = () => themes.filter((theme) => themeName(theme).toLowerCase().includes(query.trim().toLowerCase()));

  function renderOptions() {
    const list = root.querySelector('[data-theme-list]');
    if (!list) return;
    const filtered = matches().sort((a, b) => themeName(a).localeCompare(themeName(b)));
    const groups = new Map();
    for (const theme of filtered) {
      const project = theme.project || 'default';
      if (!groups.has(project)) groups.set(project, []);
      groups.get(project).push(theme);
    }
    list.innerHTML = `<option value="" ${previewId === '' ? 'selected' : ''}>Built-in default${!current() ? ' · Current' : ''}</option>` +
      [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([project, styles]) => `<optgroup label="${escapeHtml(project)}">${styles.map((theme) =>
        `<option value="${escapeHtml(theme.id)}" ${previewId === theme.id ? 'selected' : ''}>${escapeHtml(theme.name || 'Untitled style')}${theme.selected ? ' · Current' : ''}${allowed(theme, projects) ? '' : ' · Disabled'}</option>`
      ).join('')}</optgroup>`).join('');
    list.value = previewId ?? '';
    root.querySelector('[data-theme-count]').textContent = query.trim() && !filtered.length ? 'No matching styles.' : `${filtered.length} ${filtered.length === 1 ? 'style' : 'styles'}`;
  }

  function render() {
    if (!root?.isConnected) return;
    const selected = current();
    const chosen = preview();
    const isCurrent = (selected?.id || '') === previewId;
    const disabled = !allowed(chosen, projects);
    root.innerHTML = `<div class="terminal-theme-heading">
      <div class="settings-control-copy"><h3 class="section-title">Theme</h3>
        <p class="section-description"><span>${escapeHtml(loaded ? themeName(selected) : 'Loading…')}</span>${selected && !allowed(selected, projects) ? ' (disabled; using built-in default)' : ''}</p>
      </div>
      <button type="button" class="link-button" data-theme-action="toggle" aria-expanded="${expanded}" aria-controls="terminal-theme-browser">${expanded ? 'Hide preview' : 'Preview'} <span aria-hidden="true">${expanded ? '▴' : '▾'}</span></button>
    </div>
    ${loadError ? `<p class="terminal-theme-notice" role="status">${escapeHtml(loadError)} <button type="button" class="link-button" data-theme-action="retry">Retry</button></p>` : ''}
    <div id="terminal-theme-browser" ${expanded ? '' : 'hidden'}>${expanded ? `
      <div class="terminal-theme-browser">
        <div class="terminal-theme-choices">
          <label class="hint" for="terminal-theme-search">Search styles</label>
          <input id="terminal-theme-search" class="text-input" type="search" value="${escapeHtml(query)}" placeholder="Name or project" data-theme-search ${saving ? 'disabled' : ''} />
          <select class="terminal-theme-list" size="7" data-theme-list aria-label="Preview theme" ${saving || !loaded ? 'disabled' : ''}></select>
          <p class="hint" data-theme-count></p>
        </div>
        <div class="terminal-theme-sample">
          <div class="terminal-theme-preview-heading"><p class="hint">Preview</p>${isCurrent ? '<span class="terminal-theme-current">Current theme</span>' : ''}</div>
          <div data-theme-preview></div>
          <div class="terminal-theme-footer"><button type="button" class="terminal-theme-apply" data-theme-action="apply" ${saving || !loaded || loadError || disabled || isCurrent ? 'disabled' : ''}>${saving ? 'Setting theme…' : 'Set theme'}</button></div>
          ${disabled ? `<p class="terminal-theme-notice">Styles are disabled for project ${escapeHtml(chosen.project || 'default')}. This style can only be previewed.</p>` : ''}
          ${notice ? `<p class="terminal-theme-notice" role="status">${escapeHtml(notice)}</p>` : ''}
        </div>
      </div>` : ''}</div>`;
    if (expanded) {
      renderOptions();
      mountTerminalPreview(root.querySelector('[data-theme-preview]'), { css: chosen?.css || '', prompt, name: themeName(chosen) });
    }
  }

  async function refresh() {
    const read = ++readId;
    try {
      const values = await Promise.all([getShellThemes(), getProjectSettings(), getShellPrompt()]);
      if (read !== readId) return;
      [themes, projects, prompt] = values;
      loaded = true;
      loadError = '';
      if (previewId === null || (previewId && !themes.some((theme) => theme.id === previewId))) previewId = current()?.id || '';
    } catch {
      if (read !== readId) return;
      loadError = 'Unable to load terminal themes. Your current theme is unchanged.';
    }
    render();
  }

  async function apply() {
    if (saving) return;
    const id = previewId;
    saving = true;
    notice = '';
    render();
    try {
      const [latest, settings] = await Promise.all([getShellThemes(), getProjectSettings()]);
      const chosen = latest.find((theme) => theme.id === id);
      if (id && !chosen) throw new Error('This style is no longer available. Choose another theme.');
      if (!allowed(chosen, settings)) throw new Error('Styles are disabled for this project. Enable them in project settings first.');
      await storeShellThemes(latest.map((theme) => ({ ...theme, selected: theme.id === id })));
      await refresh();
    } catch (error) {
      notice = `${error.message || 'Unable to set the theme.'} Your current theme is unchanged. Try again.`;
    } finally {
      saving = false;
      render();
    }
  }

  function mount(container) {
    root = document.createElement('div');
    root.className = 'settings-block terminal-theme-settings';
    container.replaceChildren(root);
    root.addEventListener('click', (event) => {
      const action = event.target.closest('[data-theme-action]')?.dataset.themeAction;
      if (action === 'toggle') { expanded = !expanded; render(); }
      if (action === 'retry') void refresh();
      if (action === 'apply' && event.isTrusted) void apply();
    });
    root.addEventListener('input', (event) => {
      if (event.target.matches('[data-theme-search]')) {
        query = event.target.value;
        renderOptions();
      }
    });
    root.addEventListener('change', (event) => {
      if (event.target.matches('[data-theme-list]')) {
        const scrollTop = event.target.scrollTop;
        previewId = event.target.value;
        notice = '';
        render();
        const list = root.querySelector('[data-theme-list]');
        list.focus({ preventScroll: true });
        list.scrollTop = scrollTop;
      }
    });
    render();
    void refresh();
  }

  return { mount, refresh };
}
