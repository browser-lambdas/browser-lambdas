import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

const project = 'project-settings-workflow';
const policyKey = 'local_storage_key_project_settings';

async function prepare(page: Page, extensionId: string) {
	await page.goto(`chrome-extension://${extensionId}/workspace.html#functions`);
	await page.evaluate((name) => chrome.storage.local.set({
		local_storage_key_allow_main_world_functions: true,
		local_storage_key_baah_require_review: false,
		local_storage_key_lambdas: JSON.stringify([{ id: 'project-function', name: 'project-function', project: name, func: 'return 1', world: '', allowedWorlds: ['user_scripts'] }])
	}), project);
	await openProject(page);
}

async function openProject(page: Page) {
	await page.getByRole('button', { name: `Settings for ${project}`, exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Project settings', exact: true })).toBeVisible();
}

async function saved(page: Page) {
	return page.evaluate(async ({ key, name }) => (await chrome.storage.local.get(key))[key]?.[name] || {}, { key: policyKey, name: project });
}

async function holdNextSave(page: Page) {
	await page.evaluate(() => {
		const original = chrome.runtime.sendMessage.bind(chrome.runtime);
		let held = false;
		let release: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		(window as any).releaseProjectSave = () => release();
		chrome.runtime.sendMessage = (async (...args: any[]) => {
			if (!held && args[0]?.type === 'WORKSPACE_PROJECT_SETTINGS_UPDATE') {
				held = true;
				await gate;
			}
			return original(...args);
		}) as typeof chrome.runtime.sendMessage;
	});
}

test('project settings autosave every category, preserve typing, and restore the chosen world', async ({ page, extensionId }) => {
	await prepare(page, extensionId);
	const field = (name: string) => page.locator(`[data-setting="${name}"]`);
	await expect(page.getByTestId('pane-save')).toHaveCount(0);
	await expect(page.locator('.project-settings-panel details')).toHaveCount(0);
	await expect(field('userWorld')).toBeChecked();
	await expect(field('poll')).toBeChecked();
	await expect(field('review')).not.toBeChecked();
	await field('mode').selectOption('MAIN');
	await field('mainWorld').uncheck();
	await field('userWorld').uncheck();
	await expect(field('mode')).toBeDisabled();
	await expect(field('mode').locator('option:checked')).toHaveText('Disabled');
	await expect(field('mode')).toHaveAttribute('title', 'No execution worlds enabled');
	await expect(field('mode').locator('option:not([disabled])')).toHaveCount(0);
	await field('mainWorld').check();
	await expect(field('mode')).toHaveValue('MAIN');
	await field('restrictUrls').check();
	const patterns = 'https://example.com/one/*\nhttps://example.com/two/*\n';
	await field('urlPatterns').fill(patterns);
	await expect.poll(() => saved(page)).toMatchObject({ functions: { mode: 'MAIN', userWorld: false, mainWorld: true, restrictUrls: true, urlPatterns: patterns.trim() } });
	await expect(field('urlPatterns')).toHaveValue(patterns);
	await expect(field('urlPatterns')).toBeFocused();
	expect(await field('urlPatterns').evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(patterns.length);
	await field('restrictUrls').uncheck();
	await page.getByRole('tab', { name: 'Triggers', exact: true }).click();
	await field('enabled').uncheck();
	await field('restrictUrls').check();
	await field('urlPatterns').fill('https://example.com/trigger/*');
	await field('poll').uncheck();
	await field('review').check();
	await page.getByRole('tab', { name: 'Styles', exact: true }).click();
	await expect(field('restrictUrls')).toHaveCount(0);
	await field('enabled').uncheck();
	await field('lock').check();
	await expect.poll(() => saved(page)).toMatchObject({
		functions: { mode: 'MAIN', userWorld: false, mainWorld: true, restrictUrls: false, urlPatterns: patterns.trim() },
		triggers: { enabled: false, restrictUrls: true, urlPatterns: 'https://example.com/trigger/*', poll: false, review: true },
		styles: { enabled: false, lock: true }
	});
	await page.reload();
	await openProject(page);
	await expect(field('mode')).toHaveValue('MAIN');
	await expect(field('userWorld')).not.toBeChecked();
	await field('restrictUrls').check();
	await expect(field('urlPatterns')).toHaveValue(patterns.trim());
	await page.getByRole('tab', { name: 'Triggers', exact: true }).click();
	await expect(field('enabled')).not.toBeChecked();
	await expect(field('poll')).not.toBeChecked();
	await page.getByRole('tab', { name: 'Styles', exact: true }).click();
	await expect(field('enabled')).not.toBeChecked();
	await expect(field('lock')).toBeChecked();
});

test('failed project saves preserve edits, Retry succeeds, and invalid patterns never replace saved values', async ({ page, extensionId }) => {
	await prepare(page, extensionId);
	await page.evaluate(() => {
		const original = chrome.runtime.sendMessage.bind(chrome.runtime);
		let fail = true;
		chrome.runtime.sendMessage = (async (...args: any[]) => {
			if (fail && args[0]?.type === 'WORKSPACE_PROJECT_SETTINGS_UPDATE') {
				fail = false;
				throw new Error('Save temporarily unavailable');
			}
			return original(...args);
		}) as typeof chrome.runtime.sendMessage;
	});
	await page.locator('[data-setting="userWorld"]').uncheck();
	await expect(page.getByRole('alert')).toContainText('Save temporarily unavailable');
	await expect(page.locator('[data-setting="userWorld"]')).not.toBeChecked();
	expect(await saved(page)).toEqual({});
	await page.getByRole('button', { name: 'Retry', exact: true }).click();
	await expect.poll(() => saved(page)).toMatchObject({ functions: { userWorld: false } });
	await expect(page.getByRole('alert')).toHaveCount(0);
	await page.locator('[data-setting="restrictUrls"]').check();
	await page.locator('[data-setting="urlPatterns"]').fill('/[/');
	await expect(page.getByRole('alert')).toContainText('Check the URL patterns');
	await expect(page.locator('[data-setting="urlPatterns"]')).toHaveValue('/[/');
	expect((await saved(page)).functions.urlPatterns).toBeUndefined();
	await page.locator('[data-setting="urlPatterns"]').fill('https://example.com/fixed/*');
	await expect.poll(() => saved(page)).toMatchObject({ functions: { urlPatterns: 'https://example.com/fixed/*' } });
	await expect(page.getByRole('alert')).toHaveCount(0);
});

test('project settings refresh clean panes and reject stale autosaves without losing drafts', async ({ page, extensionContext, extensionId }) => {
	await prepare(page, extensionId);
	const other = await extensionContext.newPage();
	await other.goto(`chrome-extension://${extensionId}/workspace.html#functions`);
	await openProject(other);
	await page.locator('[data-setting="userWorld"]').uncheck();
	await expect(other.locator('[data-setting="userWorld"]')).not.toBeChecked();
	await expect.poll(() => saved(page)).toMatchObject({ functions: { userWorld: false } });
	await holdNextSave(page);
	await page.locator('[data-setting="mainWorld"]').uncheck();
	await other.locator('[data-setting="poll"]').uncheck();
	await expect.poll(() => saved(other)).toMatchObject({ functions: { poll: false } });
	await page.evaluate(() => (window as any).releaseProjectSave());
	await expect(page.getByRole('alert')).toContainText('changed elsewhere');
	await expect(page.locator('[data-setting="mainWorld"]')).not.toBeChecked();
	expect((await saved(other)).functions.mainWorld).toBeUndefined();
	await openProject(page);
	await expect(page.locator('[data-setting="mainWorld"]')).toBeChecked();
	await expect(page.locator('[data-setting="poll"]')).not.toBeChecked();
});

test('queued project edits finish saving after their pane closes', async ({ page, extensionId }) => {
	await prepare(page, extensionId);
	await holdNextSave(page);
	await page.locator('[data-setting="userWorld"]').uncheck();
	await page.locator('[data-setting="mainWorld"]').uncheck();
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page.locator('[data-project-settings]')).toHaveCount(0);
	await page.evaluate(() => (window as any).releaseProjectSave());
	await expect.poll(() => saved(page)).toMatchObject({ functions: { userWorld: false, mainWorld: false } });
	await openProject(page);
	await expect(page.locator('[data-setting="mode"]')).toBeDisabled();
});

test('project settings updates reject senders outside the workspace', async ({ page, extensionId }) => {
	await page.goto(`chrome-extension://${extensionId}/settings.html`);
	const result = await page.evaluate((name) => chrome.runtime.sendMessage({
		type: 'WORKSPACE_PROJECT_SETTINGS_UPDATE', project: name, settings: { functions: { mainWorld: true } }, expected: {}
	}), project);
	expect(result.success).toBe(false);
	expect(result.error).toContain('only be changed in the workspace');
	expect(await saved(page)).toEqual({});
});
