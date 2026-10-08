import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Script } from 'node:vm';
import { extensionRoot, generateRuntimeTemplate } from './runtimeTemplate.js';

generateRuntimeTemplate();
let count = 0;
function check(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = join(directory, entry.name);
        if (entry.isDirectory()) check(file);
        else if (entry.name.endsWith('.js')) {
            // The injected wrapper is intentionally a classic script (it uses `with`).
            if (relative(extensionRoot, file) === 'src/background/template.js') {
                new Script(readFileSync(file, 'utf8'), { filename: file });
            } else {
                const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
                if (result.error) throw result.error;
                if (result.status !== 0) throw new Error(result.stderr || `Syntax check failed: ${file}`);
            }
            count++;
        }
    }
}
for (const directory of ['src', 'scripts', 'tests']) check(join(extensionRoot, directory));
console.log(`Checked ${count} JavaScript files.`);
