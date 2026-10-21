# Extension architecture

See the [root architecture](../ARCHITECTURE.md) for CLI sync and the runtime handshake. This note maps internal responsibilities and patterns; it describes current behavior, not planned features.

## Contexts and entry points

| Area | Responsibility | Start here |
| --- | --- | --- |
| Background worker | Execution, trigger dispatch and privileged API handling | `src/background/index.js` |
| Content scripts | Page integration, shell launch and runtime message bridge | `src/content/index.js`, `src/content/messages.js` |
| Lambda runtime | Injected `ctx` API and encrypted invocation channel | `src/background/template.js` |
| Workspace | Resource editing, project grouping, panes and push review | `src/pages/workspace/workspace.js` |
| Settings and popup | Global controls and extension entry actions | `src/pages/settings/settings.js`, `src/pages/popup/popup.js` |
| Shell | Terminal presentation and frame integration | `src/pages/shell/shellUi.js`, `src/pages/shell/shell-frame.js` |
| Shared code | Record factories, access policies, update helpers and sync | `src/shared/` |

The worker and workspace use ES modules. Content scripts are ordered classic scripts sharing globals; `manifest.chrome.json` defines their order. Keep that distinction when extracting shared code.

## Execution and access

`executeLambda.js` parses the invocation, resolves a unique lambda and checks pending-review status, nesting depth and access policy before injection. URL triggers feed commands into the same executor through `runTriggers.js`.

Triggers control automatic execution and URL matching; functions own execution-world permissions regardless of invocation source. Legacy trigger world fields and the former global main-world trigger gate are no longer consulted.

Trigger commands run in listed order, waiting for each authenticated runtime result before starting the next. A blocked or failed command, failed startup handshake, or disconnected tab stops the remaining commands in that trigger. Long-running functions have no execution timeout.

Startup handshakes have a one-second deadline, cleared when the runtime acknowledges readiness. Both endpoints can report startup failure so waiting trigger dispatchers can stop; the runtime reports errors before closing its encrypted channel.

Background preparation gives each invocation fresh handshake tokens and a session key. The runtime and content script establish an encrypted `MessageChannel`; the bridge forwards privileged requests to background port handlers. Authentication of the channel and authorization of individual operations are separate checks.

`ctx.tabs.this().close()` uses `CLOSE_CURRENT_TAB`; the background verifies the invocation and derives the tab ID from the content-script port. It never identifies the current tab by URL.

`accessPolicy.js` owns world and URL policy normalization and evaluation. `records.js` owns creation defaults; reuse these instead of constructing resource records or duplicating policy logic in views.

New lambdas inherit their project execution mode, falling back to user-script execution. Existing explicit item modes are preserved. Main-world function access uses the effective project/global policy and the item's grants. New workspace records default to user-script access; runtime-created KV records deliberately allow both worlds, while background checks still enforce the actual world and storage/secret global gates. URL restrictions apply when the record's allowlist is enabled.

Project function and trigger policies are checked before injection. Styles use their project enable setting without URL filtering. Polling and review inherit global safeguards; project locks reject incoming additions, edits and deletions.

## Data and updates

Resources and settings live in `chrome.storage.local`; several resource collections are JSON strings. `storage.js` supplies page-facing helpers, while background constants and repositories serve privileged handlers.

KV reads use `storageRecords.js`. Mutations go through `storageRepository.js`, whose promise queue serializes read/modify/write operations. Workspace updates compare the expected record against current data before saving or deleting, returning a conflict for stale edits. Workspace administration also verifies the extension sender URL.

CLI sync and workspace review reuse `functionUpdates.js` and `triggerUpdates.js`. Incoming definitions change code, patterns and commands; they preserve existing local permissions. New resources receive factory defaults. Avoid replacing whole records with incoming payloads or old review snapshots.

Pending batches live in extension storage. `pendingUpdates.js` applies reviewed items; `reviewView.js` renders review UI. A lambda with a pending change is blocked by the executor until approved.

## UI and shared patterns

The in-page popup uses an extension-origin iframe, like the shell. `popupMenuSessions.js` issues short-lived, single-use sessions bound to the content-script tab; only the popup frame can claim them. The content script transfers a private `MessageChannel` with a token delivered through extension messaging, never the DOM or a window message to the website. The frame checks its parent origin and token before enabling controls, and accepts only trusted clicks. Failed startup removes the frame and preserves the browser popup fallback.

The workspace keeps view state in `workspace.js`. Pane layout, code editing, review rendering and HTML escaping have dedicated modules alongside it; look there before adding another implementation.

Project settings save automatically through a trusted workspace message, with serialized saves and conflict checks in `shared/projectPolicy.js`. Failed saves preserve edits and offer Retry. Global safeguards are always ceilings: projects can disable allowed execution or polling and require additional review, but cannot relax global restrictions. Unset project values inherit, and item permissions remain binding.

Settings source labels share `pages/shared/settingSource.js`: inheritance and higher-level restrictions link to the relevant global or project control.

Storage and secret caller allowlists use background-issued invocation tokens, never caller-supplied project names. Nested calls retain every ancestor; restricted access requires each ancestor to match, and a worker restart requires rerunning the function.

Sync buffers batches before checking project polling, review and locks. Resource collections are written together; deletions require explicit manifest entries, and manual approval rechecks locks against the latest project policy. Locks reject synced changes while installed resources remain usable.

The website reuses the argument parser and shell UI through its build script. Changes to those sources need consideration of both the extension and demo.

## Compatibility map

| Retained behavior | Location and reason | Removal condition |
| --- | --- | --- |
| Missing storage IDs receive stable synthetic IDs until saved | `src/shared/storageRecords.js`; older records remain editable | Existing installations have a verified persistent-ID migration |
| Separate read/write world grants normalize to their intersection | `src/shared/accessPolicy.js`; combines older policy fields without widening access | Older records have been migrated without losing restrictions |
| Missing project names resolve to `default` during updates and review | `src/shared/functionUpdates.js`, `src/shared/triggerUpdates.js`, `src/pages/workspace/pendingUpdates.js`; retains identity for ungrouped resources | Existing ungrouped records and supported CLI payloads have a replacement migration |
| Existing explicit function execution modes stay explicit; new functions use an empty mode to inherit | `src/shared/records.js`, `src/background/executeLambda.js`; project defaults apply without changing installed item choices | Explicit user migration to inherited modes |
| The removed project function enable switch maps a saved denial to both worlds off | `src/shared/projectPolicy.js`; keeps disabled projects disabled using the remaining controls | Project settings have been saved without the legacy `enabled` field |
| Removed style URL filters are ignored and dropped during normalization | `src/shared/projectPolicy.js`; prevents hidden filters from blocking styles after the controls were removed | Saved project settings no longer contain style URL filters |

Removal conditions are review criteria, not scheduled removals. This is an initial map of observed compatibility handling, not an exhaustive inventory; discuss breaking changes first.

## Build and tests

`scripts/build.js` generates the runtime module from `background/template.js`, minifies JavaScript/CSS without bundling, flattens public HTML pages to the build root and copies assets. The package version supplies the built manifest version.

Unit tests in `tests/` cover policy, records, modules and build behavior. E2E tests exercise the real extension with the CLI and local test pages. Commands and conventions live in [extension guidance](AGENTS.md) and [E2E guidance](e2e/AGENTS.md).

E2E workers launch fresh browser profiles. Each test clears extension storage and closes its new tabs; CLI tests invoke the repository's CLI directly without a global install. Install dependencies in both `extension/` and `cli/` before running sync tests; CI does this explicitly.

Clock-based tests restore the real date and resume time in `finally`; Playwright's clock is shared by later pages in the worker context.
