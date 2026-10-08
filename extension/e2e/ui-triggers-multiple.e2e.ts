import { allowFunctionOnTestPages } from './function-access';
import { test, expect } from './fixtures';

// ensure enough time for extension to build and run
test.describe.configure({ timeout: 120_000 });

test.skip('trigger executes multiple lambdas', async ({
	page,
	extensionId,
	localTestPage,
	reactionTime
}) => {
	const base = `chrome-extension://${extensionId}`;

	// enable auto shell to capture trigger logs
	await page.goto(`${base}/settings.html`);
	await page.waitForTimeout(reactionTime);
	const alwaysToggle = page.locator('text=Always Show Shell').locator('..').getByRole('button');
	if ((await alwaysToggle.innerText()) === 'Off') {
		await alwaysToggle.click();
		await page.waitForTimeout(reactionTime);
	}

	// create lambdas used by the trigger
	await page.goto(`${base}/workspace.html#functions`);
	await page.waitForTimeout(reactionTime);

	// lambda one: set storage value
	await page.getByTestId('sidebar-functions-add').click();
	await page.getByTestId('sidebar-functions-item').last().dblclick();
	await page.waitForTimeout(reactionTime);
	await page.getByTestId('pane-title').last().fill('one');
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Enter');
	await page.getByTestId('pane-content').last().locator('.code-editor').click();
	await page.keyboard.type("await ctx.kv.set('foo', '1');");
	await page.waitForTimeout(reactionTime);
	await allowFunctionOnTestPages(page);
	await page.getByTestId('pane-save').last().click();
	await page.waitForTimeout(reactionTime);

	// lambda two: log value from storage
	await page.getByTestId('sidebar-functions-add').click();
	await page.getByTestId('sidebar-functions-item').last().dblclick();
	await page.waitForTimeout(reactionTime);
	await page.getByTestId('pane-title').last().fill('two');
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Enter');
	await page.getByTestId('pane-content').last().locator('.code-editor').click();
	await page.keyboard.type("console.log(await ctx.kv.get('foo'));");
	await page.waitForTimeout(reactionTime);
	await allowFunctionOnTestPages(page);
	await page.getByTestId('pane-save').last().click();
	await page.waitForTimeout(reactionTime);

	// create trigger that runs both lambdas
	await page.goto(`${base}/workspace.html#triggers`);
	await page.waitForTimeout(reactionTime);
	await page.getByTestId('sidebar-triggers-add').click();
	await page.waitForTimeout(reactionTime);
	const triggerContent = page.locator('[data-pane-type="trigger"]').last();
	const patternBlock = triggerContent.getByTestId('trigger-url-patterns');
	await patternBlock.click();
	await page.keyboard.type('127\\.0\\.0\\.1');
	const cmdBlock = triggerContent.getByTestId('trigger-commands');
	await cmdBlock.click();
	await page.keyboard.type('one\ntwo');
	await page.waitForTimeout(reactionTime);
	await triggerContent.locator('..').getByTestId('pane-save').click();
	await page.waitForTimeout(reactionTime);

	// visit test page and expect second lambda output
	const logs: string[] = [];
	page.on('console', (msg) => logs.push(msg.text()));
	await page.goto(localTestPage);
	await page.waitForTimeout(reactionTime * 2);
	await expect.poll(() => logs.includes('1'), { timeout: 20_000 }).toBe(true);

	// clean up trigger
	await page.goto(`${base}/workspace.html#triggers`);
	await page.waitForTimeout(reactionTime);
	await page.getByTestId('sidebar-triggers-item').first().click();
	await page.getByTestId('pane-delete').click();
	await page.waitForTimeout(reactionTime);
	await expect(page.getByTestId('pane-delete')).toHaveCount(0);

	// remove created lambdas
	await page.goto(`${base}/workspace.html#functions`);
	await page.waitForTimeout(reactionTime);
	const sidebarItems = page.getByTestId('sidebar-functions-item');
	const count = await sidebarItems.count();
	for (let i = count - 1; i >= count - 2; i--) {
		await sidebarItems.nth(i).click();
		await page.getByTestId('pane-delete').click();
		await page.waitForTimeout(reactionTime);
	}
});

export default test;
