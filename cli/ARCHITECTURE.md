# CLI architecture

baah keeps browser customizations in local projects and pushes them to the extension. It handles scaffolding, browser connections and transport; the extension owns execution and local permission decisions.

See the [root architecture](../ARCHITECTURE.md) for the shared protocol, authentication and review flow.

## Responsibilities

| Location | Responsibility |
| --- | --- |
| `baah.js` | Command dispatch, connections, file discovery, trigger parsing and WebSocket transport |
| `init.js` | Interactive or scripted project scaffolding |
| `templates/` | Resources shipped with the npm package, including the optional project skill |
| `test-home.js`, `terminal-test.py` | Test-only home isolation and interactive terminal harness |
| `scripts/` | Package installation verification and release-version checks |

The package is an ES module targeting Node.js 24+. Its `baah` executable points directly to `baah.js`; no compilation step is required. Runtime dependencies are `toml` for configuration and `ws` for transport.

## Configuration and connections

`push` reads `baah.toml` from the current working directory. The project name falls back to that directory's basename. Default discovery selects JavaScript under `functions/`, CSS under `styles/` and YAML under `triggers/`; include/exclude settings refine those selections.

Connections are separate from project configuration. Named `{ token, port }` entries live in the OS-specific user configuration directory under `baah/connections.json`. Multiple projects can use the same connection; changing its port affects all of them. The default port is `4455`.

`set`, `ls` and `rm` manage that store. Interactive token entry is hidden; scripted setup accepts explicit arguments. Invalid connection data produces an error rather than silently replacing the store. Tests redirect the home directory through a test-only preload, not a production configuration override.

## Scaffolding

`init.js` selects a minimal or starter template and optionally installs the bundled skill. Unless skipped explicitly, connection setup happens before project files are created.

The minimal template creates `baah.toml`; starter also adds `functions/hello-world.js` and function exclusions. Files use exclusive creation: existing files are skipped with a message, preserving their contents. Noninteractive use requires explicit template and skill choices.

## Push lifecycle

The CLI discovers project files and reads lambda source without executing it. Trigger parsing supports the implemented scalar, inline-list and block-list forms; it is a constrained parser, not a general YAML engine.

`startServerAndPush` opens a loopback WebSocket server and waits for an extension sync client. After authentication it sends a project batch containing definitions, counts and a resource manifest. The manifest enables removal of project resources no longer present locally; this is synchronization, not merely appending files.

The CLI waits for an encrypted acknowledgement matching the batch ID. `batch-received` can mean pending review; `batch-applied` means application completed. Rejection, authentication failure or an acknowledgement timeout reports failure. No discovered resources produces a message and returns without opening the server.

Currently, individual trigger parse errors are logged and those triggers are omitted from the outgoing collection. Consider this behavior alongside manifest-driven deletion when reviewing changes to discovery or validation.

## Packaging and tests

`package.json` explicitly includes the executable, initializer and templates in the published package. `scripts/test-package.js` packs it, installs under a temporary prefix and exercises help and scaffolding, catching missing shipped files that source-level tests would miss.

`baah.test.js` combines direct parser checks, real command subprocesses and terminal onboarding tests. Browser integration lives in `../extension/e2e/`, where pushes are reviewed and executed on test pages. See [CLI guidance](AGENTS.md) for commands and isolation rules.

Version changes on `main` are detected by `.github/workflows/publish-baah.yml`, which runs checks and publishes a release. Version bumps remain the user's decision.

## Compatibility tracking

Track retained CLI behaviors and protocol migrations in the [root compatibility map](../ARCHITECTURE.md#compatibility-map), including implementation locations and removal conditions. An exhaustive CLI compatibility inventory has not yet been completed.
