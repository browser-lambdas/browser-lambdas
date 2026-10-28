import type { Page } from '@playwright/test';
import { allowFunctionOnTestPages } from './function-access';
import { test, expect } from './fixtures';

test.describe.configure({ timeout: 120_000 });

async function enableNetwork(page: Page, extensionId: string) {
	await page.goto(`chrome-extension://${extensionId}/settings.html#network-access`);
	const control = page.getByTestId('allow-network');
	if (await control.getAttribute('aria-pressed') !== 'true') await control.click();
	await expect(control).toHaveAttribute('aria-pressed', 'true');
	await page.evaluate(async () => {
		const key = 'local_storage_key_project_settings';
		const stored = await chrome.storage.local.get(key);
		const projects = stored[key] || {};
		projects.default = { ...projects.default, functions: { ...projects.default?.functions, allowNetwork: true } };
		await chrome.storage.local.set({ [key]: projects });
	});
}

async function createLambda(page: Page, extensionId: string, name: string, code: string) {
	await page.goto(`chrome-extension://${extensionId}/workspace.html#functions`);
	await page.getByTestId('sidebar-functions-add').click();
	await page.getByTestId('sidebar-functions-item').last().dblclick();
	await page.getByTestId('pane-title').last().fill(name);
	await page.keyboard.press('Enter');
	await page.locator('.code-editor').last().click();
	await page.keyboard.insertText(`try { ${code} } catch (error) { document.body.dataset.networkResult = JSON.stringify({ error: error.message }); throw error; }`);
	await allowFunctionOnTestPages(page);
	await page.getByTestId('pane-save').last().click();
	await expect.poll(() => page.evaluate(async (name) => {
		const stored = await chrome.storage.local.get('local_storage_key_lambdas');
		return JSON.parse(stored.local_storage_key_lambdas || '[]').some((item: { name: string }) => item.name === name);
	}, name)).toBe(true);
}

async function runLambda(page: Page, name: string) {
	await page.evaluate(() => { delete document.body.dataset.networkResult; });
	const input = page.frameLocator('#browser-lambdas-shell').locator('#shell-input');
	if (!await input.isVisible()) await page.keyboard.press('Meta+k');
	await input.fill(name);
	await input.press('Enter');
	await expect.poll(() => page.getAttribute('body', 'data-network-result'), { timeout: 15_000 }).not.toBeNull();
	const result = JSON.parse((await page.getAttribute('body', 'data-network-result'))!);
	expect(result.error, JSON.stringify(result)).toBeUndefined();
	return result;
}

test('network rules deduplicate, replace wholly, preserve failed replacements and invalidate stale handles', async ({ page, extensionId, localTestPage }) => {
	await enableNetwork(page, extensionId);
	await createLambda(page, extensionId, 'network-management', `
		const network = ctx.tabs.this().network;
		const match = { url: ${JSON.stringify(`${localTestPage}/__network/manage/*`)} };
		const definition = { match, request: { headers: { set: { 'X-Debug': 'true', 'X-Client': 'baah' } } } };
		const [a, duplicate] = await Promise.all([network.add(definition), network.add(definition)]);
		const initial = await network.list();
		const b = await network.add({ match, request: { headers: { set: { 'X-Debug': 'false' } } } });
		const afterReplacement = await network.list();
		const staleRemoved = await a.remove();
		let invalidError;
		try { await network.add({ match, block: true, redirect: 'http://localhost/invalid' }); }
		catch (error) { invalidError = error.message; }
		const afterFailure = await network.list();
		const removed = await b.remove();
		const removedAgain = await b.remove();
		const final = await network.list();
		document.body.dataset.networkResult = JSON.stringify({
			same: a.id === duplicate.id, replaced: a.id !== b.id, initial, afterReplacement,
			staleRemoved, invalidError, afterFailure, removed, removedAgain, final
		});
	`);
	await page.goto(localTestPage);
	const result = await runLambda(page, 'network-management');
	expect(result.same).toBe(true);
	expect(result.replaced).toBe(true);
	expect(result.initial).toHaveLength(1);
	expect(result.afterReplacement).toHaveLength(1);
	expect(result.afterReplacement[0].request.headers.set).toEqual({ 'x-debug': 'false' });
	expect(result.staleRemoved).toBe(false);
	expect(result.invalidError).toEqual(expect.any(String));
	expect(result.afterFailure).toEqual(result.afterReplacement);
	expect(result.removed).toBe(true);
	expect(result.removedAgain).toBe(false);
	expect(result.final).toEqual([]);
});

test('network redirects preserve explicit wildcard suffixes, newest overlapping rules win and blocked requests never reach the server', async ({ page, extensionId, localTestPage }) => {
	await enableNetwork(page, extensionId);
	await createLambda(page, extensionId, 'network-traffic', `
		const network = ctx.tabs.this().network;
		const origin = ${JSON.stringify(localTestPage)};
		const get = async (path) => (await fetch(origin + path, { cache: 'no-store' })).json();
		const broadDefinition = { match: { url: origin + '/__network/source/*', methods: ['GET'] }, redirect: origin + '/__network/broad/*' };
		await network.add(broadDefinition);
		const narrow = await network.add({ match: { url: origin + '/__network/source/users/*', methods: ['GET'] }, redirect: origin + '/__network/narrow/*' });
		await network.add(broadDefinition);
		const narrowResult = await get('/__network/source/users/123?page=2');
		const broadResult = await get('/__network/source/products?sort=name');
		const post = await (await fetch(origin + '/__network/source/products', { method: 'POST' })).json();
		await narrow.remove();
		const revealed = await get('/__network/source/users/123?page=2');
		await network.add({ match: { url: origin + '/__network/source/*', methods: ['GET'] }, redirect: origin + '/__network/exact' });
		const exact = await get('/__network/source/users/123?page=2');
		await network.add({ match: { url: origin + '/__network/blocked' }, block: true });
		let blocked = false;
		try { await fetch(origin + '/__network/blocked'); } catch { blocked = true; }
		const count = await get('/__network/count?path=/__network/blocked');
		await network.add({ match: { url: origin + '/__network/cross/*' }, block: true });
		await network.add({ match: { url: origin + '/__network/cross/allowed/*' }, redirect: origin + '/__network/allowed/*' });
		const crossAction = await get('/__network/cross/allowed/users');
		await network.add({ match: { url: origin + '/__network/literal/*' }, redirect: origin + '/__network/target/$value/*' });
		const literal = await get('/__network/literal/file?x=$1');
		document.body.dataset.networkResult = JSON.stringify({ narrowResult, broadResult, post, revealed, exact, blocked, count, crossAction, literal });
	`);
	await page.goto(localTestPage);
	const result = await runLambda(page, 'network-traffic');
	expect(result.narrowResult.url).toBe('/__network/narrow/123?page=2');
	expect(result.broadResult.url).toBe('/__network/broad/products?sort=name');
	expect(result.post.url).toBe('/__network/source/products');
	expect(result.revealed.url).toBe('/__network/broad/users/123?page=2');
	expect(result.exact.url).toBe('/__network/exact');
	expect(result.blocked).toBe(true);
	expect(result.count.count).toBe(0);
	expect(result.crossAction.url).toBe('/__network/allowed/users');
	expect(result.literal.url).toBe('/__network/target/$value/file?x=$1');
});

test('network APIs deny by default and respect trusted permission grant and revocation', async ({ page, extensionId, localTestPage }) => {
	await createLambda(page, extensionId, 'network-permission', `
		try {
			await ctx.tabs.this().network.add({ match: { url: ${JSON.stringify(`${localTestPage}/__network/permission`)} }, block: true });
			document.body.dataset.networkResult = JSON.stringify({ allowed: true });
		} catch (error) {
			document.body.dataset.networkResult = JSON.stringify({ allowed: false, message: error.message });
		}
	`);
	await page.goto(localTestPage);
	const denied = await runLambda(page, 'network-permission');
	expect(denied.allowed).toBe(false);
	expect(denied.message).toMatch(/network|permission|allow/i);
	await enableNetwork(page, extensionId);
	await page.goto(localTestPage);
	expect((await runLambda(page, 'network-permission')).allowed).toBe(true);
	await page.goto(`chrome-extension://${extensionId}/settings.html#network-access`);
	await page.getByTestId('allow-network').click();
	await expect(page.getByTestId('allow-network')).toHaveAttribute('aria-pressed', 'false');
	await page.goto(localTestPage);
	expect((await runLambda(page, 'network-permission')).allowed).toBe(false);
});

test('network targets returned by new and all scope rules to their tab and discard rules when it closes', async ({ page, extensionContext, extensionId, localTestPage }) => {
	await enableNetwork(page, extensionId);
	await createLambda(page, extensionId, 'network-other-tab', `
		const created = await ctx.tabs.new({ url: ${JSON.stringify(`${localTestPage}/network-created`)}, active: false });
		const fromNew = await created.network.add({ match: { url: ${JSON.stringify(`${localTestPage}/__network/new-tab`)} }, block: true });
		const tab = (await ctx.tabs.all()).find((candidate) => candidate.id === created.id);
		await tab.network.add({ match: { url: ${JSON.stringify(`${localTestPage}/__network/other-tab`)} }, redirect: ${JSON.stringify(`${localTestPage}/__network/tab-active`)} });
		document.body.dataset.networkResult = JSON.stringify({ id: created.id, rules: await tab.network.list(), ownRules: await ctx.tabs.this().network.list() });
	`);
	await page.goto(localTestPage);
	const result = await runLambda(page, 'network-other-tab');
	expect(result.rules).toHaveLength(2);
	expect(result.ownRules).toEqual([]);
	const created = extensionContext.pages().find((candidate) => candidate.url() === `${localTestPage}/network-created`)!;
	expect(created).toBeDefined();
	try {
		const redirected = await created.evaluate(async (origin) => (await (await fetch(`${origin}/__network/other-tab`)).json()).url, localTestPage);
		expect(redirected).toBe('/__network/tab-active');
		const own = await page.evaluate(async (origin) => (await (await fetch(`${origin}/__network/other-tab`)).json()).url, localTestPage);
		expect(own).toBe('/__network/other-tab');
	} finally {
		await created.close();
	}
	const worker = extensionContext.serviceWorkers()[0];
	await expect.poll(() => worker.evaluate(async (tabId) => (await chrome.declarativeNetRequest.getSessionRules()).filter((rule) => rule.condition.tabIds?.includes(tabId)).length, result.id)).toBe(0);
});

test('network header changes affect real page requests and enable explicit-origin CORS including preflight', async ({ page, extensionId, localTestPage }) => {
	const remote = localTestPage.replace('127.0.0.1', 'localhost');
	await enableNetwork(page, extensionId);
	await createLambda(page, extensionId, 'network-headers', `
		const network = ctx.tabs.this().network;
		await network.add({
			match: { url: ${JSON.stringify(`${localTestPage}/__network/headers`)} },
			request: { headers: { set: { 'X-Debug': 'true' }, remove: ['X-Remove'] } },
			response: { headers: { set: { 'X-Example': 'changed' }, remove: ['X-Legacy'] } }
		});
		await network.add({
			match: { url: ${JSON.stringify(`${remote}/__network/cors/*`)} },
			response: { headers: { set: {
				'Access-Control-Allow-Origin': ${JSON.stringify(localTestPage)},
				'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'X-Test'
			} } }
		});
		document.body.dataset.networkResult = JSON.stringify({ ready: true });
	`);
	await page.goto(localTestPage);
	expect(await page.evaluate(async (url) => {
		try { await fetch(url); return false; } catch { return true; }
	}, `${remote}/__network/cors/before`)).toBe(true);
	await runLambda(page, 'network-headers');
	const result = await page.evaluate(async ({ origin, remote }) => {
		const response = await fetch(`${origin}/__network/headers`, { headers: { 'X-Remove': 'old' } });
		const headers = { example: response.headers.get('X-Example'), legacy: response.headers.get('X-Legacy') };
		const body = await response.json();
		const simple = await (await fetch(`${remote}/__network/cors/simple`)).json();
		const preflight = await (await fetch(`${remote}/__network/cors/preflight`, { method: 'POST', headers: { 'X-Test': 'yes' } })).json();
		return { headers, body, simple, preflight };
	}, { origin: localTestPage, remote });
	expect(result.headers).toEqual({ example: 'changed', legacy: null });
	expect(result.body.headers['x-debug']).toBe('true');
	expect(result.body.headers['x-remove']).toBeUndefined();
	expect(result.simple.url).toBe('/__network/cors/simple');
	expect(result.preflight.method).toBe('POST');
	expect(result.preflight.headers['x-test']).toBe('yes');
});

test('network rules survive reload, stay in one tab, and clear across lambdas and on cross-origin navigation', async ({ page, extensionContext, extensionId, localTestPage }) => {
	await enableNetwork(page, extensionId);
	await createLambda(page, extensionId, 'network-install', `
		await ctx.tabs.this().network.add({ match: { url: ${JSON.stringify(`${localTestPage}/__network/lifetime`)} }, redirect: ${JSON.stringify(`${localTestPage}/__network/active`)} });
		document.body.dataset.networkResult = JSON.stringify({ ready: true });
	`);
	await createLambda(page, extensionId, 'network-inspect', `
		document.body.dataset.networkResult = JSON.stringify({ rules: await ctx.tabs.this().network.list() });
	`);
	await createLambda(page, extensionId, 'network-clear', `
		document.body.dataset.networkResult = JSON.stringify({ count: await ctx.tabs.this().network.clear() });
	`);
	await page.goto(`${localTestPage}/lifetime`);
	await runLambda(page, 'network-install');
	const fetchPath = async (target: Page) => target.evaluate(async (origin) => (await (await fetch(`${origin}/__network/lifetime`, { cache: 'no-store' })).json()).url, localTestPage);
	expect(await fetchPath(page)).toBe('/__network/active');
	const other = await extensionContext.newPage();
	try {
		await other.goto(`${localTestPage}/lifetime`);
		expect(await fetchPath(other)).toBe('/__network/lifetime');
		await page.reload();
		expect(await fetchPath(page)).toBe('/__network/active');
		await page.goto(`${localTestPage}/same-origin`);
		expect(await fetchPath(page)).toBe('/__network/active');
		expect((await runLambda(page, 'network-inspect')).rules).toHaveLength(1);
		expect((await runLambda(page, 'network-clear')).count).toBe(1);
		expect(await fetchPath(page)).toBe('/__network/lifetime');
		await runLambda(page, 'network-install');
		await page.goto(localTestPage.replace('127.0.0.1', 'localhost'));
		expect((await runLambda(page, 'network-inspect')).rules).toEqual([]);
		await page.goto(localTestPage);
		expect(await fetchPath(page)).toBe('/__network/lifetime');
	} finally {
		await other.close();
	}
});

test('network reconstruction retains rules serialized by real Chrome and keeps their traffic effects', async ({ page, extensionContext, extensionId, localTestPage }) => {
	await enableNetwork(page, extensionId);
	await createLambda(page, extensionId, 'network-reconstruct', `
		const network = ctx.tabs.this().network;
		const redirect = await network.add({
			match: { url: ${JSON.stringify(`${localTestPage}/__network/reconstruct/source/*`)}, methods: ['POST', 'GET'], resourceTypes: ['script', 'image', 'xmlhttprequest'] },
			redirect: ${JSON.stringify(`${localTestPage}/__network/reconstruct/target/*`)}
		});
		const headers = await network.add({
			match: { url: ${JSON.stringify(`${localTestPage}/__network/reconstruct/headers`)}, methods: ['POST', 'GET'], resourceTypes: ['script', 'image', 'xmlhttprequest'] },
			request: { headers: { set: { 'X-Zebra': 'z', 'X-Alpha': 'a' }, remove: ['X-Remove'] } },
			response: { headers: { set: { 'X-Reconstructed': 'yes' }, remove: ['X-Legacy'] } }
		});
		const tab = (await ctx.tabs.all()).find(candidate => candidate.url === location.href);
		document.body.dataset.networkResult = JSON.stringify({ ids: [redirect.id, headers.id], tabId: tab.id });
	`);
	await page.goto(`${localTestPage}/network-reconstruct`);
	const installed = await runLambda(page, 'network-reconstruct');
	const inspector = await extensionContext.newPage();
	let recovered;
	try {
		await inspector.goto(`chrome-extension://${extensionId}/settings.html`);
		recovered = await inspector.evaluate(async (tabId) => {
			const { createNetworkRules } = await import(chrome.runtime.getURL('background/networkRules.js'));
			const reconstructed = createNetworkRules(chrome);
			await reconstructed.ready();
			return reconstructed.list(tabId);
		}, installed.tabId);
	} finally {
		await inspector.close();
	}
	expect(recovered.map((rule: { id: string }) => rule.id)).toEqual(installed.ids);
	const result = await page.evaluate(async (origin) => {
		const redirected = await (await fetch(`${origin}/__network/reconstruct/source/file?page=2`)).json();
		const response = await fetch(`${origin}/__network/reconstruct/headers`, { headers: { 'X-Remove': 'old' } });
		return { redirected, body: await response.json(), reconstructed: response.headers.get('X-Reconstructed'), legacy: response.headers.get('X-Legacy') };
	}, localTestPage);
	expect(result.redirected.url).toBe('/__network/reconstruct/target/file?page=2');
	expect(result.body.headers['x-alpha']).toBe('a');
	expect(result.body.headers['x-zebra']).toBe('z');
	expect(result.body.headers['x-remove']).toBeUndefined();
	expect(result.reconstructed).toBe('yes');
	expect(result.legacy).toBeNull();
});

test('cross-origin navigation expires old rules before the destination document first script fetches', async ({ page, extensionId, localTestPage }) => {
	const destination = localTestPage.replace('127.0.0.1', 'localhost');
	await enableNetwork(page, extensionId);
	await createLambda(page, extensionId, 'network-early-expiry', `
		const network = ctx.tabs.this().network;
		await network.add({ match: { url: ${JSON.stringify(`${destination}/__network/early`)} }, redirect: ${JSON.stringify(`${destination}/__network/old-rule`)} });
		document.body.dataset.networkResult = JSON.stringify({ count: (await network.list()).length });
	`);
	await page.goto(localTestPage);
	expect((await runLambda(page, 'network-early-expiry')).count).toBe(1);
	await page.goto(`${destination}/network-first-request`, { waitUntil: 'commit' });
	await expect.poll(() => page.getAttribute('html', 'data-first-network-result')).not.toBeNull();
	const firstRequest = JSON.parse((await page.getAttribute('html', 'data-first-network-result'))!);
	expect(firstRequest).not.toHaveProperty('error');
	expect(firstRequest.url).toBe('/__network/early');
});

test('network permission ceilings reject saved lower grants and global off revokes installed effects', async ({ page, extensionContext, extensionId, localTestPage }) => {
	await createLambda(page, extensionId, 'network-ceilings', `
		try {
			await ctx.tabs.this().network.add({ match: { url: ${JSON.stringify(`${localTestPage}/__network/ceiling`)} }, redirect: ${JSON.stringify(`${localTestPage}/__network/ceiling-active`)} });
			document.body.dataset.networkResult = JSON.stringify({ allowed: true });
		} catch (error) {
			document.body.dataset.networkResult = JSON.stringify({ allowed: false, message: error.message });
		}
	`);
	const settings = await extensionContext.newPage();
	try {
		await settings.goto(`chrome-extension://${extensionId}/settings.html#network-access`);
		await page.goto(localTestPage);
		const nativeCount = () => settings.evaluate(async () => (await chrome.declarativeNetRequest.getSessionRules()).length);
		const fetchPath = () => page.evaluate(async (origin) => (await (await fetch(`${origin}/__network/ceiling`, { cache: 'no-store' })).json()).url, localTestPage);
		for (const scenario of [
			{ global: false, project: true, item: true, allowed: false },
			{ global: true, project: false, item: true, allowed: false },
			{ global: true, project: false, item: undefined, allowed: false },
			{ global: true, project: true, item: false, allowed: false },
			{ global: true, project: undefined, item: true, allowed: false },
			{ global: true, project: true, item: undefined, allowed: true }
		]) {
			await settings.evaluate(async (scenario) => {
				const stored = await chrome.storage.local.get('local_storage_key_lambdas');
				const lambdas = JSON.parse(stored.local_storage_key_lambdas);
				const lambda = lambdas.find((item) => item.name === 'network-ceilings');
				delete lambda.allowNetwork;
				if (scenario.item !== undefined) lambda.allowNetwork = scenario.item;
				await chrome.storage.local.set({
					local_storage_key_lambdas: JSON.stringify(lambdas),
					local_storage_key_allow_network: scenario.global,
					local_storage_key_project_settings: { [lambda.project || 'default']: { functions: scenario.project === undefined ? {} : { allowNetwork: scenario.project } } }
				});
			}, scenario);
			const result = await runLambda(page, 'network-ceilings');
			expect(result.allowed, JSON.stringify(scenario)).toBe(scenario.allowed);
			await expect.poll(nativeCount).toBe(scenario.allowed ? 1 : 0);
			expect(await fetchPath()).toBe(scenario.allowed ? '/__network/ceiling-active' : '/__network/ceiling');
		}
		await settings.getByTestId('allow-network').click();
		await expect(settings.getByTestId('allow-network')).toHaveAttribute('aria-pressed', 'false');
		await expect.poll(nativeCount).toBe(0);
		expect(await fetchPath()).toBe('/__network/ceiling');
		await settings.getByTestId('allow-network').click();
		await expect(settings.getByTestId('allow-network')).toHaveAttribute('aria-pressed', 'true');
		expect(await nativeCount()).toBe(0);
		expect(await fetchPath()).toBe('/__network/ceiling');
	} finally { await settings.close(); }
});

test('project and function blocks revoke their installed rules while other projects keep working', async ({ page, extensionContext, extensionId, localTestPage }) => {
	await enableNetwork(page, extensionId);
	for (const name of ['a', 'b']) {
		await createLambda(page, extensionId, `network-owner-${name}`, `
			await ctx.tabs.this().network.add({ match: { url: ${JSON.stringify(`${localTestPage}/__network/owner-${name}`)} }, redirect: ${JSON.stringify(`${localTestPage}/__network/owner-${name}-active`)} });
			document.body.dataset.networkResult = JSON.stringify({ ready: true });
		`);
	}
	const settings = await extensionContext.newPage();
	try {
		await settings.goto(`chrome-extension://${extensionId}/settings.html`);
		await settings.evaluate(async () => {
			const stored = await chrome.storage.local.get('local_storage_key_lambdas');
			const lambdas = JSON.parse(stored.local_storage_key_lambdas);
			for (const lambda of lambdas) {
				lambda.project = lambda.name === 'network-owner-a' ? 'network-a' : 'network-b';
				lambda.allowNetwork = true;
			}
			await chrome.storage.local.set({
				local_storage_key_lambdas: JSON.stringify(lambdas),
				local_storage_key_project_settings: {
					'network-a': { functions: { allowNetwork: true } },
					'network-b': { functions: { allowNetwork: true } }
				}
			});
		});
		await page.goto(localTestPage);
		await runLambda(page, 'network-owner-a');
		await runLambda(page, 'network-owner-b');
		const nativeCount = () => settings.evaluate(async () => (await chrome.declarativeNetRequest.getSessionRules()).length);
		const fetchPath = (name: string) => page.evaluate(async ({ origin, name }) => (await (await fetch(`${origin}/__network/owner-${name}`, { cache: 'no-store' })).json()).url, { origin: localTestPage, name });
		await expect.poll(nativeCount).toBe(2);
		await settings.evaluate(() => chrome.storage.local.set({ local_storage_key_project_settings: { 'network-a': { functions: { allowNetwork: false } }, 'network-b': { functions: { allowNetwork: true } } } }));
		await expect.poll(nativeCount).toBe(1);
		expect(await fetchPath('a')).toBe('/__network/owner-a');
		expect(await fetchPath('b')).toBe('/__network/owner-b-active');
		await settings.evaluate(async () => {
			const stored = await chrome.storage.local.get('local_storage_key_lambdas');
			const lambdas = JSON.parse(stored.local_storage_key_lambdas);
			lambdas.find((lambda) => lambda.name === 'network-owner-b').allowNetwork = false;
			await chrome.storage.local.set({ local_storage_key_lambdas: JSON.stringify(lambdas) });
		});
		await expect.poll(nativeCount).toBe(0);
		expect(await fetchPath('b')).toBe('/__network/owner-b');
	} finally { await settings.close(); }
});
