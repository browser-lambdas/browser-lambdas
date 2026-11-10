import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';

async function serveDocs(page: Page) {
	const root = fileURLToPath(new URL('../../web/', import.meta.url));
	await page.route('https://browser-lambdas.dev/**', async route => {
		const url = new URL(route.request().url());
		const file = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
		if (!file.startsWith(root.replace(/\/$/, '') + sep)) return route.abort();
		await route.fulfill({ path: file });
	});
}

const progress = (page: Page) => page.evaluate(async () => {
	const stored = await chrome.storage.local.get('local_storage_key_storage');
	return JSON.parse(stored.local_storage_key_storage || '[]').find((item: any) => item.key === 'tutorial-progress')?.value;
});

test('empty categories offer the hunt once, and declining preserves empty resources', async ({ page, extensionId }) => {
	const base = `chrome-extension://${extensionId}/workspace.html`;
	for (const tab of ['functions', 'storage', 'secrets', 'triggers', 'styles']) {
		await page.goto(`${base}#${tab}`);
		await expect(page.getByText('Looks like you’re starting from scratch. Want to try the treasure-hunt tutorial?')).toBeVisible();
	}
	await page.locator('[data-action="search"]').fill('no matches');
	await expect(page.locator('.tutorial-prompt')).toHaveCount(0);
	await page.locator('[data-action="search"]').fill('');
	await page.getByRole('button', { name: 'No', exact: true }).click();
	await expect(page.locator('.tutorial-prompt')).toHaveCount(0);
	await page.goto(`${base}#functions`);
	await expect(page.getByTestId('sidebar-functions-add')).toBeVisible();
	await expect(page.locator('.tutorial-prompt')).toHaveCount(0);
	await expect(page.getByTestId('sidebar-functions-item')).toHaveCount(0);
	expect(await page.evaluate(async () => (await chrome.storage.local.get('local_storage_key_tutorial_status')).local_storage_key_tutorial_status)).toBe('dismissed');
});

test('treasure hunt installs through the workspace and completes three secret-backed challenges in the real Terminal', async ({ page, extensionContext, extensionId }) => {
	await page.goto(`chrome-extension://${extensionId}/workspace.html#functions`);
	await page.getByRole('button', { name: 'Yes', exact: true }).click();
	await expect(page.getByTestId('pane-title')).toHaveValue('begin');
	await expect(page.locator('.tutorial-prompt, .tutorial-ready, .workspace-notice')).toHaveCount(0);
	const snapshot = await page.evaluate(async () => {
		const data = await chrome.storage.local.get(['local_storage_key_lambdas', 'local_storage_key_secrets', 'local_storage_key_triggers']);
		return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, JSON.parse(value as string)]));
	});
	expect(snapshot.local_storage_key_lambdas.map((item: any) => item.name)).toEqual(['begin', 'answer', 'deactivate-demo']);
	expect(snapshot.local_storage_key_secrets.map((item: any) => item.value)).toEqual(['ctx.kv.get()', 'baah', 'llms.txt']);
	expect(snapshot.local_storage_key_triggers).toHaveLength(1);
	expect(snapshot.local_storage_key_triggers[0]).toMatchObject({ name: 'deactivate-demo', enabled: true, commands: ['deactivate-demo'] });
	expect(await progress(page)).toBeNull();
	const docs = await extensionContext.newPage();
	try {
		await serveDocs(docs);
		await docs.goto('https://browser-lambdas.dev/');
		await expect.poll(() => docs.evaluate(() => localStorage.getItem('browser-lambdas-demo-disabled'))).toBe('true');
		await docs.keyboard.press('Meta+k');
		const shell = docs.frameLocator('#browser-lambdas-shell');
		const input = shell.locator('#shell-input');
		const output = shell.locator('#shell-outputs');
		await expect(input).toBeVisible();
		const run = async (command: string) => { await input.fill(command); await input.press('Enter'); };
		await run('answer anything');
		await expect(output).toContainText('Type begin to start the treasure hunt.');
		await run('begin');
		await expect(output).toContainText('Welcome to the docs treasure hunt');
		await expect.poll(() => progress(page)).toBe(0);
		await docs.locator('.docs-categories [data-category-link="ctx"]').click();
		await run('answer ctx.kv');
		await expect(output).toContainText('Not quite! Try again.');
		expect(await progress(page)).toBe(0);
		await run('answer ctx.kv.get()');
		await expect(output).toContainText('1/3 completed!');
		await expect.poll(() => progress(page)).toBe(1);
		await docs.locator('.docs-categories [data-category-link="baah"]').click();
		await page.evaluate(async () => {
			const key = 'local_storage_key_secrets';
			const secrets = JSON.parse((await chrome.storage.local.get(key))[key]);
			secrets.find((item: any) => item.key === 'tutorial-answer-2').allowedWorlds = [];
			await chrome.storage.local.set({ [key]: JSON.stringify(secrets) });
		});
		await run('answer baah');
		await expect(output).toContainText('The answer secret is unavailable.');
		expect(await progress(page)).toBe(1);
		await page.evaluate(async () => {
			const key = 'local_storage_key_secrets';
			const secrets = JSON.parse((await chrome.storage.local.get(key))[key]);
			secrets.find((item: any) => item.key === 'tutorial-answer-2').allowedWorlds = ['user_scripts'];
			await chrome.storage.local.set({ [key]: JSON.stringify(secrets) });
		});
		await run('answer baah');
		await expect(output).toContainText('2/3 completed!');
		await expect.poll(() => progress(page)).toBe(2);
		await docs.reload();
		await docs.locator('.docs-categories [data-category-link="llms"]').click();
		await docs.keyboard.press('Meta+k');
		await expect(input).toBeVisible();
		await run('answer llms.txt');
		await expect(output).toContainText('Congratulations!');
		await expect(output).toContainText('You have completed the treasure hunt');
		await expect.poll(() => progress(page)).toBe(3);
		await run('answer llms.txt');
		await expect(output).toContainText('You have already completed the treasure hunt!');
		await run('begin');
		await expect.poll(() => progress(page)).toBe(0);
	} finally { await docs.close(); }
});
