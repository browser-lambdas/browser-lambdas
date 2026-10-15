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

Background preparation gives each invocation fresh handshake tokens and a session key. The runtime and content script establish an encrypted `MessageChannel`; the bridge forwards privileged requests to background port handlers. Authentication of the channel and authorization of individual operations are separate checks.

`accessPolicy.js` owns world and URL policy normalization and evaluation. `records.js` owns creation defaults; reuse these instead of constructing resource records or duplicating policy logic in views.

New lambdas select user-script execution. Main-world access also requires the relevant global gate. New workspace records default to user-script access; runtime-created KV records deliberately allow both worlds, while background checks still enforce the actual world and global gate. URL restrictions apply when the record's allowlist is enabled.

Resource policies and global gates are implemented here. The resource → project → global inheritance described in root guidance is a product preference, not a claim that every setting already supports all three levels.

## Data and updates

Resources and settings live in `chrome.storage.local`; several resource collections are JSON strings. `storage.js` supplies page-facing helpers, while background constants and repositories serve privileged handlers.

KV reads use `storageRecords.js`. Mutations go through `storageRepository.js`, whose promise queue serializes read/modify/write operations. Workspace updates compare the expected record against current data before saving or deleting, returning a conflict for stale edits. Workspace administration also verifies the extension sender URL.

CLI sync and workspace review reuse `functionUpdates.js` and `triggerUpdates.js`. Incoming definitions change code, patterns and commands; they preserve existing local permissions. New resources receive factory defaults. Avoid replacing whole records with incoming payloads or old review snapshots.

Pending batches live in extension storage. `pendingUpdates.js` applies reviewed items; `reviewView.js` renders review UI. A lambda with a pending change is blocked by the executor until approved.

## UI and shared patterns

The workspace keeps view state in `workspace.js`. Pane layout, code editing, review rendering and HTML escaping have dedicated modules alongside it; look there before adding another implementation.

The website reuses the argument parser and shell UI through its build script. Changes to those sources need consideration of both the extension and demo.

## Compatibility map

| Retained behavior | Location and reason | Removal condition |
| --- | --- | --- |
| Missing storage IDs receive stable synthetic IDs until saved | `src/shared/storageRecords.js`; older records remain editable | Existing installations have a verified persistent-ID migration |
| Separate read/write world grants normalize to their intersection | `src/shared/accessPolicy.js`; combines older policy fields without widening access | Older records have been migrated without losing restrictions |
| Missing project names resolve to `default` during updates and review | `src/shared/functionUpdates.js`, `src/shared/triggerUpdates.js`, `src/pages/workspace/pendingUpdates.js`; retains identity for ungrouped resources | Existing ungrouped records and supported CLI payloads have a replacement migration |

Removal conditions are review criteria, not scheduled removals. This is an initial map of observed compatibility handling, not an exhaustive inventory; discuss breaking changes first.

## Build and tests

`scripts/build.js` generates the runtime module from `background/template.js`, minifies JavaScript/CSS without bundling, flattens public HTML pages to the build root and copies assets. The package version supplies the built manifest version.

Unit tests in `tests/` cover policy, records, modules and build behavior. E2E tests exercise the real extension with the CLI and local test pages. Commands and conventions live in [extension guidance](AGENTS.md) and [E2E guidance](e2e/AGENTS.md).
