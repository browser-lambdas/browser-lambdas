# End-to-end tests

The suite should establish that complete user workflows work across the CLI, extension and web pages: push updates with baah, review and apply them in the extension, then run the updated lambdas on a page and verify their effects. Isolated component checks do not replace this coverage.

## Organization

- Name test files `<domain>-<feature-or-behavior>.e2e.ts`. Allowed prefixes: `ctx-`, `ui-`, `shell-`, `cli-`. Popup tests belong under `ui-`.
- Prefer fewer files. Extend an existing file for related scenarios rather than creating a file per case.
- When you spot a test filename that breaks this convention, read the file and rename it to match its domain and behavior. Update any references to the old path.

## Coverage and approach

- Cover default behavior, successful actions and relevant failures for each feature under test.
- Import `test` and `expect` from `./fixtures`. Reuse existing fixtures and helpers before adding new ones.
- Exercise the real extension: use UI actions, run lambdas through the shell, and use `runBaah` for CLI integration.
- Use the `localTestPage` fixture for browser test pages. It starts `test-server.js` on an available port, serves `test-page.html` for every path, and stops the server afterward. Reuse it for page execution and URL-policy scenarios.
- Direct storage access is appropriate for setup, cleanup and assertions about persisted state. Keep the behavior under test exercised through its actual entry point.
- Use `allowFunctionOnTestPages` for explicit permission setup when testing unrelated runtime behavior. Permission tests must exercise their own policy setup and cover both allowed and denied behavior.
- The browser context is shared within a worker. Clean up state that could affect later tests, and avoid depending on test order.

## Execution

- Follow `../AGENTS.md` for build and test commands. Rebuild after source changes; the harness can reuse stale output.
- Run relevant files during implementation. Reserve the full suite for final verification.
- Capture noisy output in temporary logs, preserve the exit code, and inspect only relevant failures or bounded excerpts.
