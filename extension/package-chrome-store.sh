#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ $# -ne 0 ]]; then
    echo "Usage: bash package-chrome-store.sh" >&2
    exit 1
fi
if ! command -v zip >/dev/null 2>&1; then
    echo "The zip command is required to package the extension." >&2
    exit 1
fi

bash "$ROOT_DIR/compile.sh"
VERSION="$(node -p 'require(process.argv[1]).version' "$ROOT_DIR/build/manifest.json")"
OUTPUT_DIR="$ROOT_DIR/releases"
ARCHIVE="$OUTPUT_DIR/browser-lambdas-chrome-store-$VERSION.zip"
mkdir -p "$OUTPUT_DIR"

# Create a fresh archive so repeated builds cannot retain removed files.
ZIP_TEMP="$(mktemp "$OUTPUT_DIR/.chrome-store.XXXXXX")"
trap 'rm -f "$ZIP_TEMP"' EXIT
(
    cd "$ROOT_DIR/build"
    # Archive the contents, placing manifest.json at the ZIP root.
    zip -q -r -X - . -x '*.DS_Store' '__MACOSX/*'
) > "$ZIP_TEMP"
mv -f "$ZIP_TEMP" "$ARCHIVE"
echo "Chrome Web Store upload ZIP: $ARCHIVE"
