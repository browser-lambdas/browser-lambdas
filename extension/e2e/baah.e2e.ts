// Test baah init, assert dir and default .toml is ok
// Test baah connections, get token from /settings and assert it can be stored and cleared
// Test baah push sad paths against the CLI surface
// Test sad paths.

import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import { pathToFileURL } from 'url';
import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

test.afterEach(async ({ page, extensionId }) => {
	// The browser context is shared. Review rows also appear in the functions
	// sidebar, so leaving CLI pushes staged changes later tests' UI targets.
	await page.goto(`chrome-extension://${extensionId}/workspace.html#functions`);
	await page.evaluate(() => chrome.storage.local.remove('local_storage_key_baah_pending_batches'));
});

test('baah CLI end-to-end', async ({ runBaah, page, extensionId, localTestPage, reactionTime }) => {
	// initialize project
	const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baah-project-'));
	const { stdout: initOut, code: initCode } = await runBaah(['init', '--template', 'starter', '--no-skills', '--skip-connection'], { cwd: projectDir });
	expect(initCode).toBe(0);
	expect(initOut).toContain('✔ Project initialized at');

	const functionsDir = path.join(projectDir, 'functions');
	const stylesDir = path.join(projectDir, 'styles');
	const triggersDir = path.join(projectDir, 'triggers');
	const configPath = path.join(projectDir, 'baah.toml');

	expect(fs.existsSync(functionsDir)).toBe(true);
	expect(fs.existsSync(stylesDir)).toBe(false);
	expect(fs.existsSync(triggersDir)).toBe(false);
	expect(fs.existsSync(configPath)).toBe(true);
	expect(fs.readdirSync(functionsDir)).toEqual(['hello-world.js']);

	const config = fs.readFileSync(configPath, 'utf-8');
	const expected = `# baah.toml

[project]
name = "${path.basename(projectDir)}"

[functions]
include = ["functions/**/*.js"]
exclude = ["functions/**/*.test.js", "functions/**/__*__/*"]
`;
	expect(config).toBe(expected);

	// get token from extension
	const base = `chrome-extension://${extensionId}`;
	await page.goto(`${base}/popup.html`);
	const port = await new Promise<number>((resolve, reject) => {
		const server = net.createServer();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const port = (server.address() as net.AddressInfo).port;
			server.close(() => resolve(port));
		});
	});
	await page.evaluate((port) => chrome.storage.local.set({ local_storage_key_ws_port: port }), port);
	await page.goto(`${base}/settings.html`);
	await page.waitForTimeout(reactionTime);
	await page.locator('[data-action="generate-token"]').click();
	await page.waitForFunction(() =>
		chrome.storage.local.get('local_storage_key_baah_token').then((r) => {
			return !!r['local_storage_key_baah_token'];
		})
	);

	const token = await page.evaluate(async () => (await chrome.storage.local.get('local_storage_key_baah_token')).local_storage_key_baah_token);
	await expect(page.locator('[data-action="copy-token"]')).toBeVisible();
	expect(await page.locator('body').textContent()).not.toContain(token);
	// store and clear token via baah connections
	const configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'baah-auth-'));
	const env = { BAAH_TEST_HOME: configHome, XDG_CONFIG_HOME: configHome, APPDATA: configHome,
		NODE_OPTIONS: `--import=${pathToFileURL(path.resolve('../cli/test-home.js')).href}` };

	let res = await runBaah(['set', 'test-profile', '--token', token], { env });
	expect(res.code).toBe(0);
	expect(res.stdout).toContain("✔ Added connection 'test-profile'.");
	const tokenPath = path.join(configHome, ...(process.platform === 'darwin' ? ['Library', 'Application Support'] : []), 'baah', 'connections.json');
	let stored = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
	expect(stored['test-profile']).toEqual({ token, port: 4455 });

	// One saved port update applies to every project using this connection.
	res = await runBaah(['set', 'test-profile', '--port', String(port)], { env });
	expect(res.code, res.stderr).toBe(0);
	stored = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
	expect(stored['test-profile']).toEqual({ token, port });
	fs.writeFileSync(path.join(functionsDir, 'connection-check.js'), 'return "connection-check";');
	fs.mkdirSync(triggersDir);
	fs.writeFileSync(path.join(triggersDir, 'connection-check.yaml'), 'patterns: ["https://example.com/connection-check*"]\ncommands: connection-check\n');
	res = await runBaah(['push', 'test-profile'], { cwd: projectDir, env });
	expect(res.code, res.stderr).toBe(0);
	expect(res.stdout).toContain('✔ Push complete');
	expect(res.stdout).toContain('2 functions, 0 styles, 1 triggers');
	// Changing the port through the open Settings page must reconnect the
	// existing sync client before the next CLI push.
	const updatedPort = await new Promise<number>((resolve, reject) => {
		const server = net.createServer();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const nextPort = (server.address() as net.AddressInfo).port;
			server.close(() => resolve(nextPort));
		});
	});
	await page.locator('[data-action="ws-port"]').fill(String(updatedPort));
	await page.locator('[data-action="ws-port"]').blur();
	await expect.poll(() => page.evaluate(async () => (await chrome.storage.local.get('local_storage_key_ws_port')).local_storage_key_ws_port)).toBe(updatedPort);
	res = await runBaah(['set', 'test-profile', '--port', String(updatedPort)], { env });
	expect(res.code, res.stderr).toBe(0);
	res = await runBaah(['push', 'test-profile'], { cwd: projectDir, env });
	expect(res.code, res.stderr).toBe(0);
	expect(res.stdout).toContain('✔ Push complete');

	expect(fs.readFileSync(configPath, 'utf-8')).toBe(config);
	// Rotation must affect the already-open sync page, not just a later reload.
	await page.locator('[data-action="delete-token"]').click();
	await expect(page.getByText('No tokens yet..', { exact: true })).toBeVisible();
	await page.locator('[data-action="generate-token"]').click();
	await expect.poll(() => page.evaluate(async () => (await chrome.storage.local.get('local_storage_key_baah_token')).local_storage_key_baah_token)).not.toBe(token);
	const rotatedToken = await page.evaluate(async () => (await chrome.storage.local.get('local_storage_key_baah_token')).local_storage_key_baah_token);
	res = await runBaah(['push', 'test-profile'], { cwd: projectDir, env });
	expect(res.code).not.toBe(0);
	res = await runBaah(['set', 'test-profile', '--token', rotatedToken], { env });
	expect(res.code, res.stderr).toBe(0);
	const secondProject = fs.mkdtempSync(path.join(os.tmpdir(), 'baah-second-project-'));
	res = await runBaah(['init', '--template', 'starter', '--no-skills'], { cwd: secondProject, env });
	expect(res.code).toBe(0);
	fs.writeFileSync(path.join(secondProject, 'functions', 'another.js'), 'return "another";');
	const secondConfigPath = path.join(secondProject, 'baah.toml');
	const secondConfig = fs.readFileSync(secondConfigPath, 'utf-8');
	fs.writeFileSync(secondConfigPath, secondConfig.replace(/\n\[project\][\s\S]*?\n\n\[functions\]/, '\n[functions]'));
	const secondTriggersDir = path.join(secondProject, 'triggers');
	fs.mkdirSync(secondTriggersDir);
	fs.writeFileSync(path.join(secondTriggersDir, 'fallback-trigger.yaml'), '# section 16 fixture comment\n # indented comment\nname: fallback-trigger\npatterns: ["https://example.com/fallback*"]\ncommands: hello-world\n');
	res = await runBaah(['push', 'test-profile'], { cwd: secondProject, env });
	expect(res.code, res.stderr).toBe(0);
	expect(res.stdout).toContain('✔ Push complete');
	expect(fs.readFileSync(secondConfigPath, 'utf-8')).not.toContain('[project]');
	expect(res.stdout).toContain('2 functions, 0 styles, 1 triggers');
	await expect.poll(() => page.evaluate(async () => {
		const stored = await chrome.storage.local.get('local_storage_key_baah_pending_batches');
		const batches = JSON.parse(stored.local_storage_key_baah_pending_batches || '[]');
		return batches.map((batch) => ({ project: batch.project, status: batch.status }));
	})).toEqual([{ project: path.basename(secondProject), status: 'pending' }]);
	await page.goto(`${base}/workspace.html#functions`);
	await expect(page.locator('.review-panel')).toBeVisible();
	await expect(page.locator('.review-diff')).toHaveCount(0);
	await expect(page.getByText(`${path.basename(secondProject)}/hello-world.js`, { exact: true })).toBeVisible();
	await expect(page.getByText(`${path.basename(secondProject)}/fallback-trigger`, { exact: true })).toBeVisible();

	// A pending new/changed lambda is locked at the execution boundary.
	await page.evaluate(() => chrome.storage.local.set({ local_storage_key_shell_always_on: true }));
	await page.goto(localTestPage);
	await expect(page.locator('#browser-lambdas-shell')).toBeVisible();
	const lockedShell = page.frameLocator('#browser-lambdas-shell');
	await lockedShell.locator('#shell-input').fill('hello-world');
	await lockedShell.locator('#shell-input').press('Enter');
	await expect(lockedShell.locator('#shell-outputs p').last()).toContainText('locked until its pending change is approved');

	await page.goto(`chrome-extension://${extensionId}/workspace.html#triggers`);
	await page.evaluate(() => chrome.storage.local.remove('local_storage_key_shell_always_on'));
	await expect(page.getByText(`${path.basename(secondProject)}/fallback-trigger`, { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Approve latest' }).click();
	await expect.poll(() => page.evaluate(async (project) => {
		const stored = await chrome.storage.local.get('local_storage_key_triggers');
		return JSON.parse(stored.local_storage_key_triggers || '[]').some((trigger) =>
			trigger.name === 'fallback-trigger' && trigger.project === project
		);
	}, path.basename(secondProject))).toBe(true);

	fs.writeFileSync(path.join(secondTriggersDir, 'fallback-trigger.yaml'), '# updated section 16 fixture\nname: fallback-trigger\npatterns: ["https://example.com/fallback-updated*"]\ncommands: hello-world\n');
	res = await runBaah(['push', 'test-profile'], { cwd: secondProject, env });
	expect(res.code, res.stderr).toBe(0);
	await expect.poll(() => page.evaluate(async () => {
		const stored = await chrome.storage.local.get('local_storage_key_baah_pending_batches');
		const batches = JSON.parse(stored.local_storage_key_baah_pending_batches || '[]');
		return batches.length;
	})).toBe(1);
	await page.goto(`${base}/workspace.html#triggers`);
	const changedReview = page.locator('.review-section').first();
	await expect(changedReview.locator('.review-diff')).toHaveCount(1);
	await expect(changedReview.locator('.diff-added').filter({ hasText: 'fallback-updated' })).toBeVisible();
	await page.getByRole('button', { name: 'Reject latest' }).click();

	res = await runBaah(['rm', 'test-profile'], { env });
	expect(res.code).toBe(0);
	expect(res.stdout).toContain("Removed connection 'test-profile'.");
	stored = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
	expect(stored['test-profile']).toBeUndefined();

	// sad path: push without token
	res = await runBaah(['push', 'test-profile'], { cwd: projectDir, env });
	expect(res.code).not.toBe(0);
	expect(res.stderr).toContain("Connection 'test-profile' not found.");
});

export default test;
