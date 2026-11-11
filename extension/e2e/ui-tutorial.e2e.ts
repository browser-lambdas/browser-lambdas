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

test('empty categories offer demo scaffolding once, and declining preserves empty resources', async ({ page, extensionId }) => {
	const base = `chrome-extension://${extensionId}/workspace.html`;
	for (const tab of ['functions', 'storage', 'secrets', 'triggers', 'styles']) {
		await page.goto(`${base}#${tab}`);
		await expect(page.getByText('Looks like you’re starting from scratch. Want scaffold some demo stuff?')).toBeVisible();
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

test('quiz installs once and uses secret-backed questions for each docs section without KV', async ({ page, extensionContext, extensionId, reactionTime }) => {
	await page.goto(`chrome-extension://${extensionId}/workspace.html#functions`);
	await page.getByRole('button', { name: 'Yes', exact: true }).click();
	await expect(page.getByTestId('pane-title')).toHaveValue('quiz');
	await expect(page.locator('.tutorial-prompt, .tutorial-ready, .workspace-notice')).toHaveCount(0);
	const snapshot = await page.evaluate(async () => {
		const keys = ['local_storage_key_lambdas', 'local_storage_key_secrets', 'local_storage_key_triggers', 'local_storage_key_storage'];
		const data = await chrome.storage.local.get(keys);
		return Object.fromEntries(keys.map(key => [key, JSON.parse(data[key] || '[]')]));
	});
	expect(snapshot.local_storage_key_lambdas.map((item: any) => item.name)).toEqual(['quiz']);
	expect(snapshot.local_storage_key_secrets).toHaveLength(1);
	const secretValue = snapshot.local_storage_key_secrets[0].value;
	const quizzes = JSON.parse(secretValue);
	expect(Object.keys(quizzes).sort()).toEqual(['baah', 'ctx', 'demo', 'intro', 'llms', 'quick-start', 'security']);
	expect(snapshot.local_storage_key_triggers).toEqual([]);
	expect(snapshot.local_storage_key_storage).toEqual([]);
	await page.goto(`chrome-extension://${extensionId}/workspace.html#secrets`);
	await page.getByTestId('sidebar-secrets-item').click();
	await page.getByRole('button', { name: 'Show', exact: true }).click();
	await expect(page.getByTestId('pane-value')).toHaveValue(secretValue);
	const editedValue = secretValue.replace(quizzes.intro.hint, 'Edited intro question');
	await page.getByTestId('pane-value').fill(editedValue);
	await page.getByTestId('pane-save').click();
	await page.reload();
	await page.getByTestId('sidebar-secrets-item').click();
	await expect(page.getByTestId('pane-value')).toHaveValue(editedValue);
	quizzes.intro.hint = 'Edited intro question';
	const docs = await extensionContext.newPage();
	try {
		await serveDocs(docs);
		await docs.goto('https://browser-lambdas.dev/');
		// The tutorial no longer disables the website demo; turn it off through its terminal.
		expect(await docs.evaluate(() => localStorage.getItem('browser-lambdas-demo-disabled'))).toBeNull();
		await docs.keyboard.press('Meta+k');
		const demoInput = docs.locator('#demo-shell-input');
		await expect(demoInput).toBeVisible();
		await demoInput.fill('deactivate');
		await demoInput.press('Enter');
		await expect.poll(() => docs.evaluate(() => localStorage.getItem('browser-lambdas-demo-disabled'))).toBe('true');
		await docs.keyboard.press('Meta+k');
		const shell = docs.frameLocator('#browser-lambdas-shell');
		const input = shell.locator('#shell-input');
		const output = shell.locator('#shell-outputs');
		await expect(input).toBeVisible();
		const run = async (command: string) => { await input.fill(command); await input.press('Enter'); };
		await run('quiz');
		await expect(output).toContainText('Use quiz me');
		for (const [section, challenge] of Object.entries(quizzes) as [string, { hint: string; answer: string }][]) {
			await docs.locator(`.docs-categories [data-category-link="${section}"]`).click();
			await run('quiz me');
			await expect(output.getByTestId('shell-output-line').last()).toContainText(challenge.hint);
			await run(`quiz reply ${challenge.answer}`);
			await expect(output.getByTestId('shell-output-line').last()).toContainText('Correct!');
		}
		await docs.locator('.docs-categories [data-category-link="ctx"]').click();
		await run('quiz reply ctx.kv');
		await expect(output.getByTestId('shell-output-line').last()).toContainText('Not quite! Try again.');
		await page.evaluate(async () => {
			const key = 'local_storage_key_secrets';
			const secrets = JSON.parse((await chrome.storage.local.get(key))[key]);
			secrets[0].allowedWorlds = [];
			await chrome.storage.local.set({ [key]: JSON.stringify(secrets) });
		});
		await run('quiz reply ctx.kv.get()');
		await expect(output).toContainText("Cannot read properties of null");
		await page.evaluate(async () => {
			const key = 'local_storage_key_secrets';
			const secrets = JSON.parse((await chrome.storage.local.get(key))[key]);
			secrets[0].allowedWorlds = ['user_scripts'];
			await chrome.storage.local.set({ [key]: JSON.stringify(secrets) });
		});
		await docs.reload();
		await docs.waitForTimeout(reactionTime);
		await docs.keyboard.press('Meta+k');
		await expect(input).toBeVisible();
		await run('quiz me');
		await expect(output).toContainText(quizzes.ctx.hint);
		await run('quiz reply ctx.kv.get()');
		await expect(output.getByTestId('shell-output-line').last()).toContainText('Correct!');
		expect(await page.evaluate(async () => (await chrome.storage.local.get('local_storage_key_storage')).local_storage_key_storage)).toBeUndefined();
	} finally { await docs.close(); }
});
