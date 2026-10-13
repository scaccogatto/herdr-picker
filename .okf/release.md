---
type: Runbook
title: Release versioning and publication
description: Steps to cut a release, what the tag-triggered workflow does, npm trusted publishing, and the Chrome Web Store upload
tags: [release, versioning, npm, chrome-web-store, conventional-commits, runbook]
generated:
  by: claude/opus-5-5
  at: 2026-10-13
status: stable
sources:
  - resource: ../CHANGELOG.md
  - resource: ../package.json
  - resource: ../extension/manifest.json
  - resource: ../.github/workflows/release.yml
  - resource: ../.github/workflows/ci.yml
---

## Cutting a release

Released so far: `v0.1.0` and `v0.1.1` (both on npm, 0.1.1 with a provenance attestation).

1. **Bump both version fields.** `package.json`'s `version` and `extension/manifest.json`'s `version`, to the same value. `release.yml` fails before building when the tag does not equal `v` plus either of them.
2. **Update `CHANGELOG.md`.** Move the `[Unreleased]` entries into a new `## [x.y.z] - YYYY-MM-DD` section. `release.yml`'s GitHub Release job reads that section as the release notes and fails when it is missing.
3. **Commit, tag, push the tag** (example for 0.2.0):
   ```sh
   git add package.json extension/manifest.json CHANGELOG.md
   git commit -m "chore: release 0.2.0"
   git tag v0.2.0
   git push origin v0.2.0
   ```

## What `release.yml` actually does

Triggers only on a `v*` tag push (no `workflow_dispatch`: a manual run from a branch could publish whatever that branch holds). Top-level `permissions: {}`, each job grants its own.

**`publish` job** (`contents: read`, `id-token: write`, guarded by `startsWith(github.ref, 'refs/tags/v')`):

- **Exact Node pin.** `setup-node` installs Node `24.21.0`, whose bundled npm (11.19.0) is what publishes; a step fails the run if that npm is older than 11.5.1, the trusted-publishing minimum. No `npm install -g npm@latest`: nothing unpinned is downloaded inside a job that can mint an OIDC token. Dependabot does not bump `node-version`; move the pin by hand when a newer Node 24 is needed.
- **Tag check.** The tag must equal `v${package.json version}` and `v${extension/manifest.json version}`.
- **Full gate before publish:** `npm ci`, `lint`, `typecheck`, `coverage`, `build`, Playwright browser install, `e2e`, the same steps as `ci.yml`. `npm publish`'s own `prepublishOnly` (typecheck, test, build) then runs once more.
- **Version check:** `npm view "$NAME@$VERSION" version`; the publish step runs only when that version is not on the registry yet, so re-running the workflow never double-publishes.
- **Publish:** `npm publish --provenance` at `NPM_CONFIG_LOGLEVEL: verbose`, no `NODE_AUTH_TOKEN`, and `setup-node` without `registry-url` (which would plant an `_authToken=${NODE_AUTH_TOKEN}` placeholder in `.npmrc` that turns a failed OIDC exchange into a misleading `E404`). At verbose level a failed exchange logs `oidc Failed token exchange request with body message: ...` (`package not found` = no trusted publisher matches the run).
- **No GitHub environment.** The npm-side trusted publisher has no environment, and npm's docs do not say whether such a config accepts a token that carries an environment claim, so the job stays outside any environment. To gate publishing on an environment, set it on npmjs.com and on the job in the same change.

**`github-release` job** (`contents: write`, after `publish`): builds, zips `dist/extension/` as `herdr-picker-<version>-extension.zip` (manifest `key` included, the unpacked build; the Store upload still follows the section below), and creates the GitHub Release for the tag with the matching `CHANGELOG.md` section as notes. It skips when the release already exists.

## One-time trusted-publishing bootstrap

A trusted publisher attaches to a package that already exists (npm/cli#8544 tracks first-publish support), so `0.1.0` has to be published by hand, once, with a maintainer's own npm account and 2FA:

1. `npm login` (browser flow).
2. From a clean checkout of the `v0.1.0` tag: `npm ci`, then `npm publish`. `prepublishOnly` runs typecheck, test, and build first; npm asks for 2FA in the browser. No `--provenance` here; only CI can attest that.
3. On npmjs.com: package `herdr-picker`, Settings, Trusted publishing, GitHub Actions:
   - Organization or user: `scaccogatto`
   - Repository: `herdr-picker`
   - Workflow filename: `release.yml`
   - No environment.
   - Allowed actions: also permit direct publishing with `npm publish`. Configurations created after 2026-09-03 default to `npm stage publish` only, and `release.yml` runs `npm publish`: without this the OIDC exchange succeeds and the PUT fails with `E403 OIDC permission denied for this action`.
4. Then Publishing access, "Require two-factor authentication and disallow tokens," so no token can ever publish this package again; trusted publishers keep working, they use OIDC tokens, not npm tokens.
5. `npm logout` (removes the login token from `~/.npmrc`).
6. Push the `v0.1.0` tag (from "Cutting a release" above) **after** this bootstrap, not before. Pushed after, the check finds `0.1.0` already on the registry and skips the publish step cleanly. Every later version is published by the workflow over OIDC, with provenance. (Done for this package on 2026-09-09; kept here for a package rename or a new package.)

Nothing from this bootstrap is stored in the repo, in GitHub secrets, or on any machine afterward.

## Extension zip and Chrome Web Store

Copy for every dashboard field, the developer-account prerequisites and the asset list live in `store/listing.md`; `npm run store-assets` regenerates the PNGs there from the built extension against the fake herdr.

First submission, in this order:

1. **Draft upload, to harvest the Store key.** The dashboard rejects a manifest `key` that does not belong to an existing item ("key field is not allowed in manifest"), so the first zip is built without it, from a copy so `dist/` stays intact:
   ```sh
   npm run build
   rm -rf /tmp/herdr-picker-store && cp -R dist/extension /tmp/herdr-picker-store
   node -e "const fs=require('fs'),f='/tmp/herdr-picker-store/manifest.json',m=JSON.parse(fs.readFileSync(f,'utf8'));delete m.key;fs.writeFileSync(f,JSON.stringify(m,null,2)+'\n')"
   (cd /tmp/herdr-picker-store && zip -r "$OLDPWD/herdr-picker-<version>-store.zip" .)
   ```
   Developer dashboard, Add new item, upload it, do not submit.
2. **Package tab, View public key.** Copy the text between the BEGIN/END lines, remove the newlines, put it in `extension/manifest.json` `key`. From then on every build, the unpacked one included, runs under the Store's id, and `install-host` derives that id (`extensionIdFromKey` in `cli.ts`).
3. **Patch release with the new key.** Bump `package.json` and `extension/manifest.json`, changelog, commit, tag, push the tag: CI publishes the npm version whose bundled extension carries the Store key.
4. **Replace the draft's package.** `npm run build`, `(cd dist/extension && zip -r ../../herdr-picker-<version>.zip .)` (the key matches now, keep it), upload it in the draft's Package tab. Fill Store listing, Privacy practices and Distribution from `store/listing.md`. Before submitting, run the manual check once on the real path: load the new `dist/extension/` unpacked, `Ctrl+B` on any page, screenshot switch on, send: the prompt must carry a `Screenshot:` line and the PNG must exist under the temp directory. Submit for review.
5. **Machines that had the old unpacked build.** Its id no longer matches the host manifest: remove it in `chrome://extensions`, load the new `dist/extension/` or install from the Store, re-run `npx herdr-picker install-host`.

Later versions: zip `dist/extension/` as is and upload it as a new version; the key never changes again.

## Unpacked loading (interim distribution)

Until the Chrome Web Store listing is live, `chrome://extensions`, Developer mode, Load unpacked, `dist/extension/` is the distribution path. The repo's own `manifest.json` `key` (checked in) keeps this build's extension id stable across reloads and machines, so `install-host`'s derived id keeps matching without needing `--extension-id`.

## Versioning

Semantic Versioning: MAJOR.MINOR.PATCH, starting at 0.1.0. Bump:
- PATCH: bug fixes, internal refactors.
- MINOR: new features.
- MAJOR: breaking changes to the extension payload, the CLI flags, or the minimum herdr protocol version this expects (`bridge.ts`'s `getState` currently requires `protocol >= 20`).

## Commits

Conventional Commits: `<type>(<scope>): <subject>`, plus an optional body and footer.

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`.
Scope: optional, for example `extension`, `host`, `cli`, `e2e`.
Subject: imperative mood, lowercase, no period.

Example: `feat(extension): add multi-select for up to 5 elements`

## Changelog

Manual entries in `CHANGELOG.md` under `[Unreleased]` sections (Features, Bug Fixes, Build/Tooling). On release, move them into a new dated version section.

## Pre-publish checklist

`release.yml` reruns lint, typecheck, coverage, build and e2e, and checks the tag against both versions, but a red run after the tag is pushed leaves a tag with no release. Check these before tagging:
- `npm run lint`
- `npm run coverage` (a superset of `test`, with the coverage report)
- `npm run e2e` (needs `npx playwright install --with-deps chromium` first, as `ci.yml` does); it also packs and installs the package and runs the bin link the way npx does (`e2e/package.spec.ts`), the check 0.1.0 shipped without
- `npm run build` clean, with no uncommitted output
- No uncommitted changes
- `package.json` and `extension/manifest.json` versions match the tag (`release.yml` enforces this)
- `CHANGELOG.md` has the `## [x.y.z]` section (the GitHub Release job needs it)
- CI green on the commit being tagged (`ci.yml` only runs on a push to `master`/`main` or a pull request, so this only applies when that commit reached CI one of those ways)
