import { allowFunctionOnTestPages } from './function-access';
import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test('autocomplete and history navigation', async ({
	page,
	extensionId,
	localTestPage,
	reactionTime
}) => {
	const base = `chrome-extension://${extensionId}`;

	// Add first lambda
	await page.goto(`${base}/workspace.html#functions`);
	await page.waitForTimeout(reactionTime);
	await page.getByTestId('sidebar-functions-add').click();
	await page.getByTestId('sidebar-functions-item').last().dblclick();
	await page.getByTestId('pane-title').first().fill('auto-foo');
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Enter');
	await page.locator('.code-editor').click();
	await page.keyboard.type("console.log('foo');");
	await page.waitForTimeout(reactionTime);
	await allowFunctionOnTestPages(page);
	await page.getByRole('button', { name: 'Save' }).click();
	await page.waitForTimeout(reactionTime);

	// Add second lambda
	await page.getByTestId('sidebar-functions-add').click();
	await page.getByTestId('sidebar-functions-item').last().dblclick();
	await page.getByTestId('pane-title').first().fill('auto-bar');
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Enter');
	await page.locator('.code-editor').click();
	await page.keyboard.type("console.log('bar');");
	await page.waitForTimeout(reactionTime);
	await allowFunctionOnTestPages(page);
	await page.getByRole('button', { name: 'Save' }).click();
	await page.waitForTimeout(reactionTime);

	// Navigate to test page
	await page.goto(localTestPage);
	await page.waitForTimeout(reactionTime);

	// Open shell and run first command with autocomplete
	await page.keyboard.press('Meta+k');
	const shellInput = page.frameLocator('#browser-lambdas-shell').locator('#shell-input');
	const outputs = page.frameLocator('#browser-lambdas-shell').locator('#shell-outputs p');

	await shellInput.fill('auto-f');
	await expect(shellInput).toHaveAttribute('data-suggestion', 'oo');
	await shellInput.press('Tab');
	await expect(shellInput).toHaveValue('auto-foo');
	await shellInput.press('Enter');

	await expect
		.poll(async () => (await outputs.allTextContents()).length, { timeout: 10_000 })
		.toBe(2);
	await expect(outputs.nth(0)).toHaveText('> auto-foo');
	await expect(outputs.nth(1)).toHaveText('foo');

	// Run second command
	await shellInput.fill('auto-b');
	await expect(shellInput).toHaveAttribute('data-suggestion', 'ar');
	await shellInput.press('Tab');
	await expect(shellInput).toHaveValue('auto-bar');
	await shellInput.press('Enter');

	await expect
		.poll(async () => (await outputs.allTextContents()).length, { timeout: 10_000 })
		.toBe(4);
	await expect(outputs.nth(2)).toHaveText('> auto-bar');
	await expect(outputs.nth(3)).toHaveText('bar');

	// Close shell
	await shellInput.focus();
	await page.keyboard.press('Escape');
	await page.waitForTimeout(reactionTime);

	// Reopen shell and verify history navigation
	await page.keyboard.press('Meta+k');
	await page.waitForTimeout(reactionTime);

	await shellInput.press('ArrowUp');
	await expect(shellInput).toHaveValue('auto-bar');

	await shellInput.press('ArrowUp');
	await expect(shellInput).toHaveValue('auto-foo');

	await shellInput.press('ArrowDown');
	await expect(shellInput).toHaveValue('auto-bar');

	await shellInput.press('ArrowDown');
	await expect(shellInput).toHaveValue('');
});

export default test;
