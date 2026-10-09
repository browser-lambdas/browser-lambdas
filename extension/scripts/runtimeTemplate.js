import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const extensionRoot = fileURLToPath(new URL('../', import.meta.url));

export function generateRuntimeTemplate() {
    const template = readFileSync(resolve(extensionRoot, 'src/background/template.js'), 'utf8');
    const directory = resolve(extensionRoot, 'src/generated');
    mkdirSync(directory, { recursive: true });
    writeFileSync(resolve(directory, 'runtimeTemplate.js'),
        `// Generated from background/template.js. Do not edit.\nexport default ${JSON.stringify(template)};\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) generateRuntimeTemplate();
