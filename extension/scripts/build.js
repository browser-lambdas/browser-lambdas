import { cpSync, mkdirSync, readdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import { extensionRoot, generateRuntimeTemplate } from './runtimeTemplate.js';

export function buildExtension(outputDirectory = resolve(extensionRoot, 'build')) {
    generateRuntimeTemplate();
    rmSync(outputDirectory, { recursive: true, force: true });
    mkdirSync(outputDirectory, { recursive: true });
    const destinations = new Set();
    function copy(source, relative) {
        if (destinations.has(relative)) throw new Error(`Duplicate build destination: ${relative}`);
        destinations.add(relative);
        const target = join(outputDirectory, relative);
        mkdirSync(resolve(target, '..'), { recursive: true });
        if (/\.(js|css)$/.test(relative)) {
            const { code } = transformSync(readFileSync(source, 'utf8'), {
                loader: relative.endsWith('.css') ? 'css' : 'js',
                minify: true,
                // No format or bundling: classic scripts share top-level globals.
                sourcefile: relative,
            });
            writeFileSync(target, code);
        } else {
            cpSync(source, target, { recursive: true });
        }
    }
    function copySource(directory, prefix = '') {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const source = join(directory, entry.name);
            const relative = prefix + entry.name;
            if (entry.isDirectory()) copySource(source, relative + '/');
            // Public page URLs stay at the root; their scripts/styles retain source paths.
            else if (/^pages\/[^/]+\/[^/]+\.html$/.test(relative)) copy(source, entry.name);
            else if (relative !== 'background/template.js') copy(source, relative);
        }
    }
    copySource(resolve(extensionRoot, 'src'));
    const manifest = JSON.parse(readFileSync(resolve(extensionRoot, 'manifest.chrome.json'), 'utf8'));
    const { version } = JSON.parse(readFileSync(resolve(extensionRoot, 'package.json'), 'utf8'));
    writeFileSync(join(outputDirectory, 'manifest.json'), JSON.stringify({ ...manifest, version }, null, 2) + '\n');
    copy(resolve(extensionRoot, 'assets/fonts'), 'assets/fonts');
    for (const name of ['logo-hvid.svg', 'logo-sort.svg', 'logo-tekst.svg', 'logo-clean.png', 'logo-green.png', 'logo-lime.png', 'logo-purple.png']) {
        copy(resolve(extensionRoot, 'assets', name), `assets/${name}`);
    }
    for (const prefix of ['popup-icon', 'extension-page-icon']) {
        for (const size of [16, 32, 48, 128]) {
            copy(resolve(extensionRoot, 'assets/logo-lime.png'), `icons/${prefix}${size}.png`);
        }
    }
    if (!existsSync(join(outputDirectory, 'workspace.html'))) throw new Error('Missing workspace entry point.');
    return outputDirectory;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv.length > 2) throw new Error('Usage: node scripts/build.js');
    console.log(`Built browser-lambdas (chrome) at: ${buildExtension()}`);
}
