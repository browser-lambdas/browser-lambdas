# Website

Before serving the website locally, bundle the demo terminal from the shared
extension UI:

```sh
bash web/build-demo.sh
python3 -m http.server 8080 --directory web
```

Open http://localhost:8080. The demo terminal is available in every documentation
section with Cmd+K or Ctrl+K. The demo section also has an I lost my keys button.
Its adapter and curated commands live in `demo.js`; history and position are kept
in memory for the current visit. The generated `demo-shell-ui.js` is ignored by
Git and rebuilt by the GitHub Pages workflow.

After editing documentation HTML, refresh its Markdown and llms.txt exports:

```sh
bash web/html2md.sh
```

With the extension's development dependencies installed, verify the website with:

```sh
bash web/build-demo.sh
node --test web/demo.test.cjs web/navigation.test.cjs web/highlight.test.cjs
```
