import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import { pathToFileURL } from 'url';
import type { Page } from '@playwright/test';
import { test as base, expect } from './fixtures';

type Result = { stdout: string; stderr: string; code: number };
type CliProject = {
	dir: string;
	name: string;
	env: NodeJS.ProcessEnv;
	token: string;
	port: number;
	connectionPath: string;
	initOutput: string;
	run: (args: string[], cwd?: string) => Promise<Result>;
	push: () => Promise<Result>;
};

const KEYS = {
	functions: 'local_storage_key_lambdas', styles: 'local_storage_key_shellcss',
	triggers: 'local_storage_key_triggers', pending: 'local_storage_key_baah_pending_batches'
};

async function freePort() {
	return new Promise<number>((resolve, reject) => {
		const server = net.createServer();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const port = (server.address() as net.AddressInfo).port;
			server.close((error) => error ? reject(error) : resolve(port));
		});
	});
}

const test = base.extend<{ cli: CliProject }>({
	cli: async ({ page, extensionId, runBaah }, use) => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baah-e2e-project-'));
		const configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'baah-e2e-home-'));
		const env = {
			BAAH_TEST_HOME: configHome, XDG_CONFIG_HOME: configHome, APPDATA: configHome,
			NODE_OPTIONS: `--import=${pathToFileURL(path.resolve('../cli/test-home.js')).href}`
		};
		const run = (args: string[], cwd = dir) => runBaah(args, { cwd, env });
		try {
			const initialized = await run(['init', '--template', 'starter', '--no-skills', '--skip-connection']);
			expect(initialized.code, initialized.stderr).toBe(0);
			await page.goto(`chrome-extension://${extensionId}/settings.html`);
			const port = await freePort();
			await page.locator('[data-action="ws-port"]').fill(String(port));
			await page.locator('[data-action="ws-port"]').blur();
			await expect.poll(() => page.evaluate(async () => (await chrome.storage.local.get('local_storage_key_ws_port')).local_storage_key_ws_port)).toBe(port);
			await page.locator('[data-action="generate-token"]').click();
			await expect(page.locator('[data-action="delete-token"]')).toBeVisible();
			const token = await page.evaluate(async () => (await chrome.storage.local.get('local_storage_key_baah_token')).local_storage_key_baah_token);
			expect(typeof token).toBe('string');
			expect(token.length).toBeGreaterThan(20);
			const connected = await run(['set', 'test-profile', '--token', token, '--port', String(port)]);
			expect(connected.code, connected.stderr).toBe(0);
			const connectionPath = path.join(configHome, ...(process.platform === 'darwin' ? ['Library', 'Application Support'] : []), 'baah', 'connections.json');
			await use({ dir, name: path.basename(dir), env, token, port, connectionPath, initOutput: initialized.stdout, run, push: () => run(['push', 'test-profile']) });
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
			fs.rmSync(configHome, { recursive: true, force: true });
		}
	}
});

test.describe.configure({ timeout: 120_000 });

async function collections(page: Page) {
	return page.evaluate(async (keys) => {
		const stored = await chrome.storage.local.get(Object.values(keys));
		return Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, JSON.parse(stored[key] || '[]')]));
	}, KEYS);
}

async function review(page: Page, extensionId: string, decision: 'Approve' | 'Reject') {
	await page.goto(`chrome-extension://${extensionId}/workspace.html#functions`);
	await page.locator('.review-item').click();
	await expect(page.locator('.review-panel')).toBeVisible();
	await page.getByRole('button', { name: `${decision} latest`, exact: true }).click();
	await expect.poll(async () => (await collections(page)).pending.length).toBe(0);
}

async function globalToggle(page: Page, extensionId: string, action: string, enabled: boolean) {
	await page.goto(`chrome-extension://${extensionId}/settings.html`);
	const control = page.locator(`[data-action="${action}"]`);
	await expect(control).toHaveAttribute('aria-pressed', /true|false/);
	if ((await control.getAttribute('aria-pressed')) !== String(enabled)) await control.click();
	await expect(control).toHaveAttribute('aria-pressed', String(enabled));
}

async function setProjectPolicy(page: Page, project: string, policy: object) {
	await page.evaluate(({ project, policy }) => chrome.storage.local.set({ local_storage_key_project_settings: { [project]: policy } }), { project, policy });
}

function writeVersion(cli: CliProject, origin: string, version: number) {
	const write = (relative: string, value: string) => {
		fs.mkdirSync(path.dirname(path.join(cli.dir, relative)), { recursive: true });
		fs.writeFileSync(path.join(cli.dir, relative), value);
	};
	write('functions/cli-run.js', `document.body.dataset.cliVersion = "v${version}"; console.log("CLI executed v${version}");`);
	write('functions/cli-auto.js', `document.body.dataset.cliAuto = "v${version}";`);
	write('styles/cli-theme.css', `#shell-titlebar { background: rgb(${version}, 22, 33); }`);
	write('triggers/cli-auto.yaml', `name: cli-auto\npatterns: ["${origin}/automatic-v${version}*"]\ncommands: cli-auto\n`);
	if (version === 1) {
		write('functions/obsolete-function.js', 'console.log("obsolete");');
		write('styles/obsolete-style.css', '#shell-input { color: rgb(11, 12, 13); }');
		write('triggers/obsolete-trigger.yaml', `name: obsolete-trigger\npatterns: ["${origin}/obsolete*"]\ncommands: obsolete-function\n`);
	} else {
		for (const relative of ['functions/obsolete-function.js', 'styles/obsolete-style.css', 'triggers/obsolete-trigger.yaml']) fs.rmSync(path.join(cli.dir, relative), { force: true });
	}
}

async function runOnPage(page: Page, url: string, command: string) {
	await page.goto(url);
	const shell = page.frameLocator('#browser-lambdas-shell');
	await expect(shell.locator('#shell-input')).toBeVisible();
	await shell.locator('#shell-input').fill(command);
	await shell.locator('#shell-input').press('Enter');
	return shell;
}

test('CLI init and saved connections survive port changes and token rotation', async ({ cli, page, extensionId }) => {
	expect(cli.initOutput).toContain('✔ Project initialized at');
	expect(fs.readdirSync(path.join(cli.dir, 'functions'))).toEqual(['hello-world.js']);
	expect(fs.existsSync(path.join(cli.dir, 'styles'))).toBe(false);
	expect(fs.existsSync(path.join(cli.dir, 'triggers'))).toBe(false);
	const config = fs.readFileSync(path.join(cli.dir, 'baah.toml'), 'utf8');
	expect(config).toContain(`name = "${cli.name}"`);
	expect(config).toContain('include = ["functions/**/*.js"]');
	expect(JSON.parse(fs.readFileSync(cli.connectionPath, 'utf8'))['test-profile']).toEqual({ token: cli.token, port: cli.port });
	expect(await page.locator('body').textContent()).not.toContain(cli.token);

	let result = await cli.push();
	expect(result.code, result.stderr).toBe(0);
	expect(result.stdout).toContain('pending-review');

	const port = await freePort();
	await page.locator('[data-action="ws-port"]').fill(String(port));
	await page.locator('[data-action="ws-port"]').blur();
	await expect.poll(() => page.evaluate(async () => (await chrome.storage.local.get('local_storage_key_ws_port')).local_storage_key_ws_port)).toBe(port);
	result = await cli.run(['set', 'test-profile', '--port', String(port)]);
	expect(result.code, result.stderr).toBe(0);
	expect(JSON.parse(fs.readFileSync(cli.connectionPath, 'utf8'))['test-profile']).toEqual({ token: cli.token, port });
	result = await cli.push();
	expect(result.code, result.stderr).toBe(0);

	await page.locator('[data-action="delete-token"]').click();
	await expect(page.getByText('No tokens yet.', { exact: true })).toBeVisible();
	await page.locator('[data-action="generate-token"]').click();
	await expect.poll(() => page.evaluate(async () => (await chrome.storage.local.get('local_storage_key_baah_token')).local_storage_key_baah_token)).not.toBe(cli.token);
	const rotatedToken = await page.evaluate(async () => (await chrome.storage.local.get('local_storage_key_baah_token')).local_storage_key_baah_token);
	result = await cli.push();
	expect(result.code).not.toBe(0);
	result = await cli.run(['set', 'test-profile', '--token', rotatedToken]);
	expect(result.code, result.stderr).toBe(0);
	result = await cli.push();
	expect(result.code, result.stderr).toBe(0);
	expect(fs.readFileSync(path.join(cli.dir, 'baah.toml'), 'utf8')).toBe(config);

	// A project without a name uses its directory; pushing does not rewrite it.
	fs.writeFileSync(path.join(cli.dir, 'baah.toml'), '[functions]\ninclude = ["functions/**/*.js"]\n');
	result = await cli.push();
	expect(result.code, result.stderr).toBe(0);
	await expect.poll(async () => (await collections(page)).pending.map((batch) => batch.project)).toEqual([cli.name]);
	expect(fs.readFileSync(path.join(cli.dir, 'baah.toml'), 'utf8')).not.toContain('[project]');

	result = await cli.run(['rm', 'test-profile']);
	expect(result.code, result.stderr).toBe(0);
	expect(JSON.parse(fs.readFileSync(cli.connectionPath, 'utf8'))['test-profile']).toBeUndefined();
	result = await cli.push();
	expect(result.code).not.toBe(0);
	expect(result.stderr).toContain("Connection 'test-profile' not found.");
});

test('approved CLI resources execute, rejected updates stay unchanged, and approval preserves local permissions', async ({ cli, page, extensionContext, extensionId, localTestPage }) => {
	writeVersion(cli, localTestPage, 1);
	await page.evaluate(() => chrome.storage.local.set({ local_storage_key_shell_always_on: true }));
	const result = await cli.push();
	expect(result.code, result.stderr).toBe(0);
	const runtime = await extensionContext.newPage();
	const lockedShell = await runOnPage(runtime, `${localTestPage}/manual`, 'cli-run');
	await expect(lockedShell.locator('#shell-outputs p').last()).toContainText('locked until its pending change is approved');
	await expect(runtime.locator('body')).not.toHaveAttribute('data-cli-version');
	await review(page, extensionId, 'Approve');
	await runOnPage(runtime, `${localTestPage}/manual`, 'cli-run');
	await expect(runtime.locator('body')).toHaveAttribute('data-cli-version', 'v1');
	await runtime.goto(`${localTestPage}/automatic-v1`);
	await expect(runtime.locator('body')).toHaveAttribute('data-cli-auto', 'v1');

	await page.goto(`chrome-extension://${extensionId}/workspace.html#styles`);
	await page.getByTestId('sidebar-styles-item').filter({ hasText: 'cli-theme.css' }).dblclick();
	await page.getByRole('button', { name: 'Set as default terminal style', exact: true }).click();
	await expect(runtime.frameLocator('#browser-lambdas-shell').locator('#shell-titlebar')).toHaveCSS('background-color', 'rgb(1, 22, 33)');
	const installed = await collections(page);

	writeVersion(cli, localTestPage, 2);
	let update = await cli.push();
	expect(update.code, update.stderr).toBe(0);
	await page.goto(`chrome-extension://${extensionId}/workspace.html#functions`);
	await page.locator('.review-item').click();
	await expect(page.locator('.review-diff .diff-added').filter({ hasText: 'cliVersion' })).toBeVisible();
	const pending = (await collections(page)).pending[0];
	expect(pending.items.filter((item) => item.action === 'delete').map((item) => item.type).sort()).toEqual(['lambda', 'style', 'trigger']);
	await review(page, extensionId, 'Reject');
	expect(await collections(page)).toEqual(installed);
	await runOnPage(runtime, `${localTestPage}/manual`, 'cli-run');
	await expect(runtime.locator('body')).toHaveAttribute('data-cli-version', 'v1');

	update = await cli.push();
	expect(update.code, update.stderr).toBe(0);
	await page.goto(`chrome-extension://${extensionId}/workspace.html#functions`);
	await page.getByTestId('sidebar-functions-item').filter({ hasText: 'cli-run' }).dblclick();
	await page.getByRole('button', { name: 'Show settings', exact: true }).click();
	await page.getByTestId('function-url-allowlist').check();
	await page.getByTestId('function-url-patterns').fill(`${localTestPage}/manual*`);
	await page.getByTestId('pane-world').selectOption('USER_SCRIPT');
	await page.getByTestId('pane-save').click();
	await page.goto(`chrome-extension://${extensionId}/workspace.html#triggers`);
	await page.getByTestId('sidebar-triggers-item').filter({ hasText: 'cli-auto' }).dblclick();
	await page.getByRole('button', { name: 'Show settings', exact: true }).click();
	await page.locator('[data-action="trigger-enabled"]').uncheck();
	await page.getByTestId('pane-save').click();
	await review(page, extensionId, 'Approve');

	const approved = await collections(page);
	const fn = approved.functions.find((item) => item.name === 'cli-run');
	expect(fn).toMatchObject({ world: 'USER_SCRIPT', allowedWorlds: ['user_scripts'], urlAllowlistEnabled: true, urlPatterns: [`${localTestPage}/manual*`] });
	expect(fn.func).toContain('v2');
	expect(approved.triggers.find((item) => item.name === 'cli-auto')).toMatchObject({ enabled: false, patterns: [`${localTestPage}/automatic-v2*`] });
	expect(approved.styles.find((item) => item.name === 'cli-theme.css')).toMatchObject({ selected: true });
	for (const category of ['functions', 'styles', 'triggers']) expect(approved[category].some((item) => item.name.startsWith('obsolete-'))).toBe(false);
	await runOnPage(runtime, `${localTestPage}/manual`, 'cli-run');
	await expect(runtime.locator('body')).toHaveAttribute('data-cli-version', 'v2');
	await expect(runtime.frameLocator('#browser-lambdas-shell').locator('#shell-titlebar')).toHaveCSS('background-color', 'rgb(2, 22, 33)');
	const denied = await runOnPage(runtime, `${localTestPage}/denied`, 'cli-run');
	await expect(denied.locator('#shell-outputs p').last()).toContainText('does not match any allowed pattern');
	await expect(runtime.locator('body')).not.toHaveAttribute('data-cli-version');
});

test('CLI sync enforces polling, review, and locks atomically while manual approval remains available when polling stops', async ({ cli, page, extensionContext, extensionId, localTestPage }) => {
	await globalToggle(page, extensionId, 'toggle-baah-review', false);
	await page.evaluate(() => chrome.storage.local.set({ local_storage_key_shell_always_on: true }));
	writeVersion(cli, localTestPage, 1);
	let result = await cli.push();
	expect(result.code, result.stderr).toBe(0);
	expect(result.stdout).toContain('Extension applied batch');
	const initial = await collections(page);
	expect(initial.pending).toEqual([]);
	const runtime = await extensionContext.newPage();
	await runOnPage(runtime, `${localTestPage}/manual`, 'cli-run');
	await expect(runtime.locator('body')).toHaveAttribute('data-cli-version', 'v1');

	writeVersion(cli, localTestPage, 2);
	for (const restriction of [{ styles: { poll: false } }, { triggers: { lock: true } }]) {
		await setProjectPolicy(page, cli.name, { functions: { poll: true, review: false }, ...restriction });
		result = await cli.push();
		expect(result.code).not.toBe(0);
		expect(result.stderr).toMatch(/Polling is disabled for styles|triggers updates are locked/);
		expect(await collections(page)).toEqual(initial);
	}

	// Global review is binding even when every project category requests no review.
	await setProjectPolicy(page, cli.name, { functions: { review: false }, triggers: { review: false }, styles: { review: false } });
	await globalToggle(page, extensionId, 'toggle-baah-review', true);
	result = await cli.push();
	expect(result.code, result.stderr).toBe(0);
	expect(result.stdout).toContain('pending-review');
	const staged = await collections(page);
	expect(staged.functions).toEqual(initial.functions);
	expect(staged.styles).toEqual(initial.styles);
	expect(staged.triggers).toEqual(initial.triggers);

	// A lock added after staging must block the whole manual approval.
	await setProjectPolicy(page, cli.name, { triggers: { lock: true } });
	await page.goto(`chrome-extension://${extensionId}/workspace.html#functions`);
	await page.locator('.review-item').click();
	await page.getByRole('button', { name: 'Approve latest', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('triggers updates are locked');
	expect(await collections(page)).toEqual(staged);

	// Polling controls incoming sync, not a trusted decision on an existing batch.
	await setProjectPolicy(page, cli.name, { functions: { poll: false }, styles: { poll: false }, triggers: { poll: false } });
	await globalToggle(page, extensionId, 'toggle-baah-poll', false);
	await review(page, extensionId, 'Approve');
	await runOnPage(runtime, `${localTestPage}/manual`, 'cli-run');
	await expect(runtime.locator('body')).toHaveAttribute('data-cli-version', 'v2');

	// Project poll:true cannot reconnect while global polling is off.
	await setProjectPolicy(page, cli.name, { functions: { poll: true }, styles: { poll: true }, triggers: { poll: true } });
	await globalToggle(page, extensionId, 'toggle-baah-review', false);
	writeVersion(cli, localTestPage, 3);
	const beforeReconnect = await collections(page);
	let finished = false;
	const waitingPush = cli.push().then((value) => { finished = true; return value; });
	try {
		await page.waitForTimeout(1500);
		expect(finished).toBe(false);
		expect(await collections(page)).toEqual(beforeReconnect);
	} finally {
		await globalToggle(page, extensionId, 'toggle-baah-poll', true);
	}
	result = await waitingPush;
	expect(result.code, result.stderr).toBe(0);
	expect(result.stdout).toContain('Extension applied batch');
	await runOnPage(runtime, `${localTestPage}/manual`, 'cli-run');
	await expect(runtime.locator('body')).toHaveAttribute('data-cli-version', 'v3');

	// A project can require review when global review is optional.
	const automatic = await collections(page);
	await setProjectPolicy(page, cli.name, { styles: { review: true } });
	writeVersion(cli, localTestPage, 4);
	result = await cli.push();
	expect(result.code, result.stderr).toBe(0);
	expect(result.stdout).toContain('pending-review');
	await review(page, extensionId, 'Reject');
	expect(await collections(page)).toEqual(automatic);
});

export default test;
