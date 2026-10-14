# Extension store product screens

Editable HTML/CSS compositions captured as JPEGs: product screens at **1280 × 800 pixels**, and campaign editions at **440 × 280** and **1400 × 560 pixels**. Screen 01 introduces the product with its real shell. Screen 02 shows the runtime API using the workspace’s code renderer and styles. Screen 03 shows local development, diff review, and workspace security. Screen 04 shows the real workspace with function, CSS, and activity panes. Screen 05 is the mascot-led campaign artwork. All four product screens and both campaign editions are captured automatically.

## Capture

Uses Node.js and the repository's existing Playwright dependency and lockfile:

```sh
cd extension
npm ci
npx playwright install chromium
cd ..
./extension/publish/product-pages/screencapture.sh
```

The script works from any working directory. It builds the current extension into `output/extension/`, loads it in a disposable Chromium profile, starts a loopback server, and opens numbered HTML pages in filename order. It waits for the live iframe, executes the demo through the real extension shell, waits for fonts and visible images, and writes `output/<screen-name>.jpg`. All output is gitignored. Errors fail the command; the browser and server close on completion or failure. Your normal browser profile is never used.

Capture one screen:

```sh
./extension/publish/product-pages/screencapture.sh 01-automate.html
```

Interactive preview (opens Chromium with the extension and demo, and also captures JPEGs):

```sh
./extension/publish/product-pages/screencapture.sh --serve
```

Close Chromium or press Ctrl+C to stop. Rerun to pick up edits and reset the demo. Opening the HTML in an ordinary browser shows the composition and Wikipedia, but requires the capture harness to prepare the shell demo.

## The real shell

There is no recreated terminal markup or product-page shell theme. `extension-demo.mjs` loads the freshly built extension and uses its normal `OPEN_SHELL` message. The content script injects the real `chrome-extension://…/shell.html` iframe into the composition page, positioned over the live Wikipedia iframe. All shell markup, controls, fonts, styling, message handling, and function execution come from the extension.

The harness seeds a demo function in the disposable profile, enters its name in the actual shell input, presses Enter, and waits for its output. `demos/hello-world.js` uses ordinary `console.log`, rendered by the shipping output renderer. Its plain text reflects the actual default shell; no CSS adds colors, shadows, custom controls, or fake progress bars. The harness also verifies that the real position menu opens and the shell URL belongs to the extension.

Only the saved shell position and dimensions are staged to fit the artwork, using the extension's existing position setting. The surrounding browser chrome remains presentation HTML. Wikipedia is embedded live; the function executes on the composition page, not inside Wikipedia.

## Edit / add screens

- Edit copy and composition in `01-automate.html`; shared layout lives in `product-pages.css`.
- Duplicate as `02-name.html`, etc. All `NN-name.html` files are discovered automatically.
- Optional `data-capture-width` and `data-capture-height` attributes on `<html>` set a page’s output dimensions; defaults are 1280 × 800.
- Keep `html[data-ready="true"]` as the page's readiness signal after setup.
- Content iframes specify a `data-ready-selector` that must become visible before capture.
- A `[data-shell-demo="hello-world"]` placement element determines the real shell's bounds and selects `demos/hello-world.js`. `data-shell-command="hello-world --verbose"` sets the command and arguments. `data-shell-ready="(dangerous, but powerful) main world"` selects the output text that signals completion. Omit the placement element for a screen without a shell.
- Logo and local Lato / Fira Mono fonts come directly from `extension/assets`. The composition palette matches the repository website. Icons are inline SVG.
- Wikipedia requires internet access and can change between captures. A failed or blocked embed fails capture. Third-party content retains its original attribution on the embedded page.

The pipeline is repeatable; pixel-identical output also depends on the same Playwright/Chromium version, OS, and live website content. No image generation is used. Page 04 embeds a fresh Playwright screenshot of the real workspace; it is regenerated alongside the product page.

## Runtime API screen

`02-runtime-api.html` contains five editable, two-line examples. `runtime-api.js` imports the workspace’s `highlightJavaScript` and `codeLineNumbers`; the page loads `workspace.css` directly for code typography, syntax colors, gutters, and borders. `runtime-api.css` controls only the composition geometry. Examples are displayed, not executed.

## Development screen

`03-development.html` pairs CLI/config examples with the production `renderReviewPanel` renderer and staged diff data. The CLI commands and TOML are display-only examples. The capture hook in `workspace-preview.mjs` opens the real extension workspace in the disposable profile, prepares a sample function, and copies the rendered execution-world section into the composition. It keeps the actual labels, help text, switches, dropdown, and workspace styles; URL allowlist controls are outside the excerpt. Both execution worlds are permitted for this sample, with User world selected as the default. This does not affect your normal browser profile.

The copied security controls and diff buttons are presentation DOM, not connected to the workspace's event handlers. The security excerpt is populated by the capture harness (including `--serve`), rather than when opening the static HTML alone.

## Workspace screen

`04-workspace.html` shows three real workspace panes: a function editor, a CSS editor, and activity logs. `workspace-capture.mjs` seeds example files and deterministic sample log entries in the disposable extension profile, arranges the panes using the workspace's normal split controls, and collapses the file list while keeping category navigation visible. It does not modify workspace CSS.

Every capture regenerates `output/workspace-panes.png` at 940 × 790, then places it in the 1280 × 800 composition before the final JPEG capture. Both outputs are gitignored. The static page needs the capture harness (including `--serve`) to populate the workspace image.

## Campaign screen

`05-campaign.html` and `campaign.css` compose the existing mascot, bundled Lilita One wordmark, pale yellow-green brand color, purple vector shapes, CSS glow, and decorative stars. Everything remains editable and reproducible; no generated bitmap artwork or remote fonts are needed. It exports a 440 × 280 JPEG. The 1280 × 800 design is scaled uniformly to fill the tile, cropping 4 output pixels from each side.

The campaign-only display font is [Lilita One](https://github.com/google/fonts/tree/main/ofl/lilitaone), bundled with its SIL Open Font License in `assets/`. The other product pages continue to use Lato. SVG text uses rounded outline joins and tightly stacked lines.

### Campaign exports

- `05-campaign.html` → `output/05-campaign.jpg`: **440 × 280** small tile.
- `05-campaign-wide.html` → `output/05-campaign-wide.jpg`: **1400 × 560** wide canvas.

The wide page imports the small page's artwork markup with `campaign-wide.js` and arranges the mascot beside the stacked wordmark. Assets and typography are shared; the layout is adapted without stretching the mascot or cropping text. The capture script includes both editions automatically, or accepts either filename to capture it individually.

## Hero

`06-hero.html` exports `output/06-hero.jpg` at **1280 × 800**. It reuses the campaign artwork via `hero.js`, with the mascot and wordmark on the left and a large column of values on the right: Free, Secure, Private, and Open Source. Layout adjustments live in `hero.css`. It is included in the normal batch capture.
