import { launchDemoContext, runShellDemo } from './extension-demo.mjs';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../..'); // Extension root; also the local server root.
const require = createRequire(resolve(root, 'package.json'));
const args = process.argv.slice(2);
const serve = args.includes('--serve');
const selected = args.filter(arg => arg !== '--serve');
const available = (await readdir(directory)).filter(name => /^\d{2}-.+\.html$/.test(name)).sort();
if (selected.some(name => !available.includes(name))) {
  throw new Error(`Unknown screen. Choose from: ${available.join(', ')}`);
}
const screens = selected.length ? selected : available;
if (!screens.length) throw new Error('No numbered HTML screens found.');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, `.${pathname}`);
    // Serve only the source assets used by the product pages.
    const allowed = ['publish/product-pages', 'assets'].some(folder => file.startsWith(resolve(root, folder) + sep));
    if (!allowed) { response.writeHead(403).end(); return; }
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  } catch { response.writeHead(404).end('Not found'); }
});
await new Promise((accept, reject) => {
  server.once('error', reject);
  server.listen(serve ? 4173 : 0, '127.0.0.1', accept);
});
const base = `http://127.0.0.1:${server.address().port}/publish/product-pages/`;
let context;
try {
    const { chromium } = require('playwright');
    const demo = await launchDemoContext(chromium, { preview: serve });
    context = demo.context;
    await mkdir(resolve(directory, 'output'), { recursive: true });
    for (const screen of screens) {
      const page = await context.newPage();
      const failures = [];
      page.on('pageerror', error => failures.push(error.message));
      await page.goto(base + screen, { waitUntil: 'load', timeout: 60000 });
      await page.waitForSelector('html[data-ready="true"]');
      for (const iframe of await page.locator('iframe[data-ready-selector]').all()) {
        const marker = await iframe.getAttribute('data-ready-selector');
        if (!marker) throw new Error(`${screen}: each iframe needs a data-ready-selector.`);
        await iframe.contentFrame().locator(marker).waitFor({ state: 'visible', timeout: 60000 });
      }
      await runShellDemo(page, demo.worker);
      console.log(`Loaded ${screen}; waiting for visible assets…`);
      for (const frame of page.frames()) {
        await frame.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all([...document.images].filter(image => {
            const box = image.getBoundingClientRect();
            return box.width && box.height && box.top < innerHeight && box.bottom > 0 && box.left < innerWidth && box.right > 0;
          }).map(async image => {
            if (!image.complete) await new Promise((accept, reject) => {
              const timeout = setTimeout(() => reject(new Error(`Image timed out: ${image.src}`)), 15000);
              image.onload = () => { clearTimeout(timeout); accept(); };
              image.onerror = () => { clearTimeout(timeout); reject(new Error(`Image failed: ${image.src}`)); };
            });
            if (!image.naturalWidth) throw new Error(`Image failed to load: ${image.src}`);
            await image.decode();
          }));
        });
      }
      if (failures.length) throw new Error(failures.join('\n'));
      const fits = await page.evaluate(() => document.documentElement.scrollWidth === 1280 && document.documentElement.scrollHeight === 800);
      if (!fits) throw new Error(`${screen}: layout exceeds the 1280 × 800 canvas.`);
      const output = resolve(directory, 'output', screen.replace(/\.html$/, '.jpg'));
      await page.mouse.move(0, 0);
      await page.screenshot({ path: output, type: 'jpeg', quality: 95, fullPage: false, animations: 'disabled', caret: 'hide' });
      console.log(`Captured 1280 × 800: ${output}`);
      if (!serve) await page.close();
    }
    if (serve) {
      console.log(`Preview ready in Chromium: ${base}${screens[0]}\nClose Chromium or press Ctrl+C to stop. Reloading requires rerunning this command to restore the demo.`);
      await new Promise(accept => {
        context.once('close', accept);
        process.once('SIGINT', accept);
        process.once('SIGTERM', accept);
      });
    }
} finally {
    await context?.close();
    await new Promise(accept => server.close(accept));
}
