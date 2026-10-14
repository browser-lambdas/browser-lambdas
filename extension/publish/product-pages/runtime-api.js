import { codeLineNumbers, highlightJavaScript } from '../../src/pages/workspace/codeEditor.js';

// Reuse the workspace's renderer, line numbers, and CSS classes without copying
// syntax rules or their palette into the store artwork. Examples are displayed,
// not executed: they must never send requests or alter the user's tabs/storage.
for (const source of document.querySelectorAll('[data-code]')) {
  const code = source.textContent;
  const shell = document.createElement('div');
  shell.className = 'code-shell function-code-box';
  const gutter = document.createElement('div');
  gutter.className = 'line-numbers';
  gutter.setAttribute('aria-hidden', 'true');
  gutter.innerHTML = codeLineNumbers(code);
  const stack = document.createElement('div');
  stack.className = 'code-editor-stack';
  const highlight = document.createElement('pre');
  highlight.className = 'code-highlight';
  highlight.innerHTML = highlightJavaScript(code);
  stack.append(highlight);
  shell.append(gutter, stack);
  source.replaceWith(shell);
}
document.documentElement.dataset.ready = 'true';
