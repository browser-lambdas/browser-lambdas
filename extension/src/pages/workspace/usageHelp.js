import { functionUsageExamples } from '../../shared/functionUsage.js';
import { escapeHtml } from './html.js';

const HELP = {
  lambda: { title: 'Function', anchor: 'category-ctx' },
  storage: { title: 'K-V', anchor: 'storage' },
  secret: { title: 'Secrets', anchor: 'secrets' },
  trigger: { description: 'Run the listed commands automatically when a page URL matches one of the patterns.' },
  style: { description: 'Preview this CSS here, then choose Set theme to use it in the Terminal.' }
};

export function renderUsageExamples(type, item) {
  const key = JSON.stringify(item.key ?? '');
  let examples = [];
  if (type === 'lambda') {
    const { terminal, tab } = functionUsageExamples(item);
    examples = [['Terminal', terminal], ['From another function on the current tab', tab]];
  } else if (type === 'storage') {
    examples = [['Read value', `const value = await ctx.kv.get(${key});`], ['Write value', `await ctx.kv.set(${key}, "new value");`]];
  } else if (type === 'secret') {
    examples = [['Read secret', `const secret = await ctx.secrets.get(${key});`]];
  }
  return examples.map(([label, code]) => `<div class="usage-example"><h4>${label}</h4><pre><code>${escapeHtml(code)}</code></pre></div>`).join('');
}

export function renderUsageHelp(node) {
  const { type, editable, usageExpanded } = node.pane;
  const help = HELP[type];
  return `<details class="usage-help" data-usage-pane="${node.id}" ${usageExpanded ? 'open' : ''}>
    <summary>How to use</summary>
    ${help.description ? `<p class="security-help">${help.description}</p>` : ''}
    <div class="usage-examples">${renderUsageExamples(type, editable)}</div>
    ${help.anchor ? `<a class="usage-docs" href="https://browser-lambdas.dev/#${help.anchor}" target="_blank" rel="noopener">${help.title} documentation</a>` : ''}
  </details>`;
}
