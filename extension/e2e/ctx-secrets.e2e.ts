import { allowFunctionOnTestPages } from './function-access';
import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test('ctx.secrets.get retrieves stored secret', async ({
	page,
	extensionId,
	localTestPage,
	reactionTime
}) => {
	const base = `chrome-extension://${extensionId}`;

	// Navigate to secrets page and create a new secret
	await page.goto(`${base}/workspace.html#secrets`);
	await page.waitForTimeout(reactionTime);
	await page.evaluate(() => chrome.storage.local.set({ local_storage_key_allow_main_world_secrets: true }));

	await page.getByTestId('sidebar-secrets-add').click();
	await page.waitForTimeout(reactionTime);

	const keyInput = page.getByTestId('pane-key');
	await keyInput.fill('API_KEY');
	await page.waitForTimeout(reactionTime);
	const valueTextarea = page.getByTestId('pane-value');
	await valueTextarea.fill('123');
	await page.getByRole('button', { name: 'Show settings' }).click();
	await page.getByTestId('secret-url-allowlist').check();
	await page.getByTestId('secret-url-patterns').fill('*127.0.0.1*');
	await page.getByTestId('secret-security').locator('[data-world="main"]').check();
	await page.waitForTimeout(reactionTime);
	await allowFunctionOnTestPages(page, true);
	await page.getByTestId('pane-save').click();
	await page.waitForTimeout(reactionTime);

	// Add a lambda that logs the secret value
	await page.goto(`${base}/workspace.html#functions`);
	await page.waitForTimeout(reactionTime);
	await page.getByTestId('sidebar-functions-add').click();
	await page.getByTestId('sidebar-functions-item').last().dblclick();
	await page.getByTestId('pane-title').last().fill('ctx-test-secrets');
	// This scenario verifies the main-world access toggle.
	await allowFunctionOnTestPages(page, true);
	await page.getByTestId('pane-world').last().selectOption('MAIN');
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Enter');
	await page.locator('.code-editor').click();
	await page.keyboard.type("console.log(await ctx.secrets.get('API_KEY'));");
	await page.waitForTimeout(reactionTime);
	await allowFunctionOnTestPages(page, true);
	await page.getByTestId('pane-save').click();
	await page.waitForTimeout(reactionTime);

	// Navigate to the test page and execute the lambda
	await page.goto(localTestPage);
	await page.waitForTimeout(reactionTime);

	await page.keyboard.press('Meta+k');
	const shellInput = page.frameLocator('#browser-lambdas-shell').locator('#shell-input');
	await shellInput.fill('ctx-test-secrets');
	await shellInput.press('Enter');

	const allParagraphs = page.frameLocator('#browser-lambdas-shell').locator('#shell-outputs p');
	await expect
		.poll(async () => (await allParagraphs.allTextContents()).length, { timeout: 10_000 })
		.toBe(2);
	await expect(allParagraphs.nth(0)).toHaveText('> ctx-test-secrets');
	await expect(allParagraphs.nth(1)).toHaveText('123');
	await page.goto(`${base}/settings.html`);
	await page.evaluate(() => chrome.storage.local.set({ local_storage_key_allow_main_world_secrets: false }));

	await page.goto(localTestPage);
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Meta+k');
	const blockedShellInput = page.frameLocator('#browser-lambdas-shell').locator('#shell-input');
	await blockedShellInput.fill('ctx-test-secrets');
	await blockedShellInput.press('Enter');
	const blockedOutput = page.frameLocator('#browser-lambdas-shell').locator('#shell-outputs p');
	await expect(blockedOutput).toHaveCount(3);
	await expect(blockedOutput.filter({ hasText: 'WARN: Secret access blocked for key "API_KEY": main-world secret access is disabled globally.' })).toHaveCount(1);
	await page.goto(`${base}/settings.html`);
	await expect.poll(() => page.evaluate(async () => {
		const { activityLogs = [] } = await chrome.storage.local.get('activityLogs');
		return activityLogs.some((entry) => entry.level === 'error' && entry.message.includes(
			'Secret access blocked for key "API_KEY": main-world secret access is disabled globally.'
		));
	})).toBe(true);
});
