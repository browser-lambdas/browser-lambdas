// Capture real DOM from the current extension's workspace; no screenshot asset
// or duplicate implementation of its security controls is maintained here.
export async function prepareWorkspacePreview(page, worker) {
  const target = page.locator('[data-workspace-security]');
  if (!await target.count()) return;
  await worker.evaluate(async () => {
    await chrome.storage.local.set({
      local_storage_key_allow_main_world_functions: true,
      local_storage_key_lambdas: JSON.stringify([{
        id: 'store-development', name: 'self-destruct --sec',
        func: 'const seconds = Number(ctx.args.all().sec ?? 30);',
        project: 'my-tools', allowedWorlds: ['user_scripts', 'main'],
        world: 'USER_SCRIPT', urlAllowlistEnabled: false, urlPatterns: []
      }])
    });
  });
  const workspace = await page.context().newPage();
  try {
    const id = new URL(worker.url()).host;
    await workspace.goto(`chrome-extension://${id}/workspace.html#functions`);
    await workspace.getByTestId('sidebar-functions-item').filter({ hasText: 'self-destruct' }).click();
    await workspace.getByRole('button', { name: 'Show settings', exact: true }).click();
    const security = workspace.getByTestId('function-security');
    await security.waitFor();
    const markup = await security.evaluate(element => {
      const copy = element.cloneNode(true);
      // This composition shows the execution-world section. URL allowlisting
      // follows it in the workspace and is outside this excerpt.
      const defaultWorld = copy.querySelector('.access-select-row');
      while (defaultWorld.nextElementSibling) defaultWorld.nextElementSibling.remove();
      for (const link of copy.querySelectorAll('a')) link.href = new URL(link.getAttribute('href'), location.href).href;
      return copy.outerHTML;
    });
    await target.evaluate((element, html) => { element.innerHTML = html; }, markup);
  } finally { await workspace.close(); }
}
