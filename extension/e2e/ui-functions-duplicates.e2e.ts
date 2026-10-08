import { allowFunctionOnTestPages } from './function-access';
import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test('function names cannot be duplicated within a project', async ({ page, extensionId, reactionTime }) => {
	const base = `chrome-extension://${extensionId}`;

	await page.goto(`${base}/workspace.html#functions`);
	await page.waitForTimeout(reactionTime);
	await page.evaluate(() => chrome.storage.local.set({ local_storage_key_lambdas: '[]' }));
	await page.reload();
	await page.waitForTimeout(reactionTime);

	const addFunction = async () => {
		await page.getByTestId('sidebar-functions-add').click();
		await page.getByTestId('sidebar-functions-item').last().dblclick();
		await page.getByTestId('pane-title').last().fill('duplicate-name');
		await page.keyboard.press('Enter');
		await allowFunctionOnTestPages(page);
		await page.getByTestId('pane-save').last().click();
		await page.waitForTimeout(reactionTime);
	};

	await addFunction();
	await addFunction();
	await expect(page.getByRole('alert')).toHaveText('A function named "duplicate-name" already exists in this project.');
	await expect.poll(() => page.evaluate(async () => {
		const stored = await chrome.storage.local.get('local_storage_key_lambdas');
		return JSON.parse(stored.local_storage_key_lambdas || '[]').filter((item: { name?: string }) => item.name === 'duplicate-name').length;
	})).toBe(1);
});

export default test;
