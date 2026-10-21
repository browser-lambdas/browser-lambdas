import { allowFunctionOnTestPages } from './function-access';
import { test, expect } from './fixtures';
import { exerciseCallerAllowlist, runPolicyCommand } from './policy-helpers';

test.describe.configure({ timeout: 120_000 });

test('secret caller controls enforce both allowlists, empty lists and the full calling ancestry', async ({ page, extensionContext, extensionId, localTestPage }) => {
	await exerciseCallerAllowlist({ page, extensionContext, extensionId, localTestPage, secret: true });
});

test('an already-running function cannot read a secret after its project permission is revoked', async ({ page, extensionContext, localTestPage }) => {
	const worker = extensionContext.serviceWorkers()[0];
	await worker.evaluate(async () => {
		await chrome.storage.local.set({
			local_storage_key_secrets: JSON.stringify([{ id: 'live-secret', key: 'live-secret', value: 'PRIVATE_VALUE' }]),
			local_storage_key_lambdas: JSON.stringify([{ id: 'live', project: 'live', name: 'live-secret', func: 'const before = await ctx.secrets.get("live-secret"); document.body.dataset.secretReadStarted = String(before !== null); await new Promise(resolve => document.addEventListener("continue-secret-test", resolve, { once: true })); console.log(JSON.stringify({ after: await ctx.secrets.get("live-secret") }));' }])
		});
	});
	await page.goto(localTestPage);
	const output = await runPolicyCommand(page, 'live-secret');
	await expect(page.locator('body')).toHaveAttribute('data-secret-read-started', 'true');
	await worker.evaluate(() => chrome.storage.local.set({ local_storage_key_project_settings: { live: { functions: { userWorld: false } } } }));
	await page.evaluate(() => document.dispatchEvent(new Event('continue-secret-test')));
	await expect(output.filter({ hasText: '{"after":null}' })).toHaveCount(1);
	await expect(output.filter({ hasText: 'access was revoked' })).toHaveCount(1);
	expect((await output.allTextContents()).join('\n')).not.toContain('PRIVATE_VALUE');
	expect(await worker.evaluate(async () => ((await chrome.storage.local.get('activityLogs')).activityLogs || []).some((entry) => entry.message.includes('PRIVATE_VALUE')))).toBe(false);
});

test('secret URL policy is evaluated for every current invocation', async ({
	page,
	extensionId,
	localTestPage,
	reactionTime
}) => {
	const base = `chrome-extension://${extensionId}`;
	const key = `POLICY_SECRET_${Date.now()}`;
	const secretValue = `Δ policy\n"value" ${'x'.repeat(1024)}`;
	const allowedUrl = `${new URL(localTestPage).origin}/allowed/*`;

	await page.goto(`${base}/workspace.html#secrets`);
	await page.waitForTimeout(reactionTime);
	await page.evaluate(async ({ key, secretValue, allowedUrl }) => {
		await chrome.storage.local.set({
			local_storage_key_secrets: JSON.stringify([{
				id: crypto.randomUUID(),
				key,
				value: secretValue,
				allowedWorlds: ['user_scripts'],
				urlAllowlistEnabled: true, urlPatterns: [allowedUrl, '', '  ']
			}]),
			activityLogs: []
		});
	}, { key, secretValue, allowedUrl });

	await page.goto(`${base}/workspace.html#functions`);
	await page.waitForTimeout(reactionTime);
	await page.getByTestId('sidebar-functions-add').click();
	await page.getByTestId('sidebar-functions-item').last().dblclick();
	await page.getByTestId('pane-title').last().fill('ctx-secret-policy');
	await page.keyboard.press('Enter');
	await page.locator('.code-editor').click();
	await page.keyboard.type(`const value = await ctx.secrets.get('${key}');\nconsole.log(JSON.stringify({ value, denied: value === null }));`);
	await allowFunctionOnTestPages(page);
	await page.getByTestId('pane-save').click();

	const run = async (url: string) => {
		await page.goto(url);
		await page.waitForTimeout(reactionTime);
		await page.keyboard.press('Meta+k');
		const shell = page.frameLocator('#browser-lambdas-shell');
		const input = shell.locator('#shell-input');
		await input.fill('ctx-secret-policy');
		await input.press('Enter');
		return shell.locator('#shell-outputs p');
	};

	const allowedOutput = await run(`${new URL(localTestPage).origin}/allowed/page`);
	await expect(allowedOutput.filter({ hasText: JSON.stringify({ value: secretValue, denied: false }) })).toHaveCount(1);

	const deniedOutput = await run(`${new URL(localTestPage).origin}/denied/page`);
	await expect(deniedOutput.filter({ hasText: '"denied":true' })).toHaveCount(1);
	expect((await deniedOutput.allTextContents()).join('\n')).not.toContain(secretValue);

	await page.goto(`${base}/settings.html`);
	await expect.poll(() => page.evaluate(async (secretValue) => {
		const { activityLogs = [] } = await chrome.storage.local.get('activityLogs');
		return activityLogs.some((entry) => entry.message.includes('current URL does not match')) &&
			!activityLogs.some((entry) => entry.message.includes(secretValue));
	}, secretValue)).toBe(true);
});

export default test;
