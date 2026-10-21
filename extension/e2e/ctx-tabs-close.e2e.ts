import { test, expect } from './fixtures';

test('ctx.tabs.this().close closes its invoking tab when multiple tabs have the same URL', async ({ page, extensionContext, extensionId, localTestPage }) => {
	await page.goto(`chrome-extension://${extensionId}/workspace.html#functions`);
	await page.evaluate(() => chrome.storage.local.set({ local_storage_key_lambdas: JSON.stringify([{
		id: 'close-self', name: 'close-self', project: 'tab-closing', func: 'await ctx.tabs.this().close();', world: '', allowedWorlds: ['user_scripts']
	}]) }));
	const invoking = await extensionContext.newPage();
	const sameUrl = await extensionContext.newPage();
	const url = `${localTestPage}/same-path`;
	await invoking.goto(url);
	await sameUrl.goto(url);
	await invoking.bringToFront();
	await invoking.keyboard.press('Meta+k');
	const input = invoking.frameLocator('#browser-lambdas-shell').locator('#shell-input');
	await expect(input).toBeVisible();
	await input.fill('close-self');
	const closed = invoking.waitForEvent('close');
	await input.press('Enter').catch((error) => { if (!invoking.isClosed()) throw error; });
	await closed;
	expect(sameUrl.isClosed()).toBe(false);
	await expect(sameUrl).toHaveURL(url);
	await expect(page).toHaveURL(`chrome-extension://${extensionId}/workspace.html#functions`);
});
