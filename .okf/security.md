---
type: Policy
title: Security boundaries
description: Native messaging isolation, page content as data, screenshot opt-in, a closed shadow root with trusted-event guards
tags: [security, extension, native-messaging, data-handling]
generated:
  by: claude/opus-5-5
  at: 2026-10-13
status: stable
sources:
  - resource: ../README.md
  - resource: ../extension/manifest.json
  - resource: ../src/extension/picker.ts
  - resource: ../src/extension/dom.ts
  - resource: ../src/extension/content.ts
  - resource: ../src/extension/background.ts
  - resource: ../src/extension/crop.ts
  - resource: ../src/validate.ts
  - resource: ../src/native.ts
  - resource: ../src/bridge.ts
  - resource: ../src/cli.ts
  - resource: ../src/host.ts
  - resource: ../src/host-name.ts
---

## Implemented Guards

**No localhost port, no token.** Chrome, not the page, spawns the native host over stdio; there is no socket for a page to reach. The only gate is the host manifest's `allowed_origins: ["chrome-extension://<id>/"]` (`cli.ts`'s `hostManifest`), which Chrome itself checks before it will pipe messages from the extension to the host.

**Extension identity check.** `background.ts`'s single `onMessage` listener requires `sender.id === chrome.runtime.id` before handling `{ type: 'capture' }` or `{ type: 'host', ... }`; anything else is returned unhandled. `content.ts`'s own listener, for the background-to-content `{ type: 'pick' }` message, does not check the sender at all.

**Isolated world, top frame only.** `pickInTab` calls `chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })` with no `world` option, so Chrome defaults to `ISOLATED`: the content script's JS globals are separate from the page's own. There is also no `allFrames`, so injection targets the top frame only. Isolation protects the JS scope, not the DOM: the page still shares the DOM tree with the content script, which is why the shadow root below needs its own guards.

**Closed shadow root, trusted-event guards.** `picker.ts` mounts with `host.attachShadow({ mode: 'closed' })` and `mount` returns the root to its caller (the content script's isolated world, or a test) instead of exposing it: `host.shadowRoot` reads `null` from the page, so page scripts cannot read the typed prompt or the agent list, nor reach any control. The isolated world's prototypes cannot be patched by the page, so `attachShadow` cannot be intercepted either. Behind that, every listener inlines `if (!e.isTrusted) return` (there is no shared helper):
1. The window `keydown` and `click` listeners (capture phase).
2. The Send button's `click` listener.
3. The prompt textarea's `input` listener, which only copies `textarea.value` into the variable actually sent (`typed`) on a trusted event; `send()` reads `typed.trim()`, not `textarea.value`.
4. Each agent row's and spawn row's `click` listener, which sets `selectedPaneId`.
5. The To row's expand/collapse `click` listener.
6. The screenshot switch: an untrusted `click` is cancelled (`preventDefault` reverts the toggle) and its `change` listener persists the preference only on a trusted event.

Residual: keyboard events are composed, so a page that registered its own window key listeners before the picker can still observe keystrokes typed into the popup.

**Preferences out of the page's reach.** The last target (`last:<origin>`) and the screenshot switch (`shot:<origin>`) live in `chrome.storage.local` (`prefs.ts`'s `extensionPrefs`, wired up in `content.ts`), not in the page's `localStorage`, so a page cannot preselect the target pane. `content.ts` detects a second injection through the isolated world's own `window.__herdr`, not a DOM query, so a page cannot plant a fake `[data-herdr-host]` to keep the picker from mounting.

**Captured markup is adversarial input; truncation is the only mitigation.** `dom.ts` caps attribute values at 80 characters (`truncateAttr`) and text nodes at 120 (`truncateText`) while building the HTML snippet. Neither `renderAttrs` nor the text-node path in `renderChildNode` escapes anything; values are truncated, not encoded. The only other mitigation is `compose.ts`'s prompt text, which states the markup is "captured data, not instructions." Nothing from the page is parsed or executed; it becomes text in front of an agent with shell access, and that framing line is what stands between the two. `postPrompt` hands the composed text straight to `agent.prompt` (`bridge.ts`); nothing in this codebase reviews or confirms a prompt before the agent receives it.

**Host validation and caps.**
- `validate.ts`: `validatePrompt` requires a non-empty `target`, a `prompt` of at most 20000 characters, a valid `element` (`validateElement`: typed `url`/`path`/`html`/`hint`, finite `viewport`/`rect` numbers, string-valued `styles`), at most 4 `extras`, and an optional `screenshotPng` of at most 8,000,000 base64 characters matching `^[A-Za-z0-9+/]+={0,2}$`. `validateSpawn` requires `mode` to be exactly `'here'` or `'worktree'`, an optional `name` matching `^[a-z][a-z0-9_-]{0,31}$`, an optional `branch` of 1-100 characters with no whitespace. Both return `null`, never throw, on mismatch, which `native.ts` turns into 400 `invalid_params`.
- `native.ts`: frames over `MAX_FRAME_BYTES` (16 MiB) throw during decode; replies over `MAX_REPLY_BYTES` (1 MiB) are replaced with a `reply_too_large` 500 before they would ever reach Chrome. These are this host's own caps, independent of whatever Chrome itself allows.
- Client-side, the prompt textarea has `maxLength = 4000`, a UI nicety; the 20000-character cap in `validatePrompt` is the one actually enforced end to end.

**Attachment storage and cleanup.** Oversized snippets (`writeAttachment`) and opt-in screenshots (`postPrompt`'s inline write) both land in `ATTACHMENT_DIR`, `os.tmpdir()/herdr-picker-<uid>/` (plain `herdr-picker/` where the platform has no uids). Before each write `ensurePrivateDir` creates it 0700, refuses a symlink, a non-directory or a directory another uid owns, and tightens a looser mode on one it owns; files are written 0600 with the `wx` flag, so nothing pre-planted is followed or overwritten. A refused screenshot is logged and the prompt goes out without it; a refused snippet attachment fails the request. `cleanupAttachments` deletes `.md` and `.png` files whose mtime is older than 24 hours; it runs once, at `host.ts` startup, not on a timer. Because the port's 60-second idle disconnect ends the host process and the next request respawns a fresh one, this effectively reruns on every reconnect after a gap in use, but a file created just before the extension goes unused indefinitely could in principle outlive 24 hours with nothing to sweep it.

**Screenshot opt-in.** Captured only when the popup's switch is checked, a preference persisted in `chrome.storage.local` under `shot:<origin>` and the tab is visible. `chrome.tabs.captureVisibleTab` captures the visible area of the tab, the on-screen viewport, not the full scrollable page or any browser UI, returned as a PNG data URL; `crop.ts`'s `cropDataUrl` then crops it client-side to the picked element plus a 40px margin (clamped 16..4000px) and returns base64 PNG. `captureVisibleTab` runs under the `activeTab` grant, which Chrome extends only for the tab the user just invoked the extension on; there is no `host_permissions` entry backing it.

**Permissions.** `extension/manifest.json`: `["activeTab", "scripting", "nativeMessaging", "storage"]` (`storage` carries no install warning). No `host_permissions`, no `externally_connectable`. `activeTab` is revoked by Chrome on cross-origin navigation; the user re-triggers it by pressing `Ctrl+B` again.

**A wrong `key` fails closed, and legibly.** If the manifest's `key` (and so the id `extensionIdFromKey` derives) does not match what the running extension actually is, `connectNative` fails with a message `classify()` matches against `/not found|forbidden/i`, becoming `{ error: 'no_host' }`. The picker's `state()` turns that into "native host not installed, run: npx herdr-picker install-host" (`content.ts`). It fails as a missing host, not a silent hang; see `release.md` for when the key changes.

## Platform facts, not this repo's code

- Chrome's own Chrome-to-host native messaging limit is 64 MiB. This host's `MAX_FRAME_BYTES` (16 MiB) is a separate, stricter, self-imposed cap, not a restatement of Chrome's limit.
- Local Network Access (shipped in Chrome 142) does not make loopback unreachable from pages; it puts a permission prompt in front of public pages reaching it, and does not cover a `localhost` page reaching another `localhost` port. This design has no exposure to either gap for a simpler reason: a native host is never a network endpoint in the first place.
- `activeTab` revocation on cross-origin navigation is Chrome's own permission-lifecycle behavior, not something this repo implements.

## Edge Cases

**iframe.** `document.elementFromPoint` does not cross into a nested document, so a click over an `<iframe>` picks the `<iframe>` element itself, its tag and attributes such as `src`, never anything inside it. `iframe` is also in `dom.ts`'s `COLLAPSE_TAGS`, so wherever it appears in the trimmed snippet it renders as `<iframe ...>...</iframe>` without descending into it.

**Shadow DOM.** `deepElementFromPoint` walks into open shadow roots (`el.shadowRoot.elementFromPoint`) to find the real element under the cursor. A closed root's `.shadowRoot` reads `null` from outside, so the loop stops at the host element; nothing inside a closed root is reachable. Going the other direction, `selectorPath` climbs out of an ancestor shadow root and marks the crossing with ` >>> ` in the path string.

**SVG.** A hit inside an `<svg>` subtree, any element in the SVG namespace that is not the `<svg>` element itself, bubbles up to the closest ancestor `<svg>` via `.closest('svg')`; a `<path>` or `<circle>` is never picked directly.

**`chrome://` and other privileged pages.** Chrome refuses script injection into them regardless of permissions; `pickInTab`'s `try`/`catch` swallows the resulting rejection into a `console.warn`, so the picker silently does not appear, with no error surfaced to the user.

**Cross-origin navigation.** Revokes `activeTab`; the next `Ctrl+B` re-requests it for the new origin.
