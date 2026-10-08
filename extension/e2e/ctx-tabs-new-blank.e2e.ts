import { allowFunctionOnTestPages } from './function-access';
import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

for (const emptyUrlSnapshot of [false, true]) {
	test(`ctx.tabs.new() resolves for a blank tab (${emptyUrlSnapshot ? 'empty URL snapshot' : 'native metadata'})`, async ({ page, extensionId, localTestPage, reactionTime }) => {
		const base = `chrome-extension://${extensionId}`;
		const lambdaName = `test-tabs-new-blank-${emptyUrlSnapshot ? "empty" : "native"}`;

		await page.goto(`${base}/workspace.html#functions`);
		await page.waitForTimeout(reactionTime);
		await page.getByTestId('sidebar-functions-add').click();
		await page.getByTestId('sidebar-functions-item').last().dblclick();
		await page.getByTestId('pane-title').last().fill(lambdaName);
		await page.keyboard.press('Enter');
		await page.locator('.code-editor').click();
		await page.keyboard.insertText('const tab = await ctx.tabs.new();\nconsole.log(JSON.stringify({ id: tab.id, url: tab.url, title: tab.title }));');
		await allowFunctionOnTestPages(page);
		await page.getByTestId('pane-save').click();
		await page.waitForTimeout(reactionTime);

		await page.goto(localTestPage);
		await page.waitForTimeout(reactionTime);
		await page.keyboard.press('Meta+k');
		const shell = page.frameLocator('#browser-lambdas-shell');
		const input = shell.locator('#shell-input');
		const worker = page.context().serviceWorkers()[0];
		if (emptyUrlSnapshot) {
			await worker.evaluate(() => {
				const original = chrome.tabs.get;
				(globalThis as any).__restoreTabsGet = () => { chrome.tabs.get = original; };
				chrome.tabs.get = async (id) => {
					const tab = await original.call(chrome.tabs, id);
					return tab.url === 'about:blank' || tab.pendingUrl === 'about:blank'
						? { ...tab, url: '', pendingUrl: undefined }
						: tab;
				};
			});
		}
		try {
			await input.fill(lambdaName);
			await input.press('Enter');

			const output = shell.locator('#shell-outputs p');
			await expect(output).toHaveCount(2, { timeout: 10_000 });
			await expect(output.nth(0)).toHaveText(`> ${lambdaName}`);
			const metadata = JSON.parse(await output.nth(1).innerText());
			expect(metadata.id).toEqual(expect.any(Number));
			expect(metadata.url).toBe('about:blank');
			expect(metadata.title).toEqual(expect.any(String));

			const createdTab = page.context().pages().find((candidate) => candidate.url() === 'about:blank' && candidate !== page);
			await createdTab?.close();
		} finally {
			if (emptyUrlSnapshot) {
				await worker.evaluate(() => {
					(globalThis as any).__restoreTabsGet();
					delete (globalThis as any).__restoreTabsGet;
				});
			}
		}
	});
}
