const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const { chromium } = require('../extension/node_modules/playwright');

test('shared demo terminal runs hello throughout the docs', async () => {
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.route('https://fonts.googleapis.com/**', route => route.abort());
		await page.goto(pathToFileURL(resolve(__dirname, 'index.html')).href + '#category-demo');
		assert.equal(await page.locator('.doc-group:visible').getAttribute('data-category'), 'demo');
		const shown = await page.locator('#demo-hello-source').textContent();
		const actual = await page.evaluate(() => demoSources.hello);
		assert.equal(shown, actual);
		assert.ok(shown.includes('ctx.args.all()'));
		// Model an installed extension's shell and document shortcut listener.
		await page.evaluate(() => {
			const existing = document.createElement('div');
			existing.id = 'browser-lambdas-shell';
			existing.dataset.extensionShell = 'true';
			document.body.appendChild(existing);
			window.extensionShortcutCalls = 0;
			document.addEventListener('keydown', event => {
				if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
					window.extensionShortcutCalls++;
				}
			});
		});
		await page.getByRole('button', { name: 'I lost my keys', exact: true }).click();
		const shell = page.locator('#browser-lambdas-demo-terminal');
		await page.keyboard.press('Meta+k');
		await page.keyboard.press('Control+k');
		await page.getByRole('button', { name: 'I lost my keys', exact: true }).click();
		assert.equal(await shell.count(), 1);
		assert.equal(await page.locator('#browser-lambdas-shell').count(), 1);
		assert.equal(await page.evaluate(() => extensionShortcutCalls), 0);
		const initial = await shell.boundingBox();
		await page.mouse.move(initial.x + 100, initial.y + 20);
		await page.mouse.down();
		await page.mouse.move(initial.x + 220, initial.y - 80, { steps: 5 });
		await page.mouse.up();
		const dragged = await shell.boundingBox();
		assert.equal(dragged.x, initial.x + 120);
		assert.equal(dragged.y, initial.y - 100);
		await page.mouse.move(dragged.x + dragged.width - 2, dragged.y + dragged.height / 2);
		await page.mouse.down();
		await page.mouse.move(dragged.x + dragged.width + 78, dragged.y + dragged.height / 2, { steps: 5 });
		await page.mouse.up();
		const resized = await shell.boundingBox();
		assert.equal(resized.width, dragged.width + 80);
		await page.mouse.move(resized.x + resized.width - 12, resized.y + resized.height - 12);
		await page.mouse.down();
		await page.mouse.move(resized.x + resized.width + 28, resized.y + resized.height + 28, { steps: 5 });
		await page.mouse.up();
		const cornerResized = await shell.boundingBox();
		assert.equal(cornerResized.width, resized.width + 40);
		assert.equal(cornerResized.height, resized.height + 40);
		const input = page.getByRole('textbox', { name: 'Demo command' });
		await input.fill('he');
		await input.press('Tab');
		assert.equal(await input.inputValue(), 'hello');
		await input.fill('hello Ada');
		await input.press('Enter');
		await page.getByText('Hello, Ada!', { exact: true }).waitFor();
		await input.press('ArrowUp');
		assert.equal(await input.inputValue(), 'hello Ada');
		await input.fill('hello "Ada Lovelace"');
		await input.press('Enter');
		await page.getByText('Hello, Ada Lovelace!', { exact: true }).waitFor();
		await input.fill('hello');
		await input.press('Enter');
		await page.getByText('Hello, human!', { exact: true }).waitFor();
		await input.fill('nope');
		await input.press('Enter');
		await page.getByText(/Unknown command: nope/).waitFor();
		await input.fill('clear');
		await input.press('Enter');
		assert.equal(await page.locator('#demo-shell-outputs p').count(), 0);
		await input.press('Escape');
		assert.equal(await page.locator('#browser-lambdas-demo-terminal').count(), 0);
		for (const category of ['intro', 'quick-start', 'ctx', 'baah', 'llms']) {
			await page.locator(`.docs-categories [data-category-link="${category}"]`).click();
			await page.keyboard.press('Control+k');
			await input.waitFor();
			assert.deepEqual(await shell.boundingBox(), cornerResized);
			await input.press('Escape');
		}
		await page.setViewportSize({ width: 390, height: 844 });
		await page.reload();
		await page.keyboard.press('Meta+k');
		await input.waitFor();
		const bounds = await page.locator('#browser-lambdas-demo-terminal').boundingBox();
		assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
		assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 844);
		assert.deepEqual(errors, []);
	} finally { await browser.close(); }
});

test('vi-nav passes args, navigates badges, scrolls, and removes its listener', async () => {
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 700 } });
		await page.route('https://fonts.googleapis.com/**', route => route.abort());
		await page.goto(pathToFileURL(resolve(__dirname, 'index.html')).href + '#category-demo');
		assert.equal(await page.locator('#demo-vi-nav-source').textContent(), await page.evaluate(() => demoSources['vi-nav']));
		const input = page.getByRole('textbox', { name: 'Demo command' });
		const category = () => page.locator('.doc-group:visible').getAttribute('data-category');
		async function run(command) {
			await page.keyboard.press('Control+k');
			await input.fill(command);
			await input.press('Enter');
		}
		await run('vi-nav on');
		await page.locator('#demo-shell-outputs').getByText('vi-nav on (psst.. go out of terminal)', { exact: true }).waitFor();
		await input.fill('hjkl');
		assert.equal(await input.inputValue(), 'hjkl');
		assert.equal(await category(), 'demo');
		await input.fill('');
		await page.locator('#demo').click();
		await page.keyboard.press('h');
		assert.equal(await category(), 'intro');
		await page.keyboard.press('h');
		assert.equal(await category(), 'intro');
		await page.keyboard.press('l');
		assert.equal(await category(), 'demo');
		await page.keyboard.press('l');
		assert.equal(await category(), 'quick-start');
		const scroll = () => page.evaluate(() => window.scrollY);
		await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
		await page.keyboard.press('j');
		assert.equal(await scroll(), 120);
		await page.keyboard.press('k');
		assert.equal(await scroll(), 0);
		await run('vi-nav on');
		await input.press('Escape');
		await page.keyboard.press('l');
		assert.equal(await category(), 'ctx');
		await page.locator('.docs-categories [data-category-link="llms"]').click();
		await page.keyboard.press('l');
		assert.equal(await category(), 'llms');
		await run('vi-nav off');
		await page.locator('#demo-shell-outputs').getByText('vi-nav off', { exact: true }).waitFor();
		await input.press('Escape');
		await page.keyboard.press('h');
		assert.equal(await category(), 'llms');
		await page.locator('.docs-categories [data-category-link="ctx"]').click();
		await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
		await page.keyboard.press('j');
		assert.equal(await scroll(), 0);
		await page.setViewportSize({ width: 390, height: 700 });
		await page.reload();
		await run('vi-nav on');
		await input.press('Escape');
		await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
		await page.keyboard.press('j');
		assert.ok(await page.evaluate(() => window.scrollY) > 0);
		await page.keyboard.press('k');
		assert.equal(await page.evaluate(() => window.scrollY), 0);
	} finally { await browser.close(); }
});
