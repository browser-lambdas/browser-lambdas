import { test, expect } from './fixtures';

test('main-world secret access is disabled by default and configurable', async ({ page, extensionId }) => {
	const base = `chrome-extension://${extensionId}`;
	await page.goto(`${base}/settings.html`);

	const toggle = page.getByTestId('allow-main-world-secrets');
	await expect(toggle).toHaveAttribute('aria-pressed', 'false');
	await expect(page.getByText(/shares a JavaScript environment with the page/i)).toBeVisible();

	await page.goto(`${base}/workspace.html#secrets`);
	await page.getByTestId('sidebar-secrets-add').click();
	await page.getByRole('button', { name: 'Show settings' }).click();
	const disabledSecurity = page.getByTestId('secret-security');
	await expect(disabledSecurity.locator('[data-world="main"]')).toBeDisabled();

	await page.goto(`${base}/settings.html`);
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-pressed', 'true');

	await page.goto(`${base}/workspace.html#secrets`);
	await page.getByTestId('sidebar-secrets-add').click();
	await page.getByRole('button', { name: 'Show settings' }).click();
	const security = page.getByTestId('secret-security');
	await expect(security.getByText('Allow execution in main world', { exact: true })).toBeVisible();
	await expect(security.locator('[data-world="user_scripts"]')).toBeChecked();
	await expect(security.locator('[data-world="main"]')).toBeEnabled();
	await expect(page.getByTestId('secret-url-patterns')).toBeVisible();
});
