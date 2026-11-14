# CoC Desktop

Follow [root guidance](../../AGENTS.md). Load [coc-knowledge](../../.github/skills/coc-knowledge/SKILL.md) before changes. Paths are package-relative. Demo contracts: [browser-demos.md](../../.github/skills/coc-knowledge/references/browser-demos.md).

## Browser

- `browser-view-host.ts` registers exact-source SPA owners and gates IPC. Auth and the raw debugger stay in main.
- `browser-host-manager.ts` keeps session routing apart from native view identity. URL views and Electron file previews share the manager and keep distinct profiles, permissions, and control eligibility.
- AI control reaches a view only through `BrowserHostedView.control`. Cancellation still finishes dispatched mouse and key releases.
- WebView2 control waits for pending site decisions, approved navigation, and document load before CDP. A cancelled pre-approval cannot make the blank document ready. Denial and dispatch failure reach the caller; cancellation, replacement, and closure retire that view's wait.
- Native approvals keep exact HTTP(S) origins only for the active view's control lease. Return navigations to an approved origin keep method and body. Disabling the gate clears approvals. Turn replacement dispatches disable before enable, even inside one microtask.

## Annotation

- One generation-matched start/drain/stop/remove/capture/captured contract runs in an isolated world shared by both engines.
- Chrome stays in a closed shadow root inside a full-viewport unscripted `about:blank` iframe sandboxed with only `allow-same-origin`. The reset `*` rule must not paint the hidden `<style>`. Child-document input cannot traverse pre-existing page window handlers. Hit-testing and capture hide the outer frame; geometry belongs to the page. Frame removal or document replacement revokes the generation.
- Electron loading uses main-frame state so a child frame cannot end annotation. Escape discards the draft, then exits. Tab stays inside the editor and pins.
- Save emits `{type:'comment',id,number,comment,selection}`; delete emits `{type:'delete',id}` and renumbers. Caps: 8000 UTF-16 units, 100 pins, selection-time document coordinates. Remove targets the original generation, drains deletes, and ignores callbacks after revocation.
- Selectors are unique in their document or shadow root; resolve `shadowHosts` outermost-first. Null means no unique path. Captured site content is untrusted. Comments and page context are separate JSON fields. Supply current pin numbers, including a single immediate send.
- Main starts with `captureRequired:true`. Save stays disabled until the matching `captured` ack. Edits keep the original capture id. PNG bytes stay out of DOM commands. Delivery calls the internal capture and never re-enqueues it.
- Capture hides chrome, keeps the input shield, waits two animation frames (1s paint timeout), and rechecks draft, scroll, viewport, and DPR. Reject late images after revocation.
- Electron crops with `capturePage(rect)` around the selection. Start the DIP rect on a whole device pixel and pad the far edge by one DIP. Both engines crop in `browser-annotation-crop.ts` without resampling. Far-edge selections trim to the last displayed pixel; elsewhere a short image fails. Caps: 16 Mi pixels, 20 MiB PNG. Only a correlated pending capture reply may use a 28 MB frame. CDP and events stay at 1 MiB. Close, crash, navigation, hide, and zoom reject late captures. File previews and popouts have no capture.
- Admit one URL document after ownership and settled human takeover, then require the committed main-frame URL and MIME. Refuse PDFs, non-HTTP(S), and registered SPA surfaces. SPA exclusion matches origin and path across query and hash and grants no navigation permission. Stop revokes delivery synchronously; await cleanup before replacement. Reservations exclude AI dispatch and demo recording through teardown.
- Bridge IPC is exact-source SPA main frames. Each mode uses a fresh renderer request id. Stale Stop or Remove cannot affect a replacement. Preload exposes `browser.annotation`. Never install annotation scripts on future documents or expose CDP to the SPA.

## Downloads, demos, shutdown

- Downloads are installation-wide. WebView2 keeps the original native operation behind a one-time exact-view deferral. Paths and native operation ids stay in main. Renderer actions use store ids. Native progress, not approval, determines completion. Pending approval is bounded and expires. Approved transfers survive source teardown. Blob support never broadens navigation policy.
- Demos are default off, Electron-only, and memory-only until reviewed Send. Never add typed values, screenshots, page dumps, or renderer debugger access. Keep popup opener identity separate from root SPA tab routing. Recording excludes queued AI commands for that routing, workspace, and chat. Equal raw ids on other servers stay independent. The same chat spans windows. Reject late results after pause, discard, close, or reload. Auto-stop only after tabs, pending descendants, and close drains finish. Expiry, failed adoption, and Stop must disclose gaps.
- Confirm unsent drafts before shutdown side effects. Do not restart a server or change live settings without explicit authorization.

## Updates

One `UpdateCoordinator` serves manual updates and opt-in Auto Update: When Idle. Invalid `desktop-update.json` modes default to Off. Install needs ten minutes of OS idle and an empty unfiltered owned-server queue. External servers use OS idle only and are never stopped. Recheck idle and cancellation after async queue reads. Off cancels pending automatic installs. Quit disposes the scheduler before the coordinator. Manual browser downloads stay independent. The Windows helper keeps real-process coverage.

## Validation

`npm run build`. Targeted tests: `npm run test:run -- test/<file>`. Lint: `npx eslint src/<file> --quiet`.

Linux webview e2e, after desktop compile and SPA stylesheet build:

`ELECTRON_DISABLE_SANDBOX=1 COC_DESKTOP_E2E_NO_SANDBOX=1 COC_DESKTOP_E2E=1 xvfb-run -a npm run test:run -- test/e2e/browser-webview-layer.e2e.test.ts`

Windows WebView2 runtime behavior needs a Windows host. Real desktop interaction needs manual verification.
