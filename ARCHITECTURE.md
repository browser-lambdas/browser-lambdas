# Architecture

Browser Lambdas makes browsing programmable. Users write JavaScript lambdas, sync them from local projects with baah, and run them on web pages through a customizable shell or URL triggers.

It is expert tooling for building personal tools, automations and shortcuts, with storage, secrets and tab APIs. Safe defaults protect users while granular controls let them deliberately grant more freedom.

Browser Lambdas has three parts: `cli/` manages local projects and pushes updates, `extension/` stores and executes them, and `web/` documents the tools and provides a browser demo.

## CLI → extension

See [CLI architecture](cli/ARCHITECTURE.md) for command ownership, project discovery, scaffolding and connection storage.

1. `baah init` scaffolds a project. `baah.toml` selects its functions, styles and triggers.
2. The user creates a connection token in extension Settings and saves it as a named CLI connection with `baah set`.
3. `baah push <connection>` reads the project and starts a WebSocket **server** on `127.0.0.1`, using the saved port (default `4455`).
4. An open extension page running sync connects as the **client**. Settings starts sync; the workspace does so when its polling setting is enabled. A storage lock coordinates ownership between pages.
5. Both sides authenticate using the shared token and a nonce-based HMAC challenge/response. Directional session keys encrypt subsequent messages with AES-GCM; sequence checks reject out-of-order messages.
6. The CLI sends a batch: project, resource manifest, counts, resource contents and an end marker. The manifest also identifies project resources removed locally.
7. Review is enabled by default. The extension stages the batch for user approval and acknowledges `pending-review`; disabling review permits direct application. CLI push success therefore does not necessarily mean changes are applied.

The protocol has two implementations: [CLI transport](cli/baah.js) and [extension sync](extension/src/shared/baahSync.js). Changes to message formats, authentication or acknowledgements must account for both, including compatibility with older installed versions.

Pending changes are stored in extension storage and applied through the workspace review flow. See [review application](extension/src/pages/workspace/pendingUpdates.js) and [batch storage](extension/src/shared/storage.js).

## Extension → page

See [extension architecture](extension/ARCHITECTURE.md) for internal ownership, data updates and the initial compatibility map.

The Manifest V3 service worker handles execution and privileged operations. Ordered content scripts connect it to pages; extension pages provide the workspace, settings, popup and shell UI.

Shell commands and URL triggers reach background execution, which resolves the lambda and checks access policy. It injects the lambda with the generated `ctx` runtime into the target tab, normally in `USER_SCRIPT` world. Main-world execution requires explicit permission.

The runtime communicates through the content-script bridge to background handlers for storage, secrets and other privileged APIs. Page content and lambda execution contexts are distinct from trusted extension controls; granting access must remain a user decision.

Each invocation gets a fresh session key and rendezvous tokens from the background worker. The runtime is injected with these values; the worker separately sends them to the content script through extension messaging.

The content script and runtime rendezvous through `window.postMessage` using matching tokens and a handshake ID, then transfer a `MessageChannel` port. The runtime, in-page popup menu and shell share [one authenticated channel protocol](extension/src/shared/secureChannel.js), embedded into the runtime at build time. It derives directional AES-GCM keys, exchanges encrypted proofs and binds packets to their session, purpose, direction and sequence. Session keys never travel through the window rendezvous.

Failed authentication, invalid ciphertext, replay and reordering stop application traffic and close the port, with a bounded encrypted failure notification to the peer. Handshakes have deadlines; running lambdas have no execution timeout. Establishing this channel does not replace access-policy checks or isolate main-world JavaScript from page API manipulation.

Start with [execution](extension/src/background/executeLambda.js), [runtime source](extension/src/background/template.js), [content messages](extension/src/content/messages.js) and [access policy](extension/src/shared/accessPolicy.js). Resource data and settings live in `chrome.storage.local`.

## Website and documentation

See [website architecture](web/ARCHITECTURE.md) for navigation, generated exports and the demo adapter.

`web/index.html` is the user-facing syntax and API guide. `web/build.sh` generates Markdown and `llms.txt` exports plus browser data for the documentation viewer.

The website demo reuses the extension argument parser and shell UI through generated `demo-shell-ui.js`, adapting element names to avoid collisions. It is a demo, not the installed extension's privileged runtime. Changes to those shared sources can affect both products.

## Builds and verification

The extension build minifies static source without bundling classic scripts, generates the runtime template and manifest, and copies assets into `extension/build/`. Generated files are outputs, not editing targets.

E2E tests connect the real CLI, unpacked extension and locally served test pages. They verify complete workflows through push, review, execution and observable effects. See [E2E guidance](extension/e2e/AGENTS.md) for conventions and [extension guidance](extension/AGENTS.md) for commands.

## Compatibility map

Record shims and migrations here or in a linked local architecture note: retained behavior, reason, implementation location and removal conditions. This map has not yet been inventoried; absence of an entry does not imply that compatibility code is absent.
