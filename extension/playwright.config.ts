import { defineConfig } from '@playwright/test';
// Re-export our fixtures so Playwright loads them and registers CLI options
export { test } from './e2e/fixtures';

export default defineConfig({
	testDir: 'e2e',
	testMatch: /.*\.e2e\.ts/,
	timeout: 30_000,
	// Print the active test in CI, including before a test finishes.
	reporter: process.env.CI
		? [['line'], ['json', { outputFile: 'test-results/results.json' }]]
		: 'list',
	globalTimeout: process.env.CI ? 10 * 60_000 : 0,
	workers: 1
});
