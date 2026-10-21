import { test as base, chromium, BrowserContext, Page, expect } from '@playwright/test';
import { execSync, spawn, SpawnOptions } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const EXTENSION_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI_DIR = path.join(EXTENSION_DIR, '..', 'cli');

type RunResult = { stdout: string; stderr: string; code: number };

async function runBaah(args: string[], opts: SpawnOptions = {}): Promise<RunResult> {
	return new Promise((resolve, reject) => {
		const ps = spawn(process.execPath, [path.join(CLI_DIR, 'baah.js'), ...args], {
			cwd: opts.cwd,
			env: opts.env ? { ...process.env, ...opts.env } : process.env,
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let stdout = '';
		let stderr = '';
		ps.stdout.on('data', (d) => (stdout += d));
		ps.stderr.on('data', (d) => (stderr += d));
		ps.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
		ps.on('error', (err) => reject(err));
	});
}

type WorkerOptions = {
	/** Rebuild the extension before launching the browser */
	rebuildExtension: boolean;
	/** Run the browser in headless mode */
	headless: boolean;
	/** Delay used when waiting for UI reactions */
	reactionTime: number;
};

export const test = base.extend<
	{
		extensionContext: BrowserContext;
		page: Page;
		extensionId: string;
		/** URL for navigating to the local test page */
		localTestPage: string;
		isolatedState: void;
		/** Delay used between UI actions */
		reactionTime: number;
		runBaah: (args: string[], opts?: SpawnOptions) => Promise<RunResult>;
	},
	WorkerOptions
>({
	rebuildExtension: [false, { option: true, scope: 'worker' }],
	headless: [process.env.HEADLESS === '1', { scope: 'worker' }],
	reactionTime: [
		process.env.REACTION_TIME ? parseInt(process.env.REACTION_TIME, 10) : 500,
		{ option: true, scope: 'worker' }
	],

	runBaah: [
		async ({}, use) => {
			await use((args, opts = {}) => runBaah(args, { cwd: CLI_DIR, ...opts }));
		},
		{ scope: 'worker' }
	],

	localTestPage: [
		async ({}, use) => {
			const serverProcess = spawn('node', ['e2e/test-server.js'], {
				cwd: EXTENSION_DIR,
				stdio: ['ignore', 'pipe', 'inherit'],
				env: { ...process.env, PORT: '0' }
			});

			const url: string = await new Promise((resolve) => {
				serverProcess.stdout.on('data', (data) => {
					const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(data.toString());
					if (match) {
						resolve(`http://127.0.0.1:${match[1]}`);
					}
				});
			});

			try {
				await use(url);
			} finally {
				serverProcess.kill('SIGTERM');
			}
		},
		{ scope: 'worker' }
	],

	extensionContext: [
		async ({ headless, rebuildExtension }, use) => {
			const buildDir = path.join(EXTENSION_DIR, 'build');
			if (rebuildExtension || !fs.existsSync(buildDir)) {
				execSync('bash ./compile.sh', {
					cwd: EXTENSION_DIR,
					stdio: 'inherit'
				});
			}

			const args = [
				headless ? '--headless=new' : undefined,
				`--disable-extensions-except=${buildDir}`,
				`--load-extension=${buildDir}`
			].filter(Boolean) as string[];

			const context = await chromium.launchPersistentContext('', {
				headless: false,
				args
			});
			// This custom context does not inherit Playwright's `use` timeouts.
			context.setDefaultTimeout(15_000);
			context.setDefaultNavigationTimeout(30_000);

			try {
				const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
				const extensionId = worker.url().split('/')[2];
				const settings = await context.newPage();
				await settings.goto(`chrome://extensions/?id=${extensionId}`);
				await settings.evaluate(async (id) => {
					await chrome.developerPrivate.updateExtensionConfiguration({
						extensionId: id,
						userScriptsAccess: true
					});
				}, extensionId);
				await expect.poll(() => worker.evaluate(async () => {
					try {
						await chrome.userScripts.getScripts();
						return true;
					} catch {
						return false;
					}
				})).toBe(true);
				await settings.close();
				await use(context);
			} finally {
				await context.close();
			}
		},
		{ scope: 'worker' }
	],

	isolatedState: [async ({ extensionContext }, use) => {
		const existingPages = new Set(extensionContext.pages());
		const worker = extensionContext.serviceWorkers()[0] || await extensionContext.waitForEvent('serviceworker');
		await worker.evaluate(() => chrome.storage.local.clear());
		try {
			await use();
		} finally {
			await Promise.allSettled(extensionContext.pages().filter((page) => !existingPages.has(page)).map((page) => page.close()));
			const currentWorker = extensionContext.serviceWorkers()[0];
			if (currentWorker) await currentWorker.evaluate(() => chrome.storage.local.clear());
		}
	}, { auto: true }],

	page: async ({ extensionContext }, use) => {
		const page = await extensionContext.newPage();
		try {
			await use(page);
		} finally {
			await page.close();
		}
	},

	extensionId: [
		async ({ extensionContext }, use) => {
			const serviceWorker =
				extensionContext.serviceWorkers()[0] ||
				(await extensionContext.waitForEvent('serviceworker'));
			const url = serviceWorker.url();
			const extensionId = url.split('/')[2];
			await use(extensionId);
		},
		{ scope: 'worker' }
	]
});

export { expect };
