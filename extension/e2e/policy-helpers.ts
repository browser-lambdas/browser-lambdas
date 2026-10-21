import type { BrowserContext, Page } from '@playwright/test';
import { expect } from './fixtures';

export async function runPolicyCommand(page: Page, command: string) {
	const input = page.frameLocator('#browser-lambdas-shell').locator('#shell-input');
	await expect(async () => {
		if (!await page.locator('#browser-lambdas-shell').count()) await page.keyboard.press('Meta+k');
		await expect(input).toBeVisible({ timeout: 1_000 });
	}).toPass({ timeout: 15_000 });
	await input.fill(command);
	await input.press('Enter');
	return page.frameLocator('#browser-lambdas-shell').locator('#shell-outputs p');
}

export async function showCallerRestrictions(page: Page, tab: 'storage' | 'secrets', key: string) {
	await page.getByTestId(`sidebar-${tab}-item`).filter({ hasText: key }).click();
	await page.getByRole('button', { name: 'Show settings', exact: true }).click();
	await page.getByText('Caller restrictions', { exact: true }).click();
}

export async function exerciseCallerAllowlist({ page, extensionContext, extensionId, localTestPage, secret }: {
	page: Page; extensionContext: BrowserContext; extensionId: string; localTestPage: string; secret: boolean;
}) {
	const storageKey = secret ? 'local_storage_key_secrets' : 'local_storage_key_storage';
	const tab = secret ? 'secrets' : 'storage';
	const worker = extensionContext.serviceWorkers()[0];
	await worker.evaluate(async ({ storageKey, secret }) => {
		const read = secret ? 'ctx.secrets.get' : 'ctx.kv.get';
		const func = `const value = await ${read}("caller-policy"); ${secret ? '' : 'const saved = await ctx.kv.set("caller-policy", "PROTECTED_VALUE");'} console.log(JSON.stringify({ value${secret ? '' : ', saved'} }));`;
		await chrome.storage.local.set({
			[storageKey]: JSON.stringify([{ id: 'caller-policy', key: 'caller-policy', value: 'PROTECTED_VALUE', allowedWorlds: ['user_scripts'] }]),
			local_storage_key_lambdas: JSON.stringify([
				{ id: 'reader', project: 'allowed', name: 'reader', func },
				{ id: 'outsider', project: 'other', name: 'outsider', func },
				{ id: 'parent', project: 'other', name: 'parent', func: 'await ctx.run("reader"); console.log("PARENT_FINISHED");' },
				{ id: 'allowed-parent', project: 'allowed', name: 'allowed-parent', func: 'await ctx.run("reader"); console.log("PARENT_FINISHED");' }
			])
		});
	}, { storageKey, secret });
	await page.goto(`chrome-extension://${extensionId}/workspace.html#${tab}`);
	await showCallerRestrictions(page, tab, 'caller-policy');
	const target = await extensionContext.newPage();
	const configure = async (projects: string[] | null, functions: string[] | null) => {
		const details = page.locator('details.caller-restrictions');
		if (!await details.evaluate((element: HTMLDetailsElement) => element.open)) await details.locator('summary').click();
		await page.getByRole('switch', { name: 'Only allow specific projects', exact: true }).setChecked(projects !== null);
		if (projects !== null) await page.getByRole('textbox', { name: 'Allowed projects', exact: true }).fill(projects.join('\n'));
		await page.getByRole('switch', { name: 'Only allow specific functions', exact: true }).setChecked(functions !== null);
		if (functions !== null) await page.getByRole('textbox', { name: 'Allowed functions', exact: true }).fill(functions.join('\n'));
		await page.getByTestId('pane-save').click();
		await expect(page.getByRole('alert')).toHaveCount(0);
		await expect.poll(() => worker.evaluate(async (storageKey) => {
			const item = JSON.parse((await chrome.storage.local.get(storageKey))[storageKey])[0];
			return { ...item, projectsEnabled: item.projectsEnabled === true, functionsEnabled: item.functionsEnabled === true };
		}, storageKey)).toMatchObject({
			projectsEnabled: projects !== null, functionsEnabled: functions !== null,
			...(projects === null ? {} : { allowedProjects: projects }),
			...(functions === null ? {} : { allowedFunctions: functions })
		});
	};
	const run = async (command: string, allowed: boolean) => {
		await target.goto(`${localTestPage}/caller-restrictions`);
		const output = await runPolicyCommand(target, command);
		await expect(output.filter({ hasText: JSON.stringify(secret ? { value: allowed ? 'PROTECTED_VALUE' : null } : { value: allowed ? 'PROTECTED_VALUE' : null, saved: allowed }) })).toHaveCount(1);
		if (!allowed) expect((await output.allTextContents()).join('\n')).not.toContain('PROTECTED_VALUE');
		if (!secret) expect(await worker.evaluate(async (storageKey) => JSON.parse((await chrome.storage.local.get(storageKey))[storageKey])[0].value, storageKey)).toBe('PROTECTED_VALUE');
	};
	try {
		await run('reader', true);
		await configure(['allowed'], null);
		await run('reader', true);
		await run('outsider', false);
		await run('parent', false);
		await configure(null, ['allowed/reader']);
		await run('reader', true);
		await run('outsider', false);
		await run('allowed-parent', false);
		await configure(['allowed'], ['allowed/reader']);
		await run('reader', true);
		await run('parent', false);
		await configure(['other'], ['allowed/reader']);
		await run('reader', false);
		await configure(['allowed'], ['other/reader']);
		await run('reader', false);
		await configure(['allowed'], []);
		await run('reader', false);
		await configure([], ['allowed/reader']);
		await run('reader', false);
	} finally { await target.close(); }
}
