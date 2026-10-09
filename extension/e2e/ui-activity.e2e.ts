import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test('activity logs can be viewed and filtered by tab and level', async ({ page, extensionId, localTestPage }) => {
	const workspaceUrl = `chrome-extension://${extensionId}/workspace.html#activity`;
	await page.goto(workspaceUrl);
	// The worker shares extension storage across tests. Remove earlier triggers
	// before opening a web tab so they cannot append logs to the arranged export.
	await page.evaluate(() => chrome.storage.local.set({
		activityLogs: [],
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
	const arranged = await page.evaluate(async ({ tabId, uri }) => {
		const logs = [
			{ id: 'debug-test', timestamp: Date.now() - 2, tabId, uri, message: 'activity debug 🐑\nnext', level: 'debug' },
			{ id: 'info-test', timestamp: Date.now() - 1, tabId, uri, message: `activity info test ${'long message '.repeat(30)}`, level: 'info' },
			{ id: 'error-test', timestamp: Date.now(), tabId, uri, message: '<script id="activity-owned">activity error test</script>', level: 'error' }
		];
		await chrome.storage.local.set({ activityLogs: logs });
		return logs;
	}, { tabId: targetTabId, uri: localTestPage });
	// Load the workspace from the arranged snapshot instead of depending on the
	// timing of a storage event from earlier tests or content-script activity.
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
	expect(downloadedRows).toEqual([...arranged].reverse());
	await page.getByRole('button', { name: 'Copy JSONL' }).click();
	await expect(page.getByRole('button', { name: 'Copied!' })).toBeVisible();
	const copiedJsonl = await page.evaluate(() => navigator.clipboard.readText());
	expect(copiedJsonl).toBe(jsonl);
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
