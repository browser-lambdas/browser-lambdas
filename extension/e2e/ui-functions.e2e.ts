import { allowFunctionOnTestPages } from './function-access';
import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test('functions ui operations', async ({ page, extensionId, reactionTime }) => {
	const base = `chrome-extension://${extensionId}`;

	await page.goto(`${base}/workspace.html#functions`);
	await page.waitForTimeout(reactionTime);

	// Ensure there are no pre-existing functions
	const functionsList = page.getByTestId('sidebar-functions-item');
	while (await functionsList.count()) {
		await functionsList.first().click();
		await page.getByTestId('pane-delete').click();
		await page.waitForTimeout(reactionTime);
	}

	// Create first lambda
	await page.getByTestId('sidebar-functions-add').click();
	await page.getByTestId('sidebar-functions-item').last().dblclick();
	await page.waitForTimeout(reactionTime);
	await page.getByTestId('pane-title').last().fill('test-functions-ui-1');
	await allowFunctionOnTestPages(page, true);
	await page.getByTestId('pane-world').last().selectOption('MAIN');
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Enter');
	await page.locator('.code-editor').click();
	await page.keyboard.type('X');
	await page.waitForTimeout(reactionTime);
	await allowFunctionOnTestPages(page);
	await page.getByTestId('pane-save').click();
	await page.waitForTimeout(reactionTime);
	await expect(page.getByTestId('pane-world').last()).toHaveValue('MAIN');

	// Create second lambda
	await page.getByTestId('sidebar-functions-add').click();
	await page.getByTestId('sidebar-functions-item').last().dblclick();
	await page.waitForTimeout(reactionTime);
	await page.getByTestId('pane-title').last().fill('test-functions-ui-2');
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Enter');
	await page.locator('.code-editor').click();
	await page.keyboard.type('A');
	await page.waitForTimeout(reactionTime);
	await allowFunctionOnTestPages(page);
	await page.getByTestId('pane-save').click();
	await page.waitForTimeout(reactionTime);

	// Names should appear in sidebar
	await expect(
		page.getByTestId('sidebar-functions-item').filter({ hasText: 'test-functions-ui-1' })
	).toBeVisible();
	await expect(
		page.getByTestId('sidebar-functions-item').filter({ hasText: 'test-functions-ui-2' }).first()
	).toBeVisible();

	// Select second lambda
	await page
		.getByTestId('sidebar-functions-item')
		.filter({ hasText: 'test-functions-ui-2' })
		.first()
		.click();

	// Edit second lambda name and code
	await page.getByTestId('sidebar-functions-item').nth(1).dblclick();
	await page.waitForTimeout(reactionTime);
	await page.getByTestId('pane-title').last().fill('test-functions-ui-2-edited');
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Enter');
	await page.locator('.code-editor').fill('B');
	await page.waitForTimeout(reactionTime);
	await allowFunctionOnTestPages(page);
	await page.getByTestId('pane-save').click();
	await page.waitForTimeout(reactionTime);
	await expect(
		page
			.getByTestId('sidebar-functions-item')
			.filter({ hasText: 'test-functions-ui-2-edited' })
			.first()
	).toBeVisible();

	// Verify code content updated
	await page
		.getByTestId('sidebar-functions-item')
		.filter({ hasText: 'test-functions-ui-2-edited' })
		.first()
		.click();
	await expect(page.locator('.code-editor')).toContainText('B');
	await expect(page.getByTestId('pane-world').last()).toHaveValue('USER_SCRIPT');

	// Delete first lambda
	await page.getByTestId('sidebar-functions-item').nth(0).click();
	await page.getByTestId('pane-delete').click();
	await page.waitForTimeout(reactionTime);
	await expect(
		page.getByTestId('sidebar-functions-item').filter({ hasText: 'test-functions-ui-1' })
	).toHaveCount(0);

	// Verify remaining lambda can be selected
	await page
		.getByTestId('sidebar-functions-item')
		.filter({ hasText: 'test-functions-ui-2-edited' })
		.first()
		.click();
	await expect(page.getByTestId('pane-title').last()).toHaveValue('test-functions-ui-2-edited');

	// Navigate away and back
	await page.goto(`${base}/workspace.html#functions`);
	await page.waitForTimeout(reactionTime);
	await page.goto(`${base}/workspace.html#functions`);
	await page.waitForTimeout(reactionTime);
	await expect(
		page
			.getByTestId('sidebar-functions-item')
			.filter({ hasText: 'test-functions-ui-2-edited' })
			.first()
	).toBeVisible();
	await page
		.getByTestId('sidebar-functions-item')
		.filter({ hasText: 'test-functions-ui-2-edited' })
		.first()
		.click();
	await expect(page.locator('.code-editor')).toContainText('B');
	await expect(page.getByTestId('pane-world').last()).toHaveValue('USER_SCRIPT');

	// Refresh page and ensure sidebar is updated
	await page.reload();
	await page.waitForTimeout(reactionTime);
	await expect(
		page
			.getByTestId('sidebar-functions-item')
			.filter({ hasText: 'test-functions-ui-2-edited' })
			.first()
	).toBeVisible();
	await page
		.getByTestId('sidebar-functions-item')
		.filter({ hasText: 'test-functions-ui-2-edited' })
		.first()
		.click();
	await expect(page.locator('.code-editor')).toContainText('B');
	await expect(
		page.getByTestId('sidebar-functions-item').filter({ hasText: 'test-functions-ui-1' })
	).toHaveCount(0);
});
