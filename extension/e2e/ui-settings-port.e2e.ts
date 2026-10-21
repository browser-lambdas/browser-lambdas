import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test('websocket port persists after reload', async ({ page, extensionId, reactionTime }) => {
	const base = `chrome-extension://${extensionId}`;

	await page.goto(`${base}/settings.html`);
	await page.waitForTimeout(reactionTime);

	const portInput = page.locator('[data-action="ws-port"]');
	await portInput.fill('5555');
	await portInput.blur();
	await page.waitForTimeout(reactionTime);

	await page.reload();
	await page.waitForTimeout(reactionTime);

	await expect(portInput).toHaveValue('5555');

	// Invalid values retain the last working connection setting.
	for (const invalid of ['', '0', '65536', '12x', '44.5']) {
		await portInput.fill(invalid);
		await portInput.blur();
		await expect(portInput).toHaveValue('5555');
		expect(await page.evaluate(async () => (await chrome.storage.local.get('local_storage_key_ws_port')).local_storage_key_ws_port)).toBe(5555);
	}
	await page.evaluate(() => chrome.storage.local.remove('local_storage_key_ws_port'));
});

export default test;
