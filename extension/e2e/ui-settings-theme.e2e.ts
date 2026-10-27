import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

test.describe.configure({ timeout: 120_000 });

test('shell theme applies custom styles', async ({
	page,
	extensionContext,
	extensionId,
	localTestPage,
	reactionTime
}) => {
	const base = `chrome-extension://${extensionId}`;

	await page.goto(`${base}/workspace.html#styles`);
	await page.waitForTimeout(reactionTime);
	await page.getByTestId('sidebar-styles-add').click();
	await page.getByTestId('sidebar-styles-item').last().dblclick();
	await page.getByTestId('pane-title').last().fill('test-theme');
	const editor = page.getByTestId('pane-content').last().locator('.code-editor');

	const css = [
		'#browser-lambdas-shell { background: rgb(1, 2, 3); }',
		'#shell-titlebar { background: rgb(4, 5, 6); }',
		'#shell-outputs { background: rgb(7, 8, 9); }',
		'#shell-input-wrap { background: rgb(10, 11, 12); }',
		'#shell-input { background: rgb(13, 14, 15); }',
		'#shell-suggestions { background: rgb(16, 17, 18); }',
		".shell-resize-edge[data-direction='bottom-right'] { background: rgb(19, 20, 21); }"
	].join('\n');
	await editor.fill(css);
	await page.getByTestId('pane-save').last().click();
	await page.getByTitle('Set as default terminal style').last().click();
	await page.waitForTimeout(reactionTime);
	await page.evaluate(async () => {
		const key = 'local_storage_key_shellcss';
		const styles = JSON.parse((await chrome.storage.local.get(key))[key]);
		Object.assign(styles[0], { enabled: false, urlAllowlistEnabled: true, urlPatterns: [] });
		await chrome.storage.local.set({ [key]: JSON.stringify(styles) });
	});

	await page.goto(localTestPage);
	await page.waitForTimeout(reactionTime);
	await page.keyboard.press('Meta+k');
	await page.waitForTimeout(reactionTime);

	const expected = [
		['#browser-lambdas-shell', 'rgb(1, 2, 3)'],
		['#shell-titlebar', 'rgb(4, 5, 6)'],
		['#shell-outputs', 'rgb(7, 8, 9)'],
		['#shell-input-wrap', 'rgb(10, 11, 12)'],
		['#shell-input', 'rgb(13, 14, 15)'],
		['#shell-suggestions', 'rgb(16, 17, 18)'],
		[".shell-resize-edge[data-direction='bottom-right']", 'rgb(19, 20, 21)']
	] as const;

	for (const [selector, color] of expected) {
		await expect(page.frameLocator('#browser-lambdas-shell').locator(selector)).toHaveCSS('background-color', color);
	}

	const settings = await extensionContext.newPage();
	try {
		await settings.goto(`${base}/workspace.html#styles`);
		await settings.getByRole('button', { name: 'Settings for Local', exact: true }).click();
		const project = settings.getByLabel('Project settings for default', { exact: true });
		await expect(project.getByRole('tab', { name: 'Styles', exact: true })).toHaveAttribute('aria-selected', 'true');
		await expect(project.getByTestId('project-settings-restrictUrls')).toHaveCount(0);
		const enabled = project.getByTestId('project-settings-enabled');
		await expect(enabled).toBeChecked();
		await enabled.uncheck();
		const shell = page.frameLocator('#browser-lambdas-shell');
		await expect(shell.locator('#browser-lambdas-user-style')).toHaveCount(0);
		await expect(shell.locator('#browser-lambdas-default-style')).toHaveCount(1);
		await expect(shell.locator('#browser-lambdas-shell')).not.toHaveCSS('background-color', 'rgb(1, 2, 3)');
		await expect(shell.locator('#shell-input')).toBeVisible();
		await settings.reload();
		await settings.getByRole('button', { name: 'Settings for Local', exact: true }).click();
		await expect(enabled).not.toBeChecked();
		await enabled.check();
		for (const [selector, color] of expected) await expect(shell.locator(selector)).toHaveCSS('background-color', color);
	} finally {
		await settings.close();
		await page.goto(`${base}/workspace.html#styles`);
		await page.evaluate(() => chrome.storage.local.remove(['local_storage_key_shellcss', 'local_storage_key_project_settings']));
	}
});

export default test;

const themeKey = 'local_storage_key_shellcss';
const firstTheme = { id: 'theme-first', name: 'same.css', project: 'first', css: '#browser-lambdas-shell { background: rgb(20, 40, 60); }', selected: true };
const secondTheme = { id: 'theme-second', name: 'same.css', project: 'second', css: '#browser-lambdas-shell { background: rgb(60, 40, 20); }', selected: false };

async function seedThemes(page: Page, base: string, themes = [firstTheme, secondTheme], projects = {}) {
	await page.goto(`${base}/settings.html`);
	await page.evaluate(({ themes, projects }) => chrome.storage.local.set({
		local_storage_key_shellcss: JSON.stringify(themes), local_storage_key_project_settings: projects
	}), { themes, projects });
	await page.reload();
}

async function savedThemes(page: Page): Promise<typeof firstTheme[]> {
	return page.evaluate(async key => JSON.parse((await chrome.storage.local.get(key))[key] || '[]'), themeKey);
}

async function failThemeWrites(page: Page) {
	await page.evaluate(() => {
		const original = chrome.storage.local.set;
		chrome.storage.local.set = async (values) => {
			if (Object.hasOwn(values, 'local_storage_key_shellcss')) throw new Error('Simulated theme write failure');
			return original.call(chrome.storage.local, values);
		};
		window.addEventListener('restore-theme-writes', () => { chrome.storage.local.set = original; }, { once: true });
	});
}

test('global theme picker defaults to built-in and previews, filters and applies saved styles by ID', async ({ page, extensionContext, extensionId, localTestPage, reactionTime }) => {
	const base = `chrome-extension://${extensionId}`;
	await page.goto(`${base}/settings.html`);
	const picker = page.locator('[data-terminal-theme-picker]');
	const list = picker.getByRole('listbox', { name: 'Preview theme' });
	const apply = picker.getByRole('button', { name: 'Set theme', exact: true });
	await expect(picker.locator('.section-description')).toHaveText('Built-in default');
	await expect(picker.getByRole('button', { name: 'Preview', exact: true })).toHaveAttribute('aria-expanded', 'false');
	await expect(picker.locator('iframe')).toHaveCount(0);
	await picker.getByRole('button', { name: 'Preview', exact: true }).click();
	await expect(list.locator('option')).toHaveCount(1);
	await expect(apply).toBeDisabled();
	await expect(picker.frameLocator('iframe').locator('#browser-lambdas-shell')).toHaveCSS('background-color', 'rgb(22, 14, 22)');
	await picker.getByRole('button', { name: 'Hide preview', exact: true }).click();
	await expect(picker.locator('iframe')).toHaveCount(0);
	const extra = Array.from({ length: 24 }, (_, i) => ({ ...secondTheme, id: `extra-${i}`, name: `Extra ${i}.css`, project: 'collection' }));
	await seedThemes(page, base, [firstTheme, secondTheme, ...extra]);
	await picker.getByRole('button', { name: 'Preview', exact: true }).click();
	await expect(picker.locator('.section-description')).toHaveText('first / same.css');
	const site = await extensionContext.newPage();
	await site.goto(localTestPage);
	await site.waitForTimeout(reactionTime);
	await site.keyboard.press('Meta+k');
	const live = site.frameLocator('#browser-lambdas-shell').locator('#browser-lambdas-shell');
	await expect(live).toHaveCSS('background-color', 'rgb(20, 40, 60)');
	await list.selectOption(secondTheme.id);
	await expect(list).toBeFocused();
	await expect(picker.frameLocator('iframe').locator('#browser-lambdas-shell')).toHaveCSS('background-color', 'rgb(60, 40, 20)');
	await expect(live).toHaveCSS('background-color', 'rgb(20, 40, 60)');
	expect((await savedThemes(page)).filter(theme => theme.selected).map(theme => theme.id)).toEqual([firstTheme.id]);
	const search = picker.getByRole('searchbox', { name: 'Search styles' });
	await search.fill('SECOND');
	await expect(list.locator('option')).toHaveCount(2);
	await expect(list.locator('optgroup')).toHaveAttribute('label', 'second');
	await search.fill('no matching theme');
	await expect(picker.getByText('No matching styles.', { exact: true })).toBeVisible();
	await search.fill('');
	await expect(list.locator('option')).toHaveCount(27);
	await list.selectOption(secondTheme.id);
	await list.press('Home');
	await expect(list).toHaveValue('');
	await expect(list).toBeFocused();
	await list.selectOption(secondTheme.id);
	await apply.click();
	await expect(picker.locator('.section-description')).toHaveText('second / same.css');
	await expect(live).toHaveCSS('background-color', 'rgb(60, 40, 20)');
	await expect(apply).toBeDisabled();
	await expect(picker.getByText('Current theme', { exact: true })).toBeVisible();
	await expect(picker.locator('.terminal-theme-preview-heading .hint')).toHaveText('Preview');
	await expect(picker.getByText('Sample output', { exact: true })).toHaveCount(0);
	await expect.poll(async () => (await savedThemes(page)).filter(theme => theme.selected).map(theme => theme.id)).toEqual([secondTheme.id]);
	await page.reload();
	await expect(picker.locator('.section-description')).toHaveText('second / same.css');
	await picker.getByRole('button', { name: 'Preview', exact: true }).click();
	await list.selectOption('');
	await apply.click();
	await expect(picker.locator('.section-description')).toHaveText('Built-in default');
	await expect(live).toHaveCSS('background-color', 'rgb(22, 14, 22)');
	expect((await savedThemes(page)).filter(theme => theme.selected)).toEqual([]);
});

test('style settings preview and activate drafts while external theme changes preserve edits', async ({ page, extensionContext, extensionId }) => {
	const base = `chrome-extension://${extensionId}`;
	await seedThemes(page, base);
	await page.goto(`${base}/workspace.html#styles`);
	await page.locator(`[data-action="open-item"][data-id="${secondTheme.id}"]`).click();
	await expect(page.locator('iframe.terminal-preview')).toHaveCount(0);
	await page.getByRole('button', { name: 'Show settings', exact: true }).click();
	const preview = page.frameLocator('iframe.terminal-preview');
	await expect(preview.locator('#browser-lambdas-shell')).toHaveCSS('background-color', 'rgb(60, 40, 20)');
	await expect(page.getByText('Click set theme to enable this globally', { exact: true })).toBeVisible();
	await expect(page.getByText('Preview only. Your theme changes when you select Set theme.', { exact: true })).toHaveCount(0);
	const css = page.getByRole('textbox', { name: 'CSS', exact: true });
	const draft = '#browser-lambdas-shell { background: rgb(30, 80, 90); }';
	await css.fill(draft);
	await expect(preview.locator('#browser-lambdas-shell')).toHaveCSS('background-color', 'rgb(30, 80, 90)');
	await expect(page.locator('[data-style-theme-note]')).toContainText('unsaved changes');
	expect((await savedThemes(page)).find(theme => theme.id === secondTheme.id)?.css).toBe(secondTheme.css);
	const settings = await extensionContext.newPage();
	await settings.goto(`${base}/settings.html`);
	await settings.getByRole('button', { name: 'Preview', exact: true }).click();
	await settings.getByRole('listbox', { name: 'Preview theme' }).selectOption('');
	await settings.getByRole('button', { name: 'Set theme', exact: true }).click();
	await expect(settings.locator('.terminal-theme-heading .section-description')).toHaveText('Built-in default');
	await expect(css).toHaveValue(draft);
	await expect(preview.locator('#browser-lambdas-shell')).toHaveCSS('background-color', 'rgb(30, 80, 90)');
	await page.getByRole('button', { name: 'Set theme', exact: true }).click();
	await expect(page.getByText('Current theme', { exact: true })).toBeVisible();
	await expect(page.locator('[data-style-theme-note]')).toBeHidden();
	await expect.poll(async () => (await savedThemes(page)).find(theme => theme.id === secondTheme.id)).toEqual({ ...secondTheme, css: draft, selected: true });
	await expect(settings.locator('.terminal-theme-heading .section-description')).toHaveText('second / same.css');
	await page.reload();
	await page.locator(`[data-action="open-item"][data-id="${secondTheme.id}"]`).click();
	await expect(css).toHaveValue(draft);
	await page.getByRole('button', { name: 'Show settings', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Set theme', exact: true })).toBeDisabled();
});

test('theme previews isolate CSS, reject script markup and block external requests', async ({ page, extensionId, localTestPage }) => {
	const requests: string[] = [];
	await page.route(`${localTestPage}/preview-network-*`, async route => {
		requests.push(route.request().url());
		await route.fulfill({ body: '' });
	});
	const css = `
body { background: red !important; }
button { display: none !important; }
.terminal-theme-apply { display: none !important; }
#browser-lambdas-shell { background-color: rgb(9, 17, 33); background-image: url("${localTestPage}/preview-network-image"); }
#shell-titlebar::before { content: "</style><script>parent.document.documentElement.dataset.previewEscaped = 'yes'</script>"; display: none; }
`;
	await seedThemes(page, `chrome-extension://${extensionId}`, [firstTheme, { ...secondTheme, css }]);
	await page.getByRole('button', { name: 'Preview', exact: true }).click();
	await page.getByRole('listbox', { name: 'Preview theme' }).selectOption(secondTheme.id);
	const frame = page.locator('iframe.terminal-preview');
	await expect(frame).toHaveAttribute('sandbox', '');
	const sample = page.frameLocator('iframe.terminal-preview');
	await expect(sample.locator('#browser-lambdas-shell')).toHaveCSS('background-color', 'rgb(9, 17, 33)');
	await expect(sample.locator('script')).toHaveCount(0);
	await expect(sample.locator('#shell-input')).toHaveAttribute('readonly', '');
	await expect(page.getByRole('button', { name: 'Set theme', exact: true })).toBeVisible();
	await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(22, 14, 22)');
	expect(await sample.locator('body').evaluate(() => {
		try { void parent.document; return 'accessible'; }
		catch (error) { return error.name; }
	})).toBe('SecurityError');
	expect(await page.evaluate(() => document.documentElement.dataset.previewEscaped)).toBeUndefined();
	await page.waitForTimeout(100);
	expect(requests).toEqual([]);
	await page.getByRole('button', { name: 'Set theme', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
	expect((await savedThemes(page)).find(theme => theme.selected)?.id).toBe(firstTheme.id);
});

test('disabled project styles remain previewable in both settings surfaces without activation', async ({ page, extensionContext, extensionId }) => {
	const base = `chrome-extension://${extensionId}`;
	await seedThemes(page, base, [firstTheme, secondTheme], { second: { styles: { enabled: false } } });
	await page.getByRole('button', { name: 'Preview', exact: true }).click();
	await page.getByRole('listbox', { name: 'Preview theme' }).selectOption(secondTheme.id);
	await expect(page.frameLocator('iframe.terminal-preview').locator('#browser-lambdas-shell')).toHaveCSS('background-color', 'rgb(60, 40, 20)');
	await expect(page.getByRole('button', { name: 'Set theme', exact: true })).toBeDisabled();
	await expect(page.getByText(/This style can only be previewed/)).toBeVisible();
	const workspace = await extensionContext.newPage();
	await workspace.goto(`${base}/workspace.html#styles`);
	await workspace.locator(`[data-action="open-item"][data-id="${secondTheme.id}"]`).click();
	await workspace.getByRole('button', { name: 'Show settings', exact: true }).click();
	await expect(workspace.frameLocator('iframe.terminal-preview').locator('#browser-lambdas-shell')).toHaveCSS('background-color', 'rgb(60, 40, 20)');
	await expect(workspace.getByRole('button', { name: 'Set theme', exact: true })).toBeDisabled();
	await expect(workspace.getByText(/Styles are disabled for this project/)).toBeVisible();
	expect((await savedThemes(page)).filter(theme => theme.selected).map(theme => theme.id)).toEqual([firstTheme.id]);
});

test('global theme read and write failures preserve selection and support retry', async ({ page, extensionId }) => {
	const base = `chrome-extension://${extensionId}`;
	await seedThemes(page, base);
	await page.getByRole('button', { name: 'Preview', exact: true }).click();
	const list = page.getByRole('listbox', { name: 'Preview theme' });
	const apply = page.getByRole('button', { name: 'Set theme', exact: true });
	await list.selectOption(secondTheme.id);
	await failThemeWrites(page);
	await apply.click();
	await expect(page.getByRole('status')).toContainText('Your current theme is unchanged');
	await expect(list).toHaveValue(secondTheme.id);
	await expect(page.locator('.terminal-theme-heading .section-description')).toHaveText('first / same.css');
	expect((await savedThemes(page)).find(theme => theme.selected)?.id).toBe(firstTheme.id);
	await page.evaluate(() => window.dispatchEvent(new Event('restore-theme-writes')));
	await apply.click();
	await expect(page.locator('.terminal-theme-heading .section-description')).toHaveText('second / same.css');
	await page.evaluate(async () => {
		const original = chrome.storage.local.get;
		chrome.storage.local.get = async key => {
			if (key === 'local_storage_key_shellcss') throw new Error('Simulated theme read failure');
			return original.call(chrome.storage.local, key);
		};
		window.addEventListener('restore-theme-reads', () => { chrome.storage.local.get = original; }, { once: true });
		await chrome.storage.local.set({ local_storage_key_project_settings: { unused: { styles: { enabled: true } } } });
	});
	await expect(page.getByRole('status')).toContainText('Unable to load terminal themes');
	await expect(list).toHaveValue(secondTheme.id);
	await expect(apply).toBeDisabled();
	await page.evaluate(() => window.dispatchEvent(new Event('restore-theme-reads')));
	await page.getByRole('button', { name: 'Retry', exact: true }).click();
	await expect(page.getByRole('status')).toHaveCount(0);
	await expect(page.locator('.terminal-theme-heading .section-description')).toHaveText('second / same.css');
	expect((await savedThemes(page)).find(theme => theme.selected)?.id).toBe(secondTheme.id);
});

test('failed workspace theme saves and stale styles preserve the CSS draft', async ({ page, extensionId }) => {
	const base = `chrome-extension://${extensionId}`;
	await seedThemes(page, base);
	await page.goto(`${base}/workspace.html#styles`);
	await page.locator(`[data-action="open-item"][data-id="${secondTheme.id}"]`).click();
	await page.getByRole('button', { name: 'Show settings', exact: true }).click();
	const css = page.getByRole('textbox', { name: 'CSS', exact: true });
	const apply = page.getByRole('button', { name: 'Set theme', exact: true });
	const draft = '#browser-lambdas-shell { background: rgb(11, 22, 33); }';
	await css.fill(draft);
	await expect(page.frameLocator('iframe.terminal-preview').locator('#browser-lambdas-shell')).toHaveCSS('background-color', 'rgb(11, 22, 33)');
	await failThemeWrites(page);
	await apply.click();
	await expect(page.getByRole('alert')).toContainText('Simulated theme write failure');
	await expect(css).toHaveValue(draft);
	expect((await savedThemes(page)).find(theme => theme.id === secondTheme.id)).toEqual(secondTheme);
	await page.evaluate(() => window.dispatchEvent(new Event('restore-theme-writes')));
	await apply.click();
	await expect(page.getByText('Current theme', { exact: true })).toBeVisible();
	const newerDraft = `${draft}\n#shell-titlebar { background: pink; }`;
	await css.fill(newerDraft);
	const external = '#browser-lambdas-shell { background: rgb(44, 55, 66); }';
	await page.evaluate(async ({ key, external }) => {
		const styles = JSON.parse((await chrome.storage.local.get(key))[key]);
		styles.find(theme => theme.id === 'theme-second').css = external;
		await chrome.storage.local.set({ [key]: JSON.stringify(styles) });
	}, { key: themeKey, external });
	await expect(css).toHaveValue(newerDraft);
	await apply.click();
	await expect(page.getByRole('alert')).toContainText('This style changed elsewhere');
	await expect(css).toHaveValue(newerDraft);
	expect((await savedThemes(page)).find(theme => theme.id === secondTheme.id)?.css).toBe(external);
});
