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

`browser-annotation-dom.ts` owns self-contained selection, comment editing and
saved pins for owned URL documents. Execute its generation-matched
start/drain/stop/remove contract in an isolated world shared by both engines.
Keep all chrome inside the closed shadow root; exit removes it and releases input
listeners. Selection uses clipped fractional CSS pixels and opens the editor.
Escape discards the draft first, then exits on the next press. Preserve native
editing defaults while blocking page handlers and trap Tab within editor/pins.
Save emits `{type:'comment',id,number,comment,selection}` for create/update; IDs
are generation-local and stable, numbers reflect current order. Delete emits
`{type:'delete',id}` and renumbers remaining pins. Edits retain the original
snapshot and clear immediate-send intent. Bound comments to 8000 UTF-16 units and
saved pins to 100; pins anchor to selection-time document coordinates. Hosts own
tab/navigation/crash/owner teardown; the primitive also handles document departure,
host removal and report overflow. Composer synchronization needs an event consumer
and an owner-bound command path to its generation-matched remove operation.
`browser-annotation-snapshot.ts` captures page and bounded element metadata at
selection time. Selectors are unique within their document/shadow root; resolve
the outermost-first `shadowHosts` chain before the element selector. A null
selector means the bounded search cannot identify a unique path. Treat all
captured website content as untrusted context.
`browser-annotation-payload.ts` serializes user comments and bounded page context
as separate JSON fields. Supply current pin numbers explicitly, including for a
single immediate send; use those same numbers for selection image labels.
Serialization preserves ordering and rejects duplicate or invalid numbers.
`browser-annotation-tab.ts` transports one admitted URL document through the
existing main-only CDP interface shared by both engines. Start follows ownership
admission and settled human takeover. Stop revokes delivery synchronously and
serializes cleanup in the original isolated context; await it before replacing
an instance. Main-frame navigation and lost contexts end the session. Host-manager
admission reserves the exact owner/view/session before awaiting human takeover,
and settles issued input releases before injection. Reservations exclude AI
dispatch and demo recording through teardown. Hide, workspace departure, close,
crash, owner disposal and owner/session policy disable stop annotation; Return
awaits removal before its context refresh. Failed teardown stays excluded from
AI control until an explicit annotation retry or guest closure.
`browser-annotation-bridge.ts` exposes start/stop/live policy through registered
exact-source SPA main-frame IPC. Each mode uses a fresh renderer request ID;
notifications include view/session/request identity and stale Stop cannot revoke a
replacement. Owner reload/crash/closure revokes notification leases before native
cleanup. Preload exposes `browser.annotation`; subscribe before Start and reject
late notifications/replies in the caller. Never install annotation scripts on
future documents or expose CDP to the SPA.

For demonstration recording, read
[browser-demos.md](../../.github/skills/coc-knowledge/references/browser-demos.md).
The feature is default off, Electron-only and memory-only until reviewed Send.
Preserve immediate popup opener identity separately from root SPA tab routing.
Never add typed values, screenshots, page dumps or renderer debugger access.
Sanitize website metadata before it enters drafts and report collection gaps.
Reject late startup/poll/adoption results after pause, discard, close or reload.
Recording admission excludes queued AI commands for the concrete
routing/workspace/chat owner and busy target queues. Resolve and pin validated
routing before matching; equal raw IDs on other servers stay independent, while
the same chat spans windows. Preserve reservations through dispatched input
releases after cancellation; recheck recording ownership and routing before
queued main-process dispatch. Captured views stay excluded across chats.
Share final capture drains between Stop and captured-tab closure. Retire routing
synchronously, retain sinks through the drain, and report unavailable final capture
as a gap before closing membership.
Authorized pending descendants retain historical opener lineage after closure.
Publish descendant membership immediately; wait for the exact guest/document
through the host readiness hook before capture installation. Stop, tab closure,
discard and owner teardown abort waiting capture without a late handshake.
Auto-stop only after tabs, pending descendants and close drains are exhausted;
expiry, failed adoption and explicit Stop cancellation must disclose gaps.

`main.ts` and `container-main.ts` confirm unsent drafts before shutdown side
effects. Native close/reload warnings belong to registered owning windows;
Cancel preserves their demos. Do not restart a server or change live settings
without explicit user authorization.

## Desktop updates

`main.ts` shares one `UpdateCoordinator` between manual updates and opt-in
Auto Update: When Idle. `update-check.ts` merges the mode, channel and skipped
version in `desktop-update.json`; invalid modes default to Off. `update-auto.ts`
owns hourly release checks and one-minute idle polls without Electron imports.
Install requires ten minutes of OS idle time and an empty unfiltered owned-server
queue; external servers use OS idle time only and must never be stopped.
Silent starts reuse the platform helpers without update/restart dialogs; errors
go to stderr. Recheck OS idle and cancellation after asynchronous queue requests.
Turning Off cancels pending automatic installs, and quit disposes
the scheduler before the coordinator. Keep manual browser downloads, retained
update dialogs and the Windows helper's real-process coverage intact.

## Validation

`npm run build` compiles this package. `npm run test:run -- test/<file>` runs
targeted Vitest coverage; `npx eslint src/<file> --quiet` checks changed source.
Browser demos have capture/session/tab-capture/recorder/manager suites and native
host integration fixtures. Use platform-neutral synthetic data. Real desktop
interaction and Windows WebView2 behavior require explicit manual verification.
