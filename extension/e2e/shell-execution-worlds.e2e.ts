import { allowFunctionOnTestPages } from './function-access';
import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test('long execution-world prefixes override the configured world', async ({
	page,
	extensionId,
	localTestPage,
	reactionTime
}) => {
	const base = `chrome-extension://${extensionId}`;

	await page.goto(`${base}/workspace.html#functions`);
	await page.waitForTimeout(reactionTime);
	await page.getByTestId('sidebar-functions-add').click();
	await page.getByTestId('sidebar-functions-item').last().dblclick();
	await page.getByTestId('pane-title').last().fill('test-world-prefix');
	await page.keyboard.press('Enter');
	await page.locator('.code-editor').click();
	await page.keyboard.type("console.log(window.executionWorldMarker || 'user-world');");
	await allowFunctionOnTestPages(page, true);
	await page.getByTestId('pane-save').click();

	await page.goto(localTestPage);
	await page.evaluate(() => {
		(window as Window & { executionWorldMarker?: string }).executionWorldMarker = 'main-world';
	});
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Meta+k');

	const shell = page.frameLocator('#browser-lambdas-shell');
	const shellInput = shell.locator('#shell-input');
	const outputLines = shell.locator('#shell-outputs p');

	await shellInput.fill('@user-world test-world-prefix');
	await shellInput.press('Enter');
	await expect(outputLines.filter({ hasText: /^user-world$/ })).toHaveCount(1);

	await shellInput.fill('@main-world test-world-prefix');
	await shellInput.press('Enter');
	await expect(outputLines.filter({ hasText: /^main-world$/ })).toHaveCount(1);
});

export default test;
