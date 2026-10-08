import { test, expect } from './fixtures';

test('Poll changes is configured in Settings and persists', async ({ page, extensionId }) => {
	await page.goto(`chrome-extension://${extensionId}/settings.html`);
	await page.evaluate(() => chrome.storage.local.set({ local_storage_key_baah_poll_changes: true }));
	await page.reload();
	const poll = page.locator('[data-action="toggle-baah-poll"]');
	await expect(poll).toBeVisible();
	await expect(poll).toHaveAttribute('aria-pressed', 'true');
	await poll.click();
	await expect(poll).toHaveAttribute('aria-pressed', 'false');
	await expect.poll(() => page.evaluate(async () => (await chrome.storage.local.get('local_storage_key_baah_poll_changes')).local_storage_key_baah_poll_changes)).toBe(false);
	await page.goto(`chrome-extension://${extensionId}/workspace.html#triggers`);
	await expect(page.locator('[data-action="toggle-baah-poll"]')).toHaveCount(0);
	await page.evaluate(() => chrome.storage.local.set({
		local_storage_key_triggers: JSON.stringify([{
			id: 'live-sync-trigger',
			name: 'live-sync-trigger',
			project: 'live-sync-project',
			patterns: ['https://example.com/live-sync*'],
			commands: ['noop']
		}])
	}));
	await expect(page.locator('.project-title').filter({ hasText: 'live-sync-project' })).toBeVisible();
	await expect(page.getByTestId('sidebar-triggers-item').filter({ hasText: 'live-sync-trigger' })).toBeVisible();
	await page.evaluate(() => chrome.storage.local.remove('local_storage_key_triggers'));
	await expect(page.getByTestId('sidebar-triggers-item').filter({ hasText: 'live-sync-trigger' })).toHaveCount(0);
	await page.evaluate(() => chrome.storage.local.remove('local_storage_key_baah_poll_changes'));
});
