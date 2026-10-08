import { allowFunctionOnTestPages } from './function-access';
import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test('ctx.run executes another lambda', async ({
	page,
	extensionId,
	localTestPage,
	reactionTime
}) => {
	const base = `chrome-extension://${extensionId}`;

	// first lambda
	await page.goto(`${base}/workspace.html#functions`);
	await page.waitForTimeout(reactionTime);
	await page.getByTestId('sidebar-functions-add').click();
	await page.getByTestId('sidebar-functions-item').last().dblclick();
	await page.getByTestId('pane-title').first().fill('ctx-test-run-first');
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Enter');
	await page.locator('.code-editor').click();
	await page.keyboard.type("const { 0: msg } = ctx.args.all();\nconsole.log('one', msg);");
	await page.waitForTimeout(reactionTime);
	await allowFunctionOnTestPages(page);
	await page.getByRole('button', { name: 'Save' }).click();
	await page.waitForTimeout(reactionTime);

	// second lambda
	await page.getByTestId('sidebar-functions-add').click();
	await page.getByTestId('sidebar-functions-item').last().dblclick();
	await page.getByTestId('pane-title').first().fill('ctx-test-run-second');
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Enter');
	await page.locator('.code-editor').click();
	await page.keyboard.type("await ctx.run('ctx-test-run-first hello');");
	await page.waitForTimeout(reactionTime);
	await allowFunctionOnTestPages(page);
	await page.getByRole('button', { name: 'Save' }).click();
	await page.waitForTimeout(reactionTime);

	// Navigate to page and run second lambda via shell
	await page.goto(localTestPage);
	await page.waitForTimeout(reactionTime);

	await page.keyboard.press('Meta+k');
	const shellInput = page.frameLocator('#browser-lambdas-shell').locator('#shell-input');
	await shellInput.fill('ctx-test-run-second');
	await shellInput.press('Enter');

	const allParagraphs = page.frameLocator('#browser-lambdas-shell').locator('#shell-outputs p');
	await expect
		.poll(async () => (await allParagraphs.allTextContents()).length, { timeout: 10_000 })
		.toBe(2);
	await expect(allParagraphs.nth(0)).toHaveText('> ctx-test-run-second');
	await expect(allParagraphs.nth(1)).toHaveText('one hello');
});
