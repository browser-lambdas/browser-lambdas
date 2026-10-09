import { allowFunctionOnTestPages } from './function-access';
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

test.describe.configure({ timeout: 120_000 });

async function createLambda(page: Page, name: string, code: string, reactionTime: number) {
	await page.goto(`${page.url().split('/workspace.html')[0]}/workspace.html#functions`);
	await page.waitForTimeout(reactionTime);
	await page.getByTestId('sidebar-functions-add').click();
	await page.getByTestId('sidebar-functions-item').last().dblclick();
	await page.getByTestId('pane-title').first().fill(name);
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Enter');
	await page.locator('.code-editor').click();
	await page.keyboard.type(code);
	await page.waitForTimeout(reactionTime);
	await allowFunctionOnTestPages(page);
	await page.getByRole('button', { name: 'Save' }).click();
	await page.waitForTimeout(reactionTime);
}

test('nested failures warn, resolve, and stop at the maximum depth', async ({
	page,
	extensionId,
	localTestPage,
	reactionTime
}) => {
	const workspace = `chrome-extension://${extensionId}`;

	await page.goto(`${workspace}/workspace.html#functions`);
	await page.waitForTimeout(reactionTime);
	await createLambda(page, 'ctx-test-run-throwing-child', 'throw new Error("child exploded");', reactionTime);
	await createLambda(page, 'ctx-test-run-missing-parent', "await ctx.run('ctx-test-run-does-not-exist'); console.log('parent continued');", reactionTime);
	await createLambda(page, 'ctx-test-run-throwing-parent', "await ctx.run('ctx-test-run-throwing-child'); console.log('parent continued');", reactionTime);
	await createLambda(page, 'ctx-test-run-recursive', "await ctx.run('ctx-test-run-recursive');", reactionTime);

	await page.goto(localTestPage);
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Meta+k');
	const shell = page.frameLocator('#browser-lambdas-shell');
	const input = shell.locator('#shell-input');
	const output = shell.locator('#shell-outputs p');
	const expectOutput = (text: string) =>
		expect
			.poll(async () => (await output.allTextContents()).join('\n'))
			.toContain(text);

	await input.fill('ctx-test-run-missing-parent');
	await input.press('Enter');
	await expectOutput('Nested lambda request failed: No lambda named "ctx-test-run-does-not-exist" was found.');
	await expectOutput('parent continued');

	await input.fill('.clear');
	await input.press('Enter');
	await input.fill('ctx-test-run-throwing-parent');
	await input.press('Enter');
	await expectOutput('Nested lambda request failed: child exploded');
	await expectOutput('parent continued');

	await input.fill('.clear');
	await input.press('Enter');
	await input.fill('ctx-test-run-recursive');
	await input.press('Enter');
	await expectOutput('Nested lambda request failed: Maximum nested lambda depth (5) reached.');
	await expect(input).toBeEnabled();
	await input.fill('console.log("shell alive")');
	await input.press('Enter');
	await expectOutput('shell alive');
});
