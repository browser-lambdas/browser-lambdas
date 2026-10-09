import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

const lambdas = [
	{
		id: 'release-args-positional', name: 'release-args-positional first second third', project: '', world: 'USER_SCRIPT', allowedWorlds: ['user_scripts'], urlAllowlistEnabled: true, urlPatterns: ['*'],
		func: 'console.log(JSON.stringify(ctx.args.all()));'
	},
	{
		id: 'release-args-delimiter', name: 'release-args-delimiter', project: '', world: 'USER_SCRIPT', allowedWorlds: ['user_scripts'], urlAllowlistEnabled: true, urlPatterns: ['*'],
		func: 'const args = ctx.args.all(); console.log(JSON.stringify({ first: args[0], second: args[1] }));'
	},
	{
		id: 'release-args-alias', name: 'release-args-alias', project: '', world: 'USER_SCRIPT', allowedWorlds: ['user_scripts'], urlAllowlistEnabled: true, urlPatterns: ['*'],
		func: 'console.log(JSON.stringify(ctx.args.all({ u: "username", p: "password" })));'
	},
	{
		id: 'release-args-auto', name: 'release-args-auto --x --y', project: '', world: 'USER_SCRIPT', allowedWorlds: ['user_scripts'], urlAllowlistEnabled: true, urlPatterns: ['*'],
		func: 'console.log("auto");'
	}
];

async function run(shell: ReturnType<import('@playwright/test').Page['frameLocator']>, command: string, expected: string) {
	const input = shell.locator('#shell-input');
	const outputs = shell.locator('#shell-outputs p');
	const before = await outputs.count();
	await input.fill(command);
	await input.press('Enter');
	await expect.poll(() => outputs.count(), { timeout: 10_000 }).toBeGreaterThan(before);
	await expect(outputs.last()).toHaveText(expected);
}

test('ctx.args parsing and shell interaction', async ({ page, extensionId, localTestPage }) => {
	const base = `chrome-extension://${extensionId}`;
	await page.goto(`${base}/settings.html`);
	await page.evaluate((items) => chrome.storage.local.set({
		local_storage_key_lambdas: JSON.stringify(items),
		local_storage_key_input_history: []
	}), lambdas);
	await page.goto(localTestPage);
	await page.waitForTimeout(500);
	await page.keyboard.press('Meta+k');
	const shell = page.frameLocator('#browser-lambdas-shell');
	const input = shell.locator('#shell-input');
	await expect(input).toBeVisible();

	await run(shell, 'release-args-positional first second third', '{"0":"first","1":"second","2":"third"}');
	await run(shell, 'release-args-delimiter -- -dash --literal', '{"first":"-dash","second":"--literal"}');
	await run(shell, 'release-args-alias -u alice -p dummy', '{"username":"alice","password":"dummy"}');
	await run(shell, 'release-args-alias', '{}');

	await input.fill('@user-world release-args-au');
	await expect(shell.locator('.shell-suggestion')).toHaveCount(1);
	await input.press('Tab');
	await expect(input).toHaveValue('@user-world release-args-auto');

	await page.evaluate(() => navigator.clipboard.writeText('release-args-auto'));
	await input.fill('');
	await input.press('ControlOrMeta+V');
	await expect(input).toHaveValue('release-args-auto');

	await input.fill('first-command');
	await input.press('Enter');
	await input.fill('clear');
	await input.press('Enter');
	await input.press('ArrowUp');
	await expect(input).toHaveValue('clear');
});

export default test;
