# Update Log

## 2026-09-09

Repository bootstrapped: configs adapted from vite-plugin-herdr, shared modules copied at f5ef5e1 (see UPSTREAM.md).

Core modules adapted for the extension: relay-based picker (no HTTP/HMR), screenshotPng instead of ScreenshotRequest (base64 PNG captured by extension), no dev-server screencapture, trusted-event guards on UI, no in-page hotkey.

Documentation landed: README.md (use, install, security), CHANGELOG.md (Keep a Changelog format), architecture.md (modules, contracts, message flow), security.md (boundaries, guards, edge cases), release.md (versioning, npm/Web Store steps). First release pending.

0.1.0 published to npm by hand (trusted-publishing bootstrap), tag v0.1.0 pushed, the release workflow found it on the registry and skipped the publish. The published bin failed under npx: dist/cli.js had no shebang, so the shell ran the bundle as a script. 0.1.1 adds the shebang to src/cli.ts (the Vite build keeps it) and e2e/package.spec.ts, which packs and installs the package and runs the bin link the way npx does.

Trusted publishing bootstrap findings: a trusted publisher created after 2026-09-03 allows only `npm stage publish` until "Allowed actions" also permits direct `npm publish` (otherwise `E403 OIDC permission denied for this action` after a successful token exchange); `setup-node`'s `registry-url` plants an unresolved `${NODE_AUTH_TOKEN}` in `.npmrc` that turns a failed exchange into `E404`. release.yml dropped `registry-url` and publishes at verbose log level; release.md updated.

Chrome Web Store material prepared: store/listing.md, PRIVACY.md, store assets spec (npm run store-assets); release.md store section rewritten as an ordered first-submission sequence (draft upload without the manifest key, harvest the Store key, patch release, replace the package, submit).

## 2026-10-13

Hardening pass from an audit (HP-1 to HP-9). Prompt framing: page-controlled values on top-level lines are flattened and capped, html fences grow past any backtick run (`compose.ts`'s `oneLine`, `fenced`). Picker: closed shadow root returned by `mount(relay, prefs)`, trusted-event guards on every control, preferences in `chrome.storage.local` per origin (`prefs.ts`, new `storage` permission), injection deduped on the isolated world's `window.__herdr`; e2e drives the closed root over CDP (`pickerUi` in `e2e/helpers/extension.ts`). Host: private per-user attachment dir (`ensurePrivateDir`). Installer: `host.sh` values single-quoted. Node floor 22, tested in CI inside the `build` job. `release.yml`: exact Node pin instead of `npm@latest`, tag-only, tag/version check, full gate, GitHub Release job, still no GitHub environment (npm's docs do not confirm an environment-less trusted publisher accepts one). security.md, architecture.md and release.md updated.
