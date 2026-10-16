import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test('activity logs can be viewed and filtered by tab and level', async ({ page, extensionId, localTestPage }) => {
	const workspaceUrl = `chrome-extension://${extensionId}/workspace.html#activity`;
	await page.goto(workspaceUrl);
	// Prevent triggers from earlier tests from running in the target tab.
	await page.evaluate(() => chrome.storage.local.set({
		local_storage_key_triggers: JSON.stringify([])
	}));

	const target = await page.context().newPage();
	const targetUrl = new URL('#activity-target', localTestPage).href;
	await target.goto(targetUrl);

	await page.addInitScript(() => {
		let copied = '';
		Object.defineProperty(navigator, 'clipboard', { value: {
			writeText: async (value: string) => { copied = value; },
			readText: async () => copied
		} });
	});
	const targetTab = await page.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url), targetUrl);
	expect(targetTab).toBeDefined();
	const targetTabId = targetTab?.id as number;
	const arranged = await page.evaluate(async (tabId) => {
		const entries = [
			{ level: 'debug', message: 'activity debug 🐑\nnext' },
			{ level: 'info', message: `activity info test ${'long message '.repeat(30)}` },
			{ level: 'error', message: '<script id="activity-owned">activity error test</script>' }
		];
		// Use the real writer's queue and tab context instead of replacing storage mid-write.
		await chrome.scripting.executeScript({
			target: { tabId },
			world: 'ISOLATED',
			args: [entries],
			func: async (logs) => {
				for (const entry of logs) await chrome.runtime.sendMessage({ type: 'ACTIVITY_LOG', ...entry });
			}
		});
		const { activityLogs } = await chrome.storage.local.get('activityLogs');
		return activityLogs.filter((entry) => entry.tabId === tabId && entries.some((log) => log.message === entry.message));
	}, targetTabId);
	expect(arranged).toHaveLength(3);
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Activity logs' })).toBeVisible();
	await page.locator('[data-action="open-item"]').filter({ hasText: 'All' }).click();
	await expect(page.locator('.activity-table')).toContainText('activity info test');
	await expect(page.locator('.activity-table')).toContainText('activity error test');
	await expect(page.locator('#activity-owned')).toHaveCount(0);
	await page.locator('.activity-message summary').filter({ hasText: 'activity info test' }).click();
	await expect(page.locator('.activity-message details[open] pre')).toContainText('long message');

	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download JSONL' }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toMatch(/^activity-all-tabs-.*\.jsonl$/);
	const contents = await download.createReadStream();
	let jsonl = '';
	for await (const chunk of contents) jsonl += chunk.toString();
	const downloadedRows = jsonl.trim().split('\n').map((line) => JSON.parse(line));
	const arrangedIds = new Set(arranged.map((entry) => entry.id));
	const expectedRows = [...arranged].reverse();
	expect(downloadedRows.filter((entry) => arrangedIds.has(entry.id))).toEqual(expectedRows);
	await page.getByRole('button', { name: 'Copy JSONL' }).click();
	await expect(page.getByRole('button', { name: 'Copied!' })).toBeVisible();
	const copiedJsonl = await page.evaluate(() => navigator.clipboard.readText());
	const copiedRows = copiedJsonl.trim().split('\n').map((line) => JSON.parse(line));
	expect(copiedRows.filter((entry) => arrangedIds.has(entry.id))).toEqual(expectedRows);
	const expectedWebTabs = await page.evaluate(async () => (await chrome.tabs.query({}))
		.filter((tab) => !/^(chrome|moz)-extension:/.test(tab.url || '')).length);
	await expect(page.locator('[data-action="open-item"][data-id^="activity-tab-"]')).toHaveCount(expectedWebTabs);

	await page.getByRole('button', { name: 'info' }).click();
	await expect(page.locator('.activity-table')).not.toContainText('activity info test');
	await expect(page.locator('.activity-table')).toContainText('activity error test');

	await page.locator(`[data-action="open-item"][data-id="activity-tab-${targetTabId}"]`).click();
	await expect(page.locator('.pane-title')).toContainText(targetTab?.title || localTestPage);
	if (targetTab?.favIconUrl) {
		await expect(page.locator('.pane-title .activity-favicon')).toHaveAttribute('src', targetTab.favIconUrl);
	}

	await target.close();
	await expect(page.locator(`[data-action="open-item"][data-id="activity-tab-${targetTabId}"]`)).toHaveCount(0);
	await page.locator('[data-action="open-item"]').filter({ hasText: 'All' }).click();
	await expect(page.locator('.activity-table')).toContainText('activity error test');
});
