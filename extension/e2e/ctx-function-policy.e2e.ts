import { test, expect } from './fixtures';
import { runPolicyCommand } from './policy-helpers';

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
	await expect(page.getByRole('alert')).toContainText('allowed page patterns');
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
		await expect(page.getByTestId('function-security').locator('[data-world="main"]')).not.toBeChecked();
		await expect(page.locator('.code-editor')).toHaveValue('unsaved draft');
	} finally { await settings.close(); }
});

test('function execution respects global, project and item world ceilings, including nested calls', async ({ page, extensionContext, extensionId, localTestPage }) => {
	const worker = extensionContext.serviceWorkers()[0];
	await worker.evaluate(async () => {
		await chrome.storage.local.clear();
		await chrome.storage.local.set({
			local_storage_key_lambdas: JSON.stringify([
				{ id: 'target', project: 'alpha', name: 'target', allowedWorlds: ['user_scripts', 'main'], func: 'document.body.dataset.policyResult = "target-ran"; console.log("TARGET_RAN");' },
				{ id: 'caller', project: 'beta', name: 'caller', allowedWorlds: ['user_scripts'], func: 'await ctx.run("target"); console.log("CALLER_DONE");' }
			]),
			local_storage_key_project_settings: { alpha: { functions: { mainWorld: true } } }
		});
	});
	const run = async (command: string) => {
		await page.goto(`${localTestPage}/hierarchy`);
		return runPolicyCommand(page, command);
	};
	let output = await run('@main-world target');
	await expect(output.filter({ hasText: 'disabled globally' })).toHaveCount(1);
	await expect(page.locator('body')).not.toHaveAttribute('data-policy-result');

	await worker.evaluate(() => chrome.storage.local.set({ local_storage_key_allow_main_world_functions: true }));
	output = await run('@main-world target');
	await expect(output.filter({ hasText: /^TARGET_RAN$/ })).toHaveCount(1);
	await expect(page.locator('body')).toHaveAttribute('data-policy-result', 'target-ran');

	await worker.evaluate(() => chrome.storage.local.set({ local_storage_key_project_settings: { alpha: { functions: { mainWorld: false } } } }));
	output = await run('@main-world target');
	await expect(output.filter({ hasText: 'main-world access is disabled for project "alpha"' })).toHaveCount(1);
	await expect(page.locator('body')).not.toHaveAttribute('data-policy-result');

	await worker.evaluate(async () => {
		const key = 'local_storage_key_lambdas';
		const items = JSON.parse((await chrome.storage.local.get(key))[key]);
		items[0].allowedWorlds = ['user_scripts'];
		await chrome.storage.local.set({ [key]: JSON.stringify(items), local_storage_key_project_settings: {} });
	});
	output = await run('@main-world target');
	await expect(output.filter({ hasText: 'not allowed for this function' })).toHaveCount(1);
	await expect(page.locator('body')).not.toHaveAttribute('data-policy-result');

	await worker.evaluate(() => chrome.storage.local.set({ local_storage_key_project_settings: { alpha: { functions: { userWorld: false, mainWorld: false } } } }));
	output = await run('caller');
	await expect(output.filter({ hasText: /^CALLER_DONE$/ })).toHaveCount(1);
	await expect(output.filter({ hasText: 'disabled for project "alpha"' })).toHaveCount(1);
	await expect(page.locator('body')).not.toHaveAttribute('data-policy-result');

	await worker.evaluate(() => chrome.storage.local.set({ local_storage_key_project_settings: {} }));
	output = await run('caller');
	await expect(output.filter({ hasText: /^TARGET_RAN$/ })).toHaveCount(1);
	await expect(page.locator('body')).toHaveAttribute('data-policy-result', 'target-ran');
});

test('project and function URL lists intersect and an enabled empty list denies execution', async ({ page, extensionContext, localTestPage }) => {
	const worker = extensionContext.serviceWorkers()[0];
	await worker.evaluate(async (origin) => {
		await chrome.storage.local.clear();
		await chrome.storage.local.set({
			local_storage_key_lambdas: JSON.stringify([{ id: 'paths', project: 'alpha', name: 'paths', func: 'document.body.dataset.pathsRan = "yes"; console.log("PATHS_RAN");', urlAllowlistEnabled: true, urlPatterns: ['/\\/(project\\/allowed|outside)\\//'] }]),
			local_storage_key_project_settings: { alpha: { functions: { restrictUrls: true, urlPatterns: `${origin}/project/*` } } }
		});
	}, new URL(localTestPage).origin);
	for (const [path, permitted, reason] of [
		['/project/allowed/page', true, ''],
		['/project/other/page', false, 'current URL does not match'],
		['/outside/page', false, 'URL is not allowed by project']
	] as const) {
		await page.goto(`${localTestPage}${path}`);
		const output = await runPolicyCommand(page, 'paths');
		await expect(output.filter({ hasText: permitted ? /^PATHS_RAN$/ : reason })).toHaveCount(1);
		if (permitted) await expect(page.locator('body')).toHaveAttribute('data-paths-ran', 'yes');
		else await expect(page.locator('body')).not.toHaveAttribute('data-paths-ran');
	}
	await worker.evaluate(() => chrome.storage.local.set({ local_storage_key_project_settings: { alpha: { functions: { restrictUrls: true, urlPatterns: '' } } } }));
	await page.goto(`${localTestPage}/project/allowed/page`);
	let output = await runPolicyCommand(page, 'paths');
	await expect(output.filter({ hasText: 'URL is not allowed by project' })).toHaveCount(1);
	await expect(page.locator('body')).not.toHaveAttribute('data-paths-ran');
	await worker.evaluate(async () => {
		const key = 'local_storage_key_lambdas';
		const items = JSON.parse((await chrome.storage.local.get(key))[key]);
		items[0].urlPatterns = [];
		await chrome.storage.local.set({ [key]: JSON.stringify(items), local_storage_key_project_settings: {} });
	});
	await page.reload();
	output = await runPolicyCommand(page, 'paths');
	await expect(output.filter({ hasText: 'no allowed URL patterns are configured' })).toHaveCount(1);
	await expect(page.locator('body')).not.toHaveAttribute('data-paths-ran');
});

test('duplicate function names across projects cannot select an allowed caller identity', async ({ page, extensionContext, localTestPage }) => {
	const worker = extensionContext.serviceWorkers()[0];
	await worker.evaluate(() => chrome.storage.local.set({
		local_storage_key_lambdas: JSON.stringify(['allowed', 'other'].map((project) => ({
			id: project, project, name: 'shared-name',
			func: 'document.body.dataset.duplicateRan = "yes"; console.log(await ctx.secrets.get("duplicate-secret"));'
		}))),
		local_storage_key_secrets: JSON.stringify([{ id: 's', key: 'duplicate-secret', value: 'PRIVATE_DUPLICATE_VALUE', functionsEnabled: true, allowedFunctions: ['allowed/shared-name'] }])
	}));
	await page.goto(localTestPage);
	const output = await runPolicyCommand(page, 'shared-name');
	await expect(output.filter({ hasText: 'Function name conflict' })).toHaveCount(1);
	await expect(page.locator('body')).not.toHaveAttribute('data-duplicate-ran');
	expect((await output.allTextContents()).join('\n')).not.toContain('PRIVATE_DUPLICATE_VALUE');
});
