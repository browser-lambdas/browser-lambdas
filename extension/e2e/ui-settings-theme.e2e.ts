import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test('shell theme applies custom styles', async ({
	page,
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
	await page.getByTitle('Set as default shell style').last().click();
	await page.waitForTimeout(reactionTime);

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
});

export default test;
