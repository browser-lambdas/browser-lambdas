# baah

Push local JavaScript, CSS, and triggers to the Browser Lambdas extension.
Requires Node.js 24 or newer and the [Browser Lambdas extension](https://github.com/browser-lambdas/browser-lambdas/tree/main/extension).

```sh
npm install --global baah
baah init my-project
cd my-project
baah push chrome
```

`baah init` helps you choose a project template and save a browser connection.
Use the connection token from the extension's settings when prompted.
If you choose a different connection name, use that name with `baah push`.

To create a project without connecting a browser yet:

```sh
baah init my-project --template starter --skills --skip-connection
```

Run `baah --help` for all commands.
