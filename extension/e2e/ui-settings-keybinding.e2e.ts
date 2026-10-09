import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test('change keybinding is persisted and toggles shell', async ({
	page,
	extensionId,
	localTestPage,
	reactionTime
}) => {
	const base = `chrome-extension://${extensionId}`;
	const alreadyOpen = await page.context().newPage();
	await alreadyOpen.goto(localTestPage);

	await page.goto(`${base}/settings.html`);
	await page.waitForTimeout(reactionTime);

	const keyInput = page.locator('input[readonly]');
	await expect(keyInput).toHaveValue('Cmd + K');

	await keyInput.click();
	await page.keyboard.press('Meta+j');
	await page.waitForTimeout(reactionTime);
	await expect(keyInput).toHaveValue('Cmd + J');

	// The tab was already open when the setting changed: old stops, new starts.
	await alreadyOpen.keyboard.press('Meta+k');
	await expect(alreadyOpen.locator('#browser-lambdas-shell')).toHaveCount(0);
	await alreadyOpen.keyboard.press('Meta+j');
	await expect(alreadyOpen.locator('#browser-lambdas-shell')).toBeVisible();
	await alreadyOpen.keyboard.press('Escape');

	await page.reload();
	await page.waitForTimeout(reactionTime);
	await expect(keyInput).toHaveValue('Cmd + J');

	await page.goto(localTestPage);
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Meta+j');
	await expect(page.locator('#browser-lambdas-shell')).toBeVisible();
	await expect(page.frameLocator('#browser-lambdas-shell').locator('#shell-input')).toBeVisible();
	await page.keyboard.press('Escape');

	await page.goto(`${base}/settings.html`);
	await page.waitForTimeout(reactionTime);

	await keyInput.click();
	await page.keyboard.press('Meta+k');
	await page.waitForTimeout(reactionTime);
	await page.reload();
	await page.waitForTimeout(reactionTime);
	await expect(keyInput).toHaveValue('Cmd + K');
});

export default test;
