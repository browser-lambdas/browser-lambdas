import { test, expect } from './fixtures';

test('storage settings are independent and update open panes without losing drafts', async ({ page, extensionContext, extensionId }) => {
	const base = `chrome-extension://${extensionId}`;
	await page.goto(`${base}/settings.html`);
	await page.evaluate(() => chrome.storage.local.clear());
	await page.reload();
	await expect(page.getByTestId('allow-main-world-storage')).toHaveAttribute('aria-pressed', 'false');
	await expect(page.getByTestId('allow-main-world-secrets')).toHaveAttribute('aria-pressed', 'false');
	const workspace = await extensionContext.newPage();
	try {
		await workspace.goto(`${base}/workspace.html#storage`);
		await workspace.getByTestId('sidebar-storage-add').click();
		await workspace.getByRole('button', { name: 'Show settings' }).click();
		await workspace.getByTestId('pane-key').fill('draft');
		await workspace.getByTestId('pane-value').fill('unsaved value');
		await workspace.getByTestId('storage-url-allowlist').check();
		await workspace.getByTestId('storage-url-patterns').fill('https://example.com/*');
		await expect(workspace.getByTestId('storage-security').locator('[data-world="main"]')).toBeDisabled();
		await page.getByTestId('allow-main-world-storage').click();
		await expect(workspace.getByTestId('storage-security').locator('[data-world="main"]')).toBeEnabled();
		await expect(workspace.getByTestId('pane-value')).toHaveValue('unsaved value');
		await workspace.getByTestId('storage-security').locator('[data-world="main"]').check();
		await workspace.getByTestId('pane-save').click();
		await expect(workspace.getByTestId('sidebar-storage-item')).toHaveText('draft');
		// The selected sidebar category is different, but the storage pane stays open.
		await workspace.evaluate(() => { location.hash = 'secrets'; });
		await page.getByTestId('allow-main-world-storage').click();
		const main = workspace.getByTestId('storage-security').locator('[data-world="main"]');
		await expect(main).toBeDisabled();
		await expect(main).toBeChecked();
		await expect(page.getByTestId('allow-main-world-secrets')).toHaveAttribute('aria-pressed', 'false');
		await page.reload();
		await expect(page.getByTestId('allow-main-world-storage')).toHaveAttribute('aria-pressed', 'false');
	} finally { await workspace.close(); }
});
