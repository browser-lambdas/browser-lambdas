import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const extensionRoot = fileURLToPath(new URL('../', import.meta.url));

export function generateRuntimeTemplate() {
    const secureChannel = readFileSync(resolve(extensionRoot, 'src/shared/secureChannel.js'), 'utf8');
    const template = readFileSync(resolve(extensionRoot, 'src/background/template.js'), 'utf8')
        .replace('__SECURE_CHANNEL_SOURCE__;', () => secureChannel);
    const directory = resolve(extensionRoot, 'src/generated');
    mkdirSync(directory, { recursive: true });
    writeFileSync(resolve(directory, 'runtimeTemplate.js'),
        `// Generated from background/template.js and shared/secureChannel.js. Do not edit.\nexport default ${JSON.stringify(template)};\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) generateRuntimeTemplate();
