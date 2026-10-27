import { DEFAULT_STYLE_CSS } from '../workspace/defaultStyle.js';
import { escapeHtml } from '../workspace/html.js';

// CSS stays inside an opaque, script-free frame and cannot style its controls.
export function mountTerminalPreview(container, { css = '', prompt = '>', name = '' } = {}) {
  const frame = document.createElement('iframe');
  frame.className = 'terminal-preview';
  frame.title = name ? `Terminal preview: ${name}` : 'Terminal style preview';
  frame.setAttribute('sandbox', '');
  frame.tabIndex = -1;
  const styles = `${DEFAULT_STYLE_CSS}
    html, body { margin: 0; height: 100%; background: transparent; color-scheme: dark; }
    #browser-lambdas-shell { position: fixed; inset: 0 !important; width: 100% !important; height: 100% !important; transform: none !important; }
    #shell-titlebar { flex-shrink: 0; }
    .shell-controls { display: flex; align-items: center; gap: 6px; }
    .shell-icon-button { display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: 0; font: inherit; font-size: 26px; }
    .shell-icon-button svg { width: 16px; height: 16px; stroke: currentColor; fill: none; stroke-width: 1.8; }
    #shell-body { min-height: 0; }
    #shell-outputs p { margin: 0; font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; }
    #shell-input-wrap { margin-top: 8px; }
    #shell-input-wrap > span { max-width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #shell-input { min-width: 0; }
    #shell-suggestions, #shell-position-menu { display: none; }
    ${String(css)}
    #browser-lambdas-shell { inset: 0 !important; width: 100% !important; height: 100% !important; transform: none !important; }
  `;
  // A literal closing style tag in a CSS string must never become HTML.
  const safeStyles = styles.replace(/<(?=\/style(?:\s|\/|>))/gi, '\\3c ');
  const marker = escapeHtml(prompt);
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'">
    <style>${safeStyles}</style></head><body>
    <div id="browser-lambdas-shell" class="shell-container">
      <div id="shell-titlebar" class="shell-titlebar"><div class="shell-controls">
        <button class="shell-icon-button" type="button" tabindex="-1" aria-label="Set terminal position"><svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M14 3v18M11 8l-3 4 3 4"/></svg></button>
        <button class="shell-icon-button" type="button" tabindex="-1" aria-label="Close terminal">×</button>
        <div id="shell-position-menu" class="shell-position-menu"></div>
      </div></div>
      <div id="shell-body" class="shell-body">
        <div id="shell-outputs" class="shell-outputs">
          <p>${marker} hello Ada</p><p>Hello, Ada!</p>
          <p>${marker} tabs</p><p>3 tabs ready.</p>
        </div>
        <div id="shell-input-wrap" class="shell-input-wrap"><span>${marker} </span><input id="shell-input" class="shell-input" aria-label="Sample command" value="help" readonly tabindex="-1"></div>
        <div id="shell-suggestions" class="shell-suggestions"></div>
      </div>
    </div></body></html>`;
  container.replaceChildren(frame);
  return frame;
}
