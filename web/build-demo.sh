#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# Reuse the extension UI; the website supplies its own runtime adapter.
sed 's/^export const parseArgs/const parseArgs/' ../extension/src/background/parseArgs.js > demo-shell-ui.js
# Keep demo elements and styles separate from an installed extension's shell.
sed -e 's/browser-lambdas-shell/browser-lambdas-demo-terminal/g' \
    -e 's/shell-/demo-shell-/g' \
    -e 's/browser-lambdas-default-style/browser-lambdas-demo-default-style/g' \
    -e 's/browser-lambdas-user-style/browser-lambdas-demo-user-style/g' \
    ../extension/src/pages/shell/shellUi.js >> demo-shell-ui.js
