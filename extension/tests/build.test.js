import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { buildExtension } from '../scripts/build.js';
import { extensionRoot } from '../scripts/runtimeTemplate.js';

test('build resolves every page, manifest resource and module import without duplicate page copies', () => {
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
        for (const page of ['popup', 'settings', 'workspace', 'shell']) {
            const html = readFileSync(join(output, `${page}.html`), 'utf8');
            for (const [, resource] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
                assert.ok(existsSync(resolve(output, resource)), `${page}: ${resource}`);
            }
            assert.equal(existsSync(join(output, `pages/${page}/${page}.html`)), false);
            assert.equal(existsSync(join(output, `${page}.js`)), false);
        }
        function checkImports(directory) {
            for (const entry of readdirSync(directory, { withFileTypes: true })) {
                const file = join(directory, entry.name);
                if (entry.isDirectory()) checkImports(file);
                else if (entry.name.endsWith('.js') && entry.name !== 'runtimeTemplate.js') {
                    const code = readFileSync(file, 'utf8');
                    for (const [, dependency] of code.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)) {
                        if (dependency.startsWith('.')) assert.ok(existsSync(resolve(dirname(file), dependency)), `${file}: ${dependency}`);
                    }
                }
            }
        }
        checkImports(output);
        const generated = readFileSync(join(output, 'generated/runtimeTemplate.js'), 'utf8');
        const template = JSON.parse(generated.split('export default ')[1].trim().slice(0, -1));
        assert.equal(template, readFileSync(join(extensionRoot, 'src/background/template.js'), 'utf8'));
        assert.equal(existsSync(join(output, 'background/templateRaw.js')), false);
        assert.equal(existsSync(join(output, 'background/template.js')), false);
    } finally {
        rmSync(output, { recursive: true, force: true });
    }
});
