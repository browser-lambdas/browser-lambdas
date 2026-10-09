# browser-lambdas

`/extension` contains browser-lambdas, implemented with static JavaScript, HTML,
and CSS and no runtime dependencies.

## Current state

- Runtime code lives in `extension/src` as JavaScript modules and ordered classic content scripts.
- Static pages are in `extension/src/pages` (`popup`, `settings`, `workspace`).
- Build output is produced to `extension/build` and can be loaded as an unpacked extension.
- The Chrome manifest template is maintained in `extension/manifest.chrome.json`; the build reads its version from `extension/package.json`.
- Branding and icon source assets are committed in `extension/assets` and copied into the build by `bash ./compile.sh`.

## Build unpacked extension

From `extension/`, run:

```bash
npm ci
bash ./compile.sh
```

Then load `extension/build/` as unpacked extension in your browser.
Compilation minifies JavaScript and CSS with esbuild (a build-only dev dependency).
Source files remain readable; script paths and shared content-script globals are preserved.

## Package for the Chrome Web Store

After `npm ci`, run from `extension/`:

```bash
bash ./package-chrome-store.sh
# Or: npm run package:chrome-store
```

Requires the `zip` command. The script compiles a fresh, minified build and creates
`extension/releases/browser-lambdas-chrome-store-<version>.zip`, using the version
from the built manifest. It works from any working directory and replaces the ZIP
for the same version without retaining files from previous builds.

## Playwright end-to-end tests

The extension Playwright harness lives in `extension/e2e` and launches the compiled
`extension/build` directory. Install the dev dependencies once, then run the suite from
`extension/`:

```bash
npm ci
npm run test:e2e -- --headless
```

Omit `--headless` to watch the browser, or append a test filename to run a
single scenario.

## Checks

Run `npm run check` for JavaScript syntax checks and `npm run test:unit` for unit tests.
Both prepare the generated runtime template automatically. No formatter is configured.

`package.json` is the version source of truth. From `extension/`, use
`npm version patch --no-git-tag-version` (or a specific version) to update it and
the npm lockfile together, then run `npm run build` to regenerate the manifest.

The build preserves script and style paths from `src/`, with public HTML pages at the
build root. `src/generated/runtimeTemplate.js` is generated from
`src/background/template.js`; it is ignored by Git and must not be edited.
