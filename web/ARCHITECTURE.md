# Website architecture

The website teaches Browser Lambdas and lets visitors try curated lambdas without installing the extension. It is static HTML, JavaScript and CSS, usable directly from `index.html` after building or through GitHub Pages.

## Source and responsibilities

| Source | Responsibility |
| --- | --- |
| `index.html` | Documentation, categories, anchors and executable demo snippets |
| `styles.css` | Documentation layout and visual style |
| `script.js` | Category navigation, table of contents, URL history and llms.txt viewer |
| `highlight.js` | Small tokenizer and presentation of code examples |
| `demo.js` | Website adapter for the shared shell and curated command execution |
| `build.sh`, `llms.template.txt` | Shared-code generation and documentation exports |

## Build flow

`build.sh` extracts the extension's `parseArgs.js` and adapts `shellUi.js` into `demo-shell-ui.js`. It removes the parser's module export and renames shell elements/styles so the demo can coexist with an installed extension shell.

The same build extracts documentation from HTML into Markdown, combines it with a sitemap and `llms.template.txt` into `llms.txt`, then embeds that text in `llms-data.js`. Sections marked `data-skip-export` are omitted. These outputs are generated; edit their sources and rebuild.

The HTML extractor supports the site's existing markup conventions rather than arbitrary HTML. When changing documentation structure, check the generated text as well as the browser rendering.

## Navigation and documentation

`script.js` selects a documentation group from the URL hash, defaults to the introduction and builds its table of contents from headings. Cross-category links reveal the destination before navigation; browser history and deep links use the same mechanism.

The llms.txt viewer first fetches the text file. If fetching fails, including when opening local files, it falls back to generated `window.LLMS_TEXT`. If neither is available, it shows an error. Clipboard failures also produce a visible status.

`highlight.js` preserves example text while adding syntax spans. It is a lightweight tokenizer, not a language parser; unsupported syntax remains plain text.

## Demo execution

The displayed demo snippets in `index.html` are also the execution sources. `demo.js` compiles only curated bodies as async functions; terminal input selects a known command and supplies arguments, rather than becoming executable JavaScript.

The adapter uses the shared argument parser and provides a limited `ctx.args.all()` plus console output. It does not reproduce the extension's storage, secrets, tab APIs, authentication or privileged runtime. History and shell bounds last for the current visit.

Cmd+K, Ctrl+K and demo buttons open the shared shell UI with website-specific identifiers. The adapter handles dragging, resizing and command output. Unknown commands and execution failures are printed in the demo terminal.

Shared shell or parser changes can affect both products. See the [root architecture](../ARCHITECTURE.md) for extension execution and the [extension architecture](../extension/ARCHITECTURE.md) for internal ownership.

## Verification and hosting

`navigation.test.cjs` checks categories, deep links, history and responsive layout. `demo.test.cjs` checks command execution, shell interactions and coexistence with extension elements. Both open the built HTML through Playwright from the extension's development dependencies.

`highlight.test.cjs` checks tokenization and preservation of example text without a browser. Test commands and browser review expectations are in [website guidance](AGENTS.md).

`.github/workflows/pages.yml` builds and deploys `web/` from `main`. Changes to the shared extension shell UI or argument parser also trigger that workflow.
