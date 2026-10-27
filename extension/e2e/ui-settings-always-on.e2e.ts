import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test('always show shell persists and auto-opens shell', async ({
	page,
	extensionId,
	localTestPage,
	reactionTime
}) => {
	const base = `chrome-extension://${extensionId}`;

	// enable Always Show Terminal and verify persistence
	await page.goto(`${base}/settings.html`);
	await page.waitForTimeout(reactionTime);
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				chrome.storage.local.set({ local_storage_key_shell_always_on: false }, () => resolve(true))
			)
	);
	await page.reload();
	await page.waitForTimeout(reactionTime);

	const alwaysToggle = page.getByText('Always Show Terminal').locator('..').getByRole('button');
	await expect(alwaysToggle).toHaveAttribute('data-state', 'off');
	await alwaysToggle.click({ force: true });
	await page.waitForTimeout(reactionTime);
	await expect(alwaysToggle).toHaveAttribute('data-state', 'on');
	await expect
		.poll(async () =>
			page.evaluate(
				() =>
					new Promise((resolve) =>
						chrome.storage.local.get('local_storage_key_shell_always_on', (r) =>
							resolve(r['local_storage_key_shell_always_on'])
						)
					)
			)
		)
		.toBe(true);

	// open a new tab and verify shell opens automatically
	const tab = await page.context().newPage();
	await tab.goto(localTestPage);
	await tab.waitForTimeout(reactionTime);
	await expect(tab.locator('#browser-lambdas-shell')).toBeVisible();
	await expect(tab.frameLocator('#browser-lambdas-shell').locator('#shell-input')).toBeVisible();

	await tab.close();

	// disable Always Show Terminal
	await page.bringToFront();
	const alwaysToggleOff = page.getByText('Always Show Terminal').locator('..').getByRole('button');
	await alwaysToggleOff.click();
	await expect(alwaysToggleOff).toHaveAttribute('data-state', 'off');
	await expect
		.poll(async () =>
			page.evaluate(
				() =>
					new Promise((resolve) =>
						chrome.storage.local.get('local_storage_key_shell_always_on', (r) =>
							resolve(r['local_storage_key_shell_always_on'])
						)
					)
			)
		)
		.toBe(false);
});

export default test;
