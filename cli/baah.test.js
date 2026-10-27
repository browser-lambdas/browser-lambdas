import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadAllFunctions, loadTriggerFile, isAllowedOrigin } from "./baah.js";
import toml from "toml";

function isolatedHome(dir) {
  return { BAAH_TEST_HOME: dir, XDG_CONFIG_HOME: dir, APPDATA: dir,
    NODE_OPTIONS: `--import=${new URL("./test-home.js", import.meta.url).href}` };
}
function connectionPath(dir) {
  return path.join(dir, ...(process.platform === "darwin" ? ["Library", "Application Support"] : []), "baah", "connections.json");
}

test("init terminal onboarding saves a hidden global token and supports cancellation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "baah-terminal-"));
  const terminal = (steps, ...args) => {
    const result = spawnSync("python3", [fileURLToPath(new URL("./terminal-test.py", import.meta.url)), JSON.stringify(steps), process.execPath,
      fileURLToPath(new URL("./baah.js", import.meta.url)), "init", ...args], {
      cwd: dir, env: { ...process.env, ...isolatedHome(dir) }, encoding: "utf8", timeout: 20000,
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  try {
    const cancelled = terminal([["Template [1]: ", "\u0003"]], "cancelled");
    assert.notEqual(cancelled.code, 0);
    assert.match(cancelled.output, /cancelled/i);
    assert.equal(fs.existsSync(path.join(dir, "cancelled")), false);
    const tokenCancelled = terminal([
      ["Choose [Y/n]: ", "yes\n"], ["Name new connection (e.g. chrome, work): ", "chrome\n"], ["token: ", "\u0003"],
    ], "token-cancelled", "--template", "minimal", "--no-skills");
    assert.notEqual(tokenCancelled.code, 0);
    assert.equal(fs.existsSync(connectionPath(dir)), false);
    assert.equal(fs.existsSync(path.join(dir, "token-cancelled")), false);
    const skipped = terminal([["Choose [Y/n]: ", "no\n"]], "offline", "--template", "minimal", "--no-skills");
    assert.equal(skipped.code, 0, skipped.output);
    assert.equal(fs.existsSync(connectionPath(dir)), false);
    assert.ok(fs.existsSync(path.join(dir, "offline/baah.toml")));
    const defaults = terminal([
      ["Choose [Y/n]: ", "yes\n"], ["Name new connection (e.g. chrome, work): ", "chrome\n"],
      ["token: ", "dummy-default-token\n"], ["Choose [Y/n]: ", "yes\n"],
    ], "defaults", "--template", "minimal", "--no-skills");
    assert.equal(defaults.code, 0, defaults.output);
    assert.ok(!defaults.output.includes("dummy-default-token"));
    assert.deepEqual(JSON.parse(fs.readFileSync(connectionPath(dir), "utf8")), { chrome: { token: "dummy-default-token", port: 4455 } });
    fs.unlinkSync(connectionPath(dir));
    const result = terminal([
      ["Template [1]: ", "2\n"], ["[y/N]: ", "y\n"],
      ["Choose [Y/n]: ", "yes\n"], ["Name new connection (e.g. chrome, work): ", "work\n"],
      ["token: ", "dummy-private-token\n"], ["Choose [Y/n]: ", "no\n"],
      ["Port: ", "0\n"], ["Port: ", "4567\n"],
    ], "nested/project");
    assert.equal(result.code, 0, result.output);
    assert.ok(!result.output.includes("dummy-private-token"));
    assert.match(result.output, /baah push work/);
    assert.deepEqual(JSON.parse(fs.readFileSync(connectionPath(dir), "utf8")), { work: { token: "dummy-private-token", port: 4567 } });
    assert.ok(fs.existsSync(path.join(dir, "nested/project/functions/hello-world.js")));
    const second = terminal([["Template [1]: ", "1\n"], ["[y/N]: ", "n\n"]], "second");
    assert.equal(second.code, 0, second.output);
    assert.ok(!second.output.includes("token: "));
    assert.deepEqual(fs.readdirSync(path.join(dir, "second")), ["baah.toml"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("init scaffolds templates, preserves files, and checks global connections", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "baah-init-"));
  const run = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL("./baah.js", import.meta.url)), ...args], {
    cwd: dir, env: { ...process.env, ...isolatedHome(dir), BAAH_CONFIG_HOME: path.join(dir, "ignored") }, encoding: "utf8",
  });
  try {
    let result = run("init", "nested/minimal", "--template", "minimal", "--no-skills");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /No browser connection saved/);
    assert.equal(fs.existsSync(path.join(dir, "nested")), false);
    result = run("init", "nested/minimal", "--template", "minimal", "--no-skills", "--skip-connection");
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.readdirSync(path.join(dir, "nested/minimal")), ["baah.toml"]);
    assert.equal(toml.parse(fs.readFileSync(path.join(dir, "nested/minimal/baah.toml"), "utf8")).project.name, "minimal");
    assert.equal(run("set", "work", "--token", "dummy-token").status, 0);
    assert.equal(run("init", "--template", "minimal", "--no-skills").status, 0);
    assert.ok(fs.existsSync(path.join(dir, "baah.toml")));
    assert.equal(fs.existsSync(path.join(dir, "ignored")), false);
    result = run("init", "starter", "--template", "starter", "--skills");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /baah push work/);
    assert.ok(!result.stdout.includes("dummy-token"));
    for (const entry of ["functions/hello-world.js", ".agents/skills/browser-lambdas/SKILL.md"]) {
      assert.ok(fs.existsSync(path.join(dir, "starter", entry)));
    }
    const config = path.join(dir, "starter/baah.toml");
    for (const entry of ["triggers", "styles"]) {
      assert.equal(fs.existsSync(path.join(dir, "starter", entry)), false);
      assert.equal(toml.parse(fs.readFileSync(config, "utf8"))[entry], undefined);
    }
    const hello = path.join(dir, "starter/functions/hello-world.js");
    fs.writeFileSync(config, "# customized\n");
    fs.writeFileSync(hello, "console.log('custom');\n");
    assert.equal(run("init", "starter", "--template", "starter", "--skills").status, 0);
    assert.equal(fs.readFileSync(config, "utf8"), "# customized\n");
    assert.equal(fs.readFileSync(hello, "utf8"), "console.log('custom');\n");
    for (const args of [["--template", "invalid"], ["--skills", "--no-skills"], ["a", "b"]]) {
      assert.notEqual(run("init", ...args).status, 0);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loads function bundles without execution-world protocol metadata", async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "baah-world-test-"));
  try {
    const file = path.join(project, "inspect.js");
    fs.writeFileSync(file, "console.log('inspect');", "utf8");
    const bundles = await loadAllFunctions([file]);
    assert.deepEqual(bundles, [{ filename: "inspect.js", bundle: "console.log('inspect');" }]);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});


test("connection commands persist, update, list and remove credentials without exposing tokens", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "baah-connections-"));
  const run = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL("./baah.js", import.meta.url)), ...args], {
    cwd: dir, env: { ...process.env, ...isolatedHome(dir) }, encoding: "utf8",
  });
  const read = () => JSON.parse(fs.readFileSync(connectionPath(dir), "utf8"));
  try {
    assert.match(run("ls").stdout, /baah set <name>/);
    for (const name of ["work", "chrome", "__proto__"]) {
      const result = run("set", name, "--token", "test-secret");
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Added connection/);
      assert.ok(!`${result.stdout}${result.stderr}`.includes("test-secret"));
      assert.deepEqual(read()[name], { token: "test-secret", port: 4455 });
    }
    assert.match(run("set", "chrome", "--token", "replacement").stdout, /Updated connection/);
    assert.equal(read().chrome.token, "replacement");
    const updated = run("set", "chrome", "--port", "3333");
    assert.equal(updated.status, 0, updated.stderr);
    assert.deepEqual(read().chrome, { token: "replacement", port: 3333 });
    assert.equal(run("set", "chrome", "--token", "replacement").status, 0);
    assert.equal(read().chrome.port, 3333);
    assert.equal(run("push", "chrome").status, 0);
    assert.match(run("push").stderr, /Usage: baah push <name>/);
    assert.match(run("push", "missing").stderr, /Connection 'missing' not found/);
    const listed = run("ls");
    assert.equal(listed.status, 0);
    for (const args of [[], ["--help"], ["-h"]]) {
      const help = run(...args);
      assert.equal(help.status, 0);
      assert.match(help.stdout, /Save a named connection/);
      assert.match(help.stdout, /baah push <name>/);
      assert.match(help.stdout, /baah info <name>/);
      assert.equal(help.stderr, "");
    }
    assert.equal(listed.stdout, " • __proto__\n • chrome\n • work\n");
    for (const [name, port] of [["chrome", 3333], ["work", 4455], ["__proto__", 4455]]) {
      const info = run("info", name);
      assert.equal(info.status, 0, info.stderr);
      assert.equal(info.stdout, `Push listener: ws://127.0.0.1:${port}\n`);
      assert.ok(!/test-secret|replacement/.test(info.stdout + info.stderr));
    }
    const missing = run("info", "missing");
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /Connection 'missing' not found\. Run baah set missing first\./);
    assert.equal(missing.stdout, "");
    assert.notEqual(run("info", "toString").status, 0);
    for (const args of [["info"], ["info", "--help"], ["info", "chrome", "extra"]]) {
      const result = run(...args);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Usage: baah info <name>/);
    }
    for (const args of [["set"], ["rm"], ["ls", "extra"], ["unknown"], ["init", "extra"], ["push", "chrome", "extra"], ["set", "chrome", "--token"], ["set", "chrome", "--token", ""], ["set", "chrome"]]) {
      assert.notEqual(run(...args).status, 0, args.join(" "));
      assert.equal(read().chrome.token, "replacement");
    }
    for (const port of ["0", "65536", "-1", "3.3", "3333abc", "", "1e3"]) {
      const result = run("set", "chrome", "--port", port);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Port must be an integer/);
      assert.deepEqual(read().chrome, { token: "replacement", port: 3333 });
    }
    for (const args of [["--port"], ["--port", "3333", "--port", "4444"], ["--unknown", "value"]]) {
      assert.notEqual(run("set", "chrome", ...args).status, 0);
      assert.equal(read().chrome.port, 3333);
    }
    assert.equal(run("set", "edge", "--port", "65535", "--token", "edge-secret").status, 0);
    assert.equal(read().edge.port, 65535);
    fs.writeFileSync(path.join(dir, "baah.toml"), "not valid toml [");
    assert.equal(run("ls").status, 0);
    assert.equal(run("info", "chrome").status, 0);
    assert.equal(run("set", "edge", "--port", "1").status, 0);
    assert.match(run("rm", "chrome").stdout, /Removed connection/);
    assert.equal(read().chrome, undefined);
    assert.deepEqual(read().work, { token: "test-secret", port: 4455 });
    assert.match(run("rm", "chrome").stdout, /not found/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("connection listings and details report invalid stores without exposing tokens or changing data", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "baah-connection-info-"));
  const run = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL("./baah.js", import.meta.url)), ...args], {
    cwd: dir, env: { ...process.env, ...isolatedHome(dir) }, encoding: "utf8",
  });
  try {
    const missing = run("info", "chrome");
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /Connection 'chrome' not found/);
    const file = connectionPath(dir);
    for (const [content, error] of [
      ['{"chrome":{"token":"private-token"', /Unable to read connection store/],
      [JSON.stringify({ chrome: { token: "private-token", port: 0 } }), /Invalid connection store/],
    ]) {
      fs.writeFileSync(file, content);
      for (const args of [["ls"], ["info", "chrome"]]) {
        const result = run(...args);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, error);
        assert.equal(result.stdout, "");
        assert.ok(!result.stderr.includes("private-token"));
        assert.equal(fs.readFileSync(file, "utf8"), content);
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("loads trigger patterns in scalar, inline and block forms", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "baah-triggers-"));
  const file = path.join(dir, "example.yaml");
  try {
    for (const patterns of ['patterns: "https://example.com/*"', 'patterns: ["https://example.com/*"]', 'patterns:\n  - "https://example.com/*"']) {
      fs.writeFileSync(file, `${patterns}\ncommands: hello\n`);
      assert.deepEqual(loadTriggerFile(file), { name: "example", patterns: ["https://example.com/*"], commands: ["hello"] });
    }
    t.mock.method(console, "error", () => {});
    fs.writeFileSync(file, "unsupported: value\ncommands: hello\n");
    assert.equal(loadTriggerFile(file), null);
    assert.match(console.error.mock.calls[0].arguments[1], /unsupported trigger field/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("push aborts before sync when any trigger fails to load or parse", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "baah-invalid-triggers-"));
  const run = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL("./baah.js", import.meta.url)), ...args], {
    cwd: dir, env: { ...process.env, ...isolatedHome(dir) }, encoding: "utf8", timeout: 5000,
  });
  try {
    assert.equal(run("set", "test", "--token", "test-private-token").status, 0);
    fs.mkdirSync(path.join(dir, "triggers"));
    const invalid = path.join(dir, "triggers/invalid.yaml");
    for (const content of ["unsupported: value\n", "  invalid syntax\n", "name: [invalid]\n", "#".repeat(1024 * 1024 + 1)]) {
      fs.writeFileSync(invalid, content);
      for (const mixed of [false, true]) {
        const valid = path.join(dir, "triggers/valid.yaml");
        if (mixed) fs.writeFileSync(valid, "patterns: https://example.com/*\ncommands: hello\n");
        const result = run("push", "test");
        assert.equal(result.error, undefined);
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /Failed to parse trigger.*invalid\.yaml/);
        assert.match(result.stderr, /Push aborted:.*no changes were sent/);
        assert.ok(!`${result.stdout}${result.stderr}`.includes("test-private-token"));
        if (mixed) fs.unlinkSync(valid);
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loads commented trigger files in scalar, inline and block forms", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "baah-commented-triggers-"));
  try {
    const forms = [
      'patterns: "https://example.com/*" # page match\ncommands: hello # command',
      'patterns: ["https://example.com/*"] # page match\ncommands: ["hello"] # commands',
      'patterns: # page matches\n  - "https://example.com/*" # page match\ncommands: # commands\n  - hello # command',
    ];
    for (const content of forms) {
      const file = path.join(dir, "commented.yaml");
      fs.writeFileSync(file, `# Trigger configuration\n${content}\n`);
      assert.deepEqual(loadTriggerFile(file), {
        name: "commented", patterns: ["https://example.com/*"], commands: ["hello"],
      });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("sync accepts only Chrome extension origins", () => {
  assert.equal(isAllowedOrigin("chrome-extension://test-extension"), true);
  for (const origin of [undefined, "", "https://example.com", "http://localhost:4455", "other-extension://test-extension", "null"]) {
    assert.equal(isAllowedOrigin(origin), false);
  }
});
