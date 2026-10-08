import { allowFunctionOnTestPages } from './function-access';
import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test('keep output history persists and can be cleared', async ({
	page,
	extensionId,
	localTestPage,
	reactionTime
}) => {
	const base = `chrome-extension://${extensionId}`;

	// enable Keep Output History and verify persistence
	await page.goto(`${base}/settings.html`);
	await page.waitForTimeout(reactionTime);
	await page.getByRole('button', { name: 'Clear' }).click();
	await page.waitForTimeout(reactionTime);
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				chrome.storage.local.set({ local_storage_key_stickyshell: false }, () => resolve(true))
			)
	);
	await page.reload();
	await page.waitForTimeout(reactionTime);

	const keepToggle = page.getByText('Keep Output History').locator('..').getByRole('button');
	await expect(keepToggle).toHaveAttribute('data-state', 'off');
	await keepToggle.click({ force: true });
	await page.waitForTimeout(reactionTime);
	await expect(keepToggle).toHaveAttribute('data-state', 'on');
	await expect
		.poll(async () =>
			page.evaluate(
				() =>
					new Promise((resolve) =>
						chrome.storage.local.get('local_storage_key_stickyshell', (r) =>
							resolve(r['local_storage_key_stickyshell'])
						)
					)
			)
		)
		.toBe(true);

	// create a lambda that produces output
	await page.goto(`${base}/workspace.html#functions`);
	await page.waitForTimeout(reactionTime);
	await page.getByTestId('sidebar-functions-add').click();
	await page.getByTestId('sidebar-functions-item').last().dblclick();
	await page.getByTestId('pane-title').first().fill('test-clear-history');
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Enter');
	await page.locator('.code-editor').click();
	await page.keyboard.type("console.log('hello');");
	await page.waitForTimeout(reactionTime);
	await allowFunctionOnTestPages(page);
	await page.getByRole('button', { name: 'Save' }).click();
	await page.waitForTimeout(reactionTime);

	// run lambda on test page
	await page.goto(localTestPage);
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Meta+k');
	const shellInput = page.frameLocator('#browser-lambdas-shell').locator('#shell-input');
	await shellInput.fill('test-clear-history');
	await shellInput.press('Enter');

	const outputLines = page.frameLocator('#browser-lambdas-shell').locator('#shell-outputs p');
	await expect
		.poll(async () => (await outputLines.allTextContents()).length, { timeout: 10_000 })
		.toBe(2);

	// close and reopen shell to confirm history persists
	await page.keyboard.press('Escape');
	await expect(page.locator('#browser-lambdas-shell')).toHaveCount(0);
	await page.reload();
	await page.waitForTimeout(reactionTime);
	await expect(page.locator('#browser-lambdas-shell')).toHaveCount(0);
	await page.keyboard.press('Meta+k');
	await expect(outputLines).toHaveCount(2);

	// Clear from a separate Settings tab while this shell remains open.
	const settingsTab = await page.context().newPage();
	await settingsTab.goto(`${base}/settings.html`);
	await settingsTab.waitForTimeout(reactionTime);
	await settingsTab.getByRole('button', { name: 'Clear' }).click();
	await settingsTab.waitForTimeout(reactionTime);
	await expect(outputLines).toHaveCount(0);
	await settingsTab.close();

	// Navigate to the test page again and confirm persisted history is empty.
	await page.goto(`${base}/settings.html`);
	await page.waitForTimeout(reactionTime);

	// open shell again on test page - should be empty
	await page.goto(localTestPage);
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Meta+k');
	await expect(page.locator('#browser-lambdas-shell')).toBeVisible();
	await expect(page.frameLocator('#browser-lambdas-shell').locator('#shell-outputs p')).toHaveCount(0);
	const clearedInput = page.frameLocator('#browser-lambdas-shell').locator('#shell-input');
	await clearedInput.press('ArrowUp');
	await expect(clearedInput).toHaveValue('');

	// disable Keep Output History
	await page.goto(`${base}/settings.html`);
	await page.waitForTimeout(reactionTime);
	const keepToggleOff = page.getByText('Keep Output History').locator('..').getByRole('button');
	await keepToggleOff.click({ force: true });
});
export default test;
