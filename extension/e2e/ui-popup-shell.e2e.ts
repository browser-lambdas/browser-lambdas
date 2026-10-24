import { test, expect } from './fixtures';

// Ensure tests have enough time to build extension and run
test.describe.configure({ timeout: 120_000 });

test('popup open shell injects UI into active tab', async ({
	page,
	extensionId,
	localTestPage,
	reactionTime
}) => {
	const base = `chrome-extension://${extensionId}`;

	// Open a regular page that will receive the shell UI
	await page.goto(localTestPage);
	await page.waitForTimeout(reactionTime);

	// Open the popup page in a background tab
	const popup = await page.context().newPage();
	await popup.goto(`${base}/popup.html`);
	try {
		await popup.waitForTimeout(reactionTime);
	} catch {
		// Popup may close immediately in optimistic in-page menu flow.
	}

	// Bring the original page to the front so it remains the active tab
	await page.bringToFront();

	const menu = page.frameLocator('#browser-lambdas-popup-menu-host');
	await expect(menu.locator('[data-action="shell"]')).toBeVisible();
	const actions = await menu.locator('[data-action]').evaluateAll(elements => elements.map(element => (element as HTMLElement).dataset.action));
	expect(actions.indexOf('activity')).toBeLessThan(actions.indexOf('settings'));
	await menu.locator('[data-action="shell"]').click();

	await page.waitForTimeout(reactionTime);

	// Verify the shell UI appears on the active page
	await expect(page.locator('#browser-lambdas-popup-menu-host')).toHaveCount(0);
	await expect(page.locator('#browser-lambdas-shell')).toBeVisible();
	const shellInput = page.frameLocator('#browser-lambdas-shell').locator('#shell-input');
	await expect(shellInput).toBeVisible();
	await page.bringToFront();
	await expect(shellInput).toBeFocused();

	const secondPopup = await page.context().newPage();
	await secondPopup.goto(`${base}/popup.html`);
	await expect(page.locator('#browser-lambdas-popup-menu-host')).toBeAttached();
	await page.bringToFront();
	await page.frameLocator('#browser-lambdas-popup-menu-host').locator('[data-action="shell"]').click();
	await expect(page.locator('#browser-lambdas-shell')).toHaveCount(1);
});

async function openMenu(page, extensionId) {
	await page.bringToFront();
	const popup = await page.context().newPage();
	await popup.goto(`chrome-extension://${extensionId}/popup.html`);
	await expect(page.frameLocator('#browser-lambdas-popup-menu-host').locator('.bl-menu')).toBeVisible();
	await page.bringToFront();
	return popup;
}

test('popup iframe rejects page access, forged messages and synthetic clicks', async ({ page, extensionId, localTestPage }) => {
	await page.goto(localTestPage);
	await page.evaluate(() => {
		(window as any).menuMessages = [];
		window.addEventListener('message', event => (window as any).menuMessages.push(event.data));
		(window as any).menuAttack = setInterval(() => {
			const frame = document.querySelector<HTMLIFrameElement>('#browser-lambdas-popup-menu-host');
			if (!frame) return;
			const channel = new MessageChannel();
			frame.contentWindow?.postMessage({ type: 'POPUP_MENU_CONNECT', token: 'forged' }, '*', [channel.port2]);
			channel.port1.postMessage({ type: 'STATUS', error: 'forged status' });
			channel.port1.close();
			window.postMessage({ type: 'ACTION', action: 'shell' }, '*');
		}, 25);
	});
	await openMenu(page, extensionId);
	const isolation = await page.evaluate(() => {
		const frame = document.querySelector<HTMLIFrameElement>('#browser-lambdas-popup-menu-host')!;
		let blocked = false;
		try { void frame.contentWindow!.document; } catch { blocked = true; }
		return { tag: frame.tagName, blocked, document: frame.contentDocument === null, shadow: frame.shadowRoot === null,
			buttons: frame.querySelectorAll('button').length,
			leakedToken: (window as any).menuMessages.some(message => message?.token && message.token !== 'forged') };
	});
	expect(isolation).toEqual({ tag: 'IFRAME', blocked: true, document: true, shadow: true, buttons: 0, leakedToken: false });
	const menu = page.frameLocator('#browser-lambdas-popup-menu-host');
	await expect(menu.locator('.bl-warning')).not.toContainText('forged status');
	await menu.locator('[data-action="shell"]').evaluate((button: HTMLElement) => button.click());
	await page.waitForTimeout(100);
	await expect(page.locator('#browser-lambdas-shell')).toHaveCount(0);
	await expect(menu.locator('.bl-menu')).toBeVisible();
	await page.evaluate(() => clearInterval((window as any).menuAttack));
	await menu.locator('[data-action="shell"]').click();
	await expect(page.frameLocator('#browser-lambdas-shell').locator('#shell-input')).toBeVisible();
});

test('popup encrypted channel rejects plaintext and altered ciphertext', async ({ page, extensionId, localTestPage }) => {
	await page.goto(localTestPage);
	for (const failure of ['plaintext', 'tampered']) {
		await openMenu(page, extensionId);
		const menu = page.frameLocator('#browser-lambdas-popup-menu-host');
		const frame = page.frames().find(frame => frame.url().includes('/popup-menu.html#'))!;
		if (failure === 'plaintext') {
			await frame.evaluate('menuPort.postMessage({ type: "ACTION", action: "shell" })');
		} else {
			await frame.evaluate(`{
				const originalPost = menuPort.postMessage.bind(menuPort);
				menuPort.postMessage = packet => {
					if (!packet.iv || !packet.ct || packet.type) throw new Error('Menu sent plaintext');
					originalPost({ ...packet, ct: (packet.ct[0] === 'A' ? 'B' : 'A') + packet.ct.slice(1) });
				};
			}`);
			await menu.locator('[data-action="shell"]').click();
		}
		await expect(page.locator('#browser-lambdas-popup-menu-host')).toHaveCount(0);
		await expect(page.locator('#browser-lambdas-shell')).toHaveCount(0);
	}
});

test('popup iframe keeps navigation, closing and responsive layout', async ({ page, extensionId, localTestPage }) => {
	await page.goto(localTestPage);
	for (const [action, path] of [['workspace', 'workspace.html#functions'], ['activity', 'workspace.html?activityTabId='], ['settings', 'settings.html']]) {
		await openMenu(page, extensionId);
		const opened = page.context().waitForEvent('page');
		await page.frameLocator('#browser-lambdas-popup-menu-host').locator(`[data-action="${action}"]`).click();
		const target = await opened;
		await target.waitForURL(url => url.href.includes(path));
		await target.close();
		await page.bringToFront();
		await page.frameLocator('#browser-lambdas-popup-menu-host').getByRole('button', { name: 'Close menu' }).click();
		await expect(page.locator('#browser-lambdas-popup-menu-host')).toHaveCount(0);
	}
	await openMenu(page, extensionId);
	await page.screenshot({ path: '/tmp/browser-lambdas-popup-desktop.png' });
	await page.setViewportSize({ width: 320, height: 568 });
	const frame = page.locator('#browser-lambdas-popup-menu-host');
	const bounds = await frame.boundingBox();
	expect(bounds!.x).toBeGreaterThanOrEqual(0);
	expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
	await page.screenshot({ path: '/tmp/browser-lambdas-popup-mobile.png' });
	await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
	await expect(frame).toBeVisible();
	await page.frameLocator('#browser-lambdas-popup-menu-host').getByRole('button', { name: 'Close menu' }).press('Escape');
	await expect(frame).toHaveCount(0);
	await openMenu(page, extensionId);
	await page.mouse.click(2, 2);
	await expect(frame).toHaveCount(0);
});

test('popup retains fallback controls when the page prevents iframe startup', async ({ page, extensionId, localTestPage }) => {
	await page.goto(localTestPage);
	await page.evaluate(() => new MutationObserver(() => document.getElementById('browser-lambdas-popup-menu-host')?.remove()).observe(document.body, { childList: true }));
	const popup = await page.context().newPage();
	await popup.goto(`chrome-extension://${extensionId}/popup.html`);
	await expect(popup.getByRole('button', { name: /open shell/i })).toBeVisible();
	await expect(popup.getByRole('link', { name: '[ workspace ]' })).toBeVisible();
	await expect(page.locator('#browser-lambdas-popup-menu-host')).toHaveCount(0);
});

async function prepareShellProbe(page, extensionId, localTestPage) {
	await page.goto(`chrome-extension://${extensionId}/settings.html`);
	await page.evaluate(() => chrome.storage.local.set({
		local_storage_key_lambdas: JSON.stringify([{
			id: 'shell-isolation-probe', name: 'shell-isolation-probe', project: '', world: 'USER_SCRIPT',
			allowedWorlds: ['user_scripts'], urlAllowlistEnabled: true, urlPatterns: ['*'],
			func: 'document.documentElement.dataset.shellProbe = "executed"; console.log("authenticated shell output");'
		}]),
		local_storage_key_input_history: []
	}));
	await page.goto(localTestPage);
	await page.waitForTimeout(500);
}

test('shell rejects the legacy parent-page connection hijack and forged ports', async ({ page, extensionId, localTestPage }) => {
	await prepareShellProbe(page, extensionId, localTestPage);
	await page.evaluate(() => {
		(window as any).shellCaptured = [];
		(window as any).shellCredentials = [];
		(window as any).shellAttackPorts = [];
		const attack = (frame: Window, credentials = {}) => {
			const channel = new MessageChannel();
			(window as any).shellAttackPorts.push(channel.port1);
			channel.port1.onmessage = event => (window as any).shellCaptured.push(event.data);
			frame.postMessage({ type: 'SHELL_CONNECT', nonce: 'forged', token: 'forged', ...credentials, useHistory: false }, '*', [channel.port2]);
			channel.port1.postMessage({ type: 'SHELL_OUTPUT', level: 'log', values: ['spoofed shell output'] });
		};
		window.addEventListener('message', event => {
			if (event.data?.nonce || event.data?.token || event.data?.sessionKey) (window as any).shellCredentials.push(event.data);
			if (event.data?.type !== 'SHELL_READY' || !event.data.nonce) return;
			event.stopImmediatePropagation();
			attack(event.source as Window, { nonce: event.data.nonce, token: event.data.nonce });
		}, true);
		(window as any).shellAttack = setInterval(() => {
			const frame = document.querySelector<HTMLIFrameElement>('#browser-lambdas-shell');
			if (frame?.contentWindow) attack(frame.contentWindow);
		}, 25);
	});
	await page.keyboard.press('Meta+k');
	const shell = page.frameLocator('#browser-lambdas-shell');
	const input = shell.locator('#shell-input');
	await expect(input).toBeVisible();
	const isolation = await page.evaluate(() => {
		const frame = document.querySelector<HTMLIFrameElement>('#browser-lambdas-shell')!;
		let blocked = false;
		try { void frame.contentWindow!.document; } catch { blocked = true; }
		return { blocked, document: frame.contentDocument === null, buttons: frame.querySelectorAll('button').length };
	});
	expect(isolation).toEqual({ blocked: true, document: true, buttons: 0 });
	await input.fill('shell-isolation-probe');
	await input.press('Enter');
	await expect.poll(() => page.evaluate(() => document.documentElement.dataset.shellProbe)).toBe('executed');
	await expect(shell.locator('#shell-outputs')).toContainText('authenticated shell output');
	await expect(shell.locator('#shell-outputs')).not.toContainText('spoofed shell output');
	const attacked = await page.evaluate(() => {
		clearInterval((window as any).shellAttack);
		for (const port of (window as any).shellAttackPorts) port.close();
		return { captured: (window as any).shellCaptured, credentials: (window as any).shellCredentials };
	});
	expect(attacked).toEqual({ captured: [], credentials: [] });
});

test('shell encrypted channel rejects plaintext and altered command ciphertext', async ({ page, extensionId, localTestPage }) => {
	await prepareShellProbe(page, extensionId, localTestPage);
	for (const failure of ['plaintext', 'tampered']) {
		await page.keyboard.press('Meta+k');
		const shell = page.frameLocator('#browser-lambdas-shell');
		const input = shell.locator('#shell-input');
		await expect(input).toBeVisible();
		const frame = page.frames().find(frame => frame.url().includes('/shell.html#'))!;
		if (failure === 'plaintext') {
			await frame.evaluate('shellPort.postMessage({ type: "EXECUTE", command: "shell-isolation-probe" })');
		} else {
			await frame.evaluate(`{
				const originalPost = shellPort.postMessage.bind(shellPort);
				shellPort.postMessage = packet => {
					if (!packet.iv || !packet.ct || packet.type) throw new Error('Shell sent plaintext');
					originalPost({ ...packet, ct: (packet.ct[0] === 'A' ? 'B' : 'A') + packet.ct.slice(1) });
				};
			}`);
			await input.fill('shell-isolation-probe');
			await input.press('Enter');
		}
		await expect(page.locator('#browser-lambdas-shell')).toHaveCount(0);
		expect(await page.evaluate(() => document.documentElement.dataset.shellProbe)).toBeUndefined();
	}
	await page.keyboard.press('Meta+k');
	const input = page.frameLocator('#browser-lambdas-shell').locator('#shell-input');
	await expect(input).toBeVisible();
	await input.fill('shell-isolation-probe');
	await input.press('Enter');
	await expect.poll(() => page.evaluate(() => document.documentElement.dataset.shellProbe)).toBe('executed');
});

test('shell rejects synthetic command input and control clicks while trusted input works', async ({ page, extensionId, localTestPage }) => {
	await prepareShellProbe(page, extensionId, localTestPage);
	await page.keyboard.press('Meta+k');
	const shell = page.frameLocator('#browser-lambdas-shell');
	const input = shell.locator('#shell-input');
	await expect(input).toBeVisible();
	await input.fill('shell-isolation-probe');
	await input.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
	await shell.getByRole('button', { name: 'Close shell' }).evaluate((button: HTMLElement) => button.click());
	await shell.getByRole('button', { name: 'Set shell position' }).evaluate((button: HTMLElement) => button.click());
	await expect(input).toBeVisible();
	await expect(shell.locator('#shell-position-menu')).toBeHidden();
	expect(await page.evaluate(() => document.documentElement.dataset.shellProbe)).toBeUndefined();
	await input.press('Enter');
	await expect.poll(() => page.evaluate(() => document.documentElement.dataset.shellProbe)).toBe('executed');
	await shell.getByRole('button', { name: 'Close shell' }).click();
	await expect(page.locator('#browser-lambdas-shell')).toHaveCount(0);
});

const lambdas = [
	{ id: 'release-auto-a', name: 'release-alpha --x --y --z', project: '', world: 'USER_SCRIPT', allowedWorlds: ['user_scripts'], urlAllowlistEnabled: true, urlPatterns: ['*'], func: 'console.log("alpha");' },
	{ id: 'release-auto-b', name: 'release-alpine', project: '', world: 'USER_SCRIPT', allowedWorlds: ['user_scripts'], urlAllowlistEnabled: true, urlPatterns: ['*'], func: 'console.log("alpine");' },
	{ id: 'release-hostile', name: 'release-hostile', project: '', world: 'USER_SCRIPT', allowedWorlds: ['user_scripts'], urlAllowlistEnabled: true, urlPatterns: ['*'], func: `console.log("<script id=owned>alert(1)</script>", "quotes \\\" and '", "emoji 🐑", "line one\\nline two", "x".repeat(2000));` }
];

test('shell suggestions support selection, flags, and inert special text', async ({ page, extensionId, localTestPage }) => {
	await page.goto(`chrome-extension://${extensionId}/settings.html`);
	await page.evaluate((items) => chrome.storage.local.set({
		local_storage_key_lambdas: JSON.stringify(items),
		local_storage_key_input_history: []
	}), lambdas);
	await page.goto(localTestPage);
	await page.waitForTimeout(500);
	await page.keyboard.press('Meta+k');
	const shell = page.frameLocator('#browser-lambdas-shell');
	const input = shell.locator('#shell-input');
	await expect(input).toBeVisible();
	const suggestions = shell.locator('.shell-suggestion');

	await input.fill('release-al');
	await expect(suggestions).toHaveCount(2);
	await expect(suggestions.nth(0)).toHaveClass(/active/);
	await input.press('ArrowDown');
	await expect(suggestions.nth(1)).toHaveClass(/active/);
	await input.press('Tab');
	await expect(input).toHaveValue('release-alpine');

	await input.fill('release-alpha -');
	await expect(suggestions).toHaveCount(3);
	await input.press('ArrowDown');
	await input.press('Tab');
	await expect(input).toHaveValue('release-alpha --y');

	await input.fill('release-al');
	await expect(suggestions.first()).toBeVisible();
	await input.press('Escape');
	await expect(suggestions).toHaveCount(0);
	await expect(input).toHaveValue('release-al');
	await input.press('Escape');
	await expect(page.locator('#browser-lambdas-shell')).toBeHidden();
	await page.keyboard.press('Meta+k');
	await expect(input).toBeVisible();

	const hostileCommand = '<script id="command-owned">alert(1)</script> emoji 🐑';
	await input.fill(hostileCommand);
	await input.press('Enter');
	await expect(shell.locator('#command-owned')).toHaveCount(0);
	await expect(shell.locator('#shell-outputs p').first()).toHaveText(`> ${hostileCommand}`);

	await input.fill('release-hostile');
	await input.press('Enter');
	await expect(shell.locator('#shell-outputs')).toContainText('<script id=owned>alert(1)</script>');
	await expect(shell.locator('#owned')).toHaveCount(0);
	await expect(shell.locator('#shell-outputs')).toContainText('emoji 🐑');
	await expect(shell.locator('#shell-outputs')).toContainText('line one\nline two');
});

test('shell keeps suggestions visible and preserves selected output text', async ({ page, extensionId, localTestPage }) => {
	await page.goto(`chrome-extension://${extensionId}/settings.html`);
	await page.evaluate((items) => chrome.storage.local.set({
		local_storage_key_lambdas: JSON.stringify(items),
		local_storage_key_input_history: []
	}), lambdas);
	await page.goto(localTestPage);
	await page.waitForTimeout(500);
	await page.keyboard.press('Meta+k');
	const shellFrame = page.locator('#browser-lambdas-shell');
	const shell = page.frameLocator('#browser-lambdas-shell');
	const input = shell.locator('#shell-input');
	const outputs = shell.locator('#shell-outputs');
	await expect(input).toBeVisible();

	for (let i = 0; i < 18; i++) {
		await input.fill(`typed-line-${i}`);
		await input.press('Enter');
	}
	await input.fill('release-al');
	const suggestions = shell.locator('.shell-suggestions');
	await expect(suggestions).toBeVisible();
	const shellRect = await shellFrame.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		return { bottom: rect.bottom };
	});
	const suggestionsRect = await suggestions.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		return { bottom: rect.bottom };
	});
	expect(suggestionsRect.bottom).toBeLessThanOrEqual(shellRect.bottom + 1);

	const selectedText = '> typed-line-3';
	const selectedLine = outputs.locator('p', { hasText: selectedText });
	await selectedLine.scrollIntoViewIfNeeded();
	const lineBox = await selectedLine.boundingBox();
	expect(lineBox).not.toBeNull();
	await page.mouse.move(lineBox!.x + 2, lineBox!.y + 2);
	await page.mouse.down();
	await page.mouse.move(lineBox!.x + lineBox!.width - 2, lineBox!.y + 2);
	await page.mouse.up();
	await expect.poll(() => shell.locator('body').evaluate(() => window.getSelection()?.toString())).toContain(selectedText);
});

test('shell bounds are isolated per page and settings controls do not jump', async ({ page, extensionId, localTestPage }) => {
	const firstUrl = `${localTestPage}/?page=a`;
	const secondUrl = `${localTestPage}/?page=b`;
	await page.goto(firstUrl);
	await page.waitForTimeout(500);
	await page.keyboard.press('Meta+k');
	const frame = page.locator('#browser-lambdas-shell');
	const initial = await frame.boundingBox();
	await page.frameLocator('#browser-lambdas-shell').getByRole('button', { name: 'Set shell position' }).click();
	await page.frameLocator('#browser-lambdas-shell').getByRole('button', { name: 'Place on left' }).click();
	const placed = await frame.boundingBox();
	expect(placed?.x).toBe(20);
	await page.waitForTimeout(200);
	await page.reload();
	await page.waitForTimeout(500);
	await page.keyboard.press('Meta+k');
	await expect.poll(async () => (await frame.boundingBox())?.x).toBe(20);

	await page.goto(secondUrl);
	await page.waitForTimeout(500);
	await page.keyboard.press('Meta+k');
	const other = await frame.boundingBox();
	expect(other?.x).toBeCloseTo(initial?.x || 0, 0);

	await page.goto(`chrome-extension://${extensionId}/settings.html`);
	const scroll = page.locator('.settings-scroll');
	await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
	const alwaysOn = page.getByText('Always Show Shell').locator('..').getByRole('button');
	await alwaysOn.scrollIntoViewIfNeeded();
	const before = await scroll.evaluate((element) => element.scrollTop);
	await alwaysOn.click();
	await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(before);
});

export default test;
