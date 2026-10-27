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

test('disable and re-enable shortcut in existing tabs without losing the binding', async ({ page, extensionId, localTestPage, reactionTime }) => {
	const site = await page.context().newPage();
	await site.goto(localTestPage);
	await page.goto(`chrome-extension://${extensionId}/settings.html`);
	const toggle = page.locator('#keybinding-settings').getByRole('button', { name: 'Enable key binding', exact: true });
	const binding = page.locator('#shell-keybinding');
	await expect(toggle).toHaveAttribute('aria-pressed', 'true');
	await binding.click();
	await page.keyboard.press('Meta+j');
	await expect(binding).toHaveValue('Cmd + J');
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-pressed', 'false');
	await expect(binding).toBeDisabled();
	await site.keyboard.press('Meta+j');
	await expect(site.locator('#browser-lambdas-shell')).toHaveCount(0);
	await page.reload();
	await expect(toggle).toHaveAttribute('aria-pressed', 'false');
	await expect(binding).toHaveValue('Cmd + J');
	await site.reload();
	await site.waitForTimeout(reactionTime);
	await site.keyboard.press('Meta+j');
	await expect(site.locator('#browser-lambdas-shell')).toHaveCount(0);
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-pressed', 'true');
	await site.keyboard.press('Meta+j');
	await expect(site.locator('#browser-lambdas-shell')).toBeVisible();
});
