import { escapeHtml } from './html.js';
import { findPane } from './paneTree.js';

const names = (item, key) => Array.isArray(item[key]) ? item[key].join('\n') : '';
const empty = (item, key) => !names(item, key).trim();

function summary(item) {
  if (!item.projectsEnabled && !item.functionsEnabled) return 'Available to all projects and functions';
  if ((item.projectsEnabled && empty(item, 'allowedProjects')) || (item.functionsEnabled && empty(item, 'allowedFunctions'))) return 'Empty allowlist · no callers allowed';
  return `Restricted to listed ${item.projectsEnabled && item.functionsEnabled ? 'projects and functions' : item.projectsEnabled ? 'projects' : 'functions'}`;
}

function body(item) {
  const field = (enabledKey, listKey, label, placeholder) => `<label class="access-toggle-row"><span>Only allow specific ${label}</span><input type="checkbox" role="switch" aria-label="Only allow specific ${label}" class="access-switch" data-caller-field="${enabledKey}" ${item[enabledKey] ? 'checked' : ''}></label>${item[enabledKey] ? `<label class="form-field"><span class="security-help">One exact ${listKey === 'allowedProjects' ? 'project name' : 'project/function name'} per line. An empty list blocks every caller.</span><textarea class="form-textarea" rows="3" aria-label="Allowed ${label}" data-caller-field="${listKey}" spellcheck="false" placeholder="${placeholder}">${escapeHtml(names(item, listKey))}</textarea></label>` : ''}`;
  return `${field('projectsEnabled', 'allowedProjects', 'projects', 'project-name')}${field('functionsEnabled', 'allowedFunctions', 'functions', 'project-name/function-name')}${item.projectsEnabled && item.functionsEnabled ? '<p class="security-help">Access must match both lists.</p>' : ''}${item.projectsEnabled || item.functionsEnabled || names(item, 'allowedProjects') || names(item, 'allowedFunctions') ? '<button type="button" class="caller-restrictions-reset" data-caller-reset>Clear restrictions</button>' : ''}`;
}

export function renderCallerRestrictions(node) {
  const item = node.pane.editable;
  return `<details class="caller-restrictions" data-caller-pane="${node.id}"><summary>Caller restrictions</summary><p class="caller-restrictions-description">${summary(item)}</p><div class="caller-restrictions-body">${body(item)}</div></details>`;
}

export function handleCallerRestrictionsEvent(event, root) {
  const control = event.target.closest('[data-caller-field], [data-caller-reset]');
  if (!control) return false;
  const container = control.closest('[data-caller-pane]');
  const node = findPane(root, container.dataset.callerPane);
  if (!node) return true;
  const item = node.pane.editable;
  if (control.hasAttribute('data-caller-reset')) {
    if (event.type !== 'click') return true;
    Object.assign(item, { projectsEnabled: false, functionsEnabled: false, allowedProjects: [], allowedFunctions: [] });
  } else if (control.type === 'checkbox') {
    if (event.type !== 'change') return true;
    item[control.dataset.callerField] = control.checked;
  } else {
    if (event.type !== 'input') return true;
    item[control.dataset.callerField] = control.value.split('\n');
  }
  node.pane.changed = true;
  node.pane.error = '';
  container.querySelector('.caller-restrictions-description').textContent = summary(item);
  if (control.type === 'textarea') return true;
  container.querySelector('.caller-restrictions-body').innerHTML = body(item);
  container.querySelector(`[data-caller-field="${control.dataset.callerField || 'projectsEnabled'}"]`)?.focus();
  return true;
}
