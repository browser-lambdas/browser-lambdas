# Extension store product screens

Editable HTML/CSS compositions captured at exactly **1280 × 800 pixels**, as JPEGs. The first screen follows the supplied product artwork; add screens 02–05 when their content is ready.

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

The harness seeds a demo function in the disposable profile, enters its name in the actual shell input, presses Enter, and waits for its output. `demos/cool.js` uses ordinary `console.log`, rendered by the shipping output renderer. Its plain text reflects the actual default shell; no CSS adds colors, shadows, custom controls, or fake progress bars. The harness also verifies that the real position menu opens and the shell URL belongs to the extension.

Only the saved shell position and dimensions are staged to fit the artwork, using the extension's existing position setting. The surrounding browser chrome remains presentation HTML. Wikipedia is embedded live; the function executes on the composition page, not inside Wikipedia.

## Edit / add screens

- Edit copy and composition in `01-automate.html`; shared layout lives in `product-pages.css`.
- Duplicate as `02-name.html`, etc. All `NN-name.html` files are discovered automatically.
- Keep `html[data-ready="true"]` as the page's readiness signal after setup.
- Content iframes specify a `data-ready-selector` that must become visible before capture.
- A `[data-shell-demo="cool"]` placement element determines the real shell's bounds and selects `demos/cool.js`. `data-shell-ready="100%"` selects the output text that signals completion. Omit the placement element for a screen without a shell.
- Logo and local Lato / Fira Mono fonts come directly from `extension/assets`. The composition palette matches the repository website. Icons are inline SVG.
- Wikipedia requires internet access and can change between captures. A failed or blocked embed fails capture. Third-party content retains its original attribution on the embedded page.

The pipeline is repeatable; pixel-identical output also depends on the same Playwright/Chromium version, OS, and live website content. No image generation or embedded screenshot is used.
