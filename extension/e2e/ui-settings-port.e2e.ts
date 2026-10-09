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
});

export default test;
