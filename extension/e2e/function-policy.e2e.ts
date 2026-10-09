import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test('functions share permission controls and keep default world separate from grants', async ({ page, extensionContext, extensionId }) => {
	const base = `chrome-extension://${extensionId}`;
	await page.goto(`${base}/workspace.html#functions`);
	await page.evaluate(() => chrome.storage.local.clear());
	await page.reload();
	await page.getByTestId('sidebar-functions-add').click();
	await page.getByRole('button', { name: 'Show settings' }).click();
	await page.getByTestId('pane-title').fill('policy-function');
	await page.locator('.code-editor').fill('console.log("ran");');
	await expect(page.getByTestId('function-url-patterns')).toHaveValue('');
	await expect(page.getByTestId('function-security').locator('[data-world="main"]')).toBeDisabled();
	await expect(page.getByTestId('pane-world').locator('option[value=MAIN]')).toHaveJSProperty('disabled', true);
	await page.getByTestId('function-url-allowlist').check();
	await expect(page.getByTestId('function-security').locator('[data-world="main"]')).not.toBeChecked();
	await page.getByTestId('function-url-patterns').fill('/[/');
	await page.getByTestId('pane-save').click();
	await expect(page.getByRole('alert')).toContainText('pattern is invalid');
	await page.getByTestId('function-url-patterns').fill('https://example.com/*');
	const settings = await extensionContext.newPage();
	try {
		await settings.goto(`${base}/settings.html`);
		await expect(settings.getByTestId('allow-main-world-functions')).toHaveAttribute('aria-pressed', 'false');
		await settings.getByTestId('allow-main-world-functions').click();
		await expect(settings.getByTestId('allow-main-world-storage')).toHaveAttribute('aria-pressed', 'false');
		await page.getByTestId('function-security').locator('[data-world="main"]').check();
		await page.getByTestId('pane-world').selectOption('MAIN');
		await page.getByTestId('pane-save').click();
		await expect(page.getByRole('alert')).toHaveCount(0);
		await page.reload();
		await page.getByTestId('sidebar-functions-item').click();
		await page.getByRole('button', { name: 'Show settings' }).click();
		await expect(page.getByTestId('function-url-patterns')).toHaveValue('https://example.com/*');
		await expect(page.getByTestId('pane-world')).toHaveValue('MAIN');
		await page.locator('.code-editor').fill('unsaved draft');
		await settings.getByTestId('allow-main-world-functions').click();
		await expect(page.getByTestId('function-security').locator('[data-world="main"]')).toBeDisabled();
		await expect(page.getByTestId('function-security').locator('[data-world="main"]')).toBeChecked();
		await expect(page.locator('.code-editor')).toHaveValue('unsaved draft');
	} finally { await settings.close(); }
});

test('function page and world permissions block direct, nested and trigger execution', async ({ page, extensionId, localTestPage, reactionTime }) => {
	const base = `chrome-extension://${extensionId}`;
	await page.goto(`${base}/workspace.html#functions`);
	await page.evaluate(async (origin) => {
		await chrome.storage.local.clear();
		await chrome.storage.local.set({
			local_storage_key_lambdas: JSON.stringify([
				{ id: 'target', name: 'target', func: 'console.log("TARGET_RAN");', allowedWorlds: ['user_scripts', 'main'], urlAllowlistEnabled: true, urlPatterns: [`${origin}/allowed/*`] },
				{ id: 'caller', name: 'caller', func: 'await ctx.run("target"); console.log("CALLER_DONE");', allowedWorlds: ['user_scripts'], urlAllowlistEnabled: true, urlPatterns: ['*'] }
			])
		});
	}, new URL(localTestPage).origin);
	const run = async (path: string, command: string) => {
		await page.goto(`${localTestPage}${path}`);
		await page.waitForTimeout(reactionTime);
		await page.keyboard.press('Meta+k');
		const shell = page.frameLocator('#browser-lambdas-shell');
		await shell.locator('#shell-input').fill(command);
		await shell.locator('#shell-input').press('Enter');
		return shell.locator('#shell-outputs p');
	};
	let output = await run('/denied/page', 'target');
	await expect(output.filter({ hasText: 'current URL does not match' })).toHaveCount(1);
	await expect(output.filter({ hasText: /^TARGET_RAN$/ })).toHaveCount(0);
	output = await run('/denied/page', 'caller');
	await expect(output.filter({ hasText: /^CALLER_DONE$/ })).toHaveCount(1);
	await expect(output.filter({ hasText: /^TARGET_RAN$/ })).toHaveCount(0);
	output = await run('/allowed/page', '@main-world target');
	await expect(output.filter({ hasText: 'disabled globally' })).toHaveCount(1);
	await page.goto(`${base}/settings.html`);
	await page.getByTestId('allow-main-world-functions').click();
	output = await run('/allowed/page', '@main-world target');
	await expect(output.filter({ hasText: /^TARGET_RAN$/ })).toHaveCount(1);
	await page.goto(`${base}/workspace.html#functions`);
	await page.evaluate(async () => {
		const key = 'local_storage_key_lambdas';
		const lambdas = JSON.parse((await chrome.storage.local.get(key))[key]);
		lambdas[0].allowedWorlds = ['user_scripts'];
		await chrome.storage.local.set({ [key]: JSON.stringify(lambdas), local_storage_key_triggers: JSON.stringify([{ id: 't', name: 't', patterns: ['*'], commands: ['@main-world target'] }]) });
	});
	output = await run('/allowed/again', '@main-world target');
	await expect(output.filter({ hasText: 'not allowed for this function' })).toHaveCount(1);
	await expect(output.filter({ hasText: /^TARGET_RAN$/ })).toHaveCount(0);
});
