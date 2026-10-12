import assert from "node:assert/strict";
import test from "node:test";
import { releaseVersion } from "./release-version.js";

function check(before, after, lockVersion = after, rootVersion = after) {
  return releaseVersion({ version: before }, { name: "@browser-lambdas/baah", version: after }, {
    version: lockVersion, packages: { "": { version: rootVersion } },
  });
}

test("unchanged version does not publish", () => {
  assert.equal(check("0.1.0", "0.1.0"), null);
});

test("patch, minor and major bumps publish; comparison is numeric", () => {
  for (const [before, after] of [["0.1.0", "0.1.1"], ["0.1.9", "0.2.0"], ["0.9.9", "1.0.0"], ["0.1.9", "0.1.10"]]) {
    assert.equal(check(before, after), after);
  }
});

test("downgrades, prereleases and malformed versions fail", () => {
  for (const version of ["0.0.9", "0.1.1-beta.1", "0.1.1+build", "01.2.3", "1.2", "1.2.3\ninjected=true"]) {
    assert.throws(() => check("0.1.0", version));
  }
});

test("both lockfile versions must match", () => {
  assert.throws(() => check("0.1.0", "0.1.1", "0.1.0"), /Lockfile version/);
  assert.throws(() => check("0.1.0", "0.1.1", "0.1.1", "0.1.0"), /Lockfile root/);
});
