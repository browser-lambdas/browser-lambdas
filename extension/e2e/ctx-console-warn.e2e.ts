import { allowFunctionOnTestPages } from './function-access';
import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test('console.warn output', async ({ page, extensionId, localTestPage, reactionTime }) => {
	const base = `chrome-extension://${extensionId}`;

	await page.goto(`${base}/workspace.html#functions`);
	await page.waitForTimeout(reactionTime);

	const functionsList = page.getByTestId('sidebar-functions-item');
	while (await functionsList.count()) {
		await functionsList.first().click();
		await page.getByTestId('pane-delete').click();
		await page.waitForTimeout(reactionTime);
	}

	await page.getByTestId('sidebar-functions-add').click();
	await page.getByTestId('sidebar-functions-item').last().dblclick();
	await page.waitForTimeout(reactionTime);
	await page.getByTestId('pane-title').last().fill('test-console-warn');
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Enter');
	await page.locator('.code-editor').click();
	await page.keyboard.type("console.warn('result');");
	await page.waitForTimeout(reactionTime);
	await allowFunctionOnTestPages(page);
	await page.getByTestId('pane-save').click();
	await page.waitForTimeout(reactionTime);

	await page.goto(localTestPage);
	await page.waitForTimeout(reactionTime);

	await page.keyboard.press('Meta+k');
	const shellInput = page.frameLocator('#browser-lambdas-shell').locator('#shell-input');
	await shellInput.fill('test-console-warn');
	await shellInput.press('Enter');

	const allParagraphs = page.frameLocator('#browser-lambdas-shell').locator('#shell-outputs p');
	await expect(allParagraphs.filter({ hasText: /^WARN: result$/ })).toHaveCount(1);
	await expect(allParagraphs.nth(0)).toHaveText('> test-console-warn');

	await shellInput.fill('@main-worlda');
	await shellInput.press('Enter');
	await expect(allParagraphs.filter({ hasText: /^WARN: Invalid prefix @main-worlda$/ })).toHaveCount(1);
	for (const prefix of ['@a', '@usr-world']) {
		await shellInput.fill(prefix);
		await shellInput.press('Enter');
		await expect(allParagraphs.filter({ hasText: new RegExp(`^WARN: Invalid prefix ${prefix}$`) })).toHaveCount(1);
	}
});
