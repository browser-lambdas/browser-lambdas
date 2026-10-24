<p align="center">
  <img src="web/assets/logo-clean.png" alt="Browser Lambdas" width="180">
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/browser-lambdas/ghbmcdgmpahckjglhnjfaflbpehifjji"><img src="https://img.shields.io/chrome-web-store/v/ghbmcdgmpahckjglhnjfaflbpehifjji?label=Chrome%20Web%20Store" alt="Chrome Web Store version"></a>
  <a href="https://www.npmjs.com/package/@browser-lambdas/baah"><img src="https://img.shields.io/npm/v/%40browser-lambdas%2Fbaah?label=baah" alt="baah npm version"></a>
  <a href="https://github.com/browser-lambdas/browser-lambdas/actions/workflows/pr-check.yml"><img src="https://github.com/browser-lambdas/browser-lambdas/actions/workflows/pr-check.yml/badge.svg" alt="PR Checks"></a>
</p>

# Browser Lambdas

Browser extension that runs JavaScript functions on websites. Think user scripts 2.0, with an advanced runtime API and multiple execution worlds.

[Documentation](https://www.browser-lambdas.dev/) · [baah setup](cli/README.md) · [baah on npm](https://www.npmjs.com/package/@browser-lambdas/baah)

## Status

Version 1.0.0 is planned for December 2026.

Extension version 0.2.0 is available in the [Chrome Web Store](https://chromewebstore.google.com/detail/browser-lambdas/ghbmcdgmpahckjglhnjfaflbpehifjji).

Most features are built and tested:

- baah CLI tool and authentication to sync functions to the extension
- Extension storage key-value API to persist data between function calls
- Secrets management
- Tab controls
- Ergonomic argument passing
- Terminal and styling
- Automatic triggers
- Global and project settings

APIs are not expected to break, but they are being tested in the real world now.
