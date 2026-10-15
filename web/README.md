# Website

Build the website, then open `web/index.html` directly in your browser:

```sh
bash web/build.sh
```

The demo terminal is available in every documentation
section with Cmd+K or Ctrl+K. The demo section also has an I lost my keys button.
Its adapter and curated commands live in `demo.js`; history and position are kept
in memory for the current visit.

Optionally start a local preview server (requires Python 3):

```sh
bash web/build.sh --serve
```

Open http://localhost:8080 when using the preview server.

The build is also used by GitHub Actions. It bundles the extension's argument
parser and terminal UI and generates `index.md`, `llms.txt`, and `llms-data.js`
from the website HTML. These files and `demo-shell-ui.js` are generated outputs,
ignored by Git; run the build after a fresh checkout or after changing sources.
Both commands work from the repository root; from this directory use
`bash build.sh` or `bash build.sh --serve`.

With the extension's development dependencies installed, verify the website with:

```sh
bash web/build.sh
node --test web/demo.test.cjs web/navigation.test.cjs web/highlight.test.cjs
```
