import { allowFunctionOnTestPages } from './function-access';
import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test('triggers ui operations', async ({
	extensionContext,
	extensionId,
	localTestPage,
	reactionTime
}) => {
	const page = await extensionContext.newPage();
	const base = `chrome-extension://${extensionId}`;

	// create two lambdas used by the trigger
	await page.goto(`${base}/workspace.html#functions`);
	await page.waitForTimeout(reactionTime);

	await page.getByTestId('sidebar-functions-add').click();
	await page.getByTestId('sidebar-functions-item').last().dblclick();
	await page.getByTestId('pane-title').last().fill('trigger-lambda-1');
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Enter');
	await page.getByTestId('pane-content').last().locator('.code-editor').click();
	await page.keyboard.type("log.info('L1')");
	await page.waitForTimeout(reactionTime);
	await allowFunctionOnTestPages(page);
	await page.getByTestId('pane-save').last().click();
	await page.waitForTimeout(reactionTime);

	await page.getByTestId('sidebar-functions-add').click();
	await page.getByTestId('sidebar-functions-item').last().dblclick();
	await page.getByTestId('pane-title').last().fill('trigger-lambda-2');
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Enter');
	await page.getByTestId('pane-content').last().locator('.code-editor').click();
	await page.keyboard.type("log.info('L2')");
	await page.waitForTimeout(reactionTime);
	await allowFunctionOnTestPages(page);
	await page.getByTestId('pane-save').last().click();
	await page.waitForTimeout(reactionTime);

	// navigate to triggers page
	await page.goto(`${base}/workspace.html#triggers`);
	await page.waitForTimeout(reactionTime);

	// add trigger
	await page.getByTestId('sidebar-triggers-add').click();
	await page.waitForTimeout(reactionTime);
	const triggerContent = page.locator('[data-pane-type="trigger"]').last();
	const patternBlock = triggerContent.getByTestId('trigger-url-patterns');
	await patternBlock.click();
	await patternBlock.fill('*127.0.0.1*');
	const cmdBlock = triggerContent.getByTestId('trigger-commands');
	await cmdBlock.click();
	await page.keyboard.type('trigger-lambda-1\ntrigger-lambda-2');
	await page.waitForTimeout(reactionTime);
	await triggerContent.locator('..').getByTestId('pane-save').click();
	await page.waitForTimeout(reactionTime);

	// visit test page and expect both lambdas to run
	const worker = extensionContext.serviceWorkers()[0];
	const readLogs = () => worker.evaluate(async () => {
		const { activityLogs = [] } = await chrome.storage.local.get('activityLogs');
		return activityLogs.filter((entry) => entry.level === 'info').map((entry) => entry.message);
	});
	await page.goto(localTestPage);
	await page.waitForTimeout(reactionTime * 2);
	await expect.poll(async () => (await readLogs()).includes('L1')).toBe(true);
	await expect.poll(async () => (await readLogs()).includes('L2')).toBe(true);

	// edit trigger pattern and commands
	await page.goto(`${base}/workspace.html#triggers`);
	await page.waitForTimeout(reactionTime);
	await page.getByTestId('sidebar-triggers-item').first().click();
	const editContent = page.locator('[data-pane-type="trigger"]').first();
	const editPattern = editContent.getByTestId('trigger-url-patterns');
	await editPattern.fill('/127\\.0\\.0\\.1/');
	const editCmd = editContent.getByTestId('trigger-commands');
	await editCmd.fill('trigger-lambda-2');
	await page.waitForTimeout(reactionTime);
	await editContent.locator('..').getByTestId('pane-save').click();
	await page.waitForTimeout(reactionTime);
	await expect(editPattern).toHaveValue('/127\\.0\\.0\\.1/');
	await expect(editCmd).toHaveValue('trigger-lambda-2');

	// verify trigger after edit
	await worker.evaluate(() => chrome.storage.local.set({ activityLogs: [] }));
	await page.goto(localTestPage);
	await page.waitForTimeout(reactionTime * 2);
	await expect.poll(async () => (await readLogs()).includes('L2')).toBe(true);
	expect(await readLogs()).not.toContain('L1');

	// A final independent trigger marks the completion of each automatic run.
	await page.goto(`${base}/workspace.html#triggers`);
	await page.evaluate(async () => {
		const result = await chrome.storage.local.get(['local_storage_key_lambdas', 'local_storage_key_triggers']);
		const lambdas = JSON.parse(result.local_storage_key_lambdas || '[]');
		lambdas.push({ id: 'trigger-ui-fence-fn', name: 'trigger-ui-fence', project: 'fence', func: "log.info('trigger-ui-complete')", allowedWorlds: ['user_scripts'], urlAllowlistEnabled: true, urlPatterns: ['*'] });
		const triggers = JSON.parse(result.local_storage_key_triggers || '[]');
		triggers.push({ id: 'trigger-ui-fence', name: 'trigger-ui-fence', project: 'fence', patterns: ['*127.0.0.1*'], commands: ['trigger-ui-fence'] });
		await chrome.storage.local.set({ local_storage_key_lambdas: JSON.stringify(lambdas), local_storage_key_triggers: JSON.stringify(triggers) });
	});
	const visitWithoutL2 = async () => {
		await worker.evaluate(() => chrome.storage.local.set({ activityLogs: [] }));
		await page.goto(localTestPage);
		await expect.poll(async () => (await readLogs()).includes('trigger-ui-complete')).toBe(true);
		expect(await readLogs()).not.toContain('L2');
	};
	const openTrigger = async () => {
		await page.goto(`${base}/workspace.html#triggers`);
		await page.getByTestId('sidebar-triggers-item').filter({ hasNotText: 'trigger-ui-fence' }).first().click();
		await page.getByRole('button', { name: 'Show settings' }).click();
	};
	await openTrigger();
	const automatic = page.getByTestId('trigger-security').getByRole('switch', { name: 'Run automatically', exact: true });
	await expect(automatic).toBeChecked();
	await automatic.uncheck();
	await page.getByTestId('pane-save').click();
	await visitWithoutL2();
	await openTrigger();
	await automatic.check();
	await page.getByTestId('pane-save').click();
	await page.getByRole('button', { name: 'Settings for Local', exact: true }).click();
	const project = page.getByLabel('Project settings for default', { exact: true });
	await project.getByTestId('project-settings-enabled').uncheck();
	await expect.poll(() => page.evaluate(async () => (await chrome.storage.local.get('local_storage_key_project_settings')).local_storage_key_project_settings.default.triggers.enabled)).toBe(false);
	await visitWithoutL2();
	await openTrigger();
	await expect(automatic).toBeDisabled();
	await page.getByRole('button', { name: 'Settings for Local', exact: true }).click();
	await project.getByTestId('project-settings-enabled').check();
	await expect.poll(() => page.evaluate(async () => (await chrome.storage.local.get('local_storage_key_project_settings')).local_storage_key_project_settings.default.triggers.enabled)).toBe(true);
	await worker.evaluate(() => chrome.storage.local.set({ activityLogs: [] }));
	await page.goto(localTestPage);
	await expect.poll(async () => (await readLogs()).includes('L2')).toBe(true);
	await page.goto(`${base}/workspace.html#triggers`);
	await page.evaluate(async () => {
		const result = await chrome.storage.local.get(['local_storage_key_lambdas', 'local_storage_key_triggers']);
		await chrome.storage.local.set({
			local_storage_key_lambdas: JSON.stringify(JSON.parse(result.local_storage_key_lambdas).filter((item) => item.id !== 'trigger-ui-fence-fn')),
			local_storage_key_triggers: JSON.stringify(JSON.parse(result.local_storage_key_triggers).filter((item) => item.id !== 'trigger-ui-fence'))
		});
		await chrome.storage.local.remove('local_storage_key_project_settings');
	});

	// delete trigger
	await page.goto(`${base}/workspace.html#triggers`);
	await page.waitForTimeout(reactionTime);
	await page.getByTestId('sidebar-triggers-item').first().click();
	await page.getByTestId('pane-delete').click();
	await page.waitForTimeout(reactionTime);
	await expect(page.getByTestId('pane-delete')).toHaveCount(0);

	// remove created lambdas
	await page.goto(`${base}/workspace.html#functions`);
	await page.waitForTimeout(reactionTime);
	const funcItems = page.getByTestId('sidebar-functions-item');
	const funcCount = await funcItems.count();
	for (let i = funcCount - 1; i >= funcCount - 2; i--) {
		await funcItems.nth(i).click();
		await page.getByTestId('pane-delete').click();
		await page.waitForTimeout(reactionTime);
	}
	await page.close();
});

export default test;
