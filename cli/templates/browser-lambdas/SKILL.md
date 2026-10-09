---
name: browser-lambdas
description: Write and update functions, styles, triggers, and baah.toml in a Browser Lambdas project. Use for browser automation lambdas and their CLI project configuration.
---

# Browser Lambdas projects

Read the project's baah.toml before editing. Its include/exclude patterns select files for pushing; absent patterns default to functions/**/*.js, styles/**/*.css, and triggers/**/*.yaml. A function file's basename without .js is its shell command name. Avoid duplicate basenames across folders.

Function files contain JavaScript bodies, not Node.js programs or exported modules. The extension wraps them in an async runtime, so top-level await is available. Use console.log and console.warn for shell output; a return value does not automatically print. Example:

```js
const heading = document.querySelector('h1');
console.log(heading?.textContent || 'No heading found');
```

Use ctx.log.info, ctx.log.dbg, and ctx.log.err for Activity entries. Use await ctx.kv.get(key) and await ctx.kv.set(key, value) for persistent JSON-compatible data, await ctx.secrets.get(key) for configured secrets, and await ctx.run('other-function args') for nested calls. Secret access depends on URL and execution-world permissions configured in the extension. Do not embed credentials in project files.

Functions default to USER_SCRIPT. Select MAIN in the extension workspace or invoke @main-world command when page-owned JavaScript is needed; @user-world command explicitly selects the isolated world. baah.toml and CLI pushes cannot select execution worlds.

Triggers use the supported YAML subset: name (optional), patterns, and commands. Patterns and commands accept scalar strings or lists. For example:

```yaml
name: greet
patterns: ["https://example.com/*"]
commands: ["hello-world"]
```

Styles are shell-theme CSS, not arbitrary host-page styles. Inspect existing project examples before extending them.

Named connections are saved separately from project files. baah set chrome configures a browser connection; baah push chrome sends the selected project files. Pushes may require review in the extension. A push can remove previously synced files omitted from the current project manifest; inspect include/exclude changes before pushing. Only push when the user requests it.
