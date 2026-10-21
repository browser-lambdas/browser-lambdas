import { test, expect } from './fixtures';
import { exerciseCallerRestrictions } from './caller-restrictions-ui';

test.describe.configure({ timeout: 120_000 });

test('secret caller restrictions persist, retain disabled lists and clear explicitly', async ({ page, extensionId }) => {
	await exerciseCallerRestrictions(page, extensionId, 'secrets');
});

test('manage secrets operations', async ({ page, extensionId, reactionTime }) => {
	const base = `chrome-extension://${extensionId}`;
	const key = `TEST_SECRET_KEY_${Date.now()}`;
	const value = `秘密\nquoted "value" ${'x'.repeat(1024)}`;
	const editedValue = `${value}-edited`;

	// Navigate to secrets page and ensure clean state
	await page.goto(`${base}/workspace.html#secrets`);
	await page.waitForTimeout(reactionTime);
	await page.evaluate(() => chrome.storage?.local.clear());
	await page.reload();
	await page.waitForTimeout(reactionTime);

	// Add a new secret
	await page.getByTestId('sidebar-secrets-add').click();
	await page.waitForTimeout(reactionTime);

	// Fill key and value
	const keyInput = page.getByTestId('pane-key');
	await keyInput.fill(key);
	const valueTextarea = page.getByTestId('pane-value');
	await valueTextarea.fill(value);
	await page.waitForTimeout(reactionTime);

	// Save the secret
	await page.getByTestId('pane-save').click();
	await page.waitForTimeout(reactionTime);

	// Reload and verify persistence
	await page.reload();
	await page.waitForTimeout(reactionTime);
	await page.locator('[data-action="search"]').fill(key);
	await expect(page.getByTestId('sidebar-secrets-item')).toHaveCount(1);
	await page.getByTestId('sidebar-secrets-item').first().click();
	await page.waitForTimeout(reactionTime);
	await expect(page.getByTestId('pane-key')).toHaveValue(key);
	await expect(page.getByTestId('pane-value')).toHaveValue(value);
	await expect(page.getByTestId('pane-value')).toHaveClass(/secret-value-hidden/);

	// Editing conceals the value, and hover/focus cannot reveal it. Only Show does.
	await page.getByTestId('pane-value').fill(editedValue);
	await expect(page.getByTestId('pane-value')).toHaveClass(/secret-value-hidden/);
	await page.getByTestId('pane-value').hover();
	await expect(page.getByTestId('pane-value')).toHaveClass(/secret-value-hidden/);
	await page.getByRole('button', { name: 'Show', exact: true }).click();
	await expect(page.getByTestId('pane-value')).not.toHaveClass(/secret-value-hidden/);
	await expect(page.getByRole('button', { name: 'Hide', exact: true })).toHaveAttribute('aria-pressed', 'true');

	// Stub clipboard.writeText to capture copied text
	await page.evaluate(() => {
		const original = navigator.clipboard.writeText.bind(navigator.clipboard);
		(window as any).__copiedText = '';
		navigator.clipboard.writeText = async (text: string) => {
			(window as any).__copiedText = text;
			try {
				await original(text);
			} catch {
				/* ignore */
			}
		};
	});

	// Copy key to clipboard
	await page.getByTitle('Copy key').click();
	await page.waitForTimeout(reactionTime);
	const copiedKey = await page.evaluate(() => (window as any).__copiedText);
	expect(copiedKey).toBe(key);

	// Copy value to clipboard
	await page.getByTitle('Copy value').click();
	await page.waitForTimeout(reactionTime);
	const copiedValue = await page.evaluate(() => (window as any).__copiedText);
	expect(copiedValue).toBe(editedValue);

	// Delete the secret and verify it is gone after reload
	await page.getByTestId('pane-delete').click();
	await page.waitForTimeout(reactionTime);
	await page.reload();
	await page.waitForTimeout(reactionTime);
	await expect(page.getByTestId('sidebar-secrets-item')).toHaveCount(0);
});

export default test;
