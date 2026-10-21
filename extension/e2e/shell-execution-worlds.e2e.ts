import { test, expect } from './fixtures';
import { runPolicyCommand } from './policy-helpers';

test('world selection follows built-in, project, function and explicit command precedence', async ({ page, extensionContext, localTestPage }) => {
	const worker = extensionContext.serviceWorkers()[0];
	await worker.evaluate(async () => {
		await chrome.storage.local.set({
			local_storage_key_allow_main_world_functions: true,
			local_storage_key_lambdas: JSON.stringify([{ id: 'world', project: 'worlds', name: 'test-world', allowedWorlds: ['user_scripts', 'main'], func: 'console.log(window.executionWorldMarker || "USER_WORLD_RESULT");' }])
		});
	});
	const run = async (command: string, world: string) => {
		await page.goto(localTestPage);
		await page.evaluate(() => { (window as Window & { executionWorldMarker?: string }).executionWorldMarker = 'MAIN_WORLD_RESULT'; });
		const output = await runPolicyCommand(page, command);
		await expect(output.filter({ hasText: world === 'main' ? /^MAIN_WORLD_RESULT$/ : /^USER_WORLD_RESULT$/ })).toHaveCount(1);
		await expect(output.filter({ hasText: world === 'main' ? /^USER_WORLD_RESULT$/ : /^MAIN_WORLD_RESULT$/ })).toHaveCount(0);
	};
	await run('test-world', 'user');
	await run('@main-world test-world', 'main');
	await worker.evaluate(() => chrome.storage.local.set({ local_storage_key_project_settings: { worlds: { functions: { mode: 'MAIN' } } } }));
	await run('test-world', 'main');
	await run('@user-world test-world', 'user');
	await worker.evaluate(async () => {
		const key = 'local_storage_key_lambdas';
		const items = JSON.parse((await chrome.storage.local.get(key))[key]);
		items[0].world = 'USER_SCRIPT';
		await chrome.storage.local.set({ [key]: JSON.stringify(items) });
	});
	await run('test-world', 'user');
	await run('@main-world test-world', 'main');
});
