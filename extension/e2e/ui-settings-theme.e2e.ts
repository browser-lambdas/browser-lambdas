import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test('shell theme applies custom styles', async ({
	page,
	extensionContext,
	extensionId,
	localTestPage,
	reactionTime
}) => {
	const base = `chrome-extension://${extensionId}`;

	await page.goto(`${base}/workspace.html#styles`);
	await page.waitForTimeout(reactionTime);
	await page.getByTestId('sidebar-styles-add').click();
	await page.getByTestId('sidebar-styles-item').last().dblclick();
	await page.getByTestId('pane-title').last().fill('test-theme');
	const editor = page.getByTestId('pane-content').last().locator('.code-editor');

	const css = [
		'#browser-lambdas-shell { background: rgb(1, 2, 3); }',
		'#shell-titlebar { background: rgb(4, 5, 6); }',
		'#shell-outputs { background: rgb(7, 8, 9); }',
		'#shell-input-wrap { background: rgb(10, 11, 12); }',
		'#shell-input { background: rgb(13, 14, 15); }',
		'#shell-suggestions { background: rgb(16, 17, 18); }',
		".shell-resize-edge[data-direction='bottom-right'] { background: rgb(19, 20, 21); }"
	].join('\n');
	await editor.fill(css);
	await page.getByTestId('pane-save').last().click();
	await page.getByTitle('Set as default terminal style').last().click();
	await page.waitForTimeout(reactionTime);
	await page.evaluate(async () => {
		const key = 'local_storage_key_shellcss';
		const styles = JSON.parse((await chrome.storage.local.get(key))[key]);
		Object.assign(styles[0], { enabled: false, urlAllowlistEnabled: true, urlPatterns: [] });
		await chrome.storage.local.set({ [key]: JSON.stringify(styles) });
	});

	await page.goto(localTestPage);
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Meta+k');
	await page.waitForTimeout(reactionTime);

	const expected = [
		['#browser-lambdas-shell', 'rgb(1, 2, 3)'],
		['#shell-titlebar', 'rgb(4, 5, 6)'],
		['#shell-outputs', 'rgb(7, 8, 9)'],
		['#shell-input-wrap', 'rgb(10, 11, 12)'],
		['#shell-input', 'rgb(13, 14, 15)'],
		['#shell-suggestions', 'rgb(16, 17, 18)'],
		[".shell-resize-edge[data-direction='bottom-right']", 'rgb(19, 20, 21)']
	] as const;

	for (const [selector, color] of expected) {
		await expect(page.frameLocator('#browser-lambdas-shell').locator(selector)).toHaveCSS('background-color', color);
	}

	const settings = await extensionContext.newPage();
	try {
		await settings.goto(`${base}/workspace.html#styles`);
		await settings.getByRole('button', { name: 'Settings for Local', exact: true }).click();
		const project = settings.getByLabel('Project settings for default', { exact: true });
		await expect(project.getByRole('tab', { name: 'Styles', exact: true })).toHaveAttribute('aria-selected', 'true');
		await expect(project.getByTestId('project-settings-restrictUrls')).toHaveCount(0);
		const enabled = project.getByTestId('project-settings-enabled');
		await expect(enabled).toBeChecked();
		await enabled.uncheck();
		const shell = page.frameLocator('#browser-lambdas-shell');
		await expect(shell.locator('#browser-lambdas-user-style')).toHaveCount(0);
		await expect(shell.locator('#browser-lambdas-default-style')).toHaveCount(1);
		await expect(shell.locator('#browser-lambdas-shell')).not.toHaveCSS('background-color', 'rgb(1, 2, 3)');
		await expect(shell.locator('#shell-input')).toBeVisible();
		await settings.reload();
		await settings.getByRole('button', { name: 'Settings for Local', exact: true }).click();
		await expect(enabled).not.toBeChecked();
		await enabled.check();
		for (const [selector, color] of expected) await expect(shell.locator(selector)).toHaveCSS('background-color', color);
	} finally {
		await settings.close();
		await page.goto(`${base}/workspace.html#styles`);
		await page.evaluate(() => chrome.storage.local.remove(['local_storage_key_shellcss', 'local_storage_key_project_settings']));
	}
});

export default test;
