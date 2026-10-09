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

	if (popup.isClosed()) {
		// New optimistic flow: popup can close immediately when in-page menu opens.
		const menuState = await page.evaluate(() => {
			const host = document.getElementById('browser-lambdas-popup-menu-host') as
				| (HTMLElement & { shadowRoot?: ShadowRoot })
				| null;
			const actions = Array.from(host?.shadowRoot?.querySelectorAll<HTMLElement>('[data-action]') || [])
				.map((element) => element.dataset.action);
			const button = host?.shadowRoot?.querySelector<HTMLElement>('[data-action="shell"]');
			button?.click();
			return { actions, shellClicked: Boolean(button) };
		});
		expect(menuState.actions.indexOf('activity')).toBeGreaterThan(-1);
		expect(menuState.actions.indexOf('activity')).toBeLessThan(menuState.actions.indexOf('settings'));
		expect(menuState.shellClicked).toBe(true);
	} else {
		// Fallback flow: click the popup's open shell button.
		const links = await popup.locator('a.row').allTextContents();
		expect(links.indexOf('[ activity log ]')).toBeGreaterThan(-1);
		expect(links.indexOf('[ activity log ]')).toBeLessThan(links.indexOf('[ settings ]'));
		const btn = popup.getByRole('button', { name: /open shell/i });
		await btn.evaluate((el) => (el as HTMLElement).click());
	}

	await page.waitForTimeout(reactionTime);

	// Verify the shell UI appears on the active page
	await expect(page.locator('#browser-lambdas-popup-menu-host')).toHaveCount(0);
	await expect(page.locator('#browser-lambdas-shell')).toBeVisible();
	const shellInput = page.frameLocator('#browser-lambdas-shell').locator('#shell-input');
	await expect(shellInput).toBeVisible();
	await expect(shellInput).toBeFocused();

	const secondPopup = await page.context().newPage();
	await secondPopup.goto(`${base}/popup.html`);
	await expect(page.locator('#browser-lambdas-popup-menu-host')).toBeAttached();
	await page.evaluate(() => {
		const host = document.getElementById('browser-lambdas-popup-menu-host') as
			| (HTMLElement & { shadowRoot?: ShadowRoot })
			| null;
		host?.shadowRoot?.querySelector<HTMLElement>('[data-action="shell"]')?.click();
	});
	await expect(page.locator('#browser-lambdas-shell')).toHaveCount(1);
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
	const before = await scroll.evaluate((element) => element.scrollTop);
	await page.getByText('Always Show Shell').locator('..').getByRole('button').click();
	await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(before);
});

export default test;
