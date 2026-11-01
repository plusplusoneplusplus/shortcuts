# CoC Desktop

Follow [root guidance](../../AGENTS.md) and load
[coc-knowledge](../../.github/skills/coc-knowledge/SKILL.md) before changes.
Paths below are package-relative.

## Browser boundaries

`browser-view-host.ts` registers exact-source SPA owners and gates IPC.
`browser-host-manager.ts` retains concrete session routing separately from native
view identity. URL views and Electron file previews share the host manager but
keep distinct profiles, permissions and control eligibility. Authentication and
raw debugger transports stay in main.

For demonstration recording, read
[browser-demos.md](../../.github/skills/coc-knowledge/references/browser-demos.md).
The feature is default off, Electron-only and memory-only until reviewed Send.
Preserve immediate popup opener identity separately from root SPA tab routing.
Never add typed values, screenshots, page dumps or renderer debugger access.
Sanitize website metadata before it enters drafts and report collection gaps.
Reject late startup/poll/adoption results after pause, discard, close or reload.
Recording admission excludes queued AI commands for the chat and busy target
queues. Preserve reservations through dispatched input releases after cancellation;
recheck recording ownership before queued main-process dispatch.
Share final capture drains between Stop and captured-tab closure. Retire routing
synchronously, retain sinks through the drain, and report unavailable final capture
as a gap before closing membership.
Authorized pending descendants retain historical opener lineage after closure.
Auto-stop only after tabs, pending descendants and close drains are exhausted;
expiry, failed adoption and explicit Stop cancellation must disclose gaps.

`main.ts` and `container-main.ts` confirm unsent drafts before shutdown side
effects. Native close/reload warnings belong to registered owning windows;
Cancel preserves their demos. Do not restart a server or change live settings
without explicit user authorization.

## Validation

`npm run build` compiles this package. `npm run test:run -- test/<file>` runs
targeted Vitest coverage; `npx eslint src/<file> --quiet` checks changed source.
Browser demos have capture/session/tab-capture/recorder/manager suites and native
host integration fixtures. Use platform-neutral synthetic data. Real desktop
interaction and Windows WebView2 behavior require explicit manual verification.
