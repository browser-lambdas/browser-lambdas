# Test ID strategy

Use stable, descriptive `data-testid` selectors for end-to-end tests when a semantic role or accessible name is not sufficient.

## Workspace sidebar

Workspace items use `sidebar-<category>-<element>`, where `<category>` is `functions`, `storage`, `secrets`, `triggers`, or `styles`, and `<element>` is:

- `add` — button that creates an item
- `item` — an existing list item; its stable identifier is stored in `data-id`

## Panes

Every pane exposes its stable identifier through `data-pane-id`. Current pane test IDs are:

- `pane` — pane container
- `pane-title` — editable title
- `pane-content` — editor area, with its type in `data-pane-type`
- `pane-save` — save button
- `pane-delete` — delete button
- `pane-key` — key input for secrets and storage
- `pane-value` — value input for secrets and storage

Prefer the pane's `data-pane-id` when a page contains multiple matching controls.

## In-page shell

The in-page UI currently exposes:

- `popup-menu` — shell container
- `popup-menu-status` — status or warning message
- `shell-position-button` — shell position control

Access controls: `secret-security` / `storage-security`, `secret-url-patterns` / `storage-url-patterns`. Settings toggles: `allow-main-world-secrets` / `allow-main-world-storage`. Scope pane selectors to the intended pane in split layouts.

Functions share `function-security` and `function-url-patterns`; `allow-main-world-functions` is the independent Settings toggle. `pane-world` selects the default world and does not grant execution permission.

Triggers share `trigger-security` and `trigger-url-patterns`; the latter edits the existing `patterns` field. Use `trigger-commands` for command text and `allow-main-world-triggers` for its independent Settings toggle. Avoid positional textarea selectors.

Security layout: `function-url-allowlist`, `storage-url-allowlist`, and `secret-url-allowlist` are switches for optional URL filtering. All item kinds expose switches named `Allow in user world` and `Allow in main world`. Functions expose `Code` as the editor label and `pane-world` inside Security. Trigger paths/commands precede Security and have no allowlist switch.

Editor refinements: `pane-settings` identifies the footer Settings gear for Code/K-V Value (action `toggle-editor-size`). Both editors open maximized; the gear reveals the compact form, with accessible names `Show settings` / `Hide settings`. `pane-category-icon` identifies the footer category icon. K-V switches use action `access-world` and `data-world="user_scripts"` or `"main"`; each controls reads and writes. URL filtering is labeled `Only allow on specific URLs` and defaults off, including when the stored flag is missing. Secrets open hidden. Code and storage have no Copy buttons.

All four security-bearing categories have a footer `pane-settings` gear. `aria-pressed="true"` means settings are visible and the gear remains green. Secrets/triggers hide only Security by default. Function Code and storage Value retain accessible labels but have no visible titles; their large editors fill the pane without outer padding.

K-V Value uses `.storage-code-box` with `.line-numbers`, `.code-highlight`, and the existing `pane-value` textarea. The textarea retains `.storage-value` and now shares `.code-editor` behavior. Its usage example has five rows and separate get/set sections.

Functions expose `[data-function-usage]` inside settings, updated from the current name/code and common `ctx.args.all()` argument access. Trigger patterns/commands and secret value/URL patterns use taller fields; trigger and secret textareas do not soft-wrap.

Usage boxes use five rows for functions/K-V and one for secrets, without a trailing blank row. Function shell examples use the `>` prompt; secret examples use `const secret`.

`item-settings-title` is the item settings heading, using the same category SVG as `pane-category-icon`. Hovering `[data-nav-tab]` selects that category persistently, updates the active link/hash without remounting open editors, and leaves item/add actions targeting the selected category.
