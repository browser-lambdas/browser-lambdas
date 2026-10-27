import { contains, countPanes, findPane, splitNode, removeNode, normalizeSizes } from './paneTree.js';
import { escapeHtml } from './html.js';
import { codeLineNumbers, highlightJavaScript, syncCodeHighlight, syncLineNumbers } from './codeEditor.js';
import { renderReviewPanel } from './reviewView.js';
import { applyPendingItemToCollections, assertPendingBatchAllowed } from './pendingUpdates.js';
import { DEFAULT_STYLE_CSS } from './defaultStyle.js';
import { newLambda as makeLambda, newStorageItem as makeStorage, newSecret as makeSecret, newTrigger as makeTrigger, newStyle as makeStyle } from '../../shared/records.js';
import * as accessPolicy from '../../shared/accessPolicy.js';
import { sameStorageRecord } from '../../shared/storageRecords.js';
import { functionUsageExample } from '../../shared/functionUsage.js';
import { mountProjectSettings, updateProjectSettingsGlobals } from './projectSettings.js';
import { renderCallerRestrictions, handleCallerRestrictionsEvent } from './callerRestrictions.js';
import { PROJECT_SETTINGS_KEY, getProjectSettings, normalizeProjectSettings, getProjectCategorySettings } from '../../shared/projectPolicy.js';
import { settingSource } from '../shared/settingSource.js';
import { mountTerminalPreview } from '../shared/terminalPreview.js';

const VALID_TABS = ['functions', 'storage', 'triggers', 'secrets', 'styles', 'activity'];
const PANE_TYPE_BY_TAB = {
  functions: 'lambda',
  storage: 'storage',
  triggers: 'trigger',
  secrets: 'secret',
  styles: 'style',
  activity: 'activity'
};

const SECTION_META = {
  functions: { title: 'Functions', addLabel: 'add new function', search: 'search functions' },
  storage: { title: 'K-V', addLabel: 'add new storage', search: 'search storage' },
  triggers: { title: 'Triggers', addLabel: 'add new trigger', search: 'search triggers' },
  secrets: { title: 'Secrets', addLabel: 'add new secret', search: 'search secrets' },
  styles: { title: 'Styles', addLabel: 'add new style', search: 'search styles' },
  activity: { title: 'Activity logs', addLabel: '', search: '' }
};

const app = document.getElementById('app');
let cleanupBaahSync = null;
let categoryHoverTimer = null;
let stylePreviewTimer = null;

const state = {
  tab: 'functions',
  lambdas: [],
  storageItems: [],
  triggers: [],
  secrets: [],
  styles: [],
  shellPrompt: '>',
  activityLogs: [],
  openTabs: [],
  activityLevels: new Set(['debug', 'error', 'info']),
  root: null,
  activeId: '',
  paneCount: 0,
  search: '',
  sidebarCollapsed: false,
  sidebarWidth: 260,
  revealedSecretPanes: new Set(),
  projectDeleteConfirmation: null,
  pendingBatches: [],
  projectSettings: {},
  baahPollChanges: true,
  baahRequireReview: true,
  allowMainWorldSecrets: false,
  allowMainWorldStorage: false,
  allowMainWorldFunctions: false,
  sidebarRename: null,
  notice: ''
};

const clone = (value) => JSON.parse(JSON.stringify(value));

async function refreshOpenTabs(removedTabId = null) {
  const tabs = await chrome.tabs.query({});
  state.openTabs = tabs.filter((tab) => tab.id !== removedTabId && !/^(chrome|moz)-extension:/.test(tab.url || ''));
}

function currentTabFromHash() {
  const tab = location.hash.slice(1);
  if (VALID_TABS.includes(tab)) return tab;
  location.hash = 'functions';
  return 'functions';
}

function getItems(tab = state.tab) {
  if (tab === 'functions') return state.lambdas;
  if (tab === 'storage') return state.storageItems;
  if (tab === 'triggers') return state.triggers;
  if (tab === 'secrets') return state.secrets;
  if (tab === 'styles') return state.styles;
  if (tab === 'activity') return [{ id: 'activity-all', tabId: null, uri: '', label: 'All' }, ...state.openTabs.map((tab) => ({ id: `activity-tab-${tab.id}`, tabId: tab.id, uri: tab.url || '', favicon: tab.favIconUrl || '', label: tab.title || tab.url || `Tab ${tab.id}` }))];
  return [];
}

function tabForType(type) {
  if (type === 'lambda') return 'functions';
  if (type === 'storage') return 'storage';
  if (type === 'trigger') return 'triggers';
  if (type === 'style') return 'styles';
  if (type === 'activity') return 'activity';
  return 'secrets';
}

function setItems(type, items) {
  if (type === 'lambda') state.lambdas = items;
  if (type === 'storage') state.storageItems = items;
  if (type === 'trigger') state.triggers = items;
  if (type === 'secret') state.secrets = items;
  if (type === 'style') state.styles = items;
}

async function persistType(type) {
  if (type === 'lambda') await storeLambdas(state.lambdas);
  if (type === 'storage') throw new Error('Use per-item storage mutations.');
  if (type === 'trigger') await storeTriggers(state.triggers);
  if (type === 'secret') await storeSecrets(state.secrets);
  if (type === 'style') await storeShellThemes(state.styles);
}

function itemLabel(item, tab = state.tab) {
  if (tab === 'functions') return item.name || 'untitled-function';
  if (tab === 'storage') return item.key || 'untitled-key';
  if (tab === 'triggers') return item.name || 'untitled-trigger';
  if (tab === 'styles') return item.name || 'untitled-style';
  if (tab === 'activity') return item.label || 'All';
  return item.key || 'untitled-secret';
}

function draftAccessPolicy(type, item) {
  if (type === 'trigger') return {};
  return type === 'storage' ? accessPolicy.normalizeStoragePolicy(item) : accessPolicy.normalizeAccessPolicy(item);
}

function createPane(type, item) {
  return {
    type: 'pane',
    id: `pane-${state.paneCount++}`,
    pane: { type, item, expandedEditor: ['lambda', 'storage', 'secret', 'trigger', 'style'].includes(type), editable: type === 'storage' ? accessPolicy.normalizeStorageItem(clone(item)) : ['lambda', 'trigger'].includes(type) ? { ...clone(item), ...draftAccessPolicy(type, item) } : clone(item), changed: false }
  };
}

function shouldShowActivePaneChrome(node) {
  return node.id === state.activeId && countPanes(state.root) > 1;
}

function openItem(type, item) {
  const next = createPane(type, item);
  if (!state.root) {
    state.root = next;
    state.activeId = next.id;
    render();
    return;
  }
  const active = findPane(state.root, state.activeId);
  if (active) {
    state.revealedSecretPanes.delete(active.id);
    active.pane = next.pane;
  } else {
    state.root = { type: 'group', direction: 'horizontal', sizes: [50, 50], children: [state.root, next] };
    state.activeId = next.id;
  }
  render();
}

function splitItem(type, item, direction) {
  const next = createPane(type, item);
  if (!state.root) state.root = next;
  else state.root = splitNode(state.root, state.activeId, direction, next);
  state.activeId = next.id;
  render();
}

function closePane(id) {
  state.revealedSecretPanes.delete(id);
  state.root = removeNode(state.root, id);
  if (state.activeId === id) state.activeId = '';
  render();
}

function syncPanes(node, type, updated) {
  if (!node) return;
  if (node.type === 'pane') {
    if (node.pane.type === type && node.pane.item.id === updated.id) {
      if (type === 'style' && node.pane.changed && !sameStorageRecord(node.pane.editable, updated)) {
        node.pane.item = { ...node.pane.item, selected: updated.selected };
        node.pane.editable.selected = updated.selected;
        return;
      }
      if (['lambda', 'trigger', 'project-settings'].includes(type) && node.pane.changed && !sameStorageRecord(node.pane.editable, updated)) return;
      node.pane.item = updated;
      node.pane.editable = ['lambda', 'trigger'].includes(type) ? { ...clone(updated), ...draftAccessPolicy(type, updated) } : clone(updated);
      node.pane.changed = false;
    }
    return;
  }
  node.children.forEach((child) => syncPanes(child, type, updated));
}

async function autosaveProjectSettings(pane) {
  if (pane.saving) return;
  pane.saving = true;
  while (pane.changed) {
    const submitted = clone(pane.editable);
    try {
      const result = await chrome.runtime.sendMessage({ type: 'WORKSPACE_PROJECT_SETTINGS_UPDATE', project: submitted.project, settings: submitted.settings, expected: pane.item.settings });
      if (!result?.success) throw new Error(result?.error || 'Project settings could not be saved.');
      state.projectSettings = { ...state.projectSettings, [submitted.project]: result.settings };
      pane.item = { ...submitted, settings: result.settings };
      pane.changed = !sameStorageRecord(pane.editable.settings, submitted.settings);
      pane.error = '';
    } catch (error) {
      if (!sameStorageRecord(pane.editable.settings, submitted.settings)) continue;
      pane.error = error.message || 'Project settings could not be saved. Please try again.';
      break;
    }
  }
  pane.saving = false;
  renderPreservingFocus();
}

async function savePane(id) {
  const node = findPane(state.root, id);
  if (!node) return;
  const { type, editable } = node.pane;
  if (type === 'project-settings') return autosaveProjectSettings(node.pane);
  let items = getItems(tabForType(type));
  if (['storage', 'secret', 'lambda', 'trigger'].includes(type)) {
    try { accessPolicy.validateAccessPolicy(type === 'trigger' ? { ...editable, urlPatterns: editable.patterns, urlAllowlistEnabled: true } : editable); }
    catch { node.pane.error = 'Check the allowed page patterns and caller name lists.'; render(); return; }
    node.pane.error = '';
  }
  if (type === 'storage') {
    const submitted = clone(editable);
    const result = await saveStorageMutation('update', submitted, node.pane.item, node);
    if (!result) return;
    node.pane.item = result.item;
    // Keep edits made while the background was saving the submitted draft.
    node.pane.changed = !sameStorageRecord(node.pane.editable, submitted);
    if (!node.pane.changed) node.pane.editable = clone(result.item);
    node.pane.externalChange = false;
    await refreshStorage();
    return;
  }
  if (type === 'trigger') {
    items = await getTriggers();
    const current = items.find((item) => item.id === node.pane.item.id);
    if (!current || !sameStorageRecord(current, node.pane.item)) {
      node.pane.error = 'This trigger changed elsewhere. Reopen it before saving.';
      render();
      return;
    }
  }
  if (type === 'secret') {
    items = await getSecrets();
    const current = items.find((item) => item.id === node.pane.item.id);
    if (!current || !sameStorageRecord(current, node.pane.item)) {
      node.pane.error = 'This secret changed elsewhere. Reopen it before saving.';
      render();
      return;
    }
    Object.assign(editable, accessPolicy.normalizeCallerRestrictions(editable));
  }
  if (type === 'lambda') {
    // CLI pushes may update code while this permission draft is open.
    items = await getLambdas();
    const current = items.find((item) => item.id === node.pane.item.id);
    if (!current || !sameStorageRecord(current, node.pane.item)) {
      node.pane.error = 'This function changed elsewhere. Reopen it before saving.';
      render();
      return;
    }
    const normalizedName = String(editable.name || '').trim();
    const project = editable.project || 'default';
    const duplicate = normalizedName && items.some((item) =>
      item.id !== editable.id &&
      String(item.name || '').trim() === normalizedName &&
      (item.project || 'default') === project
    );
    if (duplicate) {
      state.notice = `A function named "${normalizedName}" already exists in this project.`;
      render();
      return;
    }
  }
  state.notice = '';
  const nextItems = items.map((item) => {
    if (item.id !== editable.id) return type === 'style' && editable.selected ? { ...item, selected: false } : item;
    return clone(editable);
  });
  setItems(type, nextItems);
  await persistType(type);
  node.pane.changed = false;
  syncPanes(state.root, type, clone(editable));
  render();
}

async function saveStorageMutation(operation, item, expected, node) {
  try {
    const result = await mutateStorageItem(operation, item, expected);
    if (!result?.success) throw new Error(result?.error || 'Storage could not be saved.');
    if (node) node.pane.error = '';
    state.notice = '';
    return result;
  } catch (error) {
    if (node) node.pane.error = error.message;
    else state.notice = error.message;
    render();
    return null;
  }
}

async function refreshStorage() {
  try {
    state.storageItems = await getStorageItems();
    const visit = (node) => {
      if (!node) return;
      if (node.type !== 'pane') { node.children.forEach(visit); return; }
      if (node.pane.type !== 'storage') return;
      const current = state.storageItems.find((item) => item.id === node.pane.item.id);
      if (node.pane.changed || !current) {
        node.pane.externalChange = !current || !sameStorageRecord(current, node.pane.item);
      } else {
        node.pane.item = current;
        node.pane.editable = accessPolicy.normalizeStorageItem(clone(current));
        node.pane.externalChange = false;
      }
    };
    visit(state.root);
    renderPreservingFocus();
  } catch { state.notice = 'Storage could not be loaded. Existing data was preserved.'; renderPreservingFocus(); }
}

function renderPreservingFocus() {
  const active = document.activeElement;
  const paneId = active?.dataset.paneId;
  const field = active?.dataset.field;
  const action = active?.dataset.action;
  const world = active?.dataset.world;
  const operation = active?.dataset.operation;
  const projectField = active?.dataset.projectField;
  const start = active?.selectionStart;
  const end = active?.selectionEnd;
  const expanded = [...app.querySelectorAll('.access-controls details[open]')].map((el) => el.closest('.pane-content').dataset.paneId);
  const scroll = [...app.querySelectorAll('.pane-content')].map((el) => [el.dataset.paneId, el.scrollTop]);
  render();
  for (const id of expanded) {
    const details = app.querySelector(`.pane-content[data-pane-id="${id}"] .access-controls details`);
    if (details) details.open = true;
  }
  const next = [...app.querySelectorAll('input, textarea, button, select')].find((el) =>
    el.dataset.paneId === paneId && el.dataset.field === field && el.dataset.action === action && el.dataset.world === world && el.dataset.operation === operation && el.dataset.projectField === projectField);
  if (next && active !== document.body) {
    next.focus({ preventScroll: true });
    if (typeof start === 'number' && next.setSelectionRange) next.setSelectionRange(start, end);
  }
  for (const [id, top] of scroll) app.querySelector(`.pane-content[data-pane-id="${id}"]`)?.scrollTo(0, top);
}

async function setDefaultStyle(id, select) {
  const node = findPane(state.root, id);
  if (!node || node.pane.type !== 'style' || node.pane.savingTheme) return;
  const draft = clone(node.pane.editable);
  node.pane.savingTheme = true;
  node.pane.error = '';
  renderPreservingFocus();
  try {
    const styles = await getShellThemes();
    const current = styles.find((style) => style.id === draft.id);
    if (!current) throw new Error('This style is no longer available. Reopen it from the sidebar.');
    if (!sameStorageRecord({ ...current, selected: false }, { ...node.pane.item, selected: false })) {
      throw new Error('This style changed elsewhere. Your edit is kept; reopen it before setting the theme.');
    }
    const shouldSelect = select ?? !current.selected;
    if (shouldSelect && !getProjectCategorySettings(await getProjectSettings(), draft.project, 'styles').enabled) {
      throw new Error('Styles are disabled for this project. Enable them in project settings before setting this theme.');
    }
    const nextStyle = { ...draft, selected: shouldSelect };
    const nextStyles = styles.map((style) => style.id === draft.id ? nextStyle : { ...style, selected: false });
    await storeShellThemes(nextStyles);
    state.styles = nextStyles;
    if (sameStorageRecord(node.pane.editable, draft)) node.pane.changed = false;
    nextStyles.forEach((style) => syncPanes(state.root, 'style', style));
  } catch (error) {
    node.pane.error = error.message || 'The theme could not be set. Your edit is kept; try again.';
  } finally {
    node.pane.savingTheme = false;
  }
  render();
}

async function deletePane(id) {
  const node = findPane(state.root, id);
  if (!node) return;
  const { type, item } = node.pane;
  if (type === 'storage') {
    if (!await saveStorageMutation('delete', null, item, node)) return;
    closePane(id);
    await refreshStorage();
    return;
  }
  setItems(type, getItems(tabForType(type)).filter((candidate) => candidate.id !== item.id));
  await persistType(type);
  closePane(id);
}

async function addItem() {
  const tab = state.tab;
  const type = PANE_TYPE_BY_TAB[tab];
  const item = tab === 'functions' ? makeLambda('', '') : tab === 'storage' ? makeStorage('', '') : tab === 'triggers' ? makeTrigger('', [], []) : tab === 'styles' ? makeStyle('New Theme', DEFAULT_STYLE_CSS) : makeSecret('', '');
  if (type === 'storage') {
    const result = await saveStorageMutation('create', item);
    if (!result) return;
    await refreshStorage();
    openItem(type, result.item);
    return;
  }
  setItems(type, [...getItems(tab), item]);
  await persistType(type);
  openItem(type, item);
}

function updateEditable(id, field, value) {
  const node = findPane(state.root, id);
  if (!node) return;
  if (field === 'patterns' || field === 'commands' || field === 'urlPatterns') {
    node.pane.editable[field] = value.split('\n').map((line) => line.trim()).filter(Boolean);
  } else {
    node.pane.editable[field] = value;
  }
  node.pane.changed = true;
}

function itemUsageExample(type, item) {
  const key = JSON.stringify(item.key ?? '');
  return type === 'storage'
    ? `# get value\nconst value = await ctx.kv.get(${key});\n\n# set value\nawait ctx.kv.set(${key}, "new value");`
    : `const secret = await ctx.secrets.get(${key});`;
}

function displayStorageValue(value) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';
}

function accessToggle(node, label, action, checked, attributes = '', disabled = false) {
  return `<label class="access-toggle-row ${disabled ? 'disabled' : ''}"><span>${label}</span><input class="access-switch" type="checkbox" role="switch" data-action="${action}" data-pane-id="${node.id}" ${attributes} ${checked && !disabled ? 'checked' : ''} ${disabled ? 'disabled' : ''}></label>`;
}

function projectSettingLink(item, category, setting) {
  return `<button class="security-project-link" type="button" data-action="project-settings" data-project="${escapeHtml(item.project || 'default')}" data-project-category="${category}" data-project-setting="${setting}">project settings</button>`;
}

function renderAccessControls(node) {
  const { type, editable } = node.pane;
  if (type === 'trigger') {
    const project = getProjectCategorySettings(state.projectSettings, editable.project, 'triggers', state);
    return `<section class="access-controls" data-testid="trigger-security"><h3>Automatic execution</h3>
      ${accessToggle(node, 'Run automatically', 'trigger-enabled', project.enabled && editable.enabled !== false, '', !project.enabled)}
      ${settingSource({ value: project.enabled && editable.enabled !== false, explicit: Object.hasOwn(editable, 'enabled'),
        from: !project.enabled ? projectSettingLink(editable, 'triggers', 'enabled') : '',
        controlled: !project.enabled ? projectSettingLink(editable, 'triggers', 'enabled') : '' })}
      <p class="security-help">Function permissions apply to every command. See ${projectSettingLink(editable, 'triggers', 'enabled')}.</p>
    </section>`;
  }
  const [setting, category] = { storage: ['allowMainWorldStorage', 'storage'], secret: ['allowMainWorldSecrets', 'secret'], lambda: ['allowMainWorldFunctions', 'function'] }[type];
  const projectCategory = type === 'lambda' ? 'functions' : null;
  const projectPolicy = projectCategory ? getProjectCategorySettings(state.projectSettings, editable.project, projectCategory, state) : null;
  const enabled = projectPolicy ? projectPolicy.enabled && projectPolicy.mainWorld : state[setting];
  const policy = type === 'storage' ? accessPolicy.normalizeStoragePolicy(editable) : accessPolicy.normalizeAccessPolicy(editable);
  const execution = accessPolicy.functionExecutionOptions(editable, enabled);
  if (projectPolicy && (!projectPolicy.enabled || !projectPolicy.userWorld)) execution.worlds = execution.worlds.filter((world) => world !== 'USER_SCRIPT');
  const inheritedWorld = projectPolicy?.mode || 'USER_SCRIPT';
  const selectedWorld = editable.world || inheritedWorld;
  return `<section class="access-controls" data-testid="${category}-security"><h3>Security</h3>
    ${accessToggle(node, type === 'storage' ? 'Enable in user world' : 'Allow execution in user world', 'access-world', policy.allowedWorlds.includes('user_scripts'), 'data-world="user_scripts"', projectPolicy && (!projectPolicy.enabled || !projectPolicy.userWorld))}
    ${projectPolicy && !projectPolicy.userWorld ? settingSource({ value: false, controlled: projectSettingLink(editable, 'functions', 'userWorld') }) : ''}
    ${accessToggle(node, type === 'storage' ? 'Enable in main world' : 'Allow execution in main world', 'access-world', policy.allowedWorlds.includes('main'), 'data-world="main"', !enabled)}
    ${!enabled ? settingSource({ value: false, controlled: !projectPolicy || !state[setting] ? `<a href="./settings.html#main-world-${tabForType(type)}" target="_blank" rel="noopener">global settings</a>` : projectSettingLink(editable, 'functions', 'mainWorld') }) : ''}
    <p class="security-help">Main-world access is dangerous: page scripts can interfere with execution and access exposed data. See <a href="./settings.html#main-world-${tabForType(type)}" target="_blank" rel="noopener">global settings</a>.</p>
    ${projectPolicy ? `<p class="security-help">Project access rules also apply. See ${projectSettingLink(editable, 'functions', 'userWorld')}.</p>` : ''}
    ${type === 'lambda' ? `<label class="access-select-row" for="world-${node.id}"><span>Default execution world:</span><select id="world-${node.id}" data-testid="pane-world" data-pane-id="${node.id}" data-field="world" ${execution.worlds.length ? '' : 'disabled title="No execution worlds enabled"'}>
      ${execution.worlds.length ? `<option value="" ${!editable.world ? 'selected' : ''}>Use project default (${inheritedWorld === 'MAIN' ? 'Main world' : 'User world'}${execution.worlds.includes(inheritedWorld) ? '' : ', disabled'})</option>${[['USER_SCRIPT', 'User world'], ['MAIN', 'Main world']].map(([value, label]) => `<option value="${value}" ${editable.world === value ? 'selected' : ''} ${execution.worlds.includes(value) ? '' : 'disabled'}>${label}${value === selectedWorld && !execution.worlds.includes(value) ? ' (disabled)' : ''}</option>`).join('')}` : '<option value="" selected disabled>Disabled</option>'}
      </select></label>${execution.worlds.length ? settingSource({ value: selectedWorld, explicit: Boolean(editable.world), from: projectSettingLink(editable, 'functions', 'mode') }) : ''}` : ''}
      ${accessToggle(node, type === 'lambda' ? 'Only allow execution on specific URLs' : 'Only allow on specific URLs', 'access-allowlist', policy.urlAllowlistEnabled, `data-testid="${category}-url-allowlist"`)}
      <label class="form-field url-allowlist-area ${policy.urlAllowlistEnabled ? '' : 'muted'}"><span class="security-help">One glob or /regular expression/ per line. ${policy.urlAllowlistEnabled ? type === 'lambda' ? 'An empty list blocks execution on all URLs.' : 'An empty allowlist blocks access on every page.' : 'URL filtering is off. Saved patterns are kept for later.'}</span><textarea class="form-textarea security-patterns" aria-label="URL allowlist patterns" rows="8" wrap="off" data-pane-id="${node.id}" data-field="urlPatterns" data-testid="${category}-url-patterns" spellcheck="false" placeholder="https://*.example.com/*" ${policy.urlAllowlistEnabled ? '' : 'disabled'}>${escapeHtml(policy.urlPatterns.join('\n'))}</textarea></label>
    ${['storage', 'secret'].includes(type) ? renderCallerRestrictions(node) : ''}
  </section>`;
}

function itemSettingsTitle(node) {
  if (node.pane.expandedEditor) return '';
  return `<h2 class="item-settings-title" data-testid="item-settings-title">${lucideIcon(APP_CATEGORY_ICONS[tabForType(node.pane.type)])}<span>Settings</span></h2>`;
}

function renderKeyValueForm(node) {
  const { type, editable } = node.pane;
  const isSecret = type === 'secret';
  const isHidden = !state.revealedSecretPanes.has(node.id);
  const value = isSecret ? editable.value : displayStorageValue(editable.value);
  return `<div class="form-pane ${type}-form">
    ${itemSettingsTitle(node)}
    ${node.pane.error ? `<p class="form-error" role="alert">${escapeHtml(node.pane.error)}</p>` : ''}
    ${node.pane.externalChange ? '<p class="form-error" role="status">This item changed elsewhere. Your draft is preserved. Reopen it from the sidebar to load the latest value.</p>' : ''}
    <label class="form-field"><span class="form-label-row"><span>Key</span>${isSecret ? copyButton('key', 'key', node.id) : ''}</span><input data-pane-id="${node.id}" data-field="key" value="${escapeHtml(editable.key ?? '')}" data-testid="pane-key" /></label>
    ${isSecret ? `<label class="form-field form-field-fill"><span class="form-label-row"><span>Value</span><span class="form-label-actions">${copyButton('value', 'value', node.id)}<button class="form-reveal" type="button" data-action="toggle-secret-value" data-pane-id="${node.id}" aria-pressed="${!isHidden}">${isHidden ? 'Show' : 'Hide'}</button></span></span><textarea aria-label="Value" rows="8" wrap="off" class="form-textarea secret-value ${isHidden ? 'secret-value-hidden' : ''}" data-pane-id="${node.id}" data-field="value" data-testid="pane-value" spellcheck="false">${escapeHtml(value)}</textarea></label>` : `<div class="form-field form-field-fill expandable-field"><div class="code-shell storage-code-box"><div class="line-numbers" aria-hidden="true">${codeLineNumbers(value)}</div><div class="code-editor-stack"><pre class="code-highlight" aria-hidden="true">${highlightJavaScript(value)}</pre><textarea aria-label="Value" class="code-editor storage-value" data-pane-id="${node.id}" data-field="value" data-testid="pane-value" spellcheck="false">${escapeHtml(value)}</textarea></div></div></div>`}
    ${!isSecret && typeof editable.value !== 'string' ? '<p class="security-help">This value was stored as JSON data. Editing the Value field saves it as text; changing access controls preserves its type.</p>' : ''}
    <label class="form-field"><span class="form-label-row usage-label">How to use</span><textarea class="form-textarea usage-example" data-usage-for="${node.id}" readonly rows="${isSecret ? 1 : 5}" wrap="off">${escapeHtml(itemUsageExample(type, editable))}</textarea></label>
    ${renderAccessControls(node)}
  </div>`;
}

function paneSettingsButton(node) {
  const label = node.pane.expandedEditor ? 'Show settings' : 'Hide settings';
  return `<button type="button" class="icon-button" data-testid="pane-settings" data-action="toggle-editor-size" data-pane-id="${node.id}" aria-label="${label}" title="${label}" aria-pressed="${!node.pane.expandedEditor}">${lucideIcon('settings')}</button>`;
}

function copyButton(field, label, paneId) {
  return `<button class="form-copy" type="button" data-action="copy-field" data-pane-id="${paneId}" data-field="${field}" title="Copy ${label}" aria-label="Copy ${label}">${lucideIcon('clipboard')}</button>`;
}

function projectName(item) {
  return item.project || 'Local';
}

function groupItemsByProject(items) {
  const groups = new Map();
  for (const item of items) {
    const project = projectName(item);
    if (!groups.has(project)) groups.set(project, []);
    groups.get(project).push(item);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function syncBaahPolling() {
  const enabled = state.baahPollChanges;
  if (enabled && !cleanupBaahSync && typeof initBaahSync === 'function') {
    cleanupBaahSync = initBaahSync();
  }
  if (!enabled && cleanupBaahSync) {
    cleanupBaahSync();
    cleanupBaahSync = null;
  }
}

function renderSidebar() {
  if (state.sidebarCollapsed) return `<aside class="workspace-list collapsed"><button class="collapse-rail" data-action="expand-sidebar" title="Expand sidebar">›</button></aside>`;
  const tab = state.tab;
  const width = Math.max(260, Math.min(window.innerWidth - 220, state.sidebarWidth));
  const meta = SECTION_META[tab];
  if (tab === 'activity') {
    const all = { id: 'activity-all', tabId: null, uri: '', label: 'All' };
    const tabs = getItems(tab).slice(1);
    return `<aside class="workspace-list ${state.root ? 'has-pane' : ''}" style="--sidebar-width:${width}px">
      <div class="activity-sidebar-title"><h2>Activity logs</h2><button class="icon-button" data-action="collapse-sidebar" title="Collapse sidebar">${lucideIcon('panelRight')}</button></div>
      <div class="item-list activity-sidebar"><h3>All</h3>${renderItemButton(all, tab)}<h3>Tabs</h3>${tabs.length ? tabs.map((item) => renderItemButton(item, tab)).join('') : '<p class="activity-empty">No open tabs</p>'}</div>
      <div class="sidebar-resizer" data-action="drag-sidebar" aria-label="Resize sidebar"></div>
    </aside>`;
  }
  const search = tab === state.tab ? state.search : '';
  const query = search.toLowerCase();
  const items = getItems(tab).filter((item) => itemLabel(item, tab).toLowerCase().includes(query));
  return `<aside class="workspace-list ${state.root ? 'has-pane' : ''}" style="--sidebar-width:${width}px">
    <div class="list-header">
      <button class="add-button" data-action="add-item" data-testid="sidebar-${tab}-add"><span>+</span> ${meta.addLabel}</button>
      <button class="icon-button" data-action="collapse-sidebar" title="Collapse sidebar">${lucideIcon('panelRight')}</button>
    </div>
    <div class="search-wrap"><input class="search" type="search" value="${escapeHtml(search)}" placeholder="${meta.search}" data-action="search" /></div>
    <div class="item-list">
      ${renderSidebarItems(items, tab)}
    </div>
    <div class="sidebar-resizer" data-action="drag-sidebar" aria-label="Resize sidebar"></div>
  </aside>`;
}

function latestPendingBatch() {
  return state.pendingBatches[0] || null;
}

function reviewItems() {
  const batch = latestPendingBatch();
  return batch ? [{ id: `review-${batch.id}`, name: 'Review', project: batch.project || 'default', batchId: batch.id, batch, _review: true }] : [];
}

function reviewItem() {
  return reviewItems()[0] || null;
}

function ensureReviewPaneOpen() {
  const review = reviewItem();
  if (!review || state.root) return;
  openItem('review', review);
}

function pendingKeyForItem(item, tab = state.tab) {
  if (item._review) return '';
  const type = PANE_TYPE_BY_TAB[tab];
  if (type === 'lambda') return `lambda:${item.project || 'default'}:${item.name}`;
  if (type === 'trigger') return `trigger:${item.project || 'default'}:${item.name}`;
  if (type === 'style') return `style:${item.project || 'default'}:${item.name}`;
  return '';
}

function pendingLockedKeys() {
  const keys = new Set();
  for (const batch of state.pendingBatches) {
    for (const item of batch.items || []) {
      if ((item.type === 'lambda' || item.type === 'trigger' || item.type === 'style') && item.action !== 'unchanged') keys.add(`${item.type}:${item.project || batch.project || 'default'}:${item.name}`);
    }
  }
  return keys;
}

function pendingChangeForPane(type, item) {
  const pendingType = type === 'lambda' ? 'lambda' : type === 'trigger' ? 'trigger' : type === 'style' ? 'style' : '';
  if (!pendingType || !item) return null;
  const project = item.project || 'default';
  return state.pendingBatches
    .flatMap((batch) => batch.items || [])
    .find((pending) => pending.type === pendingType && pending.action !== 'unchanged' && pending.name === item.name && (pending.project || 'default') === project) || null;
}

function renderLockedBanner(node) {
  const pending = pendingChangeForPane(node.pane.type, node.pane.item);
  if (!pending) return '';
  return `<div class="locked-file-banner"><span>🔒 File changed since last approval.</span><button type="button" class="pending-button" data-action="open-pending-review">View diff</button></div>`;
}

function renderItemButton(item, tab = state.tab) {
  const locked = !item._review && pendingLockedKeys().has(pendingKeyForItem(item, tab));
  const label = item._review ? 'Review' : itemLabel(item, tab);
  const prefix = item._review ? '🔎 ' : locked ? '🔒 ' : tab === 'styles' && item.selected ? '★ ' : '';
  const favicon = tab === 'activity' && item.tabId != null && item.favicon
    ? `<img class="activity-favicon" src="${escapeHtml(item.favicon)}" alt="" />`
    : '';
  return `<div class="item-button ${state.sidebarRename?.item.id === item.id ? 'renaming' : ''} ${item._review ? 'review-item' : ''} ${locked ? 'pending-locked' : ''}" data-action="open-item" data-id="${item.id}" data-testid="sidebar-${tab}-item" role="button" tabindex="0">
        ${favicon}
        ${state.sidebarRename?.item.id === item.id && state.sidebarRename.tab === tab ? `<span class="sidebar-rename"><input data-action="rename-input" aria-label="New name" value="${escapeHtml(state.sidebarRename.value)}" ${state.sidebarRename.saving ? 'disabled' : ''} /><button class="mini-button" data-action="save-rename" aria-label="Save name">✓</button><button class="mini-button" data-action="cancel-rename" aria-label="Cancel rename">×</button>${state.sidebarRename.error ? `<span class="form-error" role="alert">${escapeHtml(state.sidebarRename.error)}</span>` : ''}</span>` : `<span class="item-label">${prefix}${escapeHtml(label)}</span>`}
        ${item._review ? '' : `<span class="split-actions">
          ${tab === 'activity' ? '' : `<button class="mini-button" data-action="rename-item" data-id="${item.id}" title="Rename" aria-label="Rename"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6Z M14 5l5 5" /></svg></button>`}
          <button class="mini-button" data-action="split-item" data-id="${item.id}" data-dir="horizontal" title="Split right" aria-label="Split right">${lucideIcon('splitHorizontal')}</button>
          <button class="mini-button" data-action="split-item" data-id="${item.id}" data-dir="vertical" title="Split down" aria-label="Split down">${lucideIcon('splitVertical')}</button>
        </span>`}
      </div>`;
}

async function renameSidebarItem() {
  const draft = state.sidebarRename;
  if (!draft || draft.saving) return;
  const field = ['storage', 'secrets'].includes(draft.tab) ? 'key' : 'name';
  const value = draft.value.trim();
  try {
    if (!value) throw new Error('Enter a name.');
    draft.saving = true;
    const type = PANE_TYPE_BY_TAB[draft.tab];
    const items = await ({ functions: getLambdas, storage: getStorageItems, secrets: getSecrets, triggers: getTriggers, styles: getShellThemes })[draft.tab]();
    const current = items.find((item) => item.id === draft.item.id);
    if (!current || !sameStorageRecord(current, draft.item)) throw new Error('This item changed elsewhere. Cancel and try again.');
    if (items.some((item) => item.id !== current.id && String(item[field] || '').trim() === value && (field === 'key' || (item.project || 'default') === (current.project || 'default')))) throw new Error('An item with this name already exists.');
    const updated = { ...current, [field]: value };
    if (type === 'storage') {
      const result = await mutateStorageItem('update', updated, current);
      if (!result?.success) throw new Error(result?.error || 'Storage could not be saved.');
      Object.assign(updated, result.item);
    } else {
      await ({ functions: storeLambdas, secrets: storeSecrets, triggers: storeTriggers, styles: storeShellThemes })[draft.tab](items.map((item) => item.id === current.id ? updated : item));
    }
    setItems(type, items.map((item) => item.id === current.id ? updated : item));
    const visit = (node) => {
      if (!node) return;
      if (node.type !== 'pane') { node.children.forEach(visit); return; }
      if (node.pane.type !== type || node.pane.item.id !== updated.id || !sameStorageRecord(node.pane.item, current)) return;
      if (node.pane.editable[field] === current[field]) node.pane.editable[field] = value;
      node.pane.item = clone(updated);
    };
    visit(state.root);
    state.sidebarRename = null;
    state.notice = '';
  } catch (error) {
    draft.saving = false;
    draft.error = error.message;
  }
  render();
}

function renderProjectHeader(project, canDelete = true, projectKey = project) {
  const pending = state.projectDeleteConfirmation?.project === project;
  if (pending) {
    return `<div class="project-confirm"><div class="project-confirm-title">Delete ${escapeHtml(project)}?</div><input class="project-confirm-input" data-action="project-confirm-input" data-project="${escapeHtml(project)}" value="${escapeHtml(state.projectDeleteConfirmation.value)}" placeholder="type ${escapeHtml(project)}" aria-label="Type ${escapeHtml(project)} to confirm deletion" /><div class="project-confirm-actions"><button class="project-confirm-button danger" type="button" data-action="confirm-delete-project" data-project="${escapeHtml(project)}" ${state.projectDeleteConfirmation.value === project ? '' : 'disabled'}>Delete</button><button class="project-confirm-button" type="button" data-action="cancel-delete-project">Cancel</button></div></div>`;
  }
  return `<div class="project-title-row"><h3 class="project-title">${escapeHtml(project)}</h3>${canDelete ? `<div class="project-header-actions"><button class="project-settings-button icon-button" type="button" data-action="project-settings" data-project="${escapeHtml(projectKey)}" title="Settings for ${escapeHtml(project)}" aria-label="Settings for ${escapeHtml(project)}">${lucideIcon('settings')}</button><button class="project-delete" type="button" data-action="request-delete-project" data-project="${escapeHtml(project)}" title="Delete project ${escapeHtml(project)}" aria-label="Delete project ${escapeHtml(project)}">×</button></div>` : ''}</div>`;
}

function renderSidebarItems(items, tab) {
  const reviews = reviewItems();
  if (tab !== 'functions' && tab !== 'triggers' && tab !== 'styles') return `${reviews.map((item) => renderItemButton(item, tab)).join('')}${items.map((item) => renderItemButton(item, tab)).join('')}`;
  const groups = new Map(groupItemsByProject(items));
  for (const review of reviews) {
    if (!groups.has(review.project)) groups.set(review.project, []);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([project, projectItems]) => {
      const projectReviews = reviews.filter((review) => review.project === project);
      return `<section class="project-group">${renderProjectHeader(project, true, projectItems[0]?.project || projectReviews[0]?.project || 'default')}${projectReviews.map((item) => renderItemButton(item, tab)).join('')}${projectItems.map((item) => renderItemButton(item, tab)).join('')}</section>`;
    })
    .join('');
}

function filteredActivityLogs(filter) {
  return state.activityLogs.filter((entry) =>
    state.activityLevels.has(entry.level) && (filter.tabId == null || entry.tabId === filter.tabId)
  );
}

function activityLogsAsJsonl(paneId) {
  const pane = findPane(state.root, paneId);
  if (!pane || pane.pane.type !== 'activity') return null;
  return filteredActivityLogs(pane.pane.editable)
    .slice()
    .reverse()
    .map((entry) => JSON.stringify(entry))
    .join('\n');
}

function exportActivityLogs(paneId) {
  const pane = findPane(state.root, paneId);
  const jsonl = activityLogsAsJsonl(paneId);
  if (!pane || jsonl == null) return;
  const url = URL.createObjectURL(new Blob([jsonl ? `${jsonl}\n` : ''], { type: 'application/x-ndjson' }));
  const link = document.createElement('a');
  const scope = pane.pane.editable.tabId == null ? 'all-tabs' : `tab-${pane.pane.editable.tabId}`;
  link.href = url;
  link.download = `activity-${scope}-${new Date().toISOString().replaceAll(':', '-')}.jsonl`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copyActivityLogs(paneId, button) {
  const jsonl = activityLogsAsJsonl(paneId);
  if (jsonl == null) return;
  await navigator.clipboard.writeText(jsonl ? `${jsonl}\n` : '');
  const originalLabel = button.textContent;
  button.textContent = 'Copied!';
  setTimeout(() => {
    if (button.isConnected) button.textContent = originalLabel;
  }, 1500);
}

function editorFor(node) {
  const { type, editable } = node.pane;
  if (type === 'project-settings') return `<div class="project-settings-pane" data-project-settings="${node.id}"></div>`;
  if (type === 'review') return renderReviewPanel(editable.batch);
  if (type === 'activity') {
    const logs = filteredActivityLogs(editable).slice().reverse();
    const toggles = ['debug', 'info', 'error'].map((level) => `<button class="level-filter ${level} ${state.activityLevels.has(level) ? 'active' : ''}" data-action="toggle-log-level" data-level="${level}" aria-pressed="${state.activityLevels.has(level)}">${level}</button>`).join('');
    return `<div class="activity-pane"><div class="activity-toolbar"><span>${logs.length} entries</span><div>${toggles}<button class="activity-export" data-action="export-activity" data-pane-id="${node.id}">Download JSONL</button><button class="activity-export" data-action="copy-activity" data-pane-id="${node.id}">Copy JSONL</button></div></div><div class="activity-table-wrap"><table class="activity-table"><thead><tr><th>Time stamp</th><th>Tab ID</th><th>URI</th><th>MSG</th><th>LEVEL</th></tr></thead><tbody>${logs.map((entry) => `<tr class="level-${escapeHtml(entry.level)}"><td>${escapeHtml(new Date(entry.timestamp).toLocaleString())}</td><td>${escapeHtml(entry.tabId ?? '—')}</td><td title="${escapeHtml(entry.uri)}">${escapeHtml(entry.uri || '—')}</td><td class="activity-message"><details><summary>${escapeHtml(entry.message)}</summary><pre>${escapeHtml(entry.message)}</pre></details></td><td><span class="level-badge ${escapeHtml(entry.level)}">${escapeHtml(entry.level)}</span></td></tr>`).join('') || '<tr><td colspan="5" class="activity-no-logs">No activity logs match this filter.</td></tr>'}</tbody></table></div></div>`;
  }
  if (type === 'lambda') {
    return `${renderLockedBanner(node)}<div class="form-pane function-form">
      ${itemSettingsTitle(node)}
      ${node.pane.error ? `<p class="form-error" role="alert">${escapeHtml(node.pane.error)}</p>` : ''}
      <div class="form-field expandable-field"><div class="code-shell function-code-box"><div class="line-numbers" aria-hidden="true">${codeLineNumbers(editable.func)}</div><div class="code-editor-stack"><pre class="code-highlight" aria-hidden="true">${highlightJavaScript(editable.func)}</pre><textarea id="code-${node.id}" aria-label="Code" class="code-editor" spellcheck="false" data-pane-id="${node.id}" data-field="func" placeholder="Type code here...">${escapeHtml(editable.func)}</textarea></div></div></div>
      <label class="form-field"><span class="form-label-row usage-label">How to use</span><textarea class="form-textarea usage-example" data-function-usage="${node.id}" readonly rows="5" wrap="off">${escapeHtml(functionUsageExample(editable))}</textarea></label>
      ${renderAccessControls(node)}
    </div>`;
  }
  if (type === 'storage' || type === 'secret') return renderKeyValueForm(node);
  if (type === 'style') {
    const enabled = getProjectCategorySettings(state.projectSettings, editable.project, 'styles').enabled;
    const selected = state.styles.some((style) => style.id === editable.id && style.selected);
    return `${renderLockedBanner(node)}<div class="form-pane style-form">
      ${itemSettingsTitle(node)}
      ${node.pane.error ? `<p class="form-error" role="alert">${escapeHtml(node.pane.error)}</p>` : ''}
      <div class="form-field expandable-field"><div class="code-shell style-code-box"><div class="line-numbers" aria-hidden="true">${codeLineNumbers(editable.css)}</div><div class="code-editor-stack"><pre class="code-highlight" aria-hidden="true">${highlightJavaScript(editable.css)}</pre><textarea aria-label="CSS" class="code-editor" spellcheck="false" data-pane-id="${node.id}" data-field="css" placeholder="Type CSS here...">${escapeHtml(editable.css)}</textarea></div></div></div>
      <section class="style-theme-settings" aria-label="Terminal style preview">
        <div class="style-preview-heading"><h3>Preview</h3>${selected ? '<span class="style-current-theme">Current theme</span>' : ''}</div>
        <p class="security-help">Click set theme to enable this globally</p>
        <div data-terminal-preview="${node.id}"></div>
        ${!enabled ? `<p class="security-help">Styles are disabled for this project. Preview is still available. Enable styles in ${projectSettingLink(editable, 'styles', 'enabled')} to use this theme.</p>` : ''}
        <div class="style-theme-actions"><span class="security-help" data-style-theme-note="${node.id}" ${node.pane.changed ? '' : 'hidden'}>${node.pane.changed ? 'Previewing unsaved changes. Setting the theme also saves this style.' : ''}</span><button type="button" class="style-set-theme" data-action="set-style-theme" data-pane-id="${node.id}" ${!enabled || node.pane.savingTheme || (selected && !node.pane.changed) ? 'disabled' : ''}>${node.pane.savingTheme ? 'Setting…' : 'Set theme'}</button></div>
      </section>
    </div>`;
  }
  return `${renderLockedBanner(node)}<div class="form-pane trigger-form">
    ${itemSettingsTitle(node)}
    ${node.pane.error ? `<p class="form-error" role="alert">${escapeHtml(node.pane.error)}</p>` : ''}
    <label class="form-field"><span class="form-label-row"><span>On these paths:</span>${copyButton('patterns', 'patterns', node.id)}</span><textarea class="form-textarea security-patterns" data-pane-id="${node.id}" data-field="patterns" data-testid="trigger-url-patterns" rows="8" wrap="off" spellcheck="false" placeholder="https://*.example.com/*">${escapeHtml(editable.patterns.join('\n'))}</textarea></label>
    <label class="form-field form-field-fill"><span class="form-label-row"><span>Run these commands:</span>${copyButton('commands', 'commands', node.id)}</span><textarea class="form-textarea" data-pane-id="${node.id}" data-field="commands" data-testid="trigger-commands" rows="8" wrap="off" spellcheck="false">${escapeHtml(editable.commands.join('\n'))}</textarea></label>
    ${renderAccessControls(node)}
  </div>`;
}

function paneTitle(node) {
  const { type, editable } = node.pane;
  if (type === 'project-settings') return `<span class="pane-title readonly">${escapeHtml(editable.project)} · Settings</span>`;
  if (type === 'activity') {
    const favicon = editable.tabId != null && editable.favicon
      ? `<img class="activity-favicon" src="${escapeHtml(editable.favicon)}" alt="" />`
      : '';
    return `<span class="pane-title readonly activity-pane-title">${favicon}<span class="item-label">${escapeHtml(itemLabel(editable, 'activity'))}</span></span>`;
  }
  if (type === 'review') return `<span class="pane-title readonly">Review ${escapeHtml(editable.batch?.project || 'baah push')}</span>`;
  if (type === 'lambda') return `<input class="pane-title" data-testid="pane-title" data-pane-id="${node.id}" data-field="name" value="${escapeHtml(editable.name)}" placeholder="untitled-function" />`;
  if (type === 'storage') return `<input class="pane-title" data-pane-id="${node.id}" data-testid="pane-title" data-field="key" aria-label="Name" value="${escapeHtml(editable.key)}" placeholder="untitled-key" />`;
  if (type === 'trigger') return `<input class="pane-title" data-testid="pane-title" data-pane-id="${node.id}" data-field="name" value="${escapeHtml(editable.name)}" placeholder="untitled-trigger" />`;
  if (type === 'style') return `<input class="pane-title" data-testid="pane-title" data-pane-id="${node.id}" data-field="name" value="${escapeHtml(editable.name)}" placeholder="untitled-style" />`;
  return `<input class="pane-title" data-pane-id="${node.id}" data-testid="pane-title" data-field="key" aria-label="Name" value="${escapeHtml(editable.key)}" placeholder="untitled-secret" />`;
}

function renderNode(node, isFirst = false, path = []) {
  if (!node) return '';
  if (node.type === 'group') {
    const sizes = normalizeSizes(node.sizes, node.children.length);
    node.sizes = sizes;
    return `<div class="pane-group ${node.direction}" data-direction="${node.direction}">
      ${node.children.map((child, index) => `<div class="pane-slot" style="flex-basis:${sizes[index]}%">${renderNode(child, isFirst && index === 0, [...path, index])}</div>${index < node.children.length - 1 ? `<div class="splitter ${node.direction}" data-action="drag-splitter" data-path="${path.join('.') }" data-index="${index}"></div>` : ''}`).join('')}
    </div>`;
  }
  const activeChrome = shouldShowActivePaneChrome(node);
  return `<section class="pane-frame ${activeChrome ? 'active' : ''} ${isFirst ? 'first' : ''}" data-action="activate-pane" data-pane-id="${node.id}" data-testid="pane">
    <div class="pane-content ${node.pane.expandedEditor ? (['lambda', 'storage', 'style'].includes(node.pane.type) ? 'editor-maximized' : 'security-hidden') : ''} ${activeChrome ? 'active' : ''}" data-testid="pane-content" data-pane-id="${node.id}" data-pane-type="${node.pane.type}">${editorFor(node)}</div>
    <footer class="pane-footer ${activeChrome ? 'active' : ''}">
      <div class="pane-identity"><span data-testid="pane-category-icon">${lucideIcon(node.pane.type === 'project-settings' ? 'settings' : node.pane.type === 'review' ? 'refreshCw' : APP_CATEGORY_ICONS[tabForType(node.pane.type)])}</span>${paneTitle(node)}</div>
      <div class="pane-actions">
        ${['lambda', 'storage', 'secret', 'trigger', 'style'].includes(node.pane.type) ? paneSettingsButton(node) : ''}
        <button class="icon-button" data-action="split-pane" data-pane-id="${node.id}" data-dir="horizontal" title="Split right" aria-label="Split right">${lucideIcon('splitHorizontal')}</button>
        <button class="icon-button" data-action="split-pane" data-pane-id="${node.id}" data-dir="vertical" title="Split down" aria-label="Split down">${lucideIcon('splitVertical')}</button>
        ${node.pane.type === 'style' ? `<button class="icon-button" data-action="set-default-style" data-pane-id="${node.id}" title="${state.styles.some((style) => style.id === node.pane.editable.id && style.selected) ? 'Unset default terminal style' : 'Set as default terminal style'}" aria-label="${state.styles.some((style) => style.id === node.pane.editable.id && style.selected) ? 'Unset default terminal style' : 'Set as default terminal style'}" ${node.pane.savingTheme ? 'disabled' : ''}>${lucideIcon('star')}</button>` : ''}
        ${['review', 'activity', 'project-settings'].includes(node.pane.type) ? '' : `<button class="icon-button" data-action="save-pane" data-testid="pane-save" data-pane-id="${node.id}" title="Save" aria-label="Save">${lucideIcon('save')}</button><button class="icon-button" data-action="delete-pane" data-testid="pane-delete" data-pane-id="${node.id}" title="Delete" aria-label="Delete">${lucideIcon('trash')}</button>`}
        <button class="icon-button" data-action="close-pane" data-pane-id="${node.id}" title="Close" aria-label="Close">${lucideIcon('x')}</button>
      </div>
    </footer>
  </section>`;
}

function render() {
  clearTimeout(categoryHoverTimer);
  const notice = state.notice ? `<div class="workspace-notice" role="alert">${escapeHtml(state.notice)}</div>` : '';
  app.innerHTML = `<div class="workspace-shell">${renderAppNav({ activeTab: state.tab })}${notice}<main class="workspace-main ${state.root ? 'has-pane' : ''}">${renderSidebar()}<div class="editor-column"><section class="editor-area">${state.root ? renderNode(state.root, true) : '<div class="empty-state">Select or create something from the sidebar.</div>'}</section></div></main></div>`;
  app.querySelectorAll('[data-project-settings]').forEach((container) => {
    const node = findPane(state.root, container.dataset.projectSettings);
    const pane = node.pane;
    pane.settingsView ||= { category: pane.editable.category, setting: pane.editable.setting };
    mountProjectSettings(container, { project: pane.editable.project, view: pane.settingsView, settings: pane.editable.settings, error: pane.error,
      onChange: () => { pane.changed = true; pane.error = ''; void autosaveProjectSettings(pane); },
      onRetry: () => { void autosaveProjectSettings(pane); }, globals: {
      allowMainWorldFunctions: state.allowMainWorldFunctions,
      baahPollChanges: state.baahPollChanges,
      baahRequireReview: state.baahRequireReview
    } });
  });
  refreshStylePreviews();
}

function refreshStylePreviews() {
  clearTimeout(stylePreviewTimer);
  app.querySelectorAll('[data-terminal-preview]').forEach((container) => {
    const node = findPane(state.root, container.dataset.terminalPreview);
    if (!node || node.pane.expandedEditor) return;
    mountTerminalPreview(container, { css: node.pane.editable.css, prompt: state.shellPrompt, name: node.pane.editable.name });
    const selected = state.styles.some((style) => style.id === node.pane.editable.id && style.selected);
    const button = app.querySelector(`[data-action="set-style-theme"][data-pane-id="${node.id}"]`);
    if (button) button.disabled = !getProjectCategorySettings(state.projectSettings, node.pane.editable.project, 'styles').enabled || node.pane.savingTheme || (selected && !node.pane.changed);
    const note = app.querySelector(`[data-style-theme-note="${node.id}"]`);
    if (note) {
      note.textContent = node.pane.changed ? 'Previewing unsaved changes. Setting the theme also saves this style.' : '';
      note.hidden = !node.pane.changed;
    }
  });
}

function selectSidebarCategory(tab, expand = false) {
  clearTimeout(categoryHoverTimer);
  if (!VALID_TABS.includes(tab) || (tab === state.tab && !(expand && state.sidebarCollapsed))) return;
  if (expand) state.sidebarCollapsed = false;
  state.tab = tab;
  state.search = '';
  state.projectDeleteConfirmation = null;
  // Hover commits the category without adding history entries or remounting editors.
  history.replaceState(history.state, '', `#${tab}`);
  app.querySelectorAll('[data-nav-tab]').forEach((link) => {
    link.classList.toggle('active', link.dataset.navTab === tab);
  });
  const sidebar = app.querySelector('.workspace-list');
  if (sidebar) sidebar.outerHTML = renderSidebar();
}

function updateActivePaneClasses() {
  const hasMultiplePanes = countPanes(state.root) > 1;
  app.querySelectorAll('.pane-frame').forEach((pane) => {
    const isActive = hasMultiplePanes && pane.dataset.paneId === state.activeId;
    pane.classList.toggle('active', isActive);
    pane.querySelector('.pane-content')?.classList.toggle('active', isActive);
    pane.querySelector('.pane-footer')?.classList.toggle('active', isActive);
  });
}

function itemById(id) {
  const review = reviewItems().find((candidate) => candidate.id === id);
  if (review) return review;
  return getItems().find((item) => item.id === id);
}

function splitPane(id, direction) {
  const target = findPane(state.root, id);
  if (!target) return;
  const freshItem = clone(target.pane.editable);
  const fresh = createPane(target.pane.type, freshItem);
  if (target.pane.settingsView) fresh.pane.settingsView = clone(target.pane.settingsView);
  if (['storage', 'lambda', 'trigger'].includes(target.pane.type)) fresh.pane = clone(target.pane);
  if (['lambda', 'storage', 'secret', 'trigger'].includes(target.pane.type)) fresh.pane.expandedEditor = true;
  state.root = splitNode(state.root, id, direction, fresh);
  state.activeId = fresh.id;
  render();
}

function isProjectItem(item, project) {
  return projectName(item) === project;
}

function pruneProjectPanes(node, project, type) {
  if (!node) return null;
  if (node.type === 'pane') {
    return node.pane.type === type && isProjectItem(node.pane.item, project) ? null : node;
  }
  const children = node.children.map((child) => pruneProjectPanes(child, project, type)).filter(Boolean);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { ...node, children, sizes: normalizeSizes(node.sizes, children.length) };
}

async function deleteProject(project) {
  const tab = state.tab;
  const type = PANE_TYPE_BY_TAB[tab];
  if (!['lambda', 'trigger', 'style'].includes(type)) return;
  setItems(type, getItems(tab).filter((item) => !isProjectItem(item, project)));
  state.root = pruneProjectPanes(state.root, project, type);
  if (state.activeId && !contains(state.root, state.activeId)) state.activeId = '';
  state.projectDeleteConfirmation = null;
  await persistType(type);
  render();
}

function pruneReviewPanes(node, batchId) {
  if (!node) return null;
  if (node.type === 'pane') return node.pane.type === 'review' && node.pane.editable.batch?.id === batchId ? null : node;
  const children = node.children.map((child) => pruneReviewPanes(child, batchId)).filter(Boolean);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { ...node, children, sizes: normalizeSizes(node.sizes, children.length) };
}

function syncReviewPanes(node) {
  if (!node) return;
  const review = reviewItem();
  if (node.type === 'pane') {
    if (node.pane.type === 'review') {
      if (review) node.pane.editable = clone(review);
      else state.root = pruneReviewPanes(state.root, node.pane.editable.batch?.id);
    }
    return;
  }
  node.children.forEach(syncReviewPanes);
}

async function approvePendingBatch(batchId) {
  const batch = state.pendingBatches.find((candidate) => candidate.id === batchId);
  if (!batch) return;
  try { await assertPendingBatchAllowed(batch); }
  catch (error) { state.notice = error.message; render(); return; }
  const stored = await chrome.storage.local.get(['local_storage_key_lambdas', 'local_storage_key_shellcss', 'local_storage_key_triggers']);
  const lambdas = JSON.parse(stored.local_storage_key_lambdas || '[]');
  const styles = JSON.parse(stored.local_storage_key_shellcss || '[]');
  const triggers = JSON.parse(stored.local_storage_key_triggers || '[]');
  for (const item of batch.items || []) {
    applyPendingItemToCollections(item, lambdas, styles, triggers);
  }
  await chrome.storage.local.set({ local_storage_key_lambdas: JSON.stringify(lambdas), local_storage_key_shellcss: JSON.stringify(styles), local_storage_key_triggers: JSON.stringify(triggers) });
  state.pendingBatches = [];
  state.root = pruneReviewPanes(state.root, batchId);
  if (state.activeId && !contains(state.root, state.activeId)) state.activeId = '';
  await storeBaahPendingBatches(state.pendingBatches);
  state.lambdas = lambdas;
  state.triggers = triggers;
  state.styles = styles;
  lambdas.forEach((lambda) => syncPanes(state.root, 'lambda', lambda));
  triggers.forEach((trigger) => syncPanes(state.root, 'trigger', trigger));
  styles.forEach((style) => syncPanes(state.root, 'style', style));
  render();
}

async function rejectPendingBatch(batchId) {
  state.pendingBatches = [];
  state.root = pruneReviewPanes(state.root, batchId);
  if (state.activeId && !contains(state.root, state.activeId)) state.activeId = '';
  await storeBaahPendingBatches(state.pendingBatches);
  render();
}

function groupAtPath(pathText) {
  let node = state.root;
  if (!pathText) return node?.type === 'group' ? node : null;
  for (const raw of pathText.split('.').filter(Boolean)) {
    if (!node || node.type !== 'group') return null;
    node = node.children[Number(raw)];
  }
  return node?.type === 'group' ? node : null;
}

function startSidebarDrag(event) {
  const start = event.clientX;
  const startWidth = state.sidebarWidth;
  document.body.classList.add('is-resizing');

  const move = (moveEvent) => {
    state.sidebarWidth = Math.max(260, Math.min(window.innerWidth - 220, startWidth + moveEvent.clientX - start));
    const sidebar = app.querySelector('.workspace-list:not(.collapsed)');
    if (sidebar) sidebar.style.setProperty('--sidebar-width', `${state.sidebarWidth}px`);
  };
  const up = () => {
    document.body.classList.remove('is-resizing');
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    render();
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

function startSplitterDrag(splitter, event) {
  const group = groupAtPath(splitter.dataset.path);
  const index = Number(splitter.dataset.index);
  if (!group || !group.children[index + 1]) return;

  const container = splitter.parentElement;
  const rect = container.getBoundingClientRect();
  const direction = group.direction;
  const start = direction === 'horizontal' ? event.clientX : event.clientY;
  const totalPx = direction === 'horizontal' ? rect.width : rect.height;
  const sizes = normalizeSizes(group.sizes, group.children.length);
  const leftStart = sizes[index];
  const rightStart = sizes[index + 1];
  const pairTotal = leftStart + rightStart;

  const move = (moveEvent) => {
    const current = direction === 'horizontal' ? moveEvent.clientX : moveEvent.clientY;
    const deltaPercent = ((current - start) / totalPx) * 100;
    const nextLeft = Math.max(12, Math.min(pairTotal - 12, leftStart + deltaPercent));
    sizes[index] = nextLeft;
    sizes[index + 1] = pairTotal - nextLeft;
    group.sizes = sizes;
    render();
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

app.addEventListener('mousedown', (event) => {
  const sidebarHandle = event.target.closest('[data-action="drag-sidebar"]');
  if (sidebarHandle) {
    event.preventDefault();
    startSidebarDrag(event);
    return;
  }

  const splitter = event.target.closest('[data-action="drag-splitter"]');
  if (!splitter) return;
  event.preventDefault();
  startSplitterDrag(splitter, event);
});

app.addEventListener('mouseover', (event) => {
  const navItem = event.target.closest('[data-nav-tab]');
  if (!navItem || navItem.contains(event.relatedTarget)) return;
  const tab = navItem.dataset.navTab;
  clearTimeout(categoryHoverTimer);
  if (VALID_TABS.includes(tab)) {
    categoryHoverTimer = setTimeout(() => {
      if (navItem.isConnected && navItem.matches(':hover')) selectSidebarCategory(tab);
    }, 200);
  }
});

app.addEventListener('mouseout', (event) => {
  const navItem = event.target.closest('[data-nav-tab]');
  if (navItem && !navItem.contains(event.relatedTarget)) clearTimeout(categoryHoverTimer);
});

app.addEventListener('click', async (event) => {
  if (handleCallerRestrictionsEvent(event, state.root)) return;
  const category = event.target.closest('[data-nav-tab]');
  if (category && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    selectSidebarCategory(category.dataset.navTab, true);
    return;
  }
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'project-settings') {
    try {
      state.projectSettings = await getProjectSettings();
      const project = target.dataset.project;
      const item = { id: project, project, category: target.dataset.projectCategory || state.tab, setting: target.dataset.projectSetting, settings: Object.hasOwn(state.projectSettings, project) ? state.projectSettings[project] : {} };
      if (target.dataset.projectSetting) splitItem('project-settings', item, 'horizontal');
      else openItem('project-settings', item);
    } catch { state.notice = 'Project settings could not be loaded. Existing settings were preserved.'; render(); }
    return;
  }
  if (action === 'rename-item') {
    const item = itemById(target.dataset.id);
    if (item && !item._review && state.tab !== 'activity') {
      state.sidebarRename = { tab: state.tab, item: clone(item), value: String(item[['storage', 'secrets'].includes(state.tab) ? 'key' : 'name'] ?? '') };
      render();
      const input = app.querySelector('[data-action="rename-input"]');
      input?.focus();
      input?.select();
    }
  }
  if (action === 'save-rename') await renameSidebarItem();
  if (action === 'cancel-rename' && !state.sidebarRename?.saving) { state.sidebarRename = null; render(); }
  if (action === 'add-item') await addItem();
  if (action === 'export-activity') exportActivityLogs(target.dataset.paneId);
  if (action === 'copy-activity') await copyActivityLogs(target.dataset.paneId, target);
  if (action === 'toggle-log-level') { state.activityLevels.has(target.dataset.level) ? state.activityLevels.delete(target.dataset.level) : state.activityLevels.add(target.dataset.level); render(); }
  if (action === 'approve-pending-batch') await approvePendingBatch(target.dataset.batchId);
  if (action === 'reject-pending-batch') await rejectPendingBatch(target.dataset.batchId);
  if (action === 'open-pending-review') {
    const review = reviewItem();
    if (review) openItem('review', review);
  }
  if (action === 'collapse-sidebar') { state.sidebarCollapsed = true; render(); }
  if (action === 'expand-sidebar') { state.sidebarCollapsed = false; render(); }
  if (action === 'open-item') {
    const item = itemById(target.dataset.id);
    if (item) {
      target.blur();
      openItem(item._review ? 'review' : PANE_TYPE_BY_TAB[state.tab], item);
    }
  }
  if (action === 'request-delete-project') {
    event.stopPropagation();
    state.projectDeleteConfirmation = { project: target.dataset.project, value: '' };
    render();
    app.querySelector(`[data-action="project-confirm-input"]`)?.focus();
  }
  if (action === 'cancel-delete-project') {
    event.stopPropagation();
    state.projectDeleteConfirmation = null;
    render();
  }
  if (action === 'confirm-delete-project') {
    event.stopPropagation();
    if (state.projectDeleteConfirmation?.value === target.dataset.project) await deleteProject(target.dataset.project);
  }
  if (action === 'split-item') {
    event.stopPropagation();
    const item = itemById(target.dataset.id);
    if (item && !item._review) {
      target.blur();
      splitItem(PANE_TYPE_BY_TAB[state.tab], item, target.dataset.dir);
    }
  }
  if (action === 'copy-field') {
    const paneId = target.dataset.paneId;
    const node = findPane(state.root, paneId);
    const field = target.dataset.field;
    const raw = node?.pane.editable[field];
    const value = field === 'patterns' || field === 'commands' || field === 'urlPatterns' ? (raw || []).join('\n')
      : node?.pane.type === 'storage' && field === 'value' ? displayStorageValue(raw) : (raw ?? '');
    await navigator.clipboard?.writeText(value);
  }
  if (action === 'toggle-editor-size') {
    const node = findPane(state.root, target.dataset.paneId);
    if (node && ['lambda', 'storage', 'secret', 'trigger', 'style'].includes(node.pane.type)) {
      node.pane.expandedEditor = !node.pane.expandedEditor;
      renderPreservingFocus();
    }
  }
  if (action === 'toggle-secret-value') {
    const paneId = target.dataset.paneId;
    if (state.revealedSecretPanes.has(paneId)) state.revealedSecretPanes.delete(paneId);
    else state.revealedSecretPanes.add(paneId);
    render();
  }
  if (action === 'activate-pane') {
    state.activeId = target.dataset.paneId;
    updateActivePaneClasses();
  }
  if (action === 'set-default-style') await setDefaultStyle(target.dataset.paneId);
  if (action === 'set-style-theme') await setDefaultStyle(target.dataset.paneId, true);
  if (action === 'save-pane') await savePane(target.dataset.paneId);
  if (action === 'delete-pane') await deletePane(target.dataset.paneId);
  if (action === 'close-pane') closePane(target.dataset.paneId);
  if (action === 'split-pane') splitPane(target.dataset.paneId, target.dataset.dir);
});

app.addEventListener('keydown', async (event) => {
  if (event.target.dataset.action !== 'rename-input') return;
  if (event.key === 'Enter') { event.preventDefault(); await renameSidebarItem(); }
  if (event.key === 'Escape' && !state.sidebarRename?.saving) { state.sidebarRename = null; render(); }
});

app.addEventListener('error', (event) => {
  if (event.target instanceof HTMLImageElement && event.target.classList.contains('activity-favicon')) {
    event.target.hidden = true;
  }
}, true);

app.addEventListener('input', (event) => {
  if (handleCallerRestrictionsEvent(event, state.root)) return;
  const target = event.target;
  if (target.dataset.action === 'rename-input') { state.sidebarRename.value = target.value; return; }
  if (target.dataset.action === 'search') {
    state.search = target.value;
    render();
    const input = app.querySelector('[data-action="search"]');
    input?.focus();
    input?.setSelectionRange(state.search.length, state.search.length);
    return;
  }
  if (target.dataset.action === 'project-confirm-input') {
    state.projectDeleteConfirmation = { project: target.dataset.project, value: target.value };
    render();
    const input = app.querySelector('[data-action="project-confirm-input"]');
    input?.focus();
    input?.setSelectionRange(target.value.length, target.value.length);
    return;
  }
  if (target.dataset.action === 'access-allowlist') {
    const node = findPane(state.root, target.dataset.paneId);
    if (node && ['lambda', 'storage', 'secret'].includes(node.pane.type)) {
      node.pane.editable.urlAllowlistEnabled = target.checked;
      node.pane.changed = true;
      node.pane.error = '';
      renderPreservingFocus();
    }
    return;
  }
  if (target.dataset.action === 'access-world') {
    const node = findPane(state.root, target.dataset.paneId);
    if (['secret', 'storage', 'lambda'].includes(node?.pane.type)) {
      const worlds = new Set(node.pane.editable.allowedWorlds || []);
      target.checked ? worlds.add(target.dataset.world) : worlds.delete(target.dataset.world);
      node.pane.editable.allowedWorlds = [...worlds];
      node.pane.changed = true;
      renderPreservingFocus();
    }
    return;
  }
  if (target.dataset.action === 'trigger-enabled') {
    const node = findPane(state.root, target.dataset.paneId);
    if (node?.pane.type === 'trigger') {
      node.pane.editable.enabled = target.checked;
      node.pane.changed = true;
      renderPreservingFocus();
    }
    return;
  }
  if (target.dataset.paneId && target.dataset.field) {
    updateEditable(target.dataset.paneId, target.dataset.field, target.value);
    if (['css', 'name'].includes(target.dataset.field) && findPane(state.root, target.dataset.paneId)?.pane.type === 'style') {
      clearTimeout(stylePreviewTimer);
      stylePreviewTimer = setTimeout(refreshStylePreviews, 150);
    }
    if (target.dataset.field === 'world') renderPreservingFocus();
    if (target.dataset.field === 'value' && target.classList.contains('secret-value')) {
      state.revealedSecretPanes.delete(target.dataset.paneId);
      target.classList.add('secret-value-hidden');
      const revealButton = app.querySelector(`[data-action="toggle-secret-value"][data-pane-id="${target.dataset.paneId}"]`);
      if (revealButton) {
        revealButton.textContent = 'Show';
        revealButton.setAttribute('aria-pressed', 'false');
      }
    }
    if (target.classList.contains('code-editor')) syncLineNumbers(target);
    if (['name', 'func'].includes(target.dataset.field)) {
      const node = findPane(state.root, target.dataset.paneId);
      const usage = app.querySelector(`[data-function-usage="${target.dataset.paneId}"]`);
      if (node?.pane.type === 'lambda' && usage) usage.value = functionUsageExample(node.pane.editable);
    }
    if (target.dataset.field === 'key') {
      const node = findPane(state.root, target.dataset.paneId);
      if (['secret', 'storage'].includes(node?.pane.type)) {
        const title = app.querySelector(`.pane-title[data-pane-id="${target.dataset.paneId}"]`);
        const usage = app.querySelector(`[data-usage-for="${target.dataset.paneId}"]`);
        if (title) title.value = target.value;
        const key = app.querySelector(`[data-testid="pane-key"][data-pane-id="${target.dataset.paneId}"]`);
        if (key) key.value = target.value;
        if (usage) usage.value = itemUsageExample(node.pane.type, node.pane.editable);
      }
    }
  }
});

app.addEventListener('change', (event) => handleCallerRestrictionsEvent(event, state.root));

app.addEventListener('scroll', (event) => {
  if (!event.target.classList?.contains('code-editor')) return;
  const gutter = event.target.closest('.code-shell')?.querySelector('.line-numbers');
  if (gutter) gutter.scrollTop = event.target.scrollTop;
  syncCodeHighlight(event.target);
}, true);

window.addEventListener('baah-pending-batches-updated', async () => {
  state.pendingBatches = await getBaahPendingBatches();
  state.activityLogs = (await chrome.storage.local.get('activityLogs')).activityLogs || [];
  await refreshOpenTabs();
  syncReviewPanes(state.root);
  ensureReviewPaneOpen();
  render();
});

window.addEventListener('hashchange', () => {
  clearTimeout(categoryHoverTimer);
  state.tab = currentTabFromHash();
  state.search = '';
  state.sidebarCollapsed = false;
  render();
});

(async () => {
  state.tab = currentTabFromHash();
  state.baahPollChanges = await getBaahPollChanges();
  state.baahRequireReview = await getBaahRequireReview();
  syncBaahPolling();
  state.lambdas = await getLambdas();
  try { state.storageItems = await getStorageItems(); }
  catch { state.notice = 'Storage could not be loaded. Existing data was preserved.'; }
  state.triggers = await getTriggers();
  state.secrets = await getSecrets();
  state.allowMainWorldSecrets = await getAllowMainWorldSecrets();
  state.allowMainWorldStorage = await getAllowMainWorldStorage();
  state.allowMainWorldFunctions = await getAllowMainWorldFunctions();
  state.styles = await getShellThemes();
  state.shellPrompt = await getShellPrompt().catch(() => '>');
  try { state.projectSettings = await getProjectSettings(); }
  catch { state.notice = 'Project settings could not be loaded. Existing settings were preserved.'; }
  state.pendingBatches = await getBaahPendingBatches();
  state.activityLogs = (await chrome.storage.local.get('activityLogs')).activityLogs || [];
  await refreshOpenTabs();
  const requestedActivityTabId = Number(new URLSearchParams(location.search).get('activityTabId'));
  if (state.tab === 'activity' && Number.isInteger(requestedActivityTabId)) {
    const item = getItems('activity').find((candidate) => candidate.tabId === requestedActivityTabId);
    if (item) openItem('activity', item);
  }
  ensureReviewPaneOpen();
  render();
})();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[LOCAL_STORAGE_KEY_SHELL_PROMPT]) {
    state.shellPrompt = normalizeShellPrompt(changes[LOCAL_STORAGE_KEY_SHELL_PROMPT].newValue) ?? '>';
    refreshStylePreviews();
  }
  if (area === 'local' && changes[PROJECT_SETTINGS_KEY]) {
    try {
      state.projectSettings = normalizeProjectSettings(changes[PROJECT_SETTINGS_KEY].newValue ?? {});
      const visit = (node) => {
        if (!node) return;
        if (node.type !== 'pane') { node.children.forEach(visit); return; }
        if (node.pane.type !== 'project-settings' || node.pane.changed) return;
        const project = node.pane.item.project;
        const settings = Object.hasOwn(state.projectSettings, project) ? state.projectSettings[project] : {};
        if (sameStorageRecord(node.pane.item.settings, settings)) return;
        node.pane.item = { ...node.pane.item, settings: clone(settings) };
        node.pane.editable = clone(node.pane.item);
      };
      visit(state.root);
      renderPreservingFocus();
    } catch { state.notice = 'Project settings are invalid. Existing settings were preserved.'; render(); }
  }
  if (area === 'local') {
    const globals = {};
    if (changes[LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_FUNCTIONS]) globals.allowMainWorldFunctions = changes[LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_FUNCTIONS].newValue === true;
    if (changes.local_storage_key_baah_require_review) globals.baahRequireReview = state.baahRequireReview = changes.local_storage_key_baah_require_review.newValue !== false;
    if (changes.local_storage_key_baah_poll_changes) {
      globals.baahPollChanges = state.baahPollChanges = changes.local_storage_key_baah_poll_changes.newValue !== false;
      syncBaahPolling();
    }
    if (Object.keys(globals).length) updateProjectSettingsGlobals(globals);
  }
  if (area === 'local' && changes.activityLogs) { state.activityLogs = changes.activityLogs.newValue || []; if (state.tab === 'activity') render(); }
  if (area === 'local' && changes[LOCAL_STORAGE_KEY_STORAGE] && accessPolicy) void refreshStorage();
  if (area === 'local' && (changes[LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_FUNCTIONS] || changes[LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_SECRETS] || changes[LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_STORAGE])) {
    if (changes[LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_FUNCTIONS]) state.allowMainWorldFunctions = changes[LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_FUNCTIONS].newValue === true;
    if (changes[LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_SECRETS]) state.allowMainWorldSecrets = changes[LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_SECRETS].newValue === true;
    if (changes[LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_STORAGE]) state.allowMainWorldStorage = changes[LOCAL_STORAGE_KEY_ALLOW_MAIN_WORLD_STORAGE].newValue === true;
    if (accessPolicy) renderPreservingFocus();
  }
  if (area === 'local' && (changes.local_storage_key_lambdas || changes.local_storage_key_triggers || changes.local_storage_key_shellcss)) {
    Promise.all([getLambdas(), getTriggers(), getShellThemes()]).then(([lambdas, triggers, styles]) => {
      state.lambdas = lambdas;
      state.triggers = triggers;
      state.styles = styles;
      lambdas.forEach((lambda) => syncPanes(state.root, 'lambda', lambda));
      triggers.forEach((trigger) => syncPanes(state.root, 'trigger', trigger));
      styles.forEach((style) => syncPanes(state.root, 'style', style));
      render();
    });
  }
});
chrome.tabs.onCreated.addListener(async () => { await refreshOpenTabs(); if (state.tab === 'activity') render(); });
chrome.tabs.onRemoved.addListener(async (tabId) => { await refreshOpenTabs(tabId); if (state.tab === 'activity') render(); });
chrome.tabs.onUpdated.addListener(async () => { await refreshOpenTabs(); if (state.tab === 'activity') render(); });

window.addEventListener('beforeunload', () => cleanupBaahSync?.());
