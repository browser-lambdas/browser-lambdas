# Extension

## Source and build

- Edit `src/`, `assets/` and build inputs, not `build/` or `src/generated/runtimeTemplate.js`. The runtime template source is `src/background/template.js`.
- `manifest.chrome.json` defines the Chrome manifest; `package.json` supplies its version. Keep version changes in sync with the lockfile.
- Content scripts are ordered classic scripts with shared globals. Preserve their loading order and dependencies when refactoring; the build minifies without bundling.
- Public HTML pages build to the output root; their scripts and styles retain source paths.

## Compatibility and failures

- Preserve existing lambda APIs, saved resources and settings by default. Discuss breaking changes with the user before implementing them.
- Track compatibility shims and migrations in `ARCHITECTURE.md`: what is retained, why, and the conditions for removal.
- Failed UI actions preserve user input and show a concise, actionable error.
- Failed updates or migrations preserve existing data and report the failure. Never silently reset users' resources or settings.

## Verification

Run commands from `extension/`, with noisy output captured in temporary logs as described in the root guidance. Development dependencies must be installed.

- Build: `npm run build`. Load `build/` as the unpacked extension for browser verification.
- Syntax checks: `npm run check`.
- Focused unit tests: `node scripts/runtimeTemplate.js`, then `node --test tests/<file>.test.js`.
- Focused browser tests: run `npm run build`, then `npm run test:e2e -- --headless <file>.e2e.ts`. The harness may reuse an existing build; rebuild after source changes.
- Final full suite: `npm run build`, `npm run check`, `npm run test:unit`, and `npm run test:e2e -- --headless`.
