const APP_CATEGORY_ICONS = { functions: 'parentheses', storage: 'database', triggers: 'play', secrets: 'lock', styles: 'braces', activity: 'activity' };
const APP_NAV_TABS = ['functions', 'storage', 'triggers', 'secrets', 'styles', 'activity'];

function lucideIcon(name) {
  const nodes = {
    maximize: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    minimize: '<path d="M3 8h5V3m8 0v5h5M8 21v-5H3m13 5v-5h5"/>',
    parentheses: '<path d="M8 21s-4-3-4-9 4-9 4-9"/><path d="M16 3s4 3 4 9-4 9-4 9"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    braces: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
    activity: '<path d="M4 19V5"/><path d="M8 17l3-3 3 2 6-7"/><circle cx="8" cy="17" r="1"/><circle cx="11" cy="14" r="1"/><circle cx="14" cy="16" r="1"/><circle cx="20" cy="9" r="1"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    panelRight: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
    clipboard: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    splitHorizontal: '<path d="M8 19H5c-1 0-2-1-2-2V7c0-1 1-2 2-2h3"/><path d="M16 5h3c1 0 2 1 2 2v10c0 1-1 2-2 2h-3"/><line x1="12" x2="12" y1="4" y2="20"/>',
    splitVertical: '<path d="M5 8V5c0-1 1-2 2-2h10c1 0 2 1 2 2v3"/><path d="M19 16v3c0 1-1 2-2 2H7c-1 0-2-1-2-2v-3"/><line x1="4" x2="20" y1="12" y2="12"/>',
    save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    refreshCw: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>'
  };
  return `<svg class="lucide-icon" viewBox="0 0 24 24" aria-hidden="true">${nodes[name] || ''}</svg>`;
}

function renderAppNav({ activeTab = '', settingsActive = false } = {}) {

  const labels = { functions: 'Functions', storage: 'K-V', triggers: 'Triggers', secrets: 'Secrets', styles: 'Styles', activity: 'Activity' };
  const links = [
    { label: 'Home', icon: '<img src="./assets/logo-clean.png" alt="" />', localDocs: true, href: 'file:///Users/jh/dev/browser-lambdas/web/index.html' },
    ...APP_NAV_TABS.map((tab) => ({ label: labels[tab], href: `workspace.html#${tab}`, tab, icon: lucideIcon(APP_CATEGORY_ICONS[tab]) }))
  ];

  return `<nav class="app-nav" aria-label="Primary navigation">
    <div class="nav-top">
      ${links.map((item) => item.localDocs
        ? `<a class="nav-item nav-brand" href="${item.href}" data-local-docs target="_blank" rel="noopener" aria-label="${item.label}" title="Open local documentation"><span class="nav-icon">${item.icon}</span></a>`
        : `<a class="nav-item ${item.tab === activeTab ? 'active' : ''}" href="${item.href}" data-nav-tab="${item.tab || ''}" aria-label="${item.label}"><span class="nav-icon">${item.icon}</span><span>${item.label}</span></a>`).join('')}
    </div>
    <a class="nav-item ${settingsActive ? 'active' : ''}" href="settings.html" aria-label="Settings"><span class="nav-icon">${lucideIcon('settings')}</span><span>Settings</span></a>
  </nav>`;
}

// Temporary development link: use the tabs API to open the local documentation
// file, since ordinary extension-page navigation to file URLs may be blocked.
document.addEventListener('click', (event) => {
  const link = event.target.closest('[data-local-docs]');
  if (!link || !chrome.tabs?.create) return;
  event.preventDefault();
  chrome.tabs.create({ url: link.href, active: !event.ctrlKey && !event.metaKey });
});
