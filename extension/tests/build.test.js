import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { buildExtension } from '../scripts/build.js';
import { extensionRoot } from '../scripts/runtimeTemplate.js';

test('build resolves every page, manifest resource and module import without duplicate page copies', async () => {
    const output = mkdtempSync(join(tmpdir(), 'browser-lambdas-build-'));
    try {
        buildExtension(output);
        const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'));
        const pkg = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8'));
        assert.equal(manifest.version, pkg.version);
        const resources = [manifest.background.service_worker, manifest.action.default_popup,
            ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon),
            ...manifest.content_scripts.flatMap((entry) => entry.js),
            ...manifest.web_accessible_resources.flatMap((entry) => entry.resources)];
        for (const resource of resources) assert.ok(existsSync(join(output, resource)), resource);
        for (const page of ['popup', 'popup-menu', 'settings', 'workspace', 'shell']) {
            const html = readFileSync(join(output, `${page}.html`), 'utf8');
            for (const [, resource] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
                assert.ok(existsSync(resolve(output, resource)), `${page}: ${resource}`);
            }
            assert.equal(existsSync(join(output, `pages/${page === 'popup-menu' ? 'popup' : page}/${page}.html`)), false);
            assert.equal(existsSync(join(output, `${page}.js`)), false);
        }
        function checkImports(directory) {
            for (const entry of readdirSync(directory, { withFileTypes: true })) {
                const file = join(directory, entry.name);
                if (entry.isDirectory()) checkImports(file);
                else if (entry.name.endsWith('.js') && entry.name !== 'runtimeTemplate.js') {
                    const code = readFileSync(file, 'utf8');
                    for (const [, dependency] of code.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)['"]([^'"]+)['"]/g)) {
                        if (dependency.startsWith('.')) assert.ok(existsSync(resolve(dirname(file), dependency)), `${file}: ${dependency}`);
                    }
                }
            }
        }
        checkImports(output);
        const generated = readFileSync(join(output, 'generated/runtimeTemplate.js'), 'utf8');
        const { default: template } = await import(`data:text/javascript;base64,${Buffer.from(generated).toString('base64')}`);
        assert.equal(template, readFileSync(join(extensionRoot, 'src/background/template.js'), 'utf8'));
        assert.equal(existsSync(join(output, 'background/templateRaw.js')), false);
        assert.equal(existsSync(join(output, 'background/template.js')), false);
        for (const resource of ['content/crypto.js', 'pages/workspace/workspace.css']) {
            const source = readFileSync(join(extensionRoot, 'src', resource));
            const built = readFileSync(join(output, resource));
            assert.ok(built.length < source.length, `${resource} should be minified`);
        }
        // A later classic script must still be able to call these shared helpers.
        const context = createContext({ crypto, TextEncoder, TextDecoder, atob, btoa });
        runInContext(readFileSync(join(output, 'content/crypto.js'), 'utf8'), context);
        const roundTrip = await runInContext(`(async () => {
            const key = encodeBase64(crypto.getRandomValues(new Uint8Array(32)));
            return (await decrypt(await encrypt({ message: 'hello' }, key), key)).message;
        })()`, context);
        assert.equal(roundTrip, 'hello');
    } finally {
        rmSync(output, { recursive: true, force: true });
    }
});
