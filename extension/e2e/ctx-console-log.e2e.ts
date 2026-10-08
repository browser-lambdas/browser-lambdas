import { allowFunctionOnTestPages } from './function-access';
import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test('console.log output', async ({ page, extensionId, localTestPage, reactionTime }) => {
	const base = `chrome-extension://${extensionId}`;

	// Add the lambda
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
	await page.getByTestId('pane-title').last().fill('test-console-log');
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Enter');
	await page.locator('.code-editor').click();
	await page.keyboard.insertText(`console.log("hello", 42, true);
console.log(null, undefined, { answer: 42 }, ["a", "b"], new Error("boom"));
console.log("line 1\\nline 2", "λ");
console.log('<meta http-equiv="refresh" content="0; url=https://example.com">');
console.log("before");
await new Promise((resolve) => setTimeout(resolve, 25));
console.log("after");`);
	await page.waitForTimeout(reactionTime);
	await allowFunctionOnTestPages(page);
	await page.getByTestId('pane-save').click();
	await page.waitForTimeout(reactionTime);

	// Navigate to test page
	await page.goto(localTestPage);
	await page.waitForTimeout(reactionTime);

	// Trigger shell and run lambda
	await page.keyboard.press('Meta+k');
	const shellInput = page.frameLocator('#browser-lambdas-shell').locator('#shell-input');
	await shellInput.fill('test-console-log');
	await shellInput.press('Enter');

	const shell = page.frameLocator('#browser-lambdas-shell');
	const allParagraphs = shell.locator('#shell-outputs p');
	await expect(allParagraphs).toHaveText([
		'> test-console-log',
		'hello 42 true',
		'null undefined [object Object] a,b Error: boom',
		'line 1\nline 2 λ',
		'<meta http-equiv="refresh" content="0; url=https://example.com">',
		'before',
		'after'
	]);
	await expect(page).toHaveURL(localTestPage);
	await allParagraphs.first().click();
	await expect(shell.locator('#shell-input')).toBeFocused();
});
