import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test('trigger settings persist automatic execution and paths without separate world grants', async ({ page, extensionId }) => {
	await page.goto(`chrome-extension://${extensionId}/workspace.html#triggers`);
	await page.getByTestId('sidebar-triggers-add').click();
	await page.getByRole('button', { name: 'Show settings' }).click();
	await page.getByTestId('pane-title').fill('my-trigger');
	await page.getByTestId('trigger-commands').fill('@main-world target');
	const security = page.getByTestId('trigger-security');
	await expect(security.getByRole('switch', { name: 'Run automatically', exact: true })).toBeChecked();
	await expect(security.locator('[data-world]')).toHaveCount(0);
	await expect(security.getByRole('combobox')).toHaveCount(0);
	await page.getByTestId('trigger-url-patterns').fill('/[/');
	await page.getByTestId('pane-save').click();
	await expect(page.getByRole('alert')).toContainText('allowed page patterns');
	await page.getByTestId('trigger-url-patterns').fill('https://example.com/*');
	await security.getByRole('switch', { name: 'Run automatically', exact: true }).uncheck();
	await page.getByTestId('pane-save').click();
	await expect(page.getByRole('alert')).toHaveCount(0);
	await page.reload();
	await page.getByTestId('sidebar-triggers-item').click();
	await page.getByRole('button', { name: 'Show settings' }).click();
	await expect(page.getByTestId('trigger-url-patterns')).toHaveValue('https://example.com/*');
	await expect(page.getByTestId('trigger-commands')).toHaveValue('@main-world target');
	await expect(security.getByRole('switch', { name: 'Run automatically', exact: true })).not.toBeChecked();
	const stored = await page.evaluate(async () => JSON.parse((await chrome.storage.local.get('local_storage_key_triggers')).local_storage_key_triggers)[0]);
	expect(stored.enabled).toBe(false);
	expect(stored.patterns).toEqual(['https://example.com/*']);
	expect(stored).not.toHaveProperty('allowedWorlds');
	expect(stored).not.toHaveProperty('urlPatterns');
});

test('automatic triggers obey project restrictions and the invoked function permissions', async ({ page, extensionContext, localTestPage }) => {
	const worker = extensionContext.serviceWorkers()[0];
	await page.addInitScript(() => { (window as Window & { automaticWorld?: string }).automaticWorld = 'page-main-world'; });
	await worker.evaluate(async (origin) => {
		await chrome.storage.local.set({
			local_storage_key_lambdas: JSON.stringify([
				{ id: 'f', project: 'functions', name: 'auto-target', world: 'MAIN', func: 'document.body.dataset.automaticWorld = window.automaticWorld; await ctx.log.info("AUTOMATIC_TARGET_RAN");', allowedWorlds: ['user_scripts', 'main'], urlAllowlistEnabled: true, urlPatterns: [`${origin}/allowed/*`] },
				{ id: 'probe', name: 'trigger-probe', func: 'document.body.dataset.triggerDispatchReady = "yes"; await ctx.log.info("TRIGGER_PROBE_DONE");' }
			]),
			local_storage_key_triggers: JSON.stringify([
				{ id: 't', project: 'automation', name: 'auto', patterns: [`${origin}/*`], commands: ['auto-target'] },
				{ id: 'probe', name: 'probe', patterns: [`${origin}/*`], commands: ['trigger-probe'] }
			])
		});
	}, new URL(localTestPage).origin);
	const visit = async (path: string, reason = '') => {
		await worker.evaluate(() => chrome.storage.local.set({ activityLogs: [] }));
		await page.goto(`${localTestPage}${path}`);
		await expect(page.locator('body')).toHaveAttribute('data-trigger-dispatch-ready', 'yes');
		await expect.poll(() => worker.evaluate(async () => ((await chrome.storage.local.get('activityLogs')).activityLogs || []).some((entry) => entry.message === 'TRIGGER_PROBE_DONE'))).toBe(true);
		if (reason) await expect.poll(() => worker.evaluate(async (reason) => ((await chrome.storage.local.get('activityLogs')).activityLogs || []).some((entry) => entry.message.includes(reason)), reason)).toBe(true);
		return page.locator('body');
	};
	await visit('/allowed/global-denied', 'main-world function access is disabled globally');
	await expect(page.locator('body')).not.toHaveAttribute('data-automatic-world');
	await worker.evaluate(() => chrome.storage.local.set({ local_storage_key_allow_main_world_functions: true }));
	await visit('/allowed/success');
	await expect(page.locator('body')).toHaveAttribute('data-automatic-world', 'page-main-world');
	await visit('/denied/function-path', 'current URL does not match');
	await expect(page.locator('body')).not.toHaveAttribute('data-automatic-world');
	await worker.evaluate((origin) => chrome.storage.local.set({ local_storage_key_project_settings: { automation: { triggers: { restrictUrls: true, urlPatterns: `${origin}/allowed/project-ok*` } } } }), new URL(localTestPage).origin);
	await visit('/allowed/project-ok');
	await expect(page.locator('body')).toHaveAttribute('data-automatic-world', 'page-main-world');
	await visit('/allowed/project-denied', 'URL is not allowed by project "automation"');
	await expect(page.locator('body')).not.toHaveAttribute('data-automatic-world');
	await worker.evaluate(() => chrome.storage.local.set({ local_storage_key_project_settings: { automation: { triggers: { enabled: false } } } }));
	await visit('/allowed/project-disabled', 'triggers are disabled for project "automation"');
	await expect(page.locator('body')).not.toHaveAttribute('data-automatic-world');
	await worker.evaluate(() => chrome.storage.local.set({ local_storage_key_project_settings: { automation: { triggers: { restrictUrls: true, urlPatterns: '' } } } }));
	await visit('/allowed/empty-project-list', 'URL is not allowed by project "automation"');
	await expect(page.locator('body')).not.toHaveAttribute('data-automatic-world');
	await worker.evaluate(async () => {
		const key = 'local_storage_key_triggers';
		const items = JSON.parse((await chrome.storage.local.get(key))[key]);
		items[0].enabled = false;
		await chrome.storage.local.set({ [key]: JSON.stringify(items), local_storage_key_project_settings: {} });
	});
	await visit('/allowed/item-disabled');
	await expect(page.locator('body')).not.toHaveAttribute('data-automatic-world');
	await worker.evaluate(async () => {
		const key = 'local_storage_key_triggers';
		const items = JSON.parse((await chrome.storage.local.get(key))[key]);
		items[0].enabled = true;
		items[0].patterns = ['*/allowed/*'];
		await chrome.storage.local.set({ [key]: JSON.stringify(items) });
	});
	await visit('/not-triggered/path');
	await expect(page.locator('body')).not.toHaveAttribute('data-automatic-world');
	await worker.evaluate(() => chrome.storage.local.set({ local_storage_key_project_settings: { functions: { functions: { mainWorld: false } } } }));
	await visit('/allowed/function-project-disabled', 'main-world access is disabled for project "functions"');
	await expect(page.locator('body')).not.toHaveAttribute('data-automatic-world');
	await worker.evaluate(async () => {
		const key = 'local_storage_key_lambdas';
		const items = JSON.parse((await chrome.storage.local.get(key))[key]);
		items[0].allowedWorlds = ['user_scripts'];
		await chrome.storage.local.set({ [key]: JSON.stringify(items), local_storage_key_project_settings: {} });
	});
	await visit('/allowed/function-item-disabled', 'not allowed for this function');
	await expect(page.locator('body')).not.toHaveAttribute('data-automatic-world');
});

test('external trigger updates preserve a dirty permission draft and block stale saves', async ({ page, extensionId }) => {
	await page.goto(`chrome-extension://${extensionId}/workspace.html#triggers`);
	await page.evaluate(async () => {
		await chrome.storage.local.clear();
		await chrome.storage.local.set({ local_storage_key_triggers: JSON.stringify([{ id: 't', name: 'existing', patterns: ['*'], commands: ['old'] }]) });
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
