import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test('trigger permission controls persist and respond to the independent settings switch', async ({ page, extensionContext, extensionId }) => {
	const base = `chrome-extension://${extensionId}`;
	await page.goto(`${base}/workspace.html#triggers`);
	await page.evaluate(() => chrome.storage.local.clear());
	await page.reload();
	await page.getByTestId('sidebar-triggers-add').click();
	await page.getByRole('button', { name: 'Show settings' }).click();
	await page.getByTestId('pane-title').fill('my-trigger');
	await page.getByTestId('trigger-commands').fill('@main-world target');
	await expect(page.getByTestId('trigger-url-patterns')).toHaveValue('');
	await expect(page.getByTestId('trigger-security').locator('[data-world="main"]')).toBeDisabled();
	await page.getByTestId('trigger-url-patterns').fill('/[/');
	await page.getByTestId('pane-save').click();
	await expect(page.getByRole('alert')).toContainText('pattern is invalid');
	await page.getByTestId('trigger-url-patterns').fill('https://example.com/*');
	const settings = await extensionContext.newPage();
	try {
		await settings.goto(`${base}/settings.html`);
		await expect(settings.getByTestId('allow-main-world-triggers')).toHaveAttribute('aria-pressed', 'false');
		await settings.getByTestId('allow-main-world-triggers').click();
		await expect(settings.getByTestId('allow-main-world-functions')).toHaveAttribute('aria-pressed', 'false');
		await page.getByTestId('trigger-security').locator('[data-world="main"]').check();
		await page.getByTestId('pane-save').click();
		await expect(page.getByRole('alert')).toHaveCount(0);
		await page.reload();
		await page.getByTestId('sidebar-triggers-item').click();
		await page.getByRole('button', { name: 'Show settings' }).click();
		await expect(page.getByTestId('trigger-url-patterns')).toHaveValue('https://example.com/*');
		await expect(page.getByTestId('trigger-commands')).toHaveValue('@main-world target');
		await page.getByTestId('trigger-commands').fill('unsaved command');
		await settings.getByTestId('allow-main-world-triggers').click();
		await expect(page.getByTestId('trigger-security').locator('[data-world="main"]')).toBeDisabled();
		await expect(page.getByTestId('trigger-security').locator('[data-world="main"]')).toBeChecked();
		await expect(page.getByTestId('trigger-commands')).toHaveValue('unsaved command');
		const stored = await page.evaluate(async () => JSON.parse((await chrome.storage.local.get('local_storage_key_triggers')).local_storage_key_triggers)[0]);
		expect(stored.patterns).toEqual(['https://example.com/*']);
		expect(stored.allowedWorlds).toEqual(['user_scripts', 'main']);
		expect(stored).not.toHaveProperty('urlPatterns');
	} finally { await settings.close(); }
});

test('automatic main-world dispatch needs both trigger and function permission', async ({ page, extensionContext, extensionId, localTestPage }) => {
	const base = `chrome-extension://${extensionId}`;
	await page.goto(`${base}/workspace.html#triggers`);
	await page.evaluate(async (origin) => {
		await chrome.storage.local.clear();
		await chrome.storage.local.set({
			local_storage_key_allow_main_world_functions: true,
			local_storage_key_lambdas: JSON.stringify([{ id: 'f', name: 'target', world: 'MAIN', func: 'ctx.log.info("TRIGGER_ALLOWED");', allowedWorlds: ['main'], urlAllowlistEnabled: true, urlPatterns: [`${origin}/allowed/*`] }]),
			local_storage_key_triggers: JSON.stringify([{ id: 't', name: 'auto', patterns: [`${origin}/*`], commands: ['target'], allowedWorlds: ['main'] }])
		});
	}, new URL(localTestPage).origin);
	const worker = extensionContext.serviceWorkers()[0];
	const messages = () => worker.evaluate(async () => (await chrome.storage.local.get('activityLogs')).activityLogs.map((entry) => entry.message));
	const visit = async (path: string) => {
		await page.goto(`${base}/workspace.html#triggers`);
		await page.evaluate(() => chrome.storage.local.set({ activityLogs: [] }));
		await page.goto(`${localTestPage}${path}`);
	};
	await visit('/allowed/one');
	await expect.poll(async () => (await messages()).some((msg) => msg.includes('main-world trigger access is disabled globally'))).toBe(true);
	expect(await messages()).not.toContain('TRIGGER_ALLOWED');
	await worker.evaluate(() => chrome.storage.local.set({ local_storage_key_allow_main_world_triggers: true }));
	await visit('/allowed/two');
	await expect.poll(async () => (await messages()).includes('TRIGGER_ALLOWED')).toBe(true);
	await visit('/denied/page');
	await expect.poll(async () => (await messages()).some((msg) => msg.includes('Function execution blocked') && msg.includes('current URL'))).toBe(true);
	expect(await messages()).not.toContain('TRIGGER_ALLOWED');
	await worker.evaluate(() => chrome.storage.local.set({ local_storage_key_allow_main_world_functions: false }));
	await visit('/allowed/three');
	await expect.poll(async () => (await messages()).some((msg) => msg.includes('main-world function access is disabled globally'))).toBe(true);
	expect(await messages()).not.toContain('TRIGGER_ALLOWED');
});

test('external trigger updates preserve a dirty permission draft and block stale saves', async ({ page, extensionId }) => {
	await page.goto(`chrome-extension://${extensionId}/workspace.html#triggers`);
	await page.evaluate(async () => {
		await chrome.storage.local.clear();
		await chrome.storage.local.set({ local_storage_key_triggers: JSON.stringify([{ id: 't', name: 'existing', patterns: ['*'], commands: ['old'], allowedWorlds: ['user_scripts'] }]) });
	});
	await page.reload();
	await page.getByTestId('sidebar-triggers-item').click();
	await page.getByTestId('trigger-url-patterns').fill('https://local-edit.test/*');
	await page.evaluate(async () => {
		const key = 'local_storage_key_triggers';
		const items = JSON.parse((await chrome.storage.local.get(key))[key]);
		items[0].commands = ['updated-by-sync'];
		await chrome.storage.local.set({ [key]: JSON.stringify(items) });
	});
	await expect(page.getByTestId('trigger-url-patterns')).toHaveValue('https://local-edit.test/*');
	await page.getByTestId('pane-save').click();
	await expect(page.getByRole('alert')).toContainText('trigger changed elsewhere');
	await page.getByTestId('sidebar-triggers-item').click();
	await expect(page.getByTestId('trigger-commands')).toHaveValue('updated-by-sync');
});
