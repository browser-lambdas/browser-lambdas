# Website

Build the website, then open `web/index.html` directly in your browser:

```sh
bash web/build.sh
```

With the extension's development dependencies installed, verify the website with:

```sh
bash web/build.sh
node --test web/demo.test.cjs web/navigation.test.cjs web/highlight.test.cjs
```
