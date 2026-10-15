# baah CLI

## Implementation

- Target Node.js 24+ and ES modules. Reuse existing command, configuration and template handling.
- Preserve existing CLI output, errors and interaction patterns.
- `baah init` preserves existing files by default and explains what it skips. Overwriting requires an explicit user choice.
- Leave version bumps to the user; do not initiate releases or publishing.
- Consult `../ARCHITECTURE.md` for CLI/extension communication. Protocol changes must account for both implementations and existing installed versions; discuss breaking changes first.
- Track compatibility shims and migrations in the root architecture note: retained behavior, reason, location and removal conditions.

## Testing

- Follow existing `node:test` and `node:assert/strict` patterns. Group related cases in existing test files where practical.
- Cover defaults, successful actions and relevant failures. Test commands through real subprocesses; use the terminal harness for prompts, hidden input and cancellation.
- Use temporary project and configuration directories. Reuse `test-home.js` with `BAAH_TEST_HOME` and the existing environment setup to isolate tests from real browser connections and credentials. Clean up afterward.
- Preserve checks that tokens do not appear in output and existing files survive initialization.
- Changes to packaged files or scaffolding need the package installation check, which packs and installs the CLI under a temporary prefix and exercises its entry point and templates.
- CLI-to-extension workflow coverage lives in `../extension/e2e/`; follow its guidance when editing those tests.

## Verification

Run commands from `cli/`. Capture noisy output in temporary logs and inspect relevant failures or bounded excerpts.

- Focused tests: `node --test --test-name-pattern='<pattern>' baah.test.js`, or `node --test scripts/<file>.test.js`.
- Package installation check: `npm run test:package`.
- Final full CLI verification: `npm test` and `npm run test:package`. Run the relevant extension E2E coverage for integration changes; reserve full suites for final verification.
