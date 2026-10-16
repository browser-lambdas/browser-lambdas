import { escapeHtml } from './html.js';

// Preview drafts are separate from records so Save cannot grant apparent protection.
const drafts = new Map();

function getDraft(key) {
  if (!drafts.has(key)) drafts.set(key, { projectsEnabled: false, functionsEnabled: false, projects: '', functions: '' });
  return drafts.get(key);
}

function summary(draft) {
  if (!draft.projectsEnabled && !draft.functionsEnabled) return 'Available to all projects and functions';
  if ((draft.projectsEnabled && !draft.projects.trim()) || (draft.functionsEnabled && !draft.functions.trim())) return 'Empty allowlist · would block every caller';
  return `Restricted to listed ${draft.projectsEnabled && draft.functionsEnabled ? 'projects and functions' : draft.projectsEnabled ? 'projects' : 'functions'}`;
}

function body(draft) {
  const field = (kind, label, placeholder) => `<label class="access-toggle-row"><span>Only allow specific ${label}</span><input type="checkbox" role="switch" aria-label="Only allow specific ${label}" class="access-switch" data-caller-field="${kind}Enabled" ${draft[`${kind}Enabled`] ? 'checked' : ''}></label>${draft[`${kind}Enabled`] ? `<label class="form-field"><span class="security-help">One exact ${kind === 'projects' ? 'project name' : 'project/function name'} per line. An empty list would block every caller.</span><textarea class="form-textarea" rows="3" aria-label="Allowed ${label}" data-caller-field="${kind}" spellcheck="false" placeholder="${placeholder}">${escapeHtml(draft[kind])}</textarea></label>` : ''}`;
  return `<p class="security-help">UI preview. These restrictions are not applied; drafts clear when you reload.</p>${field('projects', 'projects', 'invoices')}${field('functions', 'functions', 'invoices/read-total')}${draft.projectsEnabled && draft.functionsEnabled ? '<p class="security-help">Access would need to match both lists.</p>' : ''}${draft.projectsEnabled || draft.functionsEnabled || draft.projects || draft.functions ? '<button type="button" class="caller-preview-reset" data-caller-reset>Reset preview</button>' : ''}`;
}

export function renderCallerRestrictions(type, id) {
  const key = `${type}:${id}`;
  const draft = getDraft(key);
  return `<details class="caller-preview" data-caller-key="${escapeHtml(key)}"><summary>Caller restrictions <span class="caller-preview-badge">Preview</span></summary><p class="caller-preview-description">${summary(draft)}</p><div class="caller-preview-body">${body(draft)}</div></details>`;
}

export function handleCallerPreviewEvent(event) {
  const control = event.target.closest('[data-caller-field], [data-caller-reset]');
  if (!control) return false;
  const container = control.closest('[data-caller-key]');
  const key = container.dataset.callerKey;
  if (control.hasAttribute('data-caller-reset')) {
    if (event.type !== 'click') return true;
    drafts.delete(key);
  } else {
    const draft = getDraft(key);
    if (control.type === 'checkbox') {
      if (event.type !== 'change') return true;
      draft[control.dataset.callerField] = control.checked;
    } else {
      if (event.type !== 'input') return true;
      draft[control.dataset.callerField] = control.value;
      container.querySelector('.caller-preview-description').textContent = summary(draft);
      return true;
    }
  }
  const draft = getDraft(key);
  container.querySelector('.caller-preview-description').textContent = summary(draft);
  container.querySelector('.caller-preview-body').innerHTML = body(draft);
  container.querySelector(`[data-caller-field="${control.dataset.callerField || 'projectsEnabled'}"]`)?.focus();
  return true;
}
