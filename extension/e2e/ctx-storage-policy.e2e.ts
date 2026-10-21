import { test, expect } from './fixtures';
import { exerciseCallerAllowlist, runPolicyCommand } from './policy-helpers';

test.describe.configure({ timeout: 120_000 });

test('K-V caller controls enforce project/function allowlists, empty lists and the full calling ancestry', async ({ page, extensionContext, extensionId, localTestPage }) => {
	await exerciseCallerAllowlist({ page, extensionContext, extensionId, localTestPage, secret: false });
});

test('revoking a project permission blocks the next request of an already-running invocation', async ({ page, extensionContext, localTestPage }) => {
	const worker = extensionContext.serviceWorkers()[0];
	await worker.evaluate(async () => {
		await chrome.storage.local.set({
			local_storage_key_storage: JSON.stringify([{ id: 'live', key: 'live', value: 'UNCHANGED' }]),
			local_storage_key_lambdas: JSON.stringify([{ id: 'live', project: 'live', name: 'live-permission', func: 'const before = await ctx.kv.get("live"); document.body.dataset.beforeRevocation = before; await new Promise(resolve => document.addEventListener("continue-permission-test", resolve, { once: true })); const saved = await ctx.kv.set("live", "CHANGED"); console.log(JSON.stringify({ saved }));' }])
		});
	});
	await page.goto(localTestPage);
	const output = await runPolicyCommand(page, 'live-permission');
	await expect(page.locator('body')).toHaveAttribute('data-before-revocation', 'UNCHANGED');
	await worker.evaluate(() => chrome.storage.local.set({ local_storage_key_project_settings: { live: { functions: { userWorld: false } } } }));
	await page.evaluate(() => document.dispatchEvent(new Event('continue-permission-test')));
	await expect(output.filter({ hasText: '{"saved":false}' })).toHaveCount(1);
	await expect(output.filter({ hasText: 'access was revoked' })).toHaveCount(1);
	expect(await worker.evaluate(async () => JSON.parse((await chrome.storage.local.get('local_storage_key_storage')).local_storage_key_storage)[0].value)).toBe('UNCHANGED');
});

test('K-V checks pages and both main-world permissions for reads and writes', async ({ page, extensionId, localTestPage, reactionTime }) => {
	const base = `chrome-extension://${extensionId}`;
	await page.goto(`${base}/workspace.html#storage`);
	await page.evaluate(async (origin) => {
		await chrome.storage.local.clear();
		await chrome.storage.local.set({
			local_storage_key_allow_main_world_functions: true,
			local_storage_key_storage: JSON.stringify([{ id: 'policy', key: 'policy', value: 'original', allowedWorlds: ['user_scripts', 'main'], urlAllowlistEnabled: true, urlPatterns: [`${origin}/allowed/*`] }]),
			local_storage_key_lambdas: JSON.stringify([{ id: 'lambda', name: 'kv-policy', allowedWorlds: ['user_scripts', 'main'], urlAllowlistEnabled: true, urlPatterns: ['*'], func: 'const before = await ctx.kv.get("policy"); const saved = await ctx.kv.set("policy", "updated"); console.log(JSON.stringify({ before, saved }));' }])
		});
	}, new URL(localTestPage).origin);
	const run = async (path: string, main = false) => {
		await page.goto(`${localTestPage}${path}`);
		await page.waitForTimeout(reactionTime);
		await page.keyboard.press('Meta+k');
		const shell = page.frameLocator('#browser-lambdas-shell');
		await shell.locator('#shell-input').fill(`${main ? '@main-world ' : ''}kv-policy`);
		await shell.locator('#shell-input').press('Enter');
		return shell.locator('#shell-outputs p');
	};
	const persistedValue = async () => {
		await page.goto(`${base}/workspace.html#storage`);
		return page.evaluate(async () => JSON.parse((await chrome.storage.local.get('local_storage_key_storage')).local_storage_key_storage)[0].value);
	};
	let outputs = await run('/denied/page');
	await expect(outputs.filter({ hasText: '{"before":null,"saved":false}' })).toHaveCount(1);
	expect((await outputs.allTextContents()).join('\n')).not.toContain('original');
	expect(await persistedValue()).toBe('original');

	outputs = await run('/allowed/page', true);
	await expect(outputs.filter({ hasText: '{"before":null,"saved":false}' })).toHaveCount(1);
	expect(await persistedValue()).toBe('original');
	await page.evaluate(() => chrome.storage.local.set({ local_storage_key_allow_main_world_storage: true }));
	outputs = await run('/allowed/page', true);
	await expect(outputs.filter({ hasText: '{"before":"original","saved":true}' })).toHaveCount(1);
	expect(await persistedValue()).toBe('updated');

	await page.evaluate(async () => {
		const { local_storage_key_storage } = await chrome.storage.local.get('local_storage_key_storage');
		const items = JSON.parse(local_storage_key_storage);
		items[0].allowedWorlds = ['user_scripts'];
		items[0].allowedReadWorlds = ['user_scripts'];
		items[0].allowedWriteWorlds = ['user_scripts'];
		await chrome.storage.local.set({ local_storage_key_allow_main_world_functions: true,
			local_storage_key_storage: JSON.stringify(items) });
	});
	outputs = await run('/allowed/page', true);
	await expect(outputs.filter({ hasText: '{"before":null,"saved":false}' })).toHaveCount(1);
	outputs = await run('/allowed/page');
	await expect(outputs.filter({ hasText: '{"before":"updated","saved":true}' })).toHaveCount(1);
});

for (const world of ['user-world', 'main-world']) {
	test(`K-V creates a missing key from ${world} without an origin allowlist`, async ({ page, extensionId, localTestPage, reactionTime }) => {
		const workspace = `chrome-extension://${extensionId}/workspace.html#storage`;
		await page.goto(workspace);
		await page.evaluate(async () => {
			await chrome.storage.local.clear();
			await chrome.storage.local.set({
				local_storage_key_allow_main_world_functions: true,
				local_storage_key_allow_main_world_storage: true,
				local_storage_key_lambdas: JSON.stringify([{
					id: 'create', name: 'create-key', allowedWorlds: ['user_scripts', 'main'], urlAllowlistEnabled: false,
					func: 'console.log(JSON.stringify({ saved: await ctx.kv.set("created", "value"), value: await ctx.kv.get("created") }));'
				}])
			});
		});
		await page.goto(localTestPage);
		await page.waitForTimeout(reactionTime);
		await page.keyboard.press('Meta+k');
		const shell = page.frameLocator('#browser-lambdas-shell');
		await shell.locator('#shell-input').fill(`@${world} create-key`);
		await shell.locator('#shell-input').press('Enter');
		await expect(shell.locator('#shell-outputs p').filter({ hasText: '{"saved":true,"value":"value"}' })).toHaveCount(1);
		await page.goto(workspace);
		const records = await page.evaluate(async () => JSON.parse((await chrome.storage.local.get('local_storage_key_storage')).local_storage_key_storage));
		expect(records).toHaveLength(1);
		expect(records[0].urlAllowlistEnabled).toBe(false);
		expect(records[0].urlPatterns).toEqual([]);
		expect(records[0].allowedWorlds).toEqual(['user_scripts', 'main']);
	});
}
