import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function releaseVersion(previous, pkg, lock) {
  if (previous.version === pkg.version) return null;
  const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  assert.match(pkg.version, stable, "Only stable releases are supported");
  assert.match(previous.version, stable, "Previous version must be stable");
  const current = pkg.version.split(".").map(BigInt);
  const before = previous.version.split(".").map(BigInt);
  const difference = current.findIndex((part, index) => part !== before[index]);
  assert.ok(difference >= 0 && current[difference] > before[difference], "Version must increase");
  assert.equal(pkg.name, "baah", "Unexpected package name");
  assert.equal(lock.version, pkg.version, "Lockfile version must match");
  assert.equal(lock.packages[""].version, pkg.version, "Lockfile root version must match");
  return pkg.version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.match(process.env.BEFORE_SHA || "", /^[0-9a-f]{40}$/, "Missing previous main commit");
  const previous = JSON.parse(execFileSync("git", ["show", `${process.env.BEFORE_SHA}:cli/package.json`], { encoding: "utf8" }));
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url)));
  const lock = JSON.parse(fs.readFileSync(new URL("../package-lock.json", import.meta.url)));
  const version = releaseVersion(previous, pkg, lock);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${version !== null}\nversion=${version || ""}\n`);
  console.log(version ? `Release baah ${version}` : "baah version unchanged; skipping release");
}
