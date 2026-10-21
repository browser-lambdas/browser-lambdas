import type { Page } from '@playwright/test';
import { writeFile } from 'fs/promises';
import { allowFunctionOnTestPages } from './function-access';
import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

const pageMessages = new Map<Page, string[]>();
test.beforeEach(async ({ page }) => {
	const messages: string[] = [];
	pageMessages.set(page, messages);
	page.on('pageerror', (error) => messages.push(`error: ${error.message}`));
	page.on('console', (message) => messages.push(`${message.type()}: ${message.text()}`));
});

test.afterEach(async ({ page, extensionContext }, info) => {
	const messages = pageMessages.get(page);
	pageMessages.delete(page);
	if (info.status === info.expectedStatus) return;
	const worker = extensionContext.serviceWorkers()[0];
	const state = await worker.evaluate(() => chrome.storage.local.get(['activityLogs', 'local_storage_key_lambdas', 'local_storage_key_storage', 'local_storage_key_project_settings', 'local_storage_key_allow_main_world_functions', 'local_storage_key_allow_main_world_storage']));
	const pageState = page.isClosed() ? { closed: true } : await page.evaluate(() => ({ visibility: document.visibilityState, focused: document.hasFocus(), cryptoTrace: (window as any).cryptoTrace }));
	const path = info.outputPath('trigger-state.json');
	await writeFile(path, JSON.stringify({ ...state, pageState, pageMessages: messages }, null, 2));
	await info.attach('trigger-state', { path, contentType: 'application/json' });
});

async function installTrigger(page: Page, extensionId: string, commands: Array<[string, string]>, main = false) {
	const base = `chrome-extension://${extensionId}`;
	await page.goto(`${base}/workspace.html#functions`);
	for (const [name, code] of commands) {
		await page.getByTestId('sidebar-functions-add').click();
		await page.getByTestId('sidebar-functions-item').last().dblclick();
		await page.getByTestId('pane-title').fill(name);
		await page.getByTestId('pane-content').locator('.code-editor').fill(code);
		await allowFunctionOnTestPages(page, main);
		if (main) await page.getByTestId('pane-world').selectOption('MAIN');
		await page.getByTestId('pane-save').click();
		await expect(page.getByTestId('sidebar-functions-item').filter({ hasText: name })).toBeVisible();
		await expect.poll(() => page.evaluate(async (name) => JSON.parse((await chrome.storage.local.get('local_storage_key_lambdas')).local_storage_key_lambdas).find((item) => item.name === name), name)).toMatchObject({
			func: code, world: main ? 'MAIN' : '', urlAllowlistEnabled: true, urlPatterns: ['*'], allowedWorlds: main ? ['user_scripts', 'main'] : ['user_scripts']
		});
	}
	await page.goto(`${base}/workspace.html#triggers`);
	await page.getByTestId('sidebar-triggers-add').click();
	await page.getByTestId('trigger-url-patterns').fill('*127.0.0.1*');
	await page.getByTestId('trigger-commands').fill(commands.map(([name]) => name).join('\n'));
	await page.getByTestId('pane-save').click();
	await expect.poll(() => page.evaluate(async () => JSON.parse((await chrome.storage.local.get('local_storage_key_triggers')).local_storage_key_triggers || '[]').length)).toBe(1);
}

test('trigger executes every command and produces independent page effects', async ({ page, extensionId, localTestPage }) => {
	await installTrigger(page, extensionId, [
		['trigger-first-effect', "await new Promise(resolve => setTimeout(resolve, 200)); document.documentElement.dataset.triggerFirst = 'done';"],
		['trigger-second-effect', "document.documentElement.dataset.triggerSecond = 'done';"],
	]);
	await page.goto(localTestPage);
	await expect.poll(() => page.evaluate(() => ({ first: document.documentElement.dataset.triggerFirst, second: document.documentElement.dataset.triggerSecond }))).toEqual({ first: 'done', second: 'done' });
});

for (const delay of [60, 1100]) test(`main-world trigger handles a ${delay}ms crypto round trip`, async ({ page, extensionId, localTestPage, extensionContext }) => {
	await installTrigger(page, extensionId, [
		['trigger-delayed-crypto', "document.documentElement.dataset.delayedCrypto = 'ran';"],
		['trigger-after-crypto', "document.documentElement.dataset.afterCrypto = 'ran';"],
	], true);
	await page.addInitScript((delay) => {
		const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
		(window as any).cryptoTrace = [];
		crypto.subtle.decrypt = async (...args) => {
			(window as any).cryptoTrace.push({ phase: 'start', now: performance.now(), visibility: document.visibilityState, focused: document.hasFocus() });
			await new Promise((resolve) => setTimeout(resolve, delay));
			const result = await decrypt(...args);
			(window as any).cryptoTrace.push({ phase: 'end', now: performance.now(), visibility: document.visibilityState, focused: document.hasFocus() });
			return result;
		};
	}, delay);
	await page.goto(localTestPage);
	if (delay < 1000) {
		await expect(page.locator('html')).toHaveAttribute('data-delayed-crypto', 'ran');
		await expect(page.locator('html')).toHaveAttribute('data-after-crypto', 'ran');
	} else {
		const worker = extensionContext.serviceWorkers()[0];
		await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('activityLogs')).activityLogs?.filter((entry) => entry.level === 'error').map((entry) => entry.message).join('\n') || '')).toMatch(/runtime connection|runtime handshake timed out/);
		await expect(page.locator('html')).not.toHaveAttribute('data-delayed-crypto');
		await expect(page.locator('html')).not.toHaveAttribute('data-after-crypto');
	}
});

for (const main of [false, true]) test(`trigger awaits each command before reading its result in ${main ? 'main' : 'user'} world`, async ({ page, extensionId, localTestPage }) => {
	await page.goto(`chrome-extension://${extensionId}/workspace.html#functions`);
	await page.evaluate((main) => chrome.storage.local.set({
		local_storage_key_allow_main_world_storage: main,
		local_storage_key_storage: JSON.stringify([{ id: 'trigger-order', key: 'trigger-order', value: 'not-yet', allowedWorlds: ['user_scripts', 'main'], urlAllowlistEnabled: true, urlPatterns: ['*'] }])
	}), main);
	await installTrigger(page, extensionId, [
		['trigger-order-write', "await new Promise(resolve => setTimeout(resolve, 200)); await ctx.kv.set('trigger-order', 'written');"],
		['trigger-order-read', "document.documentElement.dataset.triggerOrder = await ctx.kv.get('trigger-order');"],
	], main);
	const worker = page.context().serviceWorkers()[0];
	await page.goto(localTestPage);
	await expect(page.locator('html')).toHaveAttribute('data-trigger-order', 'written');
	expect(await worker.evaluate(async () => JSON.parse((await chrome.storage.local.get('local_storage_key_storage')).local_storage_key_storage)[0].value)).toBe('written');
});

for (const [name, code, reason] of [
	['runtime failure', "throw new Error('trigger-test-failure');", 'trigger-test-failure'],
	['startup failure', 'const = ;', 'runtime connection'],
] as const) test(`trigger stops its remaining commands after a ${name}`, async ({ page, extensionId, localTestPage, extensionContext }) => {
	await installTrigger(page, extensionId, [
		['trigger-failure', code],
		['trigger-after-failure', "document.documentElement.dataset.afterFailure = 'ran';"],
	]);
	const worker = extensionContext.serviceWorkers()[0];
	await page.goto(localTestPage);
	await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('activityLogs')).activityLogs?.filter((entry) => entry.level === 'error').map((entry) => entry.message).join('\n') || '')).toContain(`Trigger execution failed:`);
	const errors = await worker.evaluate(async () => (await chrome.storage.local.get('activityLogs')).activityLogs.filter((entry) => entry.level === 'error').map((entry) => entry.message).join('\n'));
	expect(errors).toContain(reason);
	await expect(page.locator('html')).not.toHaveAttribute('data-after-failure');
});

test('a trigger stops when its current command closes the tab', async ({ page, extensionId, localTestPage, extensionContext }) => {
	await installTrigger(page, extensionId, [
		['trigger-close', 'await ctx.tabs.this().close();'],
		['trigger-after-close', "log.info('AFTER_CLOSED_TAB');"],
	]);
	const worker = extensionContext.serviceWorkers()[0];
	const target = await extensionContext.newPage();
	const closed = target.waitForEvent('close');
	await target.goto(localTestPage);
	await closed;
	await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('activityLogs')).activityLogs?.filter((entry) => entry.level === 'error').map((entry) => entry.message).join('\n') || '')).toContain('The tab disconnected before the function finished.');
	expect(await worker.evaluate(async () => (await chrome.storage.local.get('activityLogs')).activityLogs.some((entry) => entry.message === 'AFTER_CLOSED_TAB'))).toBe(false);
});
