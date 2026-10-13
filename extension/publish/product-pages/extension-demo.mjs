import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildExtension } from '../../scripts/build.js';

// Build and load the shipping extension, including its content scripts, iframe,
// fonts, styles, message channel, and user-script runtime. Never recreate its UI.
export async function launchDemoContext(chromium, { preview }) {
  const build = buildExtension(fileURLToPath(new URL('./output/extension/', import.meta.url)));
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: !preview,
    args: [`--disable-extensions-except=${build}`, `--load-extension=${build}`],
    viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
    locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', reducedMotion: 'reduce'
  });
  try {
    context.setDefaultTimeout(15000);
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const settings = await context.newPage();
    await settings.goto(`chrome://extensions/?id=${id}`);
    // Same setup as the extension's end-to-end fixtures; this is a disposable profile.
    await settings.evaluate(async extensionId => {
      await chrome.developerPrivate.updateExtensionConfiguration({ extensionId, userScriptsAccess: true });
    }, id);
    await settings.close();
    await worker.evaluate(async () => {
      await chrome.userScripts.getScripts();
      await chrome.storage.local.set({
        local_storage_key_keybinding: { meta: false, ctrl: true, key: 'k' },
        local_storage_key_baah_poll_changes: false
      });
    });
    return { context, worker };
  } catch (error) { await context.close(); throw error; }
}

export async function runShellDemo(page, worker) {
  const anchor = page.locator('[data-shell-demo]');
  if (!await anchor.count()) return;
  const name = await anchor.getAttribute('data-shell-demo');
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid demo name.');
  const readyText = await anchor.getAttribute('data-shell-ready');
  if (!readyText) throw new Error('Demo needs a data-shell-ready output marker.');
  const code = await readFile(new URL(`./demos/${name}.js`, import.meta.url), 'utf8');
  const bounds = await anchor.boundingBox();
  if (!bounds) throw new Error('Missing shell placement bounds.');
  await worker.evaluate(async ({ name, code, bounds, url }) => {
    await chrome.storage.local.set({
      local_storage_key_lambdas: JSON.stringify([{ name, func: code, allowedWorlds: ['user_scripts'] }]),
      [`local_storage_key_shellposition:${url}`]: bounds
    });
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(tab => tab.url === url);
    if (!tab) throw new Error('Capture tab not found.');
    await chrome.tabs.sendMessage(tab.id, { action: 'OPEN_SHELL' });
  }, { name, code, bounds, url: page.url() });
  const shell = page.frameLocator('#browser-lambdas-shell');
  const input = shell.locator('#shell-input');
  await input.fill(name);
  await input.press('Enter');
  await shell.locator('#shell-outputs p').filter({ hasText: readyText }).waitFor();
  await shell.getByRole('button', { name: 'Set shell position' }).click();
  await shell.getByRole('button', { name: 'Place on right', exact: true }).waitFor();
  await shell.getByRole('button', { name: 'Set shell position' }).click();
  const output = await shell.locator('#shell-outputs').innerText();
  if (output.includes('WARN:')) throw new Error(`Demo failed: ${output}`);
  // Assert we're capturing the extension document, never a look-alike DOM shell.
  const src = await page.locator('#browser-lambdas-shell').getAttribute('src');
  if (!src?.startsWith('chrome-extension://')) throw new Error('The real extension shell was not injected.');
}
