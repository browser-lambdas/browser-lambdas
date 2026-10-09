import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "baah-package-"));
const run = (command, args, cwd = temporary) => execFileSync(command, args, {
  cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
});

try {
  const [packed] = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", temporary], root));
  const paths = packed.files.map((file) => file.path);
  for (const required of ["package.json", "README.md", "LICENSE", "baah.js", "init.js", "templates/browser-lambdas/SKILL.md"]) {
    assert.ok(paths.includes(required), `Package is missing ${required}`);
  }
  assert.ok(paths.every((file) => ["package.json", "README.md", "LICENSE", "baah.js", "init.js"].includes(file) || file.startsWith("templates/")), "Unexpected package contents");
  const prefix = path.join(temporary, "installed");
  run("npm", ["install", "--global", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", path.join(temporary, packed.filename)]);
  const executable = path.join(prefix, "bin", "baah");
  assert.match(run(executable, ["--help"]), /Usage:/);
  run(executable, ["init", "project", "--template", "starter", "--skills", "--skip-connection"]);
  for (const file of ["baah.toml", "functions/hello-world.js", ".agents/skills/browser-lambdas/SKILL.md"]) {
    assert.ok(fs.statSync(path.join(temporary, "project", file)).size > 0, `Missing generated ${file}`);
  }
  console.log(`Package installation and initialization passed: ${packed.filename}`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
