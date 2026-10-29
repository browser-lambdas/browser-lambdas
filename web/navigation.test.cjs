const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const { chromium } = require('../extension/node_modules/playwright');

test('category navigation, deep links, history and responsive layout', async () => {
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
		await page.route('https://fonts.googleapis.com/**', route => route.abort());
		const url = pathToFileURL(resolve(__dirname, 'index.html')).href;
		await page.goto(url);
		const expected = {
			demo: ['Demo', 'Preloaded functions', 'hello', 'vi-nav'],
			intro: ['Hack your browsing', 'How It Works'],
			'quick-start': ['Hello world', 'Whats next?'],
			ctx: ['Overview', 'Args', 'kv', 'Secrets', 'Run', 'Chain', 'Tabs', 'Network'],
			security: ['Security', 'Approach', 'Bad Pages', 'Execution Worlds', 'Securing communication paths', 'baah CLI'],
			baah: ['baah', 'Connections', 'Commands', 'baah init .', 'baah set', 'baah push', 'baah ls', 'baah info', 'baah rm', 'baah.toml'],
		};
		async function check(category) {
			assert.deepEqual(await page.locator('.doc-group:visible').evaluateAll(groups => groups.map(g => g.dataset.category)), [category]);
			assert.deepEqual(await page.locator('#docs-toc a').allTextContents(), expected[category]);
			assert.equal(await page.locator('[data-category-link][aria-current]').getAttribute('data-category-link'), category);
		}
		await check('intro');
		const highlighting = await page.evaluate(() => {
			const code = document.querySelector('code[data-language="javascript"]');
			const before = code.textContent;
			highlightCodeBlocks();
			return {
				preserved: code.textContent === before,
				colored: code.querySelectorAll('.syntax-keyword, .syntax-function').length > 0,
				divider: getComputedStyle(document.querySelector('.docs-prose h2')).borderTopWidth,
			};
		});
		assert.deepEqual(highlighting, { preserved: true, colored: true, divider: '0px' });
		for (const language of ['shell']) {
			assert.ok(await page.locator(`code[data-language="${language}"] span`).count() > 0);
		}

		assert.equal(await page.locator('.docs-nav').evaluate(el => el.getBoundingClientRect().width), 200);
		assert.equal(await page.locator('.docs-prose').evaluate(el => el.getBoundingClientRect().width), 550);
		const centered = await page.evaluate(() => {
			const logo = document.querySelector('.docs-logo').getBoundingClientRect();
			const nav = document.querySelector('.docs-nav').getBoundingClientRect();
			return Math.abs((logo.left + logo.right) / 2 - (nav.left + nav.right) / 2) < 1;
		});
		assert.equal(centered, true);
		assert.equal(await page.locator('.docs-categories [data-category-link="llms"]').count(), 1);
		assert.equal(await page.locator('#copy-llms-content').count(), 1);
		assert.equal(await page.locator('#llms-content').textContent(), 'Loading llms.txt…');

		assert.equal(await page.locator('.docs-shell').evaluate(el => el.getBoundingClientRect().width), 1160);
		assert.equal(await page.locator('.docs-shell').evaluate(el => el.getBoundingClientRect().left), 140);
		assert.equal(await page.locator('.docs-logo img').evaluate(img => img.complete && img.naturalWidth > 0), true);
		assert.equal(await page.locator('.docs-header').count(), 0);
		assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(15, 10, 15)');
		for (const category of Object.keys(expected)) {
			await page.locator('.docs-content').evaluate(el => { el.scrollTop = 400; });
			await page.locator(`.docs-categories [data-category-link="${category}"]`).click();
			assert.equal(await page.evaluate(() => scrollY), 0);
			assert.equal(await page.locator('.docs-content').evaluate(el => el.scrollTop), 0);
			assert.equal(await page.locator('.docs-logo').evaluate(el => el.getBoundingClientRect().top), 0);
			await check(category);
			for (const link of await page.locator('#docs-toc a').all()) {
				const href = await link.getAttribute('href');
				assert.equal(await page.locator(href).count(), 1);
			}
		}
		await page.goto(`${url}#args`);
		await check('ctx');
		await page.reload();
		await check('ctx');
		await page.goto(`${url}#network`);
		await check('ctx');
		await page.screenshot({ path: '/private/tmp/browser-lambdas-network-docs-desktop.png' });
		await page.goto(`${url}#baah-2`);
		await check('baah');
		assert.deepEqual(await page.locator('[id]').evaluateAll(els => {
			const ids = els.map(el => el.id);
			return ids.filter((id, i) => ids.indexOf(id) !== i);
		}), []);
		await page.locator('.docs-categories [data-category-link="ctx"]').click();
		await page.screenshot({ path: '/private/tmp/browser-lambdas-categories-desktop.png' });
		await page.setViewportSize({ width: 390, height: 844 });
		await page.locator('.docs-categories [data-category-link="quick-start"]').click();
		await check('quick-start');
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
		await page.screenshot({ path: '/private/tmp/browser-lambdas-categories-mobile.png' });
		for (const width of [320, 390, 700]) {
			await page.setViewportSize({ width, height: 844 });
			for (const category of [...Object.keys(expected), 'llms']) {
				await page.locator(`.docs-categories [data-category-link="${category}"]`).click();
				const layout = await page.evaluate(() => {
					const nav = document.querySelector('.docs-nav').getBoundingClientRect();
					const content = document.querySelector('.docs-content').getBoundingClientRect();
					return { separated: nav.bottom <= content.top, overflow: document.documentElement.scrollWidth > innerWidth };
				});
				assert.deepEqual(layout, { separated: true, overflow: false }, `${category} at ${width}px`);
			}
		}
		await page.setViewportSize({ width: 390, height: 844 });
		await page.locator('.docs-categories [data-category-link="intro"]').click();
		await page.locator('#docs-toc a[href="#how-it-works"]').click();
		await page.waitForFunction(() => {
			const heading = document.querySelector('#how-it-works').getBoundingClientRect();
			return document.querySelector('.docs-nav').getBoundingClientRect().bottom < 0 && heading.top >= 0 && heading.bottom < innerHeight;
		});
		assert.ok(await page.locator('.docs-nav').evaluate(el => el.getBoundingClientRect().bottom < 0));
		await page.screenshot({ path: '/private/tmp/browser-lambdas-mobile-scrolled.png' });
	} finally {
		await browser.close();
	}
});
