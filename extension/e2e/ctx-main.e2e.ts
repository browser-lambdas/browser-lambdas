import { test, expect } from './fixtures';
import { runPolicyCommand } from './policy-helpers';

test.describe.configure({ timeout: 120_000 });

const mainFunction = (id: string, func: string, project = 'main-api') => ({
	id, name: id, project, world: 'USER_SCRIPT', allowedWorlds: ['user_scripts', 'main'],
	urlAllowlistEnabled: true, urlPatterns: ['*'], func
});

test('USER_SCRIPT reads and calls page APIs and runs an async callback with explicit plain data', async ({ page, extensionContext, localTestPage }) => {
	const worker = extensionContext.serviceWorkers()[0];
	await worker.evaluate((lambda) => chrome.storage.local.set({
		local_storage_key_allow_main_world_functions: true,
		local_storage_key_lambdas: JSON.stringify([lambda])
	}), mainFunction('main-success', `
		const isolated = typeof window.mainApiProbe;
		const initial = await ctx.main.get('mainApiProbe.counter');
		const call = await ctx.main.call('mainApiProbe.add', { amount: 3, nested: ['hello', null, true] });
		const run = await ctx.main.run(async ({ amount }) => {
			await Promise.resolve();
			return { value: window.mainApiProbe.counter + amount, ctx: typeof ctx };
		}, { amount: 4 });
		console.log(JSON.stringify({ isolated, initial, call, run, missing: await ctx.main.get('mainApiProbe.missing') === undefined }));
	`));
	await page.goto(localTestPage);
	await page.evaluate(() => {
		(window as any).mainApiProbe = {
			counter: 7,
			async add(arg: { amount: number; nested: unknown[] }) {
				await Promise.resolve();
				this.counter += arg.amount;
				return { value: this.counter, nested: arg.nested };
			}
		};
	});
	const output = await runPolicyCommand(page, 'main-success');
	await expect(output.filter({ hasText: JSON.stringify({ isolated: 'undefined', initial: 7,
		call: { value: 10, nested: ['hello', null, true] }, run: { value: 14, ctx: 'undefined' }, missing: true }) })).toHaveCount(1);
	expect(await page.evaluate(() => (window as any).mainApiProbe.counter)).toBe(10);
});

test('MAIN boundaries reject captured locals and non-data arguments or results without running invalid calls', async ({ page, extensionContext, localTestPage }) => {
	const worker = extensionContext.serviceWorkers()[0];
	await worker.evaluate((lambda) => chrome.storage.local.set({
		local_storage_key_allow_main_world_functions: true,
		local_storage_key_lambdas: JSON.stringify([lambda])
	}), mainFunction('main-boundary', `
		const capturedOnlyInUserWorld = 'private';
		const results = {};
		try { await ctx.main.run(() => capturedOnlyInUserWorld); } catch (error) { results.closure = error.message.includes('capturedOnlyInUserWorld'); }
		const cycle = {}; cycle.self = cycle;
		for (const [name, value] of [['dom', document.body], ['function', () => 1], ['cycle', cycle]]) {
			try { await ctx.main.call('mainApiProbe.touch', value); results[name + 'Arg'] = false; }
			catch (error) { results[name + 'Arg'] = error.message.includes('plain JSON'); }
		}
		for (const name of ['node', 'method', 'cycle']) {
			try { await ctx.main.get('mainApiProbe.' + name); results[name + 'Result'] = false; }
			catch (error) { results[name + 'Result'] = error.message.includes('plain JSON'); }
		}
		console.log(JSON.stringify(results));
	`));
	await page.goto(localTestPage);
	await page.evaluate(() => {
		const cycle: any = {}; cycle.self = cycle;
		(window as any).mainApiProbe = { node: document.body, method() {}, cycle,
			touch() { document.body.dataset.invalidMainCall = 'ran'; } };
	});
	const output = await runPolicyCommand(page, 'main-boundary');
	await expect(output.filter({ hasText: JSON.stringify({ closure: true, domArg: true, functionArg: true,
		cycleArg: true, nodeResult: true, methodResult: true, cycleResult: true }) })).toHaveCount(1);
	await expect(page.locator('body')).not.toHaveAttribute('data-invalid-main-call');
});

test('MAIN operations enforce default denial, global, project, item and ancestor ceilings', async ({ page, extensionContext, localTestPage }) => {
	const worker = extensionContext.serviceWorkers()[0];
	const operation = `try { await ctx.main.run(() => { document.body.dataset.mainPolicy = 'ran'; return true; }); console.log('MAIN_ALLOWED'); } catch (error) { console.log('MAIN_DENIED', error.message); }`;
	for (const scenario of [
		{ name: 'default', global: false, project: true, item: true, ancestor: true },
		{ name: 'global ceiling', global: false, project: true, item: true, ancestor: true },
		{ name: 'project ceiling', global: true, project: false, item: true, ancestor: true },
		{ name: 'item ceiling', global: true, project: true, item: false, ancestor: true },
		{ name: 'ancestor ceiling', global: true, project: true, item: true, ancestor: false },
		{ name: 'allowed', global: true, project: true, item: true, ancestor: true }
	]) {
		await worker.evaluate(async ({ scenario, operation }) => {
			const child = { id: 'main-child', name: 'main-child', project: 'child', world: 'USER_SCRIPT',
				allowedWorlds: scenario.item ? ['user_scripts', 'main'] : ['user_scripts'], func: operation };
			const parent = { id: 'main-parent', name: 'main-parent', project: 'parent', world: 'USER_SCRIPT',
				allowedWorlds: scenario.ancestor ? ['user_scripts', 'main'] : ['user_scripts'],
				func: 'await ctx.run("main-child"); console.log("PARENT_FINISHED");' };
			await chrome.storage.local.remove('local_storage_key_allow_main_world_functions');
			await chrome.storage.local.set({
				...(scenario.name === 'default' ? {} : { local_storage_key_allow_main_world_functions: scenario.global }),
				local_storage_key_project_settings: { child: { functions: { mainWorld: scenario.project } }, parent: { functions: { mainWorld: true } } },
				local_storage_key_lambdas: JSON.stringify([child, parent])
			});
		}, { scenario, operation });
		await page.goto(`${localTestPage}/main-policy/${scenario.name.replaceAll(' ', '-')}`);
		const output = await runPolicyCommand(page, 'main-parent');
		await expect(output.filter({ hasText: /^PARENT_FINISHED$/ }), scenario.name).toHaveCount(1);
		if (scenario.name === 'allowed') {
			await expect(output.filter({ hasText: /^MAIN_ALLOWED$/ })).toHaveCount(1);
			await expect(page.locator('body')).toHaveAttribute('data-main-policy', 'ran');
		} else {
			await expect(output.filter({ hasText: 'MAIN_DENIED MAIN access blocked:' }), scenario.name).toHaveCount(1);
			await expect(page.locator('body')).not.toHaveAttribute('data-main-policy');
		}
	}
});
