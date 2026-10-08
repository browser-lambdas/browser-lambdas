import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test('ctx.log records user levels with tab context while lifecycle logs remain debug', async ({ page, extensionContext, extensionId, localTestPage }) => {
	const worker = extensionContext.serviceWorkers()[0] || await extensionContext.waitForEvent('serviceworker');
	await page.goto(`chrome-extension://${extensionId}/settings.html`);
	await page.evaluate(() => chrome.storage.local.set({
		activityLogs: [],
		local_storage_key_lambdas: JSON.stringify([{
			id: 'activity-levels', name: 'activity-levels', project: '', world: 'USER_SCRIPT', allowedWorlds: ['user_scripts'], urlAllowlistEnabled: true, urlPatterns: ['*'],
			func: 'ctx.log.dbg("user debug", {ok:true}); ctx.log.info("user info 🐑\\nnext"); ctx.log.err("user error", "<script>bad</script>"); return 42;'
		}])
	}));
	await page.goto(localTestPage);
	await page.waitForTimeout(500);
	await page.keyboard.press('Meta+k');
	const input = page.frameLocator('#browser-lambdas-shell').locator('#shell-input');
	await expect(input).toBeVisible();
	await input.fill('activity-levels');
	await input.press('Enter');

	await expect.poll(async () => worker.evaluate(async () => {
		const { activityLogs = [] } = await chrome.storage.local.get('activityLogs');
		return activityLogs;
	}), { timeout: 10_000 }).toEqual(expect.arrayContaining([
		expect.objectContaining({ level: 'debug', message: 'user debug [object Object]' }),
		expect.objectContaining({ level: 'info', message: 'user info 🐑\nnext' }),
		expect.objectContaining({ level: 'error', message: 'user error <script>bad</script>' })
	]));
	const snapshot = await worker.evaluate(async () => (await chrome.storage.local.get('activityLogs')).activityLogs || []);
	const userRows = snapshot.filter((entry: any) => entry.message.startsWith('user '));
	expect(userRows).toHaveLength(3);
	for (const entry of userRows) {
		expect(entry.tabId).toBeTruthy();
		expect(entry.uri).toBe(localTestPage + '/');
		expect(entry.timestamp).toEqual(expect.any(Number));
	}
	const tabRows = snapshot.filter((entry: any) => entry.tabId === userRows[0].tabId);
	expect(tabRows.filter((entry: any) => entry.message.startsWith('Secure function channel established:'))).toHaveLength(1);
	expect(tabRows.filter((entry: any) => entry.message.startsWith('Secure runtime channel established:'))).toHaveLength(1);
	expect(tabRows.some((entry: any) => entry.level === 'info' && entry.message.includes('Function execution'))).toBe(false);
	expect(tabRows.some((entry: any) => entry.level === 'error' && entry.message.includes('Unable to deliver function result'))).toBe(false);
	const completion = tabRows.find((entry: any) => entry.message.startsWith('Top-level function result completed:'));
	expect(completion).toMatchObject({ level: 'debug', tabId: userRows[0].tabId, uri: localTestPage + '/' });
});

export default test;
