import { fileURLToPath } from 'node:url';

// A fresh, real workspace screenshot on every capture. Only the demo data and
// arrangement are staged; no workspace styles or controls are recreated.
export async function captureWorkspace(page, worker) {
  const image = page.locator('[data-workspace-image]');
  if (!await image.count()) return;
  await worker.evaluate(async () => {
    const policy = { allowedWorlds: ['user_scripts'], world: 'USER_SCRIPT', urlAllowlistEnabled: false, urlPatterns: [] };
    await chrome.storage.local.set({
      local_storage_key_allow_main_world_functions: false,
      local_storage_key_baah_poll_changes: false,
      local_storage_key_baah_pending_batches: [],
      local_storage_key_lambdas: JSON.stringify([
        { id: 'store-save', project: 'my-tools', name: 'wellsaid', ...policy, func: [
          '// Collect quotes from any page.',
          'const quote = window.getSelection()',
          '  .toString().trim();',
          'if (!quote) return;',
          '',
          'const quotes =',
          '  await ctx.kv.get("quotes") ?? [];',
          'quotes.push({',
          '  text: quote, url: location.href',
          '});',
          'await ctx.kv.set("quotes", quotes);',
          'console.log("Quote saved.");'
        ].join('\n') },
        { id: 'store-quotes', project: 'my-tools', name: 'list-quotes', ...policy, func: 'console.log(await ctx.kv.get("quotes") ?? []);' },
      ]),
      local_storage_key_shellcss: JSON.stringify([{
        id: 'store-style', project: 'my-tools', name: 'glass.css', selected: false,
        css: [
          '/* use CSS to style the terminal',
          '   how you want it */',
          '#browser-lambdas-shell {',
          '  background: rgb(22 14 22 / 65%);',
          '  backdrop-filter: blur(18px);',
          '  color: #e7fdce;',
          '  border: 1px solid #ffffff30;',
          '  border-radius: 24px;',
          '  box-shadow: 0 12px 40px #0004;',
          '}',
          '#shell-outputs, #shell-input-wrap,',
          '#shell-input { background: none; }'
        ].join('\n')
      }]),
      local_storage_key_triggers: JSON.stringify([]),
      activityLogs: [
        { id: 'store-log-1', timestamp: Date.UTC(2026, 9, 14, 10, 30, 0), level: 'info', tabId: 12, uri: 'https://example.com', message: 'Running wellsaid' },
        { id: 'store-log-2', timestamp: Date.UTC(2026, 9, 14, 10, 30, 1), level: 'debug', tabId: 12, uri: 'https://example.com', message: 'KV write: quotes' },
        { id: 'store-log-3', timestamp: Date.UTC(2026, 9, 14, 10, 30, 2), level: 'info', tabId: 12, uri: 'https://example.com', message: 'Quote saved.' },
        { id: 'store-log-4', timestamp: Date.UTC(2026, 9, 14, 10, 30, 3), level: 'info', tabId: 12, uri: 'https://example.com', message: 'Running list-quotes' },
        { id: 'store-log-5', timestamp: Date.UTC(2026, 9, 14, 10, 30, 4), level: 'debug', tabId: 12, uri: 'https://example.com', message: 'Loaded 12 quotes.' }
      ]
    });
  });
  const workspace = await page.context().newPage();
  try {
    await workspace.setViewportSize({ width: 940, height: 790 });
    const id = new URL(worker.url()).host;
    await workspace.goto(`chrome-extension://${id}/workspace.html#functions`);
    await workspace.getByTestId('sidebar-functions-item').filter({ hasText: 'wellsaid' }).click();
    // Add activity below the function using the same split controls users use.
    await workspace.getByRole('link', { name: 'Activity', exact: true }).click();
    await workspace.locator('[data-id="activity-all"][data-action="open-item"]').hover();
    await workspace.locator('[data-id="activity-all"][data-action="open-item"]').getByRole('button', { name: 'Split down', exact: true }).click();
    await workspace.locator('[data-pane-type="lambda"] .code-editor').click();
    await workspace.getByRole('link', { name: 'Styles', exact: true }).click();
    const style = workspace.getByTestId('sidebar-styles-item').filter({ hasText: 'glass.css' });
    await style.hover();
    await style.getByRole('button', { name: 'Split right', exact: true }).click();
    // Keep the category navigation visible, but give the three panes room.
    await workspace.getByRole('link', { name: 'Functions', exact: true }).click();
    await workspace.getByTitle('Collapse sidebar').click();
    await workspace.locator('.activity-table').waitFor();
    if (await workspace.getByTestId('pane').count() !== 3) throw new Error('Expected three workspace panes.');
    await workspace.evaluate(async () => { await document.fonts.ready; });
    await workspace.mouse.move(939, 0);
    const output = fileURLToPath(new URL('./output/workspace-panes.png', import.meta.url));
    await workspace.screenshot({ path: output, animations: 'disabled', caret: 'hide' });
    await image.evaluate((element) => { element.src = 'output/workspace-panes.png'; });
  } finally { await workspace.close(); }
}
