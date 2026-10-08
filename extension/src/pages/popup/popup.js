const app = document.getElementById('app');
const spinner = ['|', '/', '-', '\\'];
let idx = 0;
let timer;

const isExtensionUrl = (url = '') => url.startsWith('chrome-extension://');

function renderFallback(status, tabId = null) {
  const activityHref = `/workspace.html${tabId == null ? '' : `?activityTabId=${tabId}`}#activity`;
  app.innerHTML = `
    <div class="card">
      <a class="row" href="/workspace.html#functions" target="_blank" rel="noopener noreferrer">[ workspace ]</a>
      <button class="row" id="open-shell">[ open shell ]</button>
      <a class="row" href="${activityHref}" target="_blank" rel="noopener noreferrer">[ activity log ]</a>
      <a class="row" href="/settings.html" target="_blank" rel="noopener noreferrer">[ settings ]</a>
      <p class="small">[ Site status: ${status} ]</p>
    </div>`;
  document.getElementById('open-shell')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'OPEN_SHELL' });
    window.close();
  });
}

function renderLoading() {
  app.innerHTML = `<div class="card">Opening in-page menu… <span id="spin">|</span></div>`;
}

function startSpinner() {
  timer = setInterval(() => {
    const el = document.getElementById('spin');
    if (el) el.textContent = spinner[idx++ % spinner.length];
  }, 100);
}

(async () => {
  renderLoading();
  startSpinner();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let targetTab = tab;
  if (!targetTab?.url || isExtensionUrl(targetTab.url)) {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const candidates = tabs.filter((t) => t.id !== targetTab?.id && t.id && t.url && !isExtensionUrl(t.url));
    targetTab = candidates.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  }

  if (!targetTab?.id || !targetTab.url) {
    clearInterval(timer);
    renderFallback('Scripts blocked ❌');
    return;
  }

  let handled = false;
  const finishWithFallback = (status) => {
    if (handled) return;
    handled = true;
    clearInterval(timer);
    renderFallback(status, targetTab.id);
  };

  const timeout = setTimeout(() => {
    finishWithFallback('Menu response timed out ❌');
  }, 3000);

  chrome.runtime.sendMessage({ action: 'OPEN_POPUP_MENU', tabId: targetTab.id }, (response) => {
    if (handled) return;

    if (chrome.runtime.lastError || response?.success !== true) {
      const url = new URL(targetTab.url).hostname;
      chrome.runtime.sendMessage({ action: 'TEST_SCRIPT_INJECTION', url, tabId: targetTab.id }, (scriptStatus) => {
        clearTimeout(timeout);
        const status = chrome.runtime.lastError || scriptStatus?.success !== true ? 'Scripts blocked ❌' : 'Scripts allowed ✅';
        finishWithFallback(status);
      });
      return;
    }

    handled = true;
    clearTimeout(timeout);
    clearInterval(timer);
    window.close();
  });
})();
