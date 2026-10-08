import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test('token is generated on request, copied without display, and rotated', async ({
	page,
	extensionId,
	reactionTime
}) => {
	const base = `chrome-extension://${extensionId}`;

	await page.goto(`${base}/settings.html`);
	await page.waitForTimeout(reactionTime);
	await page.evaluate(() => chrome.storage.local.remove('local_storage_key_baah_token'));
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Connection token', exact: true })).toBeVisible();
	await expect(page.locator('[data-action="copy-token"]')).toHaveCount(0);
	const readToken = () => page.evaluate(async () => (await chrome.storage.local.get('local_storage_key_baah_token')).local_storage_key_baah_token);
	expect(await readToken()).toBeUndefined();
	await expect(page.getByText('No tokens yet..', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Create new', exact: true }).click();
	const remove = page.getByRole('button', { name: 'Delete', exact: true });
	await expect(remove).toBeVisible();
	await expect(page.getByRole('checkbox', { name: 'Token created!' })).toBeChecked();
	await expect(page.getByRole('checkbox', { name: 'Token created!' })).toBeDisabled();
	const createdAt = await page.evaluate(async () => (await chrome.storage.local.get('local_storage_key_baah_token_created_at')).local_storage_key_baah_token_created_at);
	await expect(page.locator('time')).toHaveAttribute('datetime', new Date(createdAt).toISOString());
	const first = await readToken();
	expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
	await expect(page.locator('code')).toHaveCount(0);
	expect(await page.locator('body').innerHTML()).not.toContain(first);
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
	await page.getByRole('button', { name: 'Copy', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Copied!', exact: true })).toBeVisible();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first);
	await page.reload();
	await expect(remove).toBeVisible();
	await expect(page.locator('time')).toHaveAttribute('datetime', new Date(createdAt).toISOString());
	expect(await readToken()).toBe(first);
	await remove.click();
	await expect(page.getByText('No tokens yet..', { exact: true })).toBeVisible();
	expect(await readToken()).toBeUndefined();
	expect(await page.evaluate(async () => (await chrome.storage.local.get('local_storage_key_baah_token_created_at')).local_storage_key_baah_token_created_at)).toBeUndefined();
	await page.getByRole('button', { name: 'Create new', exact: true }).click();
	await expect.poll(readToken).not.toBe(first);
	const second = await readToken();
	expect(second).not.toBe(first);
	await page.getByRole('button', { name: 'Copy', exact: true }).click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(second);
	expect(await page.locator('body').innerHTML()).not.toContain(second);
	await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', { value: async () => { throw new Error('denied'); }, configurable: true }));
	await page.locator('[data-action="copy-token"]').click();
	await expect(page.getByText('Unable to copy the token. Please try again.')).toBeVisible();
	await page.evaluate(() => chrome.storage.local.remove('local_storage_key_baah_token_created_at'));
	await expect(page.getByText('(creation date unavailable)', { exact: true })).toBeVisible();
	expect(await readToken()).toBe(second);
	await page.context().clearPermissions();
});

export default test;
