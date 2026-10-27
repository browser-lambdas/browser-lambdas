import { test, expect } from './fixtures';

for (const [tab, kind] of [['functions', 'function'], ['storage', 'storage'], ['secrets', 'secret']]) {
	test(`${tab} show world switches and preserve disabled allowlist patterns`, async ({ page, extensionId }) => {
		await page.goto(`chrome-extension://${extensionId}/workspace.html#${tab}`);
		await page.evaluate(() => chrome.storage.local.clear());
		await page.reload();
		await page.getByTestId(`sidebar-${tab}-add`).click();
		if (tab === 'functions' || tab === 'storage') {
			await expect(page.getByTestId('pane-content')).toHaveClass(/editor-maximized/);
			await expect(page.getByRole('button', { name: 'Copy code' })).toHaveCount(0);
			await expect(page.getByTestId('pane-content').locator('.access-controls')).toBeHidden();
			await expect(page.getByTestId('pane-content').getByTestId('pane-settings')).toHaveCount(0);
			await expect(page.locator('.pane-footer').getByTestId('pane-settings')).toBeVisible();
			if (tab === 'storage') await expect(page.locator('[data-usage-for]')).toBeHidden();
			await page.getByRole('button', { name: 'Show settings' }).click();
		}
		if (tab === 'secrets') await page.getByRole('button', { name: 'Show settings' }).click();
		const security = page.getByTestId(`${kind}-security`);
		if (tab === 'storage') {
			await expect(security.getByRole('switch')).toHaveCount(3);
			await expect(page.getByRole('button', { name: /^Copy / })).toHaveCount(0);
		}
		await expect(security.getByRole('switch', { name: tab === 'storage' ? 'Enable in user world' : 'Allow execution in user world', exact: true })).toBeChecked();
		await expect(security.getByRole('switch', { name: tab === 'storage' ? 'Enable in main world' : 'Allow execution in main world', exact: true })).toBeDisabled();
		if (tab === 'functions') {
			await expect(page.getByLabel('Code', { exact: true })).toBeVisible();
			await page.getByLabel('Code', { exact: true }).fill('console.log("code");');
			await expect(security.getByTestId('pane-world')).toBeVisible();
			await expect(security.getByTestId('pane-world').locator('option')).toHaveText(['Use project default (User world)', 'User world', 'Main world']);
		} else await expect(security.getByTestId('pane-world')).toHaveCount(0);
		const patterns = page.getByTestId(`${kind}-url-patterns`);
		const toggle = security.getByRole('switch', { name: tab === 'functions' ? 'Only allow execution on specific URLs' : 'Only allow on specific URLs', exact: true });
		await expect(toggle).not.toBeChecked();
		await expect(patterns).toBeDisabled();
		await toggle.check();
		await patterns.fill('https://example.com/*');
		await toggle.uncheck();
		await expect(patterns).toBeDisabled();
		await expect(security.locator('.url-allowlist-area')).toHaveClass(/muted/);
		await expect(patterns).toHaveValue('https://example.com/*');
		await page.getByTestId('pane-save').click();
		await page.reload();
		await page.getByTestId(`sidebar-${tab}-item`).click();
		await page.getByRole('button', { name: 'Show settings' }).click();
		await expect(toggle).not.toBeChecked();
		await expect(patterns).toBeDisabled();
		await toggle.check();
		await expect(patterns).toBeEnabled();
		await expect(patterns).toHaveValue('https://example.com/*');
	});
}

test('trigger panel orders paths, commands and Security without an optional allowlist', async ({ page, extensionId }) => {
	await page.goto(`chrome-extension://${extensionId}/workspace.html#triggers`);
	await page.getByTestId('sidebar-triggers-add').click();
	await expect(page.getByTestId('trigger-url-patterns')).toBeVisible();
	await expect(page.getByTestId('trigger-commands')).toBeVisible();
	await expect(page.getByTestId('trigger-security')).toBeHidden();
	await page.getByRole('button', { name: 'Show settings' }).click();
	const security = page.getByTestId('trigger-security');
	await expect(security.getByRole('switch', { name: 'Run automatically', exact: true })).toBeChecked();
	await expect(security.getByRole('switch', { name: 'Only allow on specific URLs' })).toHaveCount(0);
	await expect(security.locator('textarea, select')).toHaveCount(0);
	const order = await page.locator('.trigger-form').evaluate((form) => [...form.querySelectorAll('textarea, section')].map((el) => el.getAttribute('data-testid')));
	expect(order).toEqual(['trigger-url-patterns', 'trigger-commands', 'trigger-security']);
});

for (const [tab, editor] of [['functions', '.code-editor'], ['storage', '.storage-value']]) {
	test(`${tab} maximize stays within its pane and preserves drafts`, async ({ page, extensionId }) => {
		await page.goto(`chrome-extension://${extensionId}/workspace.html#${tab}`);
		await page.getByTestId(`sidebar-${tab}-add`).click();
		if (tab === 'functions' || tab === 'storage') {
			await expect(page.getByTestId('pane-content')).toHaveClass(/editor-maximized/);
			await expect(page.getByRole('button', { name: 'Copy code' })).toHaveCount(0);
			await expect(page.getByTestId('pane-content').locator('.access-controls')).toBeHidden();
			await expect(page.getByTestId('pane-content').getByTestId('pane-settings')).toHaveCount(0);
			await expect(page.locator('.pane-footer').getByTestId('pane-settings')).toBeVisible();
			if (tab === 'storage') await expect(page.locator('[data-usage-for]')).toBeHidden();
			await page.getByRole('button', { name: 'Show settings' }).click();
		}
		await page.locator(editor).fill('draft before maximize');
		await page.getByTestId('pane').getByRole('button', { name: 'Split right', exact: true }).click();
		const first = page.getByTestId('pane').first();
		const second = page.getByTestId('pane').last();
		await expect(first.getByTestId('pane-category-icon').locator('svg')).toHaveCount(1);
		const initial = await first.locator(editor).boundingBox();
		await first.getByRole('button', { name: 'Hide settings' }).click();
		await expect(first.getByTestId('pane-content')).toHaveClass(/editor-maximized/);
		await expect(second.getByTestId('pane-content')).toHaveClass(/editor-maximized/);
		await expect(first.locator(editor)).toHaveValue('draft before maximize');
		const expanded = await first.locator(editor).boundingBox();
		expect(expanded!.height).toBeGreaterThan(initial!.height);
		await first.locator(editor).fill('draft while maximized');
		await first.getByRole('button', { name: 'Show settings' }).click();
		await expect(first.locator(editor)).toHaveValue('draft while maximized');
		await expect(first.getByTestId('pane-content')).not.toHaveClass(/editor-maximized/);
	});
}

test('function dropdown follows grants and shows Disabled with neither world', async ({ page, extensionId }) => {
	await page.goto(`chrome-extension://${extensionId}/workspace.html#functions`);
	await page.evaluate(() => chrome.storage.local.clear());
	await page.reload();
	await page.getByTestId('sidebar-functions-add').click();
	await page.getByRole('button', { name: 'Show settings' }).click();
	const security = page.getByTestId('function-security');
	const world = page.getByTestId('pane-world');
	await expect(world.locator('option[value="MAIN"]')).toHaveJSProperty('disabled', true);
	await security.locator('[data-world="user_scripts"]').uncheck();
	await expect(world).toBeDisabled();
	await expect(world.locator('option:checked')).toHaveText('Disabled');
	await expect(world.locator('option')).toHaveCount(1);
	await expect(world).toHaveAttribute('title', 'No execution worlds enabled');
	await page.evaluate(() => chrome.storage.local.set({ local_storage_key_allow_main_world_functions: true }));
	await security.locator('[data-world="main"]').check();
	await expect(world).toBeEnabled();
	await expect(world).toHaveValue('');
	await expect(world.locator('option:checked')).toHaveText('Use project default (User world, disabled)');
	await world.selectOption('MAIN');
	await expect(world).toHaveValue('MAIN');
	await expect(world.locator('option[value="USER_SCRIPT"]')).toHaveJSProperty('disabled', true);
	await expect(security.getByRole('link', { name: 'global settings', exact: true }).last()).toHaveAttribute('href', './settings.html#main-world-functions');
	await expect(security).toContainText('dangerous');
});

for (const tab of ['functions', 'storage', 'secrets']) {
	test(`${tab} security link scrolls to its global setting after loading`, async ({ page, extensionId }) => {
		await page.goto(`chrome-extension://${extensionId}/workspace.html#${tab}`);
		await page.getByTestId(`sidebar-${tab}-add`).click();
		await page.getByRole('button', { name: 'Show settings' }).click();
		const link = page.getByRole('link', { name: 'global settings', exact: true }).last();
		await expect(link).toHaveAttribute('href', `./settings.html#main-world-${tab}`);
		// Visit the link in this tab so the assertion targets the loaded settings page.
		await page.goto(new URL((await link.getAttribute('href'))!, page.url()).href);
		const target = page.locator(`#main-world-${tab}`);
		await expect(target).toBeInViewport();
		expect(await page.locator('.settings-scroll').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
		await page.evaluate(() => { location.hash = '#main-world-functions'; });
		await expect(page.locator('#main-world-functions')).toBeInViewport();
	});
}

for (const [tab, kind] of [['functions', 'function'], ['storage', 'storage'], ['secrets', 'secret'], ['triggers', 'trigger']]) {
	test(`${tab} gear stays green while settings are open`, async ({ page, extensionId }) => {
		await page.goto(`chrome-extension://${extensionId}/workspace.html#${tab}`);
		await page.getByTestId(`sidebar-${tab}-add`).click();
		const gear = page.getByTestId('pane-settings');
		const security = page.getByTestId(`${kind}-security`);
		await expect(security).toBeHidden();
		await expect(gear).toHaveAttribute('aria-pressed', 'false');
		if (tab === 'secrets') await expect(page.getByTestId('pane-value')).toBeVisible();
		if (tab === 'triggers') await expect(page.getByTestId('trigger-commands')).toBeVisible();
		if (tab === 'functions' || tab === 'storage') {
			const box = page.locator(tab === 'functions' ? '.function-code-box' : '.storage-code-box');
			const outer = await page.getByTestId('pane-content').boundingBox();
			const inner = await box.boundingBox();
			expect(Math.abs(inner!.width - outer!.width)).toBeLessThan(2);
			expect(Math.abs(inner!.height - outer!.height)).toBeLessThan(2);
			await expect(page.getByTestId('pane-content').getByText(tab === 'functions' ? 'Code' : 'Value', { exact: true })).toHaveCount(0);
		}
		await gear.click();
		await page.mouse.move(0, 0);
		await expect(gear).toHaveAttribute('aria-pressed', 'true');
		await expect(security).toBeVisible();
		const title = page.getByTestId('item-settings-title');
		await expect(title).toHaveText('Settings');
		const categoryIcon = await page.getByTestId('pane-category-icon').locator('svg').innerHTML();
		expect(await title.locator('svg').innerHTML()).toBe(categoryIcon);
		const expectedColor = await page.evaluate(() => {
			const probe = document.createElement('span');
			probe.style.color = 'var(--green)';
			document.body.append(probe);
			const color = getComputedStyle(probe).color;
			probe.remove();
			return color;
		});
		await expect(gear).toHaveCSS('color', expectedColor);
		await gear.click();
		await expect(gear).toHaveAttribute('aria-pressed', 'false');
		await expect(security).toBeHidden();
		await expect(page.getByTestId('item-settings-title')).toHaveCount(0);
	});
}

test('function usage updates with code and name edits', async ({ page, extensionId }) => {
	await page.goto(`chrome-extension://${extensionId}/workspace.html#functions`);
	await page.getByTestId('sidebar-functions-add').click();
	await page.getByTestId('pane-title').fill('do-something');
	await page.getByLabel('Code', { exact: true }).fill('const { 0: first, 1: second } = ctx.args.all();');
	await page.getByTestId('pane-settings').click();
	const usage = page.locator('[data-function-usage]');
	await expect(usage).toHaveValue('# invoke in terminal\n> do-something pos1 pos2\n\n# tabs\nawait ctx.tabs.this().run("do-something pos1 pos2");');
	await page.getByTestId('pane-title').fill('renamed');
	await expect(usage).toHaveValue(/> renamed pos1 pos2/);
});

for (const tab of ['triggers', 'secrets']) {
	test(`${tab} text fields are taller and do not soft-wrap`, async ({ page, extensionId }) => {
		await page.goto(`chrome-extension://${extensionId}/workspace.html#${tab}`);
		await page.getByTestId(`sidebar-${tab}-add`).click();
		const fields = tab === 'triggers' ? ['trigger-url-patterns', 'trigger-commands'] : ['pane-value'];
		for (const id of fields) {
			const field = page.getByTestId(id);
			await expect(field).toHaveAttribute('wrap', 'off');
			await expect(field).toHaveCSS('white-space', 'pre');
			expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(210);
		}
	});
}
