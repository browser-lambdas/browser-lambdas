import type { Page } from '@playwright/test';

// Explicit setup for tests of runtime features other than function permissions.
// Permission-specific tests intentionally do not use this helper.
export async function allowFunctionOnTestPages(page: Page, main = false) {
	if (main) await page.evaluate(() => chrome.storage.local.set({ local_storage_key_allow_main_world_functions: true }));
	const panes = page.locator('[data-pane-type="lambda"]');
	for (let index = 0; index < await panes.count(); index++) {
		const pane = panes.nth(index);
		const restore = pane.locator('..').getByRole('button', { name: 'Show settings' });
		if (await restore.count()) await restore.click();
		await pane.getByTestId('function-url-allowlist').check();
		await pane.getByTestId('function-url-patterns').fill('*');
		if (main) await pane.getByTestId('function-security').locator('[data-world="main"]').check();
	}
}
