import { allowFunctionOnTestPages } from './function-access';
import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test('storage persists across lambdas', async ({
	page,
	extensionId,
	localTestPage,
	reactionTime
}) => {
	const base = `chrome-extension://${extensionId}`;

	await page.goto(`${base}/workspace.html#functions`);
	await page.waitForTimeout(reactionTime);

	// first lambda: set value
	await page.getByTestId('sidebar-functions-add').click();
	await page.getByTestId('sidebar-functions-item').last().dblclick();
	await page.getByTestId('pane-title').first().fill('ctx-test-storage-set');
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Enter');
	await page.locator('.code-editor').click();
	await page.keyboard.type("console.log(await ctx.kv.set('foo', 'bar'));");
	await page.waitForTimeout(reactionTime);
	await allowFunctionOnTestPages(page);
	await page.getByRole('button', { name: 'Save' }).click();
	await page.waitForTimeout(reactionTime);

	// second lambda: get value
	await page.getByTestId('sidebar-functions-add').click();
	await page.getByTestId('sidebar-functions-item').last().dblclick();
	await page.getByTestId('pane-title').first().fill('ctx-test-storage-get');
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Enter');
	await page.locator('.code-editor').click();
	await page.keyboard.type("console.log(await ctx.kv.get('foo'));");
	await page.waitForTimeout(reactionTime);
	await allowFunctionOnTestPages(page);
	await page.getByRole('button', { name: 'Save' }).click();
	await page.waitForTimeout(reactionTime);

	await page.goto(localTestPage);
	await page.waitForTimeout(reactionTime);

	await page.keyboard.press('Meta+k');
	const shellInput = page.frameLocator('#browser-lambdas-shell').locator('#shell-input');

	// run setter
	await shellInput.fill('ctx-test-storage-set');
	await shellInput.press('Enter');

	const outputs = page.frameLocator('#browser-lambdas-shell').locator('#shell-outputs p');
	await expect
		.poll(async () => (await outputs.allTextContents()).length, { timeout: 10_000 })
		.toBe(2);
	await expect(outputs.nth(0)).toHaveText('> ctx-test-storage-set');
	await expect(outputs.nth(1)).toHaveText('true');

	// run getter
	await shellInput.fill('ctx-test-storage-get');
	await shellInput.press('Enter');

	await expect
		.poll(async () => (await outputs.allTextContents()).length, { timeout: 10_000 })
		.toBe(4);
	await expect(outputs.nth(2)).toHaveText('> ctx-test-storage-get');
	await expect(outputs.nth(3)).toHaveText('bar');
	await page.goto(`${base}/workspace.html#storage`);
	const stored = await page.evaluate(async () => JSON.parse((await chrome.storage.local.get('local_storage_key_storage')).local_storage_key_storage));
	const created = stored.find((item: { key: string }) => item.key === 'foo');
	expect(created.allowedWorlds).toEqual(['user_scripts', 'main']);
	expect(created.urlAllowlistEnabled).toBe(false);
	expect(created.urlPatterns).toEqual([]);
});
