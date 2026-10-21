import { test, expect } from './fixtures';

test('global settings group controls and enforce review and polling in open project panes', async ({ page, extensionContext, extensionId }) => {
	const base = `chrome-extension://${extensionId}`;
	await page.goto(`${base}/settings.html`);
	await page.evaluate(async () => {
		await chrome.storage.local.remove(['local_storage_key_baah_require_review', 'local_storage_key_baah_poll_changes', 'local_storage_key_project_settings']);
		await chrome.storage.local.set({ local_storage_key_lambdas: JSON.stringify([{ id: 'settings-project-function', name: 'settings-project-function', project: 'settings-project', func: '' }]) });
	});
	await page.reload();
	const shell = page.getByRole('region', { name: 'Shell', exact: true });
	await expect(shell.getByLabel('Key binding', { exact: true })).toBeVisible();
	await expect(shell.getByRole('button', { name: 'Keep Output History', exact: true })).toBeVisible();
	await expect(shell.getByRole('button', { name: 'Always Show Shell', exact: true })).toBeVisible();
	await expect(shell.getByRole('button', { name: 'Clear', exact: true })).toBeVisible();
	const cli = page.getByRole('region', { name: 'Baah CLI', exact: true });
	for (const heading of ['Token', 'Polling', 'Review']) await expect(cli.getByRole('heading', { name: heading, exact: true })).toBeVisible();
	await expect(cli.getByLabel('Port', { exact: true })).toBeVisible();
	const security = page.getByRole('region', { name: 'Security', exact: true });
	for (const category of ['functions', 'storage', 'secrets']) await expect(security.getByTestId(`allow-main-world-${category}`)).toHaveAttribute('aria-pressed', 'false');
	await expect(page.getByText('Project restrictions', { exact: true })).toHaveCount(0);
	const review = cli.getByRole('button', { name: 'Require review', exact: true });
	const polling = cli.getByRole('button', { name: 'Poll for updates', exact: true });
	await expect(review).toHaveAttribute('aria-pressed', 'true');
	await expect(polling).toHaveAttribute('aria-pressed', 'true');
	const workspace = await extensionContext.newPage();
	try {
		await workspace.goto(`${base}/workspace.html#functions`);
		await workspace.getByRole('button', { name: 'Settings for settings-project', exact: true }).click();
		const project = workspace.getByLabel('Project settings for settings-project', { exact: true });
		const projectReview = project.getByTestId('project-settings-review');
		const projectPolling = project.getByTestId('project-settings-poll');
		await expect(projectReview).toBeChecked();
		await expect(projectReview).toBeDisabled();
		await expect(project.locator('[data-source="review"]')).toHaveText('Required by global settings');
		await expect(project.locator('[data-source="review"] a')).toHaveAttribute('href', 'settings.html#baah-review');
		await expect(projectPolling).toBeChecked();
		await expect(projectPolling).toBeEnabled();
		await review.click();
		await expect(projectReview).toBeEnabled();
		await expect(projectReview).not.toBeChecked();
		await expect(project.locator('[data-source="review"]')).toBeEmpty();
		await polling.click();
		await expect(projectPolling).not.toBeChecked();
		await expect(projectPolling).toBeDisabled();
		await expect(project.locator('[data-source="poll"]')).toHaveText('Polling is disabled by global settings');
		await expect(project.locator('[data-source="poll"] a')).toHaveAttribute('href', 'settings.html#baah-poll');
		await page.reload();
		await expect(review).toHaveAttribute('aria-pressed', 'false');
		await expect(polling).toHaveAttribute('aria-pressed', 'false');
		const [pollLinked] = await Promise.all([
			extensionContext.waitForEvent('page'),
			project.locator('[data-source="poll"] a').click(),
		]);
		try {
			await expect(pollLinked).toHaveURL(`${base}/settings.html#baah-poll`);
			await expect(pollLinked.locator('#baah-poll')).toBeInViewport();
		} finally { await pollLinked.close(); }
		await review.click();
		await expect(projectReview).toBeDisabled();
		const [reviewLinked] = await Promise.all([
			extensionContext.waitForEvent('page'),
			project.locator('[data-source="review"] a').click(),
		]);
		try {
			await expect(reviewLinked).toHaveURL(`${base}/settings.html#baah-review`);
			await expect(reviewLinked.locator('#baah-review')).toBeInViewport();
		} finally { await reviewLinked.close(); }
	} finally {
		await workspace.close();
		await page.evaluate(() => chrome.storage.local.remove(['local_storage_key_lambdas', 'local_storage_key_project_settings', 'local_storage_key_baah_require_review', 'local_storage_key_baah_poll_changes']));
	}
});

test('Poll changes is configured in Settings and persists', async ({ page, extensionId }) => {
	await page.goto(`chrome-extension://${extensionId}/settings.html`);
	await page.evaluate(() => chrome.storage.local.set({ local_storage_key_baah_poll_changes: true }));
	await page.reload();
	const poll = page.locator('[data-action="toggle-baah-poll"]');
	await expect(poll).toBeVisible();
	await expect(poll).toHaveAttribute('aria-pressed', 'true');
	await poll.click();
	await expect(poll).toHaveAttribute('aria-pressed', 'false');
	await expect.poll(() => page.evaluate(async () => (await chrome.storage.local.get('local_storage_key_baah_poll_changes')).local_storage_key_baah_poll_changes)).toBe(false);
	await page.goto(`chrome-extension://${extensionId}/workspace.html#triggers`);
	await expect(page.locator('[data-action="toggle-baah-poll"]')).toHaveCount(0);
	await page.evaluate(() => chrome.storage.local.set({
		local_storage_key_triggers: JSON.stringify([{
			id: 'live-sync-trigger',
			name: 'live-sync-trigger',
			project: 'live-sync-project',
			patterns: ['https://example.com/live-sync*'],
			commands: ['noop']
		}])
	}));
	await expect(page.locator('.project-title').filter({ hasText: 'live-sync-project' })).toBeVisible();
	await expect(page.getByTestId('sidebar-triggers-item').filter({ hasText: 'live-sync-trigger' })).toBeVisible();
	await page.evaluate(() => chrome.storage.local.remove('local_storage_key_triggers'));
	await expect(page.getByTestId('sidebar-triggers-item').filter({ hasText: 'live-sync-trigger' })).toHaveCount(0);
	await page.evaluate(() => chrome.storage.local.remove('local_storage_key_baah_poll_changes'));
});
