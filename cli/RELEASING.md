# Publishing baah

The `Publish baah` GitHub workflow publishes from `cli/` when a tag such as
`baah-v0.1.1` is pushed. It checks the tag against both package files, runs CLI
tests, and installs a packed copy to verify the executable and starter template.
Only stable versions are supported; prerelease tags fail before publishing.

## One-time setup

1. Review the package metadata and MIT license before the first public release.
2. Merge the workflow and package changes. Use Node.js 24 locally for setup.
3. If `baah` has never been published, publish the initial version from `cli/`:

   ```sh
   cd cli
   npm ci
   npm test
   npm run test:package
   npm login
   npm publish --access public
   ```

   This publishes the actual initial package (currently `0.1.0`). Your npm
   account must own the package name. Do not subsequently push a release tag
   for this same version: npm versions cannot be published twice.

4. In npm's package settings, add a GitHub Actions trusted publisher:

   - Organization/user: `browser-lambdas`
   - Repository: `browser-lambdas`
   - Workflow filename: `publish-baah.yml`
   - Environment: leave blank (the workflow does not use one)
   - Allow direct publishing with `npm publish`

   No npm token or GitHub secret is needed. Complete the first CI publish within
   two days of creating the trusted publisher, or recreate it if it expires.
   See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

## Subsequent releases

Update the version from the repository root, for example:

```sh
cd cli
npm version patch --no-git-tag-version
cd ..
```

Commit both `cli/package.json` and `cli/package-lock.json`, then merge through
the normal PR checks. From that merged commit, tag the matching version:

```sh
git tag -a baah-v0.1.1 -m "baah 0.1.1"
git push origin baah-v0.1.1
```

Replace `0.1.1` with the version in `cli/package.json`. Follow the `Publish baah`
run in GitHub Actions. A successful run publishes that version to npm's `latest`
tag. If publishing fails, inspect the error before retrying; if the version
already reached npm, use a new version instead of moving or reusing its tag.
