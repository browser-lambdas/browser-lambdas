import { allowFunctionOnTestPages } from './function-access';
import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test.setTimeout(120_000);

test('run lambda via shell', async ({ page, extensionId, localTestPage, reactionTime }) => {
	const base = `chrome-extension://${extensionId}`;

	console.log('Navigating to functions page...');
	await page.goto(`${base}/workspace.html#functions`);
	await page.waitForTimeout(reactionTime);
	console.log('Creating lambda...');
	await page.getByTestId('sidebar-functions-add').click();
	await page.getByTestId('sidebar-functions-item').last().dblclick();
	await page.getByTestId('pane-title').first().fill('e2e-test');
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Enter');
	await page.locator('.code-editor').click();
	await page.keyboard.type('console.log("e2e")');
	await page.waitForTimeout(reactionTime);
	await allowFunctionOnTestPages(page);
	await page.getByRole('button', { name: 'Save' }).click();
	await page.waitForTimeout(reactionTime);

	console.log('Navigating to local test page...');
	await page.goto(localTestPage);
	await page.waitForTimeout(reactionTime);

	console.log('Opening shell...');
	await page.keyboard.press('Meta+k');
	const shellInput = page.frameLocator('#browser-lambdas-shell').locator('#shell-input');
	await shellInput.fill('e2e-test');
	await shellInput.press('Enter');

	console.log('Checking shell output...');
	await expect(page.frameLocator('#browser-lambdas-shell').locator('#shell-outputs p')).toHaveText(['> e2e-test', 'e2e']);
});
