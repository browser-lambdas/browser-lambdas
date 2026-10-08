import { allowFunctionOnTestPages } from './function-access';
import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test('typing .clear clears shell outputs and allows start over', async ({
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
	await page.getByTestId('pane-title').first().fill('test-shell-clear');
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Enter');
	await page.locator('.code-editor').click();
	await page.keyboard.type("console.log('ok');");
	await page.waitForTimeout(reactionTime);
	await allowFunctionOnTestPages(page);
	await page.getByRole('button', { name: 'Save' }).click();
	await page.waitForTimeout(reactionTime);

	await page.goto(localTestPage);
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Meta+k');

	const shellInput = page.frameLocator('#browser-lambdas-shell').locator('#shell-input');
	const outputs = page.frameLocator('#browser-lambdas-shell').locator('#shell-outputs p');

	await shellInput.fill('test-shell-clear');
	await shellInput.press('Enter');
	await expect
		.poll(async () => (await outputs.allTextContents()).length, { timeout: 10_000 })
		.toBe(2);
	await expect(outputs.nth(0)).toHaveText('> test-shell-clear');
	await expect(outputs.nth(1)).toHaveText('ok');

	await shellInput.fill('.clear');
	await shellInput.press('Enter');
	await expect(outputs).toHaveCount(0);

	await shellInput.fill('test-shell-clear');
	await shellInput.press('Enter');
	await expect
		.poll(async () => (await outputs.allTextContents()).length, { timeout: 10_000 })
		.toBe(2);
	await expect(outputs.nth(0)).toHaveText('> test-shell-clear');
	await expect(outputs.nth(1)).toHaveText('ok');
});

export default test;
