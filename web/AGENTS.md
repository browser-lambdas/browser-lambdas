# Website

## Content and appearance

- Preserve the current visual style. Discuss larger visual changes with the user first.
- Match the concise copy in `index.html`: usually one or two short sentences per paragraph. Let examples do the explaining.
- Check examples against the actual CLI and runtime behavior. User-facing documentation updates remain a separate step unless requested.

## Source and build

- Edit HTML, source scripts/styles and `llms.template.txt`. Do not hand-edit generated `index.md`, `llms.txt`, `llms-data.js` or `demo-shell-ui.js`.
- `build.sh` exports documentation from HTML and generates the demo shell from the extension parser and shell UI. Fix shared behavior at its source rather than duplicating it in the website.
- Consult `../ARCHITECTURE.md` for those dependencies. Check both consumers when changing shared code.
- Keep the site usable by opening `index.html` directly after building, as supported today.

## Verification

Run commands from the repository root. Capture noisy output in temporary logs and inspect relevant failures or bounded excerpts.

- Build: `bash web/build.sh`.
- Focused checks: `node --test web/<file>.test.cjs`. Browser tests use Playwright from the extension's development dependencies.
- Final full website suite: build, then `node --test web/demo.test.cjs web/navigation.test.cjs web/highlight.test.cjs`.
- Reuse existing tests for navigation, demo behavior and syntax highlighting. Cover defaults, successful interactions and relevant failures.
- For UI changes, inspect the built page in a browser and exercise the affected interactions before claiming done.
