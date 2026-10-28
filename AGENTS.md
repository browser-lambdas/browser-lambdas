# Working in browser-lambdas

## Scope

- `extension/`: browser extension and its runtime.
- `cli/`: the `baah` CLI.
- `web/`: website and documentation.
- See `ARCHITECTURE.md` for how the CLI, extension and website fit together, especially sync and execution flows.
- Before writing a lambda function, check `web/index.html` for syntax guidance.
- Read applicable nested `AGENTS.md` files before editing their directories. They refine this guidance for their scope.

## Collaboration

- Always highlight: “What’s the default behavior?” and “What if it goes wrong or does not work?”
- Work in the requested step. We usually make it work, refine the code, performance and UI, then update documentation in a separate step.
- Make routine implementation decisions independently. Ask one or two focused questions when intent is unclear or a choice materially changes behavior, scope or design.
- Briefly highlight unrelated bugs or improvements; leave them for the user to decide. The user creates issues; agents do not file them. Leave fixes for a separate task.
- Use subagents when there are clear, independent domains and the benefit justifies their token and coordination cost. Keep closely related work together.

## User safety

- Prefer static JavaScript, HTML and CSS wherever possible. Keep dependencies to an absolute minimum to reduce supply chain risk.
- Build expert tooling with safe defaults that users can deliberately relax.
- Support settings at resource, project and global levels. Unset values inherit from the parent level, falling back to the built-in safe default. Security safeguards are ceilings: lower levels may restrict access, never override a higher-level block. For other settings, the most specific explicit value wins.
- Only explicit user choices through trusted controls may relax safeguards. Malicious actors or untrusted content must not make that choice for users.

## Browser access

- Never launch, inspect, attach to, or control the user's personal browser, profiles, tabs, or installed extensions. Do not request access to them as a fallback.
- Use Codex's in-app browser or a separate automation browser with a fresh, isolated profile for browser work. Never reuse the user's browser profile.
- If an agent-owned browser cannot perform a check, report the limitation and leave that check to the user. This rule applies to all nested instructions and browser tooling.

## Code

- Look for existing implementations and patterns before introducing new ones. Reuse or refactor them when appropriate.
- Consult relevant `ARCHITECTURE.md` files for patterns and flows. Keep them current as code evolves, including useful refactors; user-facing documentation comes in a separate step.
- Larger refactors are welcome when they make existing code cleaner and clearer. Keep them relevant to the requested work.
- Abstract real patterns. Avoid unrequested features, speculative extension points and infrastructure for hypothetical future needs.
- Keep comments sparse. Explain non-obvious reasons or constraints; do not narrate the code.

## Writing

- Keep documentation super concise. Match `web/index.html`: usually one or two short sentences per paragraph, with examples where useful.
- Remove padding and repetition. Do not expand documentation beyond the requested step.
- Keep updates and final responses brief, with relevant results and limitations.

## Verification and token use

- Plan for compact tool output from the start. Search narrowly and read only the relevant files or excerpts.
- Frequently run scripts, including test runners, should support quiet execution with detailed output in a temporary log. Preserve failure exit codes and report the result and log path briefly.
- For existing noisy commands, redirect output to a temporary log. Search it for relevant failures and read bounded excerpts instead of dumping it into the conversation.
- Run focused checks during implementation. Run the full suite only at the final verification stage, before claiming done.
- Inspect UI changes only in an agent-owned browser, following Browser access above. If unavailable, state that visual verification remains for the user.
- If a required check cannot run or fails, state that clearly; do not claim verified completion.

## Git

- Git operations are read-only. Inspection commands such as `status`, `diff`, `log` and `show` are allowed.
- Do not stage, commit, push, switch or create branches, stash, reset, restore, clean, merge, rebase, tag, or otherwise mutate Git state or configuration.
- Normal project file edits are allowed. Editing `.gitignore` is the only allowed write to Git-related configuration; do not edit `.git/`.
