import { escapeHtml } from './html.js';

function pendingSummary(batch) {
  const items = batch?.items || [];
  const changedCount = items.filter((item) => item.action !== 'unchanged').length;
  const unchangedCount = items.length - changedCount;
  return { batchCount: batch ? 1 : 0, itemCount: changedCount, unchangedCount };
}

function pendingText(item, source) {
  if (!source) return '';
  if (item.type === 'lambda') return String(source.func || '');
  if (item.type === 'style') return String(source.css || '');
  return [...(source.patterns || []), ...(source.commands || [])].join('\n');
}

function renderDiff(item) {
  const before = pendingText(item, item.previous).split('\n');
  const after = pendingText(item, item.incoming).split('\n');
  if (item.action === 'create') return after.map((line) => `<span class="diff-added">+ ${escapeHtml(line)}</span>`).join('\n');
  if (item.action === 'delete') return before.map((line) => `<span class="diff-removed">- ${escapeHtml(line)}</span>`).join('\n');
  const rows = [];
  const width = Math.max(before.length, after.length);
  for (let index = 0; index < width; index += 1) {
    const oldLine = before[index];
    const newLine = after[index];
    if (oldLine === newLine) rows.push(`<span class="diff-context">  ${escapeHtml(oldLine || '')}</span>`);
    else {
      if (oldLine !== undefined) rows.push(`<span class="diff-removed">- ${escapeHtml(oldLine)}</span>`);
      if (newLine !== undefined) rows.push(`<span class="diff-added">+ ${escapeHtml(newLine)}</span>`);
    }
  }
  return rows.join('\n');
}

function renderPendingItem(item) {
  const previousHash = item.previous?.hash || 'new';
  const incomingHash = item.incoming?.hash || (item.action === 'delete' ? 'deleted' : 'unknown');
  const displayName = item.type === 'lambda' ? (item.sourcePath || `${item.name}.js`) : item.name;
  const diff = item.previous ? `<pre class="review-diff">${renderDiff(item).split('\n').slice(0, 600).join('\n')}</pre>` : '';
  return `<li class="pending-review-item">
    <div class="pending-review-item-header"><span class="pending-type">${escapeHtml(item.type)}</span><strong>${escapeHtml(item.project ? `${item.project}/` : '')}${escapeHtml(displayName)}</strong><span class="pending-action ${escapeHtml(item.action)}">${escapeHtml(item.action)}</span></div>
    <div class="pending-hashes">${escapeHtml(previousHash)} → ${escapeHtml(incomingHash)}</div>
    ${diff}
  </li>`;
}

function renderUnchangedSummary(items) {
  if (!items.length) return '';
  return `<section class="review-section"><h2>Unchanged files</h2><details class="unchanged-review-summary"><summary>${items.length} unchanged ${items.length === 1 ? 'file' : 'files'}</summary><ol class="pending-review-list compact">${items.map(renderPendingItem).join('')}</ol></details></section>`;
}

export function renderReviewPanel(batch) {
  const { batchCount, itemCount, unchangedCount } = pendingSummary(batch);
  if (!batch) return '<div class="empty-state">No pending baah pushes.</div>';
  const changedItems = (batch.items || []).filter((item) => item.action !== 'unchanged');
  const unchangedItems = (batch.items || []).filter((item) => item.action === 'unchanged');
  return `<div class="review-panel">
    <header class="review-panel-header">
      <div><strong>🔒 baah push waiting for review</strong><p>${batchCount} pending batch · ${itemCount} pending ${itemCount === 1 ? 'change' : 'changes'} · ${unchangedCount} unchanged · latest project: ${escapeHtml(batch.project || 'default')}</p></div>
      <div class="pending-actions"><button class="pending-button" data-action="approve-pending-batch" data-batch-id="${escapeHtml(batch.id)}">Approve latest</button><button class="pending-button danger" data-action="reject-pending-batch" data-batch-id="${escapeHtml(batch.id)}">Reject latest</button></div>
    </header>
    <section class="review-section"><h2>Review changes</h2>${changedItems.length ? `<ol class="pending-review-list">${changedItems.map(renderPendingItem).join('')}</ol>` : '<div class="empty-review-delta">No changed files in this push.</div>'}</section>
    ${renderUnchangedSummary(unchangedItems)}
  </div>`;
}
