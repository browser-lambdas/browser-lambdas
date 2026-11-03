import { test, expect } from './fixtures';
import { runPolicyCommand } from './policy-helpers';

test.describe.configure({ timeout: 120_000 });

const lambda = (id: string, func: string) => ({ id, name: id, project: 'native-tests', world: 'USER_SCRIPT',
	allowedWorlds: ['user_scripts'], urlAllowlistEnabled: true, urlPatterns: ['*'], func });

const activeWorldCount = (worker: any) => worker.evaluate(async () =>
	(await chrome.userScripts.getWorldConfigurations()).filter((world) => world.worldId?.startsWith('lambda-')).length);

test('concurrent calls share their function world but finish independently and drain final output', async ({ page, extensionContext, localTestPage }) => {
	const worker = extensionContext.serviceWorkers()[0];
	await worker.evaluate((item) => chrome.storage.local.set({ local_storage_key_lambdas: JSON.stringify([item]) }),
		lambda('native-wait', `
			const label = ctx.args.all()[0];
			document.body.setAttribute('data-wait-' + label, 'yes');
			await new Promise(resolve => document.addEventListener('finish-' + label, resolve, { once: true }));
			for (let i = 0; i < 20; i++) console.log('OUTPUT_' + label + '_' + i);
		`));
	await page.goto(localTestPage);
	const output = await runPolicyCommand(page, 'native-wait first');
	await expect(page.locator('body')).toHaveAttribute('data-wait-first', 'yes');
	await runPolicyCommand(page, 'native-wait second');
	await expect(page.locator('body')).toHaveAttribute('data-wait-second', 'yes');
	expect(await activeWorldCount(worker)).toBe(1);
	await page.evaluate(() => document.dispatchEvent(new Event('finish-first')));
	await expect(output.filter({ hasText: /^OUTPUT_first_\d+$/ })).toHaveCount(20);
	expect((await output.allTextContents()).filter((line) => line.startsWith('OUTPUT_first_'))).toEqual(Array.from({ length: 20 }, (_, i) => `OUTPUT_first_${i}`));
	await expect.poll(() => worker.evaluate(async () => ((await chrome.storage.local.get('activityLogs')).activityLogs || [])
		.filter((entry) => entry.message.startsWith('Top-level function result completed:')).length)).toBe(1);
	expect(await activeWorldCount(worker)).toBe(1);
	await page.evaluate(() => document.dispatchEvent(new Event('finish-second')));
	await expect(output.filter({ hasText: /^OUTPUT_second_\d+$/ })).toHaveCount(20);
	await expect.poll(() => activeWorldCount(worker)).toBe(0);
	expect((await output.allTextContents()).join('\n')).not.toMatch(/connection closed|connection failed/);
});

test('named worlds separate function code and caller ancestry while repeated boundaries reuse globals', async ({ page, extensionContext, localTestPage }) => {
	const worker = extensionContext.serviceWorkers()[0];
	const code = `globalThis.nativeWorldCounter = (globalThis.nativeWorldCounter || 0) + 1; console.log('WORLD_COUNT', globalThis.nativeWorldCounter);`;
	await worker.evaluate((items) => chrome.storage.local.set({ local_storage_key_lambdas: JSON.stringify(items) }), [
		lambda('native-counter', code), lambda('native-other', code),
		lambda('native-parent', 'await ctx.run("native-counter"); console.log("PARENT_DONE");')
	]);
	await page.goto(localTestPage);
	const output = await runPolicyCommand(page, 'native-counter');
	await expect(output.filter({ hasText: /^WORLD_COUNT 1$/ })).toHaveCount(1);
	await expect.poll(() => activeWorldCount(worker)).toBe(0);
	await runPolicyCommand(page, 'native-counter');
	await expect(output.filter({ hasText: /^WORLD_COUNT 2$/ })).toHaveCount(1);
	await runPolicyCommand(page, 'native-other');
	await expect(output.filter({ hasText: /^WORLD_COUNT 1$/ })).toHaveCount(2);
	await runPolicyCommand(page, 'native-parent');
	await expect(output.filter({ hasText: /^PARENT_DONE$/ })).toHaveCount(1);
	await expect(output.filter({ hasText: /^WORLD_COUNT 1$/ })).toHaveCount(3);
	await runPolicyCommand(page, 'native-parent');
	await expect(output.filter({ hasText: /^PARENT_DONE$/ })).toHaveCount(2);
	await expect(output.filter({ hasText: /^WORLD_COUNT 2$/ })).toHaveCount(2);
	await worker.evaluate(async () => {
		const key = 'local_storage_key_lambdas';
		const items = JSON.parse((await chrome.storage.local.get(key))[key]);
		items[0].func += '\nconsole.log("NEW_CODE_BOUNDARY");';
		await chrome.storage.local.set({ [key]: JSON.stringify(items) });
	});
	await runPolicyCommand(page, 'native-counter');
	await expect(output.filter({ hasText: /^NEW_CODE_BOUNDARY$/ })).toHaveCount(1);
	await expect(output.filter({ hasText: /^WORLD_COUNT 1$/ })).toHaveCount(4);
	expect(await page.evaluate(() => typeof (window as any).nativeWorldCounter)).toBe('undefined');
});

test('navigation ends the old document invocation without replay and a fresh document can run again', async ({ page, extensionContext, localTestPage }) => {
	const worker = extensionContext.serviceWorkers()[0];
	await worker.evaluate((items) => chrome.storage.local.set({
		local_storage_key_lambdas: JSON.stringify(items),
		local_storage_key_storage: JSON.stringify([{ id: 'navigation', key: 'navigation', value: 'UNCHANGED' }])
	}), [lambda('native-old-document', `
		document.body.dataset.oldInvocationWaiting = 'yes';
		await new Promise(resolve => document.addEventListener('finish-old-document', resolve, { once: true }));
		await ctx.kv.set('navigation', 'REPLAYED'); console.log('OLD_DOCUMENT_CONTINUED');
	`), lambda('native-fresh-document', 'console.log("FRESH_DOCUMENT_WORKS");')]);
	await page.goto(`${localTestPage}/original`);
	await runPolicyCommand(page, 'native-old-document');
	await expect(page.locator('body')).toHaveAttribute('data-old-invocation-waiting', 'yes');
	await page.goto(`${localTestPage}/replacement`);
	await expect.poll(() => activeWorldCount(worker)).toBe(0);
	await page.evaluate(() => document.dispatchEvent(new Event('finish-old-document')));
	const output = await runPolicyCommand(page, 'native-fresh-document');
	await expect(output.filter({ hasText: /^FRESH_DOCUMENT_WORKS$/ })).toHaveCount(1);
	expect(await worker.evaluate(async () => JSON.parse((await chrome.storage.local.get('local_storage_key_storage')).local_storage_key_storage)[0].value)).toBe('UNCHANGED');
	expect((await output.allTextContents()).join('\n')).not.toContain('OLD_DOCUMENT_CONTINUED');
	await expect.poll(() => worker.evaluate(async () => ((await chrome.storage.local.get('activityLogs')).activityLogs || [])
		.some((entry) => /before the function finished|background connection closed/i.test(entry.message)))).toBe(true);
});

test('native calls stay off public window messages and full MAIN credentials stay off tab-wide messages', async ({ page, extensionContext, localTestPage }) => {
	const worker = extensionContext.serviceWorkers()[0];
	const observerWorld = 'e2e-message-observer';
	await worker.evaluate((items) => chrome.storage.local.set({
		local_storage_key_allow_main_world_functions: true, local_storage_key_lambdas: JSON.stringify(items)
	}), [lambda('native-private', 'console.log("NATIVE_PRIVATE_DONE");'),
		{ ...lambda('main-private', 'console.log("MAIN_PRIVATE_DONE");'), allowedWorlds: ['user_scripts', 'main'] }]);
	await page.goto(localTestPage);
	await runPolicyCommand(page, '.clear');
	await page.evaluate(() => {
		(window as any).lambdaWindowTypes = [];
		window.addEventListener('message', (event) => {
			if (event.source === window && ['qToken', 'aToken', 'CONTENT_SCRIPT_HANDSHAKE'].includes(event.data?.type)) {
				(window as any).lambdaWindowTypes.push(event.data.type);
			}
		});
	});
	try {
		await worker.evaluate(async ({ url, worldId }) => {
			const [tab] = await chrome.tabs.query({ url: url + '/' });
			await chrome.userScripts.configureWorld({ worldId, messaging: true });
			await chrome.userScripts.execute({ target: { tabId: tab.id }, world: 'USER_SCRIPT', worldId,
				js: [{ code: `globalThis.observedTabMessages = []; chrome.runtime.onMessage.addListener(message => { observedTabMessages.push({ type: message.type, credentials: ['sessionKey', 'invocationToken', 'connectionGrant'].some(key => key in message) }); });` }] });
			await chrome.tabs.sendMessage(tab.id, { type: 'E2E_PUBLIC_PROBE' }).catch(() => {});
		}, { url: localTestPage, worldId: observerWorld });
		const observed = () => worker.evaluate(async ({ url, worldId }) => {
			const [tab] = await chrome.tabs.query({ url: url + '/' });
			const [result] = await chrome.userScripts.execute({ target: { tabId: tab.id }, world: 'USER_SCRIPT', worldId,
				js: [{ code: 'globalThis.observedTabMessages' }] });
			return result.result;
		}, { url: localTestPage, worldId: observerWorld });
		await expect.poll(observed).toEqual([{ type: 'E2E_PUBLIC_PROBE', credentials: false }]);
		const output = await runPolicyCommand(page, 'native-private');
		await expect(output.filter({ hasText: /^NATIVE_PRIVATE_DONE$/ })).toHaveCount(1);
		await expect.poll(() => activeWorldCount(worker)).toBe(0);
		expect(await page.evaluate(() => (window as any).lambdaWindowTypes)).toEqual([]);
		await runPolicyCommand(page, '@main-world main-private');
		await expect(output.filter({ hasText: /^MAIN_PRIVATE_DONE$/ })).toHaveCount(1);
		expect(await page.evaluate(() => (window as any).lambdaWindowTypes)).toEqual(['qToken', 'aToken', 'CONTENT_SCRIPT_HANDSHAKE']);
		expect(await observed()).toEqual([{ type: 'E2E_PUBLIC_PROBE', credentials: false }]);
	} finally {
		await worker.evaluate((worldId) => chrome.userScripts.resetWorldConfiguration(worldId), observerWorld);
	}
});

test('browser world exhaustion fails before lambda code runs, keeps existing worlds usable and recovers on navigation', async ({ page, extensionContext, localTestPage }) => {
	const worker = extensionContext.serviceWorkers()[0];
	await worker.evaluate((items) => chrome.storage.local.set({ local_storage_key_lambdas: JSON.stringify(items) }),
		Array.from({ length: 32 }, (_, index) => lambda(`native-limit-${index}`, `globalThis.limitCount = (globalThis.limitCount || 0) + 1; console.log('LIMIT_OK_${index}', globalThis.limitCount);`)));
	await page.goto(localTestPage);
	let exhaustedAt = -1;
	const output = page.frameLocator('#browser-lambdas-shell').locator('#shell-outputs p');
	for (let index = 0; index < 32; index++) {
		await runPolicyCommand(page, `native-limit-${index}`);
		await expect.poll(async () => (await output.allTextContents()).some((line) =>
			line === `LIMIT_OK_${index} 1` || line.includes('cannot provide another isolated function world'))).toBe(true);
		if ((await output.allTextContents()).some((line) => line.includes('cannot provide another isolated function world'))) {
			exhaustedAt = index;
			break;
		}
	}
	expect(exhaustedAt).toBeGreaterThan(0);
	expect((await output.allTextContents()).join('\n')).not.toContain(`LIMIT_OK_${exhaustedAt} 1`);
	await expect.poll(() => activeWorldCount(worker)).toBe(0);
	await runPolicyCommand(page, 'native-limit-0');
	await expect(output.filter({ hasText: /^LIMIT_OK_0 2$/ })).toHaveCount(1);
	await page.reload();
	const freshOutput = await runPolicyCommand(page, `native-limit-${exhaustedAt}`);
	await expect(freshOutput.filter({ hasText: `LIMIT_OK_${exhaustedAt} 1` })).toHaveCount(1);
});

test('worker loss rejects pending and future calls without replay; a fresh invocation works after reload', async ({ page, extensionContext, localTestPage }) => {
	const worker = extensionContext.serviceWorkers()[0];
	await worker.evaluate((items) => chrome.storage.local.set({
		local_storage_key_allow_main_world_functions: true,
		local_storage_key_lambdas: JSON.stringify(items)
	}), [
		{ ...lambda('native-worker-loss', `
			try {
				await ctx.main.run(async () => {
					document.body.dataset.pageEffects = String(Number(document.body.dataset.pageEffects || 0) + 1);
					await new Promise(resolve => document.addEventListener('finish-page-operation', resolve, { once: true }));
					return 1;
				});
			} catch (error) { document.body.dataset.pendingFailure = error.message; }
			try { await ctx.kv.get('after-loss'); }
			catch (error) { document.body.dataset.futureFailure = error.message; }
		`), allowedWorlds: ['user_scripts', 'main'] },
		lambda('native-after-worker-loss', 'console.log("WORKER_RECOVERED");')
	]);
	await page.goto(localTestPage);
	await runPolicyCommand(page, 'native-worker-loss');
	await expect(page.locator('body')).toHaveAttribute('data-page-effects', '1');
	const cdp = await extensionContext.newCDPSession(page);
	try {
		await cdp.send('ServiceWorker.enable');
		await cdp.send('ServiceWorker.stopAllWorkers');
		await expect(page.locator('body')).toHaveAttribute('data-pending-failure', /background connection closed/i);
		await expect(page.locator('body')).toHaveAttribute('data-future-failure', /background connection closed/i);
		await page.evaluate(() => document.dispatchEvent(new Event('finish-page-operation')));
		await expect(page.locator('body')).toHaveAttribute('data-page-effects', '1');
		await page.reload();
		const output = await runPolicyCommand(page, 'native-after-worker-loss');
		await expect(output.filter({ hasText: /^WORKER_RECOVERED$/ })).toHaveCount(1);
		expect(await page.locator('body').getAttribute('data-page-effects')).toBeNull();
	} finally {
		await cdp.detach();
	}
});
