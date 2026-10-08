import { escapeHtml } from './html.js';

export function codeLineNumbers(value) {
  const lineCount = Math.max(1, String(value).split('\n').length);
  return Array.from({ length: lineCount }, (_, index) => `<span>${index + 1}</span>`).join('');
}

export function highlightJavaScript(value) {
  const source = value || '';
  const tokenPattern = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|`(?:\\.|[^`])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:await|async|break|case|catch|class|const|continue|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|static|super|switch|this|throw|try|typeof|var|void|while|yield)\b|\b(?:true|false|null|undefined)\b|\b(?:0[xX][\da-fA-F]+|0[bB][01]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?n?)\b|\.[A-Za-z_$][\w$]*|\b(?:Array|Boolean|Date|Error|JSON|Map|Math|Number|Object|Promise|RegExp|Set|String|Symbol|console|ctx)\b|\b[A-Za-z_$][\w$]*(?=\s*\()|[{}()[\];,:.?]|[+\-*/%=&|!<>~^]+)/g;
  let highlighted = '';
  let lastIndex = 0;

  for (const match of source.matchAll(tokenPattern)) {
    const token = match[0];
    highlighted += escapeHtml(source.slice(lastIndex, match.index));
    const escapedToken = escapeHtml(token);

    if (token.startsWith('//') || token.startsWith('/*')) highlighted += `<span class="syntax-comment">${escapedToken}</span>`;
    else if (token.startsWith('.') && token.length > 1) highlighted += `.<span class="syntax-property">${escapeHtml(token.slice(1))}</span>`;
    else if (/^['"`]/.test(token)) highlighted += `<span class="syntax-string">${escapedToken}</span>`;
    else if (/^\d/.test(token)) highlighted += `<span class="syntax-number">${escapedToken}</span>`;
    else if (/^(true|false|null|undefined)$/.test(token)) highlighted += `<span class="syntax-constant">${escapedToken}</span>`;
    else if (/^[{}()[\];,:.?+\-*/%=&|!<>~^]+$/.test(token)) highlighted += `<span class="syntax-operator">${escapedToken}</span>`;
    else if (/^(Array|Boolean|Date|Error|JSON|Map|Math|Number|Object|Promise|RegExp|Set|String|Symbol|console|ctx)$/.test(token)) highlighted += `<span class="syntax-builtin">${escapedToken}</span>`;
    else if (/^(await|async|break|case|catch|class|const|continue|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|static|super|switch|this|throw|try|typeof|var|void|while|yield)$/.test(token)) highlighted += `<span class="syntax-keyword">${escapedToken}</span>`;
    else highlighted += `<span class="syntax-function">${escapedToken}</span>`;

    lastIndex = match.index + token.length;
  }

  return highlighted + escapeHtml(source.slice(lastIndex));
}

export function syncCodeHighlight(textarea) {
  const shell = textarea.closest('.code-shell');
  const highlight = shell?.querySelector('.code-highlight');
  if (!highlight) return;
  highlight.innerHTML = highlightJavaScript(textarea.value);
  highlight.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
}

export function syncLineNumbers(textarea) {
  const shell = textarea.closest('.code-shell');
  const gutter = shell?.querySelector('.line-numbers');
  if (!gutter) return;
  gutter.innerHTML = codeLineNumbers(textarea.value);
  gutter.scrollTop = textarea.scrollTop;
  syncCodeHighlight(textarea);
}
