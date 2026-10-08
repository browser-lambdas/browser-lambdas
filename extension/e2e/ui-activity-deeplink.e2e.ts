import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test('activity deep link selects a requested web tab and excludes extension pages', async ({ page, extensionId, localTestPage }) => {
	const target = await page.context().newPage();
	await target.goto(`${localTestPage}/activity-scope`);
	await page.goto(`chrome-extension://${extensionId}/settings.html`);
	const targetTab = await page.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url), `${localTestPage}/activity-scope`);
	await page.goto(`chrome-extension://${extensionId}/workspace.html?activityTabId=${targetTab?.id}#activity`);
	await expect(page.locator('.pane-title')).toContainText(targetTab?.title || 'activity-scope');
	await expect(page.locator(`[data-action="open-item"][data-id="activity-tab-${targetTab?.id}"]`)).toBeVisible();
	const listedLabels = await page.locator('[data-action="open-item"][data-id^="activity-tab-"] .item-label').allTextContents();
	expect(listedLabels.some((label) => label.includes('Settings') || label.includes('Activity logs'))).toBe(false);
});

export default test;
