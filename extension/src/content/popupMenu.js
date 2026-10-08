const MENU_HOST_ID = 'browser-lambdas-popup-menu-host';
let outsideClickListener = null;
const getMenuMarkup = () => `
	<div class="bl-menu" data-testid="popup-menu">
		<div class="bl-top">
			<div class="bl-header">
				<span class="bl-title">browser lambdas</span>
				<button class="bl-close" data-action="close" aria-label="Close menu">×</button>
			</div>
			<p class="bl-warning" data-testid="popup-menu-status" hidden></p>
		</div>
		<div class="bl-divider"></div>
		<div class="bl-items">
			<button data-action="workspace">[ workspace ]</button>
			<button data-action="shell">[ open shell ]</button>
			<button data-action="activity">[ activity log ]</button>
			<button data-action="settings">[ settings ]</button>
		</div>
	</div>
`;
const getMenuStyles = () => `
	:host {
		all: initial;
	}

	.bl-menu {
		position: fixed;
		top: 12px;
		right: 16px;
		z-index: 2147483647;
		width: min(220px, calc(100vw - 24px));
		background: #160e16;
		color: #f7f5f8;
		border-radius: 24px;
		border: 1px solid #2d1b2e;
		box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
		font-size: 14px;
		line-height: 1.3;
		overflow: hidden;
	}

	.bl-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 16px;
		background: #160e16;
	}

	.bl-top {
		display: grid;
		gap: 0;
	}

	.bl-divider {
		border-top: 1px solid #2d1b2e;
	}

	.bl-title {
		font-size: 12px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		opacity: 0.9;
	}

	.bl-close {
		border: 0;
		background: transparent;
		color: inherit;
		font-size: 26px;
		line-height: 20px;
		padding: 0;
		cursor: pointer;
	}

	.bl-items {
		display: grid;
		gap: 10px;
		padding: 14px;
	}

	.bl-items button {
		font: inherit;
		text-align: left;
		border: 1px solid #2d1b2e;
		border-radius: 12px;
		padding: 10px 12px;
		background: #231325;
		color: inherit;
		cursor: pointer;
		transition: background 120ms ease, transform 120ms ease;
	}

	.bl-items button:hover {
		background: #2a1a2d;
		transform: translateY(-1px);
	}

	.bl-warning {
		margin: 0 16px 14px;
		padding: 10px 12px;
		font-size: 14px;
		border: 1px solid #8a2946;
		border-radius: 12px;
		background: #34131e;
		color: #ffd8e2;
	}
`;
const removePopupMenu = () => {
    if (outsideClickListener) {
        document.removeEventListener('mousedown', outsideClickListener, true);
        outsideClickListener = null;
    }
    document.getElementById(MENU_HOST_ID)?.remove();
};
const openExtensionPage = (relativePath) => {
    chrome.runtime.sendMessage({ action: 'OPEN_EXTENSION_PAGE', path: relativePath });
};
const updateScriptStatus = (warningEl) => {
    chrome.runtime.sendMessage({ action: 'TEST_SCRIPT_INJECTION', url: window.location.hostname }, (response) => {
        if (chrome.runtime.lastError || response?.success !== true) {
            const details = response?.error ||
                chrome.runtime.lastError?.message ||
                'This site likely blocks dynamic execution through Content Security Policy (CSP).';
            warningEl.textContent = `⚠️ Script execution blocked: ${details}`;
            warningEl.hidden = false;
            return;
        }
        warningEl.hidden = true;
    });
};
const togglePopupMenu = () => {
    const existing = document.getElementById(MENU_HOST_ID);
    if (existing) {
        removePopupMenu();
        return;
    }
    const host = document.createElement('div');
    host.id = MENU_HOST_ID;
    host.style.position = 'fixed';
    host.style.inset = '0';
    host.style.zIndex = '2147483646';
    host.style.pointerEvents = 'none';
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = getMenuStyles();
    const wrapper = document.createElement('div');
    wrapper.style.pointerEvents = 'auto';
    wrapper.innerHTML = getMenuMarkup();
    shadow.append(style, wrapper);
    const menu = shadow.querySelector('.bl-menu');
    if (!menu)
        return;
    const warningEl = shadow.querySelector('.bl-warning');
    if (warningEl) {
        updateScriptStatus(warningEl);
    }
    shadow.addEventListener('click', (event) => {
        const target = event.target.closest('[data-action]');
        const action = target?.dataset?.action;
        if (!action) {
            return;
        }
        switch (action) {
            case 'close':
                removePopupMenu();
                break;
            case 'workspace':
                openExtensionPage('workspace.html#functions');
                break;
            case 'activity':
                openExtensionPage(`workspace.html?activityTabId=${tabId}#activity`);
                break;
            case 'settings':
                openExtensionPage('settings.html');
                break;
            case 'shell':
                removePopupMenu();
                chrome.runtime.sendMessage({ action: 'OPEN_SHELL' });
                break;
        }
    });
    outsideClickListener = (event) => {
        const target = event.target;
        if (!host.contains(target) && !menu.contains(target)) {
            removePopupMenu();
        }
    };
    document.addEventListener('mousedown', outsideClickListener, true);
};
