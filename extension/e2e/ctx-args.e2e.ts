import { allowFunctionOnTestPages } from './function-access';
import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test('ctx.args.all parsing', async ({ page, extensionId, localTestPage, reactionTime }) => {
	const base = `chrome-extension://${extensionId}`;

	// Add the lambda
	await page.goto(`${base}/workspace.html#functions`);
	await page.waitForTimeout(reactionTime);
	await page.getByTestId('sidebar-functions-add').click();
	await page.getByTestId('sidebar-functions-item').last().dblclick();
	await page.getByTestId('pane-title').first().fill('ctx-test-args');
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Enter');
	await page.locator('.code-editor').click();
	await page.keyboard.type("console.log(JSON.stringify(ctx.args.all({ u: 'user' })));");
	await page.waitForTimeout(reactionTime);
	await allowFunctionOnTestPages(page);
	await page.getByRole('button', { name: 'Save' }).click();
	await page.waitForTimeout(reactionTime);

	// Navigate to test page
	await page.goto(localTestPage);
	await page.waitForTimeout(reactionTime);

	// Trigger shell and run lambda with args
	await page.keyboard.press('Meta+k');
	const shellInput = page.frameLocator('#browser-lambdas-shell').locator('#shell-input');
	await shellInput.fill('ctx-test-args --title=Hi -u alice file.txt');
	await shellInput.press('Enter');

	const allParagraphs = page.frameLocator('#browser-lambdas-shell').locator('#shell-outputs p');
	await expect
		.poll(async () => (await allParagraphs.allTextContents()).length, { timeout: 10_000 })
		.toBe(2);
	await expect(allParagraphs.nth(0)).toHaveText('> ctx-test-args --title=Hi -u alice file.txt');
	await expect(allParagraphs.nth(1)).toHaveText(
		'{"0":"file.txt","title":"Hi","user":"alice"}'
	);
});
