import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test('storage ui operations', async ({ page, extensionId, reactionTime }) => {
	const base = `chrome-extension://${extensionId}`;

	// Start on the storage tab
	await page.goto(`${base}/workspace.html#storage`);
	await page.waitForTimeout(reactionTime);

	// ensure empty state in case previous tests left data behind
	await page.evaluate(() => (chrome as any).storage.local.clear());
	await page.reload();
	await page.waitForTimeout(reactionTime);

	// Add storage item
	await page.getByTestId('sidebar-storage-add').click();
	await page.getByRole('button', { name: 'Show settings' }).click();
	await page.waitForTimeout(reactionTime);

	const keyInput = page.getByTestId('pane-key');
	await keyInput.fill('test-storage-key');
	await page.waitForTimeout(reactionTime);

	const editor = page.getByTestId('pane-value');
	await editor.click();
	await page.keyboard.type('test-storage-value');
	await page.waitForTimeout(reactionTime);

	await page.getByTestId('pane-save').click();
	await page.waitForTimeout(reactionTime);

	// Reload and verify persistence
	await page.reload();
	await page.waitForTimeout(reactionTime);

	const firstItem = page.getByTestId('sidebar-storage-item').first();
	await expect(firstItem).toHaveText('test-storage-key');
	await firstItem.click();
	await page.getByRole('button', { name: 'Show settings' }).click();
	await page.waitForTimeout(reactionTime);
	await expect(page.getByTestId('pane-key')).toHaveValue('test-storage-key');
	await expect(page.getByTestId('pane-content')).toContainText('test-storage-value');

	// Edit and save again
	await page.getByTestId('pane-key').fill('test-storage-key-edited');
	await page.waitForTimeout(reactionTime);
	await page.getByTestId('pane-value').fill('test-storage-value-edited');
	await page.waitForTimeout(reactionTime);
	await page.getByTestId('pane-save').click();
	await page.waitForTimeout(reactionTime);

	await expect(page.getByTestId('sidebar-storage-item').first()).toHaveText(
		'test-storage-key-edited'
	);
	await expect(page.getByTestId('pane-content')).toContainText('test-storage-value-edited');

	// Search for the item, then clear the search and reopen it.
	const search = page.getByPlaceholder('search storage');
	await search.fill('edited');
	await expect(page.getByTestId('sidebar-storage-item')).toHaveCount(1);
	await expect(page.getByTestId('sidebar-storage-item').first()).toHaveText(
		'test-storage-key-edited'
	);
	await search.fill('missing');
	await expect(page.getByTestId('sidebar-storage-item')).toHaveCount(0);
	await search.fill('');
	await page.getByTestId('sidebar-storage-item').first().click();
	await page.getByRole('button', { name: 'Show settings' }).click();
	await expect(page.getByTestId('pane-key')).toHaveValue('test-storage-key-edited');
	await expect(page.getByTestId('pane-content')).toContainText('test-storage-value-edited');

	// Delete the item and confirm empty state
	await page.getByTestId('pane-delete').click();
	await page.waitForTimeout(reactionTime);
	await expect(page.getByTestId('sidebar-storage-item')).toHaveCount(0);
});

test('storage ui preserves edge-case keys and values', async ({ page, extensionId, reactionTime }) => {
	const base = `chrome-extension://${extensionId}`;
	const longKey = `long-${'x'.repeat(256)}`;
	const largeValue = 'large-value-'.repeat(8_192);
	const items = [
		{ key: '', value: 'empty-key-value' },
		{ key: 'duplicate-key', value: 'duplicate-one' },
		{ key: 'duplicate-key', value: 'duplicate-two' },
		{ key: longKey, value: largeValue },
		{ key: 'invalid-json-like', value: '{"unterminated":' }
	];

	await page.goto(`${base}/workspace.html#storage`);
	await page.waitForTimeout(reactionTime);
	await page.evaluate(() => (chrome as any).storage.local.clear());
	await page.reload();
	await page.waitForTimeout(reactionTime);

	for (const item of items) {
		await page.getByTestId('sidebar-storage-add').click();
		await page.getByRole('button', { name: 'Show settings' }).click();
		await page.getByTestId('pane-key').fill(item.key);
		await page.getByTestId('pane-value').fill(item.value);
		await page.getByTestId('pane-save').click();
		await page.waitForTimeout(reactionTime);
	}

	const stored = await page.evaluate(async () => {
		const result = await chrome.storage.local.get('local_storage_key_storage');
		return JSON.parse(result.local_storage_key_storage || '[]');
	});

	expect(stored).toHaveLength(items.length);
	expect(stored.map((item: { key: string; value: string }) => item.key)).toEqual([
		'',
		'duplicate-key',
		'duplicate-key',
		longKey,
		'invalid-json-like'
	]);
	expect(stored.map((item: { value: string }) => item.value)).toEqual(
		items.map((item) => item.value)
	);
	expect(new Set(stored.map((item: { id: string }) => item.id)).size).toBe(items.length);

	// The long and invalid JSON-like entries remain addressable through the UI.
	await page.getByPlaceholder('search storage').fill('invalid-json-like');
	await page.getByTestId('sidebar-storage-item').click();
	await page.getByRole('button', { name: 'Show settings' }).click();
	await expect(page.getByTestId('pane-value')).toHaveValue('{"unterminated":');
	await page.getByPlaceholder('search storage').fill('long-');
	await page.getByTestId('sidebar-storage-item').click();
	await page.getByRole('button', { name: 'Show settings' }).click();
	await expect(page.getByTestId('pane-key')).toHaveValue(longKey);
	await expect(page.getByTestId('pane-value')).toHaveValue(largeValue);
});

test('storage policies preserve JSON values, validate patterns and show safe usage', async ({ page, extensionId }) => {
	await page.goto(`chrome-extension://${extensionId}/workspace.html#storage`);
	await page.evaluate(async () => {
		await chrome.storage.local.clear();
		await chrome.storage.local.set({ local_storage_key_storage: JSON.stringify([{ id: 'typed', key: 'a"\\key', value: { nested: [false, 0, null] } }]) });
	});
	await page.reload();
	await page.getByTestId('sidebar-storage-item').click();
	await page.getByRole('button', { name: 'Show settings' }).click();
	await expect(page.getByTestId('pane-value')).toHaveValue(JSON.stringify({ nested: [false, 0, null] }, null, 2));
	await expect(page.locator('.storage-code-box .code-highlight')).toContainText('nested');
	await expect(page.locator('.storage-code-box .line-numbers span')).toHaveCount(7);
	await expect(page.locator('[data-usage-for]')).toHaveAttribute('rows', '5');
	await expect(page.locator('[data-usage-for]')).toHaveValue('# get value\nconst value = await ctx.kv.get("a\\"\\\\key");\n\n# set value\nawait ctx.kv.set("a\\"\\\\key", "new value");');
	await expect(page.getByTestId('storage-url-allowlist')).not.toBeChecked();
	await page.getByTestId('storage-url-allowlist').check();
	await page.getByTestId('storage-url-patterns').fill('/[/');
	await page.getByTestId('pane-save').click();
	await expect(page.getByRole('alert')).toContainText('pattern is invalid');
	await page.getByTestId('storage-url-patterns').fill('https://example.com/*');
	await page.getByTestId('pane-save').click();
	await expect(page.getByRole('alert')).toHaveCount(0);
	const saved = await page.evaluate(async () => JSON.parse((await chrome.storage.local.get('local_storage_key_storage')).local_storage_key_storage)[0]);
	expect(saved.value).toEqual({ nested: [false, 0, null] });
	expect(saved.allowedWorlds).toEqual(['user_scripts']);
	expect(saved.urlPatterns).toEqual(['https://example.com/*']);
	await expect(page.getByRole('button', { name: /^Copy / })).toHaveCount(0);
	await page.getByTestId('pane-key').fill('renamed');
	await expect(page.getByTestId('pane-title')).toHaveText('renamed');
	await page.getByTestId('pane-value').fill('{not JSON');
	await page.getByTestId('pane-save').click();
	await expect.poll(() => page.evaluate(async () => JSON.parse((await chrome.storage.local.get('local_storage_key_storage')).local_storage_key_storage)[0].value)).toBe('{not JSON');
});

test('external writes refresh clean panes and protect dirty drafts and deletions', async ({ page, extensionContext, extensionId }) => {
	const url = `chrome-extension://${extensionId}/workspace.html#storage`;
	await page.goto(url);
	await page.evaluate(async () => {
		await chrome.storage.local.clear();
		await chrome.storage.local.set({ local_storage_key_storage: JSON.stringify([{ id: 'one', key: 'one', value: 'initial', allowedWorlds: ['user_scripts'], urlAllowlistEnabled: true, urlPatterns: ['*'] }]) });
	});
	await page.reload();
	await page.getByTestId('sidebar-storage-item').click();
	await page.getByRole('button', { name: 'Show settings' }).click();
	const second = await extensionContext.newPage();
	try {
		await second.goto(url);
		await second.getByTestId('sidebar-storage-item').click();
		await second.getByRole('button', { name: 'Show settings' }).click();
		await second.getByTestId('pane-value').fill('newer');
		await second.getByTestId('pane-save').click();
		await expect(page.getByTestId('pane-value')).toHaveValue('newer');
		await page.getByTestId('pane-value').fill('draft');
		await second.getByTestId('pane-value').fill('latest');
		await second.getByTestId('pane-save').click();
		await expect(page.getByText('This item changed elsewhere.', { exact: false })).toBeVisible();
		await expect(page.getByTestId('pane-value')).toHaveValue('draft');
		await page.getByTestId('pane-save').click();
		await expect(page.getByRole('alert')).toContainText('changed or was deleted elsewhere');
		await page.getByTestId('pane-delete').click();
		await expect(page.getByTestId('sidebar-storage-item')).toHaveCount(1);
		await page.getByTestId('sidebar-storage-item').click();
		await page.getByRole('button', { name: 'Show settings' }).click();
		await expect(page.getByTestId('pane-value')).toHaveValue('latest');
		await second.getByTestId('pane-delete').click();
		await expect(page.getByTestId('sidebar-storage-item')).toHaveCount(0);
		await page.getByTestId('pane-save').click();
		await expect(page.getByRole('alert')).toContainText('changed or was deleted elsewhere');
	} finally { await second.close(); }
});
