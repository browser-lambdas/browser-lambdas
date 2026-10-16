import { test, expect } from './fixtures';

test('hover selects a category and keeps it selected when moving into items', async ({ page, extensionId }) => {
	const base = `chrome-extension://${extensionId}`;

	await page.goto(`${base}/workspace.html#functions`);
	await expect(page.getByTestId('sidebar-functions-add')).toBeVisible();

	await page.getByRole('link', { name: 'Secrets' }).hover();
	await expect(page.getByTestId('sidebar-secrets-add')).toBeVisible();
	await expect(page).toHaveURL(`${base}/workspace.html#secrets`);
	await expect(page.getByRole('link', { name: 'Secrets' })).toHaveClass(/active/);

	await page.getByTestId('sidebar-secrets-add').hover();
	await expect(page.getByRole('link', { name: 'Secrets' })).toHaveClass(/active/);
	await page.getByTestId('sidebar-secrets-add').click();
	await expect(page.locator('[data-pane-type=secret]')).toBeVisible();
	await page.locator('.editor-area').hover({ position: { x: 20, y: 20 } });
	await expect(page.getByTestId('sidebar-secrets-add')).toBeVisible();

	await page.getByTitle('Collapse sidebar').click();
	await page.getByRole('link', { name: 'K-V' }).hover();
	await expect(page.getByTestId('sidebar-storage-add')).toHaveCount(0);
	await expect(page.getByTitle('Expand sidebar')).toBeVisible();
});

test('category clicks reopen the collapsed sidebar without replacing an unsaved editor', async ({ page, extensionId }) => {
	await page.goto(`chrome-extension://${extensionId}/workspace.html#functions`);
	await page.getByTestId('sidebar-functions-add').click();
	const editor = page.getByLabel('Code', { exact: true });
	await editor.fill('unsaved draft');
	await page.getByTitle('Collapse sidebar').click();
	await editor.evaluate((el) => { (el as HTMLElement).dataset.identity = 'preserved'; });
	for (const [label, category] of [['Functions', 'functions'], ['Secrets', 'secrets']]) {
		await page.getByRole('link', { name: label, exact: true }).click();
		await expect(page.getByTestId(`sidebar-${category}-add`)).toBeVisible();
		await expect(page.getByTitle('Expand sidebar')).toHaveCount(0);
		await expect(editor).toHaveValue('unsaved draft');
		await expect(editor).toHaveAttribute('data-identity', 'preserved');
		await page.getByTitle('Collapse sidebar').click();
		await editor.evaluate((el) => { (el as HTMLElement).dataset.identity = 'preserved'; });
	}
	const functions = page.getByRole('link', { name: 'Functions', exact: true });
	await functions.focus();
	await functions.press('Enter');
	await expect(page.getByTestId('sidebar-functions-add')).toBeVisible();
	await expect(editor).toHaveAttribute('data-identity', 'preserved');
});

test('navigates every workspace destination and follows browser history', async ({ page, extensionId }) => {
	const base = `chrome-extension://${extensionId}`;
	const destinations = [
		{ label: 'K-V', hash: 'storage' },
		{ label: 'Triggers', hash: 'triggers' },
		{ label: 'Secrets', hash: 'secrets' },
		{ label: 'Styles', hash: 'styles' },
		{ label: 'Activity', hash: 'activity' }
	];

	await page.goto(`${base}/workspace.html#functions`);
	for (const destination of destinations) {
		const link = page.getByRole('link', { name: destination.label });
		await link.click();
		await expect(page).toHaveURL(`${base}/workspace.html#${destination.hash}`);
		await expect(link).toHaveClass(/active/);
	}

	await page.getByRole('link', { name: 'Settings' }).click();
	await expect(page).toHaveURL(`${base}/settings.html`);
	await expect(page.getByRole('link', { name: 'Settings' })).toHaveClass(/active/);
	await page.goBack();
	await expect(page).toHaveURL(`${base}/workspace.html#activity`);
	await expect(page.getByRole('link', { name: 'Activity' })).toHaveClass(/active/);
	await page.goForward();
	await expect(page).toHaveURL(`${base}/settings.html`);
});

test('logo opens local documentation in a browser tab', async ({ page, extensionId }) => {
	await page.goto(`chrome-extension://${extensionId}/workspace.html#functions`);
	const home = page.getByRole('link', { name: 'Home', exact: true });
	await expect(home).toHaveAttribute('href', 'file:///Users/jh/dev/browser-lambdas/web/index.html');
	await page.evaluate(() => {
		(window as any).__documentationTab = null;
		chrome.tabs.create = async (options: any) => { (window as any).__documentationTab = options; return {} as any; };
	});
	await home.click();
	expect(await page.evaluate(() => (window as any).__documentationTab)).toEqual({ url: 'file:///Users/jh/dev/browser-lambdas/web/index.html', active: true });
	await expect(page).toHaveURL(`chrome-extension://${extensionId}/workspace.html#functions`);
});

test('hover preserves the editor draft and opens an item from the hovered category', async ({ page, extensionId }) => {
	await page.goto(`chrome-extension://${extensionId}/workspace.html#functions`);
	await page.evaluate(async () => {
		await chrome.storage.local.clear();
		await chrome.storage.local.set({ local_storage_key_storage: JSON.stringify([{ id: 'hover-key', key: 'hover-key', value: 'stored value' }]) });
	});
	await page.reload();
	await page.getByTestId('sidebar-functions-add').click();
	const editor = page.getByLabel('Code', { exact: true });
	await editor.fill('unsaved draft');
	await editor.evaluate((el) => { (el as HTMLTextAreaElement).dataset.hoverIdentity = 'preserved'; });
	await page.getByRole('link', { name: 'K-V', exact: true }).hover();
	await expect(editor).toHaveValue('unsaved draft');
	await expect(editor).toHaveAttribute('data-hover-identity', 'preserved');
	const item = page.getByTestId('sidebar-storage-item');
	await item.hover();
	await expect(item).toHaveText('hover-key');
	await expect(page.getByRole('link', { name: 'K-V', exact: true })).toHaveClass(/active/);
	await item.click();
	await expect(page.getByTestId('pane-value')).toHaveValue('stored value');
	await expect(page.locator('[data-pane-type=storage]')).toBeVisible();
});

for (const tab of ['functions', 'storage', 'secrets', 'triggers', 'styles']) {
	test(`${tab} can be renamed in the sidebar`, async ({ page, extensionId }) => {
		await page.goto(`chrome-extension://${extensionId}/workspace.html#${tab}`);
		await page.evaluate(() => chrome.storage.local.clear());
		await page.reload();
		await page.getByTestId(`sidebar-${tab}-add`).click();
		const title = page.getByTestId('pane-title');
		const original = await title.inputValue();
		if (tab === 'functions') await page.getByLabel('Code', { exact: true }).fill('unsaved code');
		const row = page.getByTestId(`sidebar-${tab}-item`).first();
		await row.hover();
		await row.getByRole('button', { name: 'Rename', exact: true }).click();
		const input = page.getByRole('textbox', { name: 'New name', exact: true });
		await input.fill('cancelled');
		await input.press('Escape');
		await expect(title).toHaveValue(original);
		await row.hover();
		await row.getByRole('button', { name: 'Rename', exact: true }).click();
		await input.fill('');
		await input.press('Enter');
		await expect(page.getByRole('alert')).toHaveText('Enter a name.');
		await input.fill(`renamed-${tab}`);
		await input.press('Enter');
		await expect(row).toHaveText(`renamed-${tab}`);
		await expect(title).toHaveValue(`renamed-${tab}`);
		if (tab === 'functions') await expect(page.getByLabel('Code', { exact: true })).toHaveValue('unsaved code');
		if (['storage', 'secrets'].includes(tab)) {
			await title.fill(`footer-${tab}`);
			await page.getByTestId('pane-save').click();
			await expect(row).toHaveText(`footer-${tab}`);
		}
		await page.reload();
		await expect(row).toHaveText(`${['storage', 'secrets'].includes(tab) ? 'footer' : 'renamed'}-${tab}`);
		await page.screenshot({ path: `/private/tmp/workspace-rename-${tab}.png` });
	});
}


test('category hover waits 200ms and cancels when the pointer leaves', async ({ page, extensionId }) => {
	await page.goto(`chrome-extension://${extensionId}/workspace.html#storage`);
	await expect(page.getByTestId('sidebar-storage-add')).toBeVisible();
	const clockStart = new Date('2030-01-01T00:00:00Z');
	await page.clock.install({ time: clockStart });
	await page.clock.pauseAt(new Date(clockStart.getTime() + 1_000));
	const functions = page.getByRole('link', { name: 'Functions', exact: true });
	await functions.hover();
	await page.clock.runFor(199);
	await expect(page).toHaveURL(/#storage$/);
	await page.locator('.editor-area').hover();
	await page.clock.runFor(250);
	await expect(page).toHaveURL(/#storage$/);
	await functions.hover();
	await page.clock.runFor(199);
	await expect(page).toHaveURL(/#storage$/);
	await page.clock.runFor(1);
	await expect(page).toHaveURL(/#functions$/);
	await page.getByRole('link', { name: 'Secrets', exact: true }).click();
	await expect(page).toHaveURL(/#secrets$/);
	await page.clock.runFor(250);
	await expect(page).toHaveURL(/#secrets$/);
});
