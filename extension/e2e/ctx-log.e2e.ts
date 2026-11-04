import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

for (const world of ['USER_SCRIPT', 'MAIN']) test(`ctx.log records user levels with tab context while ${world} lifecycle logs remain debug`, async ({ page, extensionContext, extensionId, localTestPage }) => {
	const worker = extensionContext.serviceWorkers()[0] || await extensionContext.waitForEvent('serviceworker');
	await page.goto(`chrome-extension://${extensionId}/settings.html`);
	await page.evaluate((world) => chrome.storage.local.set({
		local_storage_key_allow_main_world_functions: world === 'MAIN',
		activityLogs: [],
		local_storage_key_lambdas: JSON.stringify([{
			id: 'activity-levels', name: 'activity-levels', project: '', world, allowedWorlds: ['user_scripts', 'main'], urlAllowlistEnabled: true, urlPatterns: ['*'],
			func: 'ctx.log.dbg("user debug", {ok:true}); ctx.log.info("user info 🐑\\nnext"); ctx.log.err("user error", "<script>bad</script>"); return 42;'
		}])
	}), world);
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
	const transport = world === 'MAIN' ? 'Secure' : 'Native';
	for (const endpoint of ['function', 'runtime']) {
		const rows = tabRows.filter((entry: any) => entry.message.startsWith(`${transport} ${endpoint} channel established:`));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ level: 'debug', tabId: userRows[0].tabId, uri: localTestPage + '/' });
	}
	expect(tabRows.some((entry: any) => entry.level === 'info' && entry.message.includes('Function execution'))).toBe(false);
	expect(tabRows.some((entry: any) => entry.level === 'error' && entry.message.includes('Unable to deliver function result'))).toBe(false);
	await expect.poll(async () => worker.evaluate(async () => ((await chrome.storage.local.get('activityLogs')).activityLogs || [])
		.find((entry: any) => entry.message.startsWith('Top-level function result completed:')))).toMatchObject({ level: 'debug', tabId: userRows[0].tabId, uri: localTestPage + '/' });
	const completion = (await worker.evaluate(async () => (await chrome.storage.local.get('activityLogs')).activityLogs || []))
		.find((entry: any) => entry.message.startsWith('Top-level function result completed:'));
	expect(completion).toMatchObject({ level: 'debug', tabId: userRows[0].tabId, uri: localTestPage + '/' });
});

export default test;
