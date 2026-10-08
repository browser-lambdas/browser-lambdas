# Hack your browsing

With Browser Lambdas, your browsing experience is hackable in the best way possible: write lambda functions and execute them on the web to give yourself new tools, capabilities, and shortcuts.

It started as just functions but now also includes a mod’able shell, persistant key-value storage, secrets and URL based trigger automations.

Use it to work faster, reduce mental load, avoid clicks or just have fun. Track your stuff in git and sync with the extension via the CLI tool baah.

## How It Works

The intended flow is simple:

- Write a lambda function on your machine and track it with git.
- Sync it to the extension via `baah push`.
- Go to a page.
- Execute the function.

The extension keeps a copy of your function and injects it together with a small runtime into a JavaScript context associated with the target page. The runtime exposes APIs for key-value storage, secrets, and more through the async `ctx` object. These APIs establish secure channels between the extension background worker and the runtime.

Your function runs instantly and disappears when it’s done. It can manipulate the page DOM, open tabs, act on inputs, and more. Basically you are Neo now.

Continue to Hello world →

# Hello world

Quickstart introduction guide to the `baah` cli tool and running your first lambda function.

- Install the **Browser Lambdas** extension from the Chrome Web Store.
- Install `baah` with:
```
npm install -g baah
```

- Open the extension workspace in your browser and create a connection token at `Settings`→`Connection token`→`Create new`.
- Run `baah set chrome` and provide the token.
```
$ baah set chrome
Token (hidden):
✔ Added connection 'chrome'.
```

- Scaffold the hello-world example with:
```
baah init hello-world
```

```
✔ Created baah.toml
✔ Created functions/hello-world.js
✔ Project initialized at hello-world

Next:
cd 'hello-world'
baah push chrome
```

- Sync it with the extension:
```
baah push chrome
```

```
▶ Loading functions...
✔ Function loading complete
▶ Connecting to client...
✔ Client authenticated on ws://127.0.0.1:4455
✔ Push complete
```

- Open the workspace and approve the push.
- Go to a page.
- Open the shell with `Cmd+K` (or `Ctrl+K`) and run `hello-world`.

## Whats next?

Looks like you are ready to roam on your own.

Browser Lambdas is a powerful tool and it ships with some awesome capabilities not covered in this tutorial. It’s recommended to keep exploring on your own:

- baah CLI tool
- the `ctx` API (KV storage, secrets, tabs and more)

(or just throw the llms.txt at an agent and ask for shit):

- llms.txt

## Overview

The functions you write are just plain JavaScript functions. To spice things up you can use the `ctx` API to:

- Use key-value storage (KV) to read/write persisted values between function calls
- Read-only access secrets at runtime to make API requests
- Parse rich arguments to your functions (positional, flags etc)
- Run other lambda functions
- Manipulate tabs

The surface of the `ctx` object looks like this:

| Feature | API Examples | Purpose |
| --- | --- | --- |
| Arguments | `ctx.args.all()` | Read command‑line flags passed to a lambda |
| Storage | `ctx.kv.get()`, `ctx.kv.set()` | Persist values between lambdas |
| Secrets | `ctx.secrets.get()` | Access configured secrets |
| Run | `ctx.run("foo bar")`, `ctx.tabs.this().run()` | Execute another lambda on the current page |
| Tabs | `ctx.tabs.new()`, `ctx.tabs.all()` | Open, list and control browser tabs |

## Args

### `ctx.args.all()`

Returns an object with all command‑line arguments.

#### Positional arguments

```
my-lambda cats dogs
```

```
const { 0: first, 1: second } = ctx.args.all();
console.log(first, second);
```

#### Long flags

```
my-lambda --title "Hello" --count=5 --dry-run
```

```
const { title, count, dryRun } = ctx.args.all();
console.log(title, count, dryRun);
```

#### Short flags and aliases

```
my-lambda -u alice -p hunter2
```

```
const { username, password } = ctx.args.all({ u: 'username', p: 'password' });
console.log(username); // "alice"
console.log(password); // "hunter2"
```

## kv

Key-value map stored persistently in browser extension storage. Values are stored as JSON, so you can save plain strings or complex objects without stringifying.

### `ctx.kv.get(key)`

Fetches a value when the item allows the current page and execution world.

```
const value = await ctx.kv.get("my-key");
console.log(value);
```

Missing or denied keys return `null` with a shell warning. A stored null also returns null, without a warning.

### `ctx.kv.set(key, value)`

Stores a JSON-compatible value and returns `true` when allowed, or `false` with a warning when blocked.

```
await ctx.kv.set("my-key", "hello");
```

You can store objects too:

```
const snippet = { url: location.href, text: window.getSelection().toString() };
await ctx.kv.set("last-snippet", snippet);

// later on another page
const saved = await ctx.kv.get("last-snippet");
console.log(saved.text);
```

## Secrets

### `ctx.secrets.get(key)`

Read-only access to a secret added via the extension workspace.

```
const token = await ctx.secrets.get("API_KEY");
const res = await fetch("https://api.example.com", {
headers: { Authorization: `Bearer ${token}` }
});
console.log(await res.json());
```

## Run

### `ctx.run(cmd)`

Runs another lambda on the current page. Provide the full command exactly as you would type it in the shell.

```
await ctx.run("other-lambda arg1 arg2");
```

## Tabs

### `ctx.tabs.new(url?)`

Opens a new tab with the specified URL.

```
await ctx.tabs.new("https://example.com");
```

### `ctx.tabs.new().run(lambda, args?)`

Opens a new tab and runs a lambda inside it.

```
await ctx.tabs.new("https://example.com").run("scrapetool --include-metatags");
```

### `ctx.tabs.new().focus()`

Brings a newly opened tab into focus.

```
const tab = await ctx.tabs.new("https://example.com");
await tab.focus();
```

### `ctx.tabs.new().close()`

Closes a newly opened tab after you're done with it.

```
const tab = await ctx.tabs.new();
await tab.close();
```

### `ctx.tabs.this().run(cmd)`

Runs a lambda on the current tab. This is synonymous with `ctx.run()`.

```
await ctx.tabs.this().run("other-lambda arg1");
```

### `ctx.tabs.all()`

Returns wrappers for all open tabs.

```
const tabs = await ctx.tabs.all();
for (const tab of tabs) {
console.log(tab.title);
}
```

# `baah`

Functions, triggers and styles should all be tracked in git on your machine. To sync them and run with the extension you need to use the CLI tool `baah`.

In short it:

- A `baah.toml` file is used to decide what files get synced.
- `baah push` starts a server waiting for connected browsers.
- When the extension workspace is open it polls the changes.
- You approve the diff.
- Ready to go.

## Connections

The `baah` CLI tool revolves around two resources: `connections`, which are individual authenticated connections to browsers on your machine, and `baah.toml` files with instructions for syncing a project through those established connections.

```
npm install -g baah
```

## Commands

```
$ baah --help
Usage:
baah init [path]                 Set up a project and browser connection
[--template minimal|starter] [--skills|--no-skills] [--skip-connection]
baah set <name> [--token TOKEN] [--port PORT]
Save a named connection to your browser extension
baah ls                          List saved connections
baah rm <name>                   Remove a saved connection
baah push <name>                 Push using a saved connection
```

## `baah init .`

Use `baah init` to scaffold a project. If zero connections are found it will ask to create one (optional).

```
$ baah init my-lambdas
Choose a template:
1. Minimal — baah.toml only
2. Starter — baah.toml, functions/hello-world.js
Template [1]: 1
Include agent skills in .agents/skills/? [y/N]: n
No browser connections yet
Set up a new browser connection?
- yes
- no
Choose [Y/n]: y
Name new connection (e.g. chrome, work): chrome
Open extension → Settings → Connection token → create a new token or reuse the existing one. Click to copy the token and paste it below (input is hidden).
token:
Use default port for updates (4455)?
- yes (recommended)
- no
Choose [Y/n]: y
✔ Added connection 'chrome'.
✔ Created baah.toml
✔ Project initialized at /path/to/my-lambdas

Next:
cd '/path/to/my-lambdas'
Add your lambdas under functions/.
baah push chrome
```

## `baah set`

Single command to create or update connections. If you change the default port remember to also change it in the connected browser.

```
$ baah set chrome
Token (hidden): <entered token is hidden>
✔ Added connection 'chrome'.

$ baah set chrome --token TOKEN --port 4455
✔ Updated connection 'chrome'.

$ baah set chrome --port 3333
✔ Updated connection 'chrome'.
```

## `baah push`

Starts a server that waits for the workspace to connect. Then it syncs your project with the extension’s storage according to your `baah.toml` file.

```
$ baah push chrome
▶ Loading functions...
✔ Function loading complete
▶ Connecting to client...
✔ Client authenticated on ws://127.0.0.1:4455
✔ Push complete
```

## `baah ls`

List all connections.

```
$ baah ls
Saved baah connections:
• chrome (port 4455)
• safari (port 4455)
```

## `baah rm`

Remove a single connection.

```
$ baah rm chrome
Removed connection 'chrome'.
```

## `baah.toml`

Use the `include` and `exclude` globs to select what files are pushed and synced with your browser.

```
[project]
name = "my-project"

[functions]
include = ["functions/**/*.js"]
exclude = ["functions/**/*.test.js", "functions/**/__*__/*"]

[styles]
include = ["styles/**/*.css"]

[triggers]
include = ["triggers/**/*.yaml"]
```
