# Dashboard SPA — Shell & Routing

React SPA served by `coc serve`, at `packages/coc/src/server/spa/client/`: entry point,
module layout, routing, pop-out windows, contexts, hooks, the per-conversation request
budget, feature flags, and coc-client integration.

## Entry point

- `entry.tsx` — mounts `App` (main shell) or `PopOut` (floating chat window).
- `html-template.ts` — server-side HTML with inline bundled assets from `client/dist/`.
- `client/dist/` is served at the **site root**, not `/static`. Alongside the bundle it
  holds separately-loaded assets: Monaco workers, `pdf.worker.js`, and `canvas-vendor/`
  (`react.js`, `recharts.js`, `papaparse.js`, `tailwind.css`) — the library globals an
  extension canvas loads into its sandboxed iframe. Built by `scripts/build-client.mjs`;
  `dist/` is gitignored. Monaco worker URLs come from
  `explorer/monacoWorkerUrls.ts`; `test/server/monaco-worker-urls.test.ts` checks them
  against the build's worker list and the router, because an unresolved asset URL
  silently returns the SPA page.

## Module layout

```
spa/client/react/
├── App.tsx        # Root component
├── admin/         # Admin panel & preferences UI
├── chat/          # Reusable conversation rendering
├── components/    # Shared UI (ContextWindowIndicator)
├── contexts/      # App, Queue, Task, Toast, FloatingChats
├── hooks/         # 30+ custom hooks
├── layout/        # Router, TopBar, BottomNav, MobileScopeBar, navDestinations, ThemeProvider
├── features/
│   ├── canvas/    # CanvasPanel, ExtensionCanvasView, KustoView/KustoChart
│   ├── chat/      # ChatDetail, ChatListPane, ConversationArea, ImportCopilotChatDialog (flag `nativeCliSessions`: toolbar icon next to New chat)
│   ├── dreams/    # Workspace Dreams review panel
│   ├── memory/    # Memory V2 route
│   ├── native-copilot-sessions/   # Read-only CLI session view and chat importer support
│   ├── notes/     # NoteEditor, Mermaid zoom/pan, sidebar
│   ├── pull-requests/             # PR dashboard, BatchCommandPanel
│   └── terminal/  # TerminalView, pin/unpin
├── processes/     # Process detail, DAG visualization
├── queue/         # EnqueueDialog, QueueView
├── repos/         # Repo views, clone/add dialogs, explorer, Monaco editor
├── shared/        # MarkdownView, RichTextInput, SourceEditor, markdown-document
├── tasks/         # Task/plan management, inline comments
├── ui/            # Primitives (Button, Card, Dialog, Spinner, Badge, Toast)
├── welcome/       # WelcomeTour, FirstStepsCard, FeatureTip
├── types/ utils/  # Types and utility modules
└── featureFlags.ts
```

## Routing

Inner-tab navigation is client-local and workspace-scoped. `AppContext` persists
`repoTabState` under `coc-repo-tab-state` and the full inner route suffix under
`coc-repo-route-state`, dropping unknown sub-tab ids on hydrate. `Router` records the
suffix for every `#repos/<workspaceId>/<subroute>` hash and expands a bare
`#repos/<workspaceId>` hash to the remembered route, then the remembered tab, then
`/chats`. Repos and groups have no Notes/Settings page: their `notes`, `settings`,
`copilot` and `info` segments (except `settings/display` → admin) replace to
`/activity` before any sub-tab or suffix is recorded. Only My Work / My Life
keep those pages and their Alt+N / Alt+C shortcuts.

`layout/dashboardRoutes.ts` owns parsing, redirects, and stale-selection clearing:
`resolveDashboardRoute(hash, ctx)` turns one hash into an ordered list of typed
`RouteEffect`s (app/queue dispatches plus `replace`/`replaceState` navigations) that
`Router` runs through `applyRouteEffects`. Parsers and hash builders sit on the
per-segment encode/decode helpers in `layout/routePath.ts`, re-exported from
`layout/Router`.

Group member chat routes use
`#repos/<groupSelectionId>/chats/member/<ownerWorkspaceId>/<canonicalProcessId>`.
`dashboardRoutes` builds and parses the path, deriving the member's concrete clone
key from the group server. `useRepoGroupChatSelection` restores owner identity
before feed pages load and follows hash history. The router records the full
suffix under the server-qualified group but clears group queue selection;
member ids never select group tasks. New Chat returns to the same group's
`/chats` route. `RepoGroupMemberChatDetail` supplies `RepoChatTab.detailOverride`,
an owner header and explicit repo navigation; mobile back clears the member
route without unmounting the list.
Group list search and repo/status/archive filters persist under
`coc.group-chat-filters:<groupSelectionId>`. Narrow layouts use a filter
disclosure; matching rows retain their owner prefixes and plain-text excerpts.
Member conversation completion writes the owner's existing seen-state and
invalidates the group feed through an owner-qualified event.
The feed keeps a bounded in-memory owner/query history cache for unavailable
sources, marks their rows and counts partial, and removes sources absent from
fresh membership. Reconnect and topology events reconcile the list; topology
invalidates pending responses immediately. Removed members retain the open
conversation identity until navigation clears it.
The aggregate list groups Ralph, For Each, Map Reduce, generic tagged groups,
spawn trees and enabled chat folders per owner. Cross-owner parent links remain
delegation navigation, not nesting. Bulk actions keep owner-qualified selection,
apply successful writes and retain failed rows for retry. Queue controls always
name one owner; reorder uses that owner's repo view.

Workspace switchers use `useWorkspaceNavigation()`, so TopBar, the repo grid,
process-sidebar links, and clone completion all write full hashes. `RepoDetail` treats
`chats`/`activity` and `cli-sessions`/`copilot-sessions` as aliases, waits for git
capability loading, and falls back to the chat surface only when the active sub-tab is
absent from the resolved `visibleSubTabs` — that fallback does not erase the stored deep
route suffix.

### Workspace panel resources

For repos and groups, Work Items, Pull Requests, Notes and Settings open from the
right-panel add-tab menu. Each WI/PR tab belongs to one concrete local or remote
owner; member targets keep their group's hosting workspace. `UnifiedWorkResourceTab`
reuses `WorkItemsTab` and `PullRequestsTab` under the pinned owner client.
`workPath` persists list/detail selection in the descriptor. Closed WI/PR views
stay mounted in the panel to preserve filters, selections and drafts.

`layout/workResourceRoute.ts` owns canonical
`#repos/<scope>/panel/<kind>/<owner>/<detail>` links. Router opens/focuses the
owner-qualified tab without clearing the selected chat. Alt+I/Alt+R use these
routes; removed page routes and invalid panel routes replace to the workspace.
The same panel mounts on mobile, where its toggle opens a full-width presentation.
Externally hosted Git details leave the Workspace push/back state unchanged, so
hiding the panel restores the selected list segment.
WI/PR list/detail layouts respond to the panel width with their single-pane back
navigation and restore the split when widened.

`unifiedPanelWorkspaceResources.ts` builds Notes/Settings descriptors for the menu
and outside links. Those resources belong to the panel workspace; WI/PR tools use
the current dock target. Group dock controls resolve clone selections to raw
workspace ids while descriptors retain concrete server routes.

`features/repo-settings/WorkspaceSettingsHost.tsx` mounts one `RepoSettingsTab`
or `RepoGroupSettingsTab` on first panel open and keeps it in a stable portal
container. The tab belongs to the panel workspace and concrete server,
independently of its dock target or selected chat. Section navigation stays
local; closing parks the form in a hidden node and preserves drafts.

`workspaceSettingsClient.tsx` supplies one pinned client through
`WorkspaceOwnerContext`. Settings sections, shared preference hooks, Notes and
group mutations retain raw workspace ids on that server. Linked-repo choices
stay server-local. Unresolved remote owners wait for their route; changed
endpoints retain mounted drafts, show an error and reject requests until the
workspace is reopened. A new endpoint never silently replaces a draft's client.

## Pop-out windows

**Every `#popout/*` opener must test its `window.open` result with `popOutOpened(handle)`
(`react/utils/popOutWindow.ts`), not `if (handle)`.** In the Electron desktop shell the
main process intercepts pop-out-shaped opens with `{ action: 'deny' }` and rebuilds them
as native windows (`packages/coc-desktop/src/popout-window-host.ts`), so `window.open`
returns `null` **on success**. A bare null check fires a false "Pop-out blocked" toast and
skips the `markPoppedOut` bookkeeping driving the popped-out rails.

The desktop allow-list is narrow — same-origin `#popout/` hashes plus same-origin PDFs —
so print preview and OAuth popups get real handles. `window.open(url, name)` name reuse
focuses an existing window in both hosts. Desktop pop-outs expose no handle to poll, so
handle-dependent focus (`features/canvas/canvasPopOut.ts` tracking live handles) degrades
there to re-issuing the named open, which focuses the existing window.

## Desktop browser and HTML page views

`window.cocDesktop.browser` (`packages/coc-desktop/src/preload.ts`) is the one desktop view API, backed by `browser-host-manager.ts`. `open(viewId, source, sessionKey, relatedEngine?)` takes `{ kind: 'url', url }` (or a bare URL string) or `{ kind: 'file', path }`, validates HTTP(S)/file policy and ownership, and replays a live view's state and history; only `file` sources load `file:`. `browser.sources` (`['url', 'file']`) lets the SPA feature-detect file previews, and `openViewExternal(viewId)` opens a view's current page in the system browser.
Results/state identify the retained engine and `sourceKind`; `sessionKey` identifies routing ownership, not a profile. Electron browser opens return `embed: 'webview'`, `src` and `partition`; the renderer attaches the guest through `adopt(viewId, guestId)`. `setBounds` aligns native views in CSS px and reports guest visibility; `null`/`hide()` hides, and `close()` destroys.

### HTML page (file) views

Local `.html`/`.htm` previews are `file` sources hosted as Electron webview guests by `file-preview-host.ts`, independent of engine preferences and browser-data cleanup. They have no preload, use the isolated in-memory `coc-html-page` session, and follow `html-page-policy.ts`. Only pending, main-validated exact file URLs pass the attachment guard. Invalid, relative or missing HTML files return `{ ok: false, reason }`, requiring the source-viewer fallback.
`window.cocDesktop.htmlPage` is a compatibility wrapper for SPAs without `file` sources: it maps each `pageId` to view `html-page:<pageId>` (session key `html-page`) over the browser channels and narrows replies/states (`loading`/`loaded`/`failed`); it has no view logic of its own.

SPA side: `desktopHtmlPageBridge()` adapts the `file` source and its attachment metadata to the page API (view `html-page:<pageId>`); web dashboards and remote-workspace paths keep the source viewer. `UnifiedHtmlPageTab` and `UnifiedBrowserTab` share `NativeViewTab`, the toolbar classes in `NativeViewTab.tsx`, and `NativeViewNavButtons` (one rounded back/forward/reload-or-stop capsule labelled Page navigation); their Electron placeholders register with the same persistent guest layer. The browser address input and the HTML toolbar's read-only path share one pill style.

### Browser profiles and preferences

`desktop-browser.json` stores `defaultEngine` (Electron), `pageZoomPercent` (100%) and `clickOnceEnabled` (false). Independent writes preserve other fields. The Admin **Browser** page (`#admin/browser`, Configure group after AI Provider) hosts installation-wide Desktop Preferences through local IPC, not workspace-server APIs. Engine and ClickOnce changes apply to new tabs; disabling ClickOnce also blocks pending activation. The web dashboard shows a desktop-only notice. The page's server-backed Browser features card holds browser control, sensitive input and HTML page tabs.
Its optional history recording toggle reads committed state through a bounded history query and saves through `setRecording`; history invalidations refresh all open settings views. Pausing preserves existing suggestions. Loading, storage and operation failures are explicit, with retry and stale-query/unmount guards.
Separate persistent `browser/electron` and `browser/webview2` profiles share sign-ins across workspaces/windows, isolating the SPA/HTML previews. Confirmed cleanup closes target-engine tabs and excludes new views.
Electron forces its locked `session.fromPath` profile onto each guest. The returned
partition is a single-use attachment token, not a new storage partition; existing
sign-ins and session permission/download hooks remain shared.
The Windows desktop helper enables OS-account SSO by default at environment creation without an environment flag. Profiles remain separate from Edge. SSO does not guarantee Conditional Access compliance; clearing site data does not disconnect Windows accounts.

### Desktop history persistence

`browser-view-host.ts` creates one `BrowserHistoryStore` from
`packages/coc-desktop/src/browser-history.ts`, shared by the manager across
windows/workspaces. Its versioned
`<desktopDataDir>/browser/history.json` retains credential-free HTTP(S) URLs for
90 days, capped at 10,000 unique URLs. Per-engine title/time/count contributions
support independent cleanup. Atomic serialized saves publish only on success;
queries expose storage errors. Host `visited`/`titleUpdated` callbacks write only
URL sources; state snapshots, reattachment and file previews never record.
Both engines emit visits after successful main-document completion and committed
same-document changes, including popup documents. WebView2's native helper tracks
navigation IDs and emits explicit `visited`/`title-updated` messages with each
document's final URL/title through its root tab. Failures, stop and crashes
invalidate pending visits; late or repeated completions never record.
`updateTitle` cannot create entries. Recording preferences, deletion and bounded
URL/title search use the same store. Startup and main-owned hourly maintenance
prune expired entries; shutdown stops the timer and drains queued saves even when
host cleanup fails. Confirmed profile cleanup closes that engine's tabs, clears
its profile, then removes its history contributions; failures are explicit.

`cocDesktop.browser.history` exposes bounded `query(search, offset, limit)`, `suggest(search)`,
`delete(url)`, confirmed `clear()`, `setRecording(boolean)` and `onChanged()`.
IPC requires a registered exact-source SPA main frame. Main broadcasts data-free
invalidations to all registered SPA windows after committed saves or storage
failures. Queries return recording state and persistent storage errors; mutations
return explicit failure results. History-only clear preserves profiles, tabs and
recording state. The optional history surface supports older-host detection.

`BrowserHistoryPanel` opens from the desktop browser toolbar menu. It searches
URL/title with bounded 50-entry pages, shows latest visit times and calls
`delete`/native-confirmed `clear`. Main invalidations refresh open panels; failed
queries/mutations and persistent storage errors stay visible. Pausing retains
searchable entries. Opening uses the current panel's dock target and concrete
clone route to mint a fresh default-engine tab. Tab, owner and visibility changes
dismiss the dialog and invalidate replies. Its modal overlay covers Electron
guests and hides native WebView2 surfaces.

`query` uses recency pagination for the History panel. `suggest` searches the full
retained URL/title index case-insensitively and returns at most eight entries:
URL prefixes (including scheme-omitted prefixes), recency, visit count, then
stable URL order. Blank/whitespace-only input returns zero entries without searching
the index; explicit `query` retains full browsing for blank searches. Suggestions include a
case-preserving `completion` URL or scheme-omitted URL for prefix matches;
title/substring and whitespace-padded input has null completion. Both
APIs await queued saves, filter expiry and return recording/storage-error state.

### Windows ClickOnce activation

`packages/coc-desktop/src/browser-clickonce.ts` validates HTTPS deployment URLs and
download MIME `application/x-ms-application`. Both engines intercept navigation,
redirects and new windows without adding launch visits to CoC history.
Main validates the exact registered owner, view and source document and permits
one in-flight activation per view. With the installation-wide preference enabled,
recognized links dispatch directly without a CoC confirmation. Windows may show
its own installation or trust prompts.

Windows x64 activation uses the documented
[`dfshim.dll!LaunchApplication`](https://learn.microsoft.com/en-us/visualstudio/deployment/clickonce-unmanaged-api-reference)
in an isolated helper, without WebView2 initialization, shell interpolation or a
local manifest. The original HTTPS activation URL/query travels unchanged through
stdin, never argv, launch logs or persisted launch records. Redirect recognition
retains the original URL when the engine supplies a correlated chain. URLs must
be at most 2048 UTF-16 units, without credentials, fragments or whitespace.

Browser profiles, cookies and OS-account SSO remain engine-owned. Windows deployment
performs its own authentication; browser cookies are not transferred. Missing
handlers, unsupported platforms, cancellation and activation failures are explicit.
Accepted requests stay silent; acceptance means Windows took the request, not that the application opened.
Timeout/process failure has an unknown outcome and must not auto-retry.
Live engine tests stub activation; `--clickonce-check` probes the system DLL/export
without installing or launching an application.

### Browser adapters and lifecycle

Electron browser tabs use sandboxed DOM `<webview>` guests; WebView2 uses a Windows x64 Rust STA helper ([native contracts](../../../../../packages/coc-native/AGENTS.md#desktop-webview2)).
Probes create no views; failures have no fallback/automatic installation. Navigation, layout and events are engine-neutral; related tabs/popups inherit engine/profile. Electron downloads use desktop main’s download manager; WebView2 reports an explicit source-page system-browser fallback without replaying the download URL. Opted-in Windows ClickOnce requests use the shared activation policy.
Pages have no CoC bridge, use normal TLS and deny sensitive permissions; HTML previews stay Electron.
WebView2 placement combines renderer-relative DIP bounds with Electron's physical screen content origin. The helper maps that origin into the parent HWND's client coordinates and DPI-scales only relative bounds, keeping pages aligned below Windows menu bars through moves, zoom and fullscreen. It raises the child HWND without activation; null bounds hide it for inactive tabs and DOM overlays.

`browser-webview-guard.ts` registers exact main SPA documents and denies every
other embedder. `sanitizeWebviewAttach` replaces renderer preferences and strips
preloads and privilege attributes. Owner/source-bound tokens expire after 30
seconds unless adopted; main wires navigation, popup, download and state handlers
at guest creation, before loading. Renderer adoption uses the first `dom-ready`,
when stock Electron exposes `getWebContentsId`, and rejects foreign/reused guests.

`BrowserWebviewLayer` mounts once beside `App` and retains each guest outside keyed workspace subtrees. Placeholders register in `browserWebviewLayerStore`; fixed hosts track their rectangles and clip to ancestor overflow viewports. Hidden hosts use visibility and pointer-events, never display. Close and `onClosed` remove guests, with identity checks rejecting late open replies.

`BrowserToolbarMenu` and `BrowserAddressBar` portal dropdowns above the live
Electron page. The address combobox consumes optional `browser.history.suggest`:
main ranks up to eight URL/title matches and supplies case-preserving prefix
completions. Blank/whitespace-only input makes no suggestion requests and renders
no dropdown or completion. Clearing discards entries/selection and invalidates
in-flight replies. Local typed text survives Escape; deletion, caret moves, paste
and IME suppress automatic suffix selection. Owner/revision checks reject stale
queries; history invalidations refresh open nonblank results.

Standard address Copy writes an escaped HTTP(S) title anchor as `text/html` and
the exact URL as `text/plain` only for a fully selected, unedited current page.
Blank titles use the URL label. Main publishes owner-scoped `committedPage`
URL/title/revision pairs from source-qualified successful-document events,
independent of history recording; popup history cannot alter the pair.
Main-document navigation and failures revoke it. Title updates retain
the revision. Edited submissions become eligible only when their document commits.
Partial selections, drafts, blank addresses, cut, file previews and older hosts
retain native editing. Clipboard failures leave default copy enabled and visible.

Optional `browser.showAddressMenu` opens native Cut/Copy/Paste/Select All through
registered-main-frame IPC; actions target the requesting SPA's web contents.
Native Copy and the Edit menu dispatch the input's ordinary copy event. The
page title belongs in the tab label; the site icon replaces the tab's globe.
Browser tabs ignore title length: `UnifiedPanelTabStrip` gives each a 160px basis
that shrinks evenly to 96px before the row scrolls, ellipsizing the label; other
kinds stay content-sized (max 180px) and non-shrinking.
Icons travel as `BrowserViewState.favicon`, a `data:image/...` URL whose bytes
match a known image signature (at most 64 KiB, `browser-favicon.ts`). Electron
loads the first of three page-declared HTTP(S)/data candidates from
`page-favicon-updated` through its profile session's `fetch`; WebView2's helper
reads `GetFavicon` PNG output on `FaviconChanged` and successful completion
(runtimes without `ICoreWebView2_15` keep the globe). Both clear the icon when a
new document starts or commits and drop superseded requests; error states and
file previews never carry one, and the manager re-validates before owner-routed
publication. The SPA keeps icons in memory per tab (`browserTabFavicons.ts`),
never persists or requests page URLs, and keeps the globe on absent or failed
images. The toolbar's Import cookies action opens
`BrowserCookieImportDialog` with an editable domain and JSON or `name=value` pairs.

### Desktop downloads

`browser-view-host.ts` owns one `BrowserDownloadStore` (`browser-downloads.ts`) at
`<desktopDataDir>/browser/downloads.json`. All workspaces/windows in that process
share its 500-record bound, 90-day pruning on save and 20-live-transfer limit.
Atomic serialized writes coalesce progress; storage failures remain visible.
Records retain filename, safe host label, time, byte counts and native-selected
file identity/path; public metadata excludes paths, request URLs and credentials.
Shutdown cancels live handles, marks them interrupted and drains saves. Startup
never restores live handles or offers retry/resume for interrupted transfers.

`electron-downloads.ts` retains Chromium's original transfer and native Save dialog,
including overwrite selection; the renderer supplies only managed IDs and actions.
Pause/resume require live engine capability, and Open/Show require a completed,
unchanged regular file. Clear/remove affect records only. Source navigation or
close does not own the session's download handles. ClickOnce interception runs
first. WebView2's native bridge supplies no retained operations: Downloads explains
its unavailability and directs the user to open the source page in the system
browser. Download URLs are never automatically replayed.

Optional `cocDesktop.browser.downloads` exposes `query`, ID-only `action` and
payload-free `onChanged`. IPC and broadcasts require registered exact-source SPA
main documents. `BrowserDownloadsPanel` uses the shared modal/focus and native
view overlay contracts, ignores stale replies, and dismisses on owner/visibility
changes. Web dashboards and older desktops show explicit unavailability. The
feature needs updated desktop main/preload and SPA; no experimental flag applies.

### Desktop browser control

`shared/file-path/browser-control-relay.ts` attaches to existing local/clone
sockets. Only preload hosts with `browser.control` advertise capability. A visible
conversation publishes its concrete owner and panel scope through
`browser-control-scope.ts`, preserving repo-group and clone routing. Main binds
that scope separately from each structured command, requires a registered
exact-source SPA main frame, and resolves owner-qualified tab ids against URL
views sharing the concrete session key. File previews and other clones stay
outside this scope; Electron URL popouts inherit their opener's owner.

Main reveal events open or reuse ordinary descriptors through
`openUnifiedPanelTab`, including collapsed/unmounted panels. Existing descriptors
retain their original panel scope. `BrowserHostManager.executeControl` returns
raw contract results; conversation selection, output hints and deltas belong on
the server. Subtree/all snapshots include a separate full interactive baseline.
Each view retains one `BrowserControlPage` and serial command queue across
navigation. Input commands activate the owner window and selected hosted view;
Electron focuses the exact guest element and WebView2 transfers native focus. Explicit frame key presses
require visible ancestors and focus in that document, excluding descendant frames, and preserve the
active element and selection. Shared DOM reads transport-page markdown at `command.offset` in
8000-character slices with `textTotal`; evaluation returns values or visible
exceptions. CDP screenshots return inline JPEG base64 with a 1280px
width limit and optional ref crop. No debugger API reaches the renderer.

Cancellation, workspace changes, reload and owner close reject IPC calls and
cancel queued actions. Outstanding CDP calls retain the serialization barrier
until they settle; release events complete dispatched key/mouse presses. The
local-only Electron relay fixture exercises WebSocket, SPA tab creation, preload,
main, trusted input, markdown, evaluation, JPEG crops and popup discovery.

### Browser human takeover

Default-off `browserControl.humanTakeoverEnabled` advertises explicit desktop support.
Main's `BrowserHumanTakeover` owns an in-memory exact owner/workspace/process/turn gate
across claimed URL views and popups. Toolbar Take over and `request_human(text)` pause
dispatch immediately; issued input settles required releases before human ownership.
Server and IPC deadlines compose with navigation holds; provider deadlines keep running.
Late observations are discarded. Stop, disable, disconnect, close and turn finish
terminate pending work; reconnect never replays a revoked turn.

`BrowserHumanTakeoverStrip` lives in the browser toolbar. Explicit Return refreshes
ordinary context without input values, then preserved work validates opaque document,
frame and mutation stamps. Unprovable or changed targets return `stale-action` for
replanning; issued unknown outcomes never replay. Tool-queue revision capture covers
commands delayed on the server. Paused scopes survive workspace switches with background
control off; Return requires the owning foreground surface. Snapshots and credentials
never enter handoff state persistence. Runtime state and optional notes stay in memory.

### Background browser control

With default-off `browserControl.backgroundEnabled` (runtime flag
`browserBackgroundControlEnabled`) and a desktop exposing `control.retainScope`,
switching workspace keeps every scope with an active turn retained: the relay
retains it before rebinding, advertises it in `background`, and runs its commands
with `execute(request, routingRef)` without cancelling them. Background reveals
create the guest unseen and never change the hash. Desktop actions that cannot run
hidden fail before dispatch with `foreground-required:`; the relay then sends
`browser-command-waiting` (the server pauses its 60s limit) and publishes one
`browser-control-notice.ts` entry per turn, rendered by the app-shell
`BrowserControlSwitchBackNotices` with Switch back and Stop. Switch back opens
`#repos/<panel scope>/chats/<processId>` (repo group or clone key); once that ref
is foreground again, waiting requests re-run. Turn finish, tab close, server
cancel, flag off, socket close and dispose reject and clear them. Other background
errors return unchanged. With the flag off, switching cancels active agent work;
human takeover retains its private pause until explicit Return or termination.

Site approval (live `browserControl.navigationApprovalEnabled`, default on) gates
agent-driven main-frame loads while a control turn is active on the view, its
control popout or a tab `open` is creating. Electron holds the profile session's
mainFrame `webRequest.onBeforeRequest` callback (before any request, per redirect
hop, POST bodies kept); WebView2 cancels cross-host http(s) new documents in
native `NavigationStarting` and re-issues `navigate {approved:true}` on Allow
(back/forward/reload and same-host loads pass; a re-issued POST becomes GET).
Main sends `coc-desktop:browser-control-navigation-check` to the routing window and
accepts `...-navigation-decision` only from it; a held check pauses the view queue
and that conversation's 60s deadlines (`ControlDeadline`). Turn finish, tab/popout
or owner close and dispose deny held checks. The SPA relay forwards
source-matched checks as `browser-navigation-check`, denies when disconnected or on
close/dispose, and shows server prompts as `BrowserNavigationApprovalCard`
(Allow once / Always allow / Deny) inline in the conversation, or floating when
that chat is not mounted. Manual navigation, iframes and file previews never ask.

With default-off `browserControl.framesEnabled`, a main-owned per-view registry
maps opaque frame handles to default-world contexts and private OOPIF sessions.
Electron debugger events and WebView2 native event receivers supply lifecycle
invalidation; candidate OOPIFs require an authenticated embedding in the selected
view before initialization. Both engines retain their selected runtime and fail
explicitly when frame capabilities are unsupported. No debugger API reaches SPA.

Frame-aware DOM extraction stays document-local and budgeted; host composition
labels frames/origins without duplicate same-origin traversal. Refs share one
view-lifetime counter and bind document generations. Input translates through
ancestor frame geometry, clipping, scroll and focus. `browser-control-clip.ts`
shares document-local root/body overflow propagation and containing-block-aware
content-box clipping between DOM targets and frame owners. Absolute/fixed
descendants escape overflow boxes below their containing block; positioned,
transformed and paint-contained clipping ancestors retain their clips.
Verified OOPIF clicks use private frame
sessions with local coordinates after ancestor and target hit tests. Discovery, staged text,
nodes, refs and protocol events are bounded; detach/navigation/close revoke
pending results. Frame state is memory-only. With the flag off, existing control
semantics remain unchanged and frame subscriptions/sessions are absent.

`paste_html(ref, html, text, replaceClipboard?)` requires both frame control and
default-off `browserControl.richPasteEnabled` on the owning server. The main-process
clipboard barrier serializes writes across owners/workspaces/engines. It refuses
nonempty clipboards unless replacement is explicit, never reads old contents,
and leaves supplied HTML/plain formats in place. The ref must identify the focused
contenteditable containing the selection; paste neither clicks nor selects all.
Document/selection checks surround clipboard writes and trusted Ctrl/Cmd+V.
Trusted paste delivery is acknowledged, not persistence; errors after dispatch
report unknown outcomes without automatic retry. Synthetic real-engine rich-paste
tests require `COC_DESKTOP_RICH_CLIPBOARD_E2E=1` because they replace the OS clipboard.

### Shared web-page zoom

`browser.setPageZoom(percent)` validates 50-200% in 25-point steps; reset is 100%.
`BrowserHostManager` serializes mutations, persists the desired value and updates every
URL guest, including hidden workspaces/windows and pending startup. New/restored URL
views inherit it; native navigation retains it. Preference broadcasts refresh toolbar
readouts in every window of that desktop process. Independent desktop processes
share disk preferences but have no live cross-process synchronization.

Electron sets the authorized guest's `WebContents.setZoomFactor`, retaining pending
attachment values and reapplying them after navigation. URL guests disable background
throttling so hidden tabs process zoom/layout updates; file previews retain their
existing throttling. WebView2 uses controller
`SetZoomFactor` through typed helper commands. Per-tab native zoom cannot override the
shared setting. The toolbar's Web page zoom controls are separate from app zoom and
show unavailable/disabled states without a supported bridge/engine. Apply failures
are surfaced; persistence records desired zoom even if a guest fails to apply it.
The SPA shell, editors, terminals, file previews and system browser are unaffected.

Optional `browser.importCookies(viewId, domain, cookies, relatedEngine?)` accepts a null view id for blank tabs and imports into the related or configured engine profile without opening a page. An existing view id retains its own engine and ownership. The call routes through registered-main-frame, owner-checked desktop IPC to the tab’s retained engine profile, independent of its redirected URL. WebView2 retains its hidden import controller until a replacement controller exists or shutdown, preserving session cookies before the first page.

Main-process validation rejects unrelated domains, invalid fields and partitioned cookies before writes; engine failures omit cookie values. Imports coordinate with profile cleanup and never navigate. JSON retains attributes, supplied expiry/session semantics and exact values, including literal double quotes and backslashes escaped with JSON syntax. Pairs retain quotes/backslashes literally, trim surrounding spaces, and use host-only, secure cookies at `/` with SameSite Lax and expiry 30 days from import. Both engines receive Unix-second expiry in their installation-wide profiles. Values reject controls, non-ASCII characters, spaces, semicolons and commas; pairs reject controls before trimming. Size and batch limits apply.

Optional `browser.siteInfo(viewId, sessionKey)` backs the address pill's leading **View site information** popover (`BrowserSiteInfo.tsx`). Registered-main-frame IPC reaches `BrowserHostManager.siteInfo`, which requires the exact owner/view/session and describes the committed document, never an address draft; a reply is refused (`busy`) once a newer commit, load or failure replaces it, and the SPA closes the popover and drops late replies when owner, view, document or visibility changes. Connection states: `secure` only when the engine rejects invalid certificates with no bypass (Electron; its profile's observe-only `setCertificateVerifyProc` keeps Chromium's result with `-3` and records the verified certificate per host for issuer/expiry), `https-unverified` for WebView2 (its default TLS interstitial can offer to proceed and the helper reports no certificate), `insecure` (HTTP), `certificate-error` (Electron net errors −200…−299; WebView2 helper statuses 1–5 in `Navigation failed (<status>)`), `failed`, `loading` and `unknown`. Cookies are a count for the committed URL only (Electron `cookies.get({ url })`; WebView2 `Network.getCookies` over its view CDP transport), never names or values; read failures are explicit. Site settings show the fixed deny-by-default permission policy; there are no per-site settings. HTML page tabs show the same control with a static local-file description and no IPC.

Electron `cookies.set` and WebView2 `CreateCookie`/`AddOrUpdateCookie` receive values without unquoting or decoding. Import compatibility does not guarantee site authentication. Cookie text stays in dialog memory. Native surfaces use `useNativeViewPlacement`: modals hide them globally; visible tab menus and `data-native-view-overlay` elements hide only intersecting views, including overlaps between hit-test probes. Dismissal restores placement; disposed callbacks cannot restore a previous owner. DOM webviews stay visible under menus, dialogs and toasts.
The sandbox preload captures renderer pointer/focus events. Owner-validated `browser-host-focus` IPC restores renderer focus and sends the visible WebView2 view a `focus-host` command, which transfers native keyboard focus to its parent HWND without joining input queues.

The browser toolbar handles Ctrl+L (Cmd+L on macOS); native engines forward
`onFocusAddressRequested` to the owning renderer after returning host keyboard
focus. Only the matching active, visible browser tab focuses and selects its
complete editable address, including unsent edits.

Reload keys belong to the focused browser surface, never the app menu. The
desktop View menu keeps Reload/Force Reload as items without Ctrl/Cmd+R or
Ctrl/Cmd+Shift+R accelerators, since a full SPA reload closes every hosted
view. A focused, visible Electron URL guest reloads itself on Ctrl/Cmd+R
(Shift bypasses the cache); a focused HTML preview guest reloads on Ctrl/Cmd+R;
WebView2 keeps its native browser accelerators, which act only with native
focus. The browser toolbar (address bar and buttons, not portaled popovers)
reloads its active, visible tab on plain Ctrl/Cmd+R. Focus anywhere else leaves
the key to that surface.

Both tabs hide on unmount and close with their tab; entry-point `onClosed` reaches inactive stores and removes guest hosts via `closeBrowserPanelView`. Window teardown and full SPA reload (`manager.reloadOwner`) close all views. Persisted HTML descriptors reopen files from disk with fresh history, scroll and form state; URL tabs remain session-only.
Live desktop `test/e2e/browser-engines.e2e.test.ts` uses `COC_DESKTOP_E2E=1` and `--fileParallelism=false`; headless Linux needs Xvfb/`COC_DESKTOP_E2E_NO_SANDBOX=1`.

Pop-out buttons draw the SVG `PopOutIcon` (`features/canvas/components/icons.tsx`),
**never a text glyph**: U+29C9 `⧉` is missing from the UI font stack on common Linux
desktops, making a glyph-only button an invisible click target. `DevToolsDialog` imports
that icon; `MarkdownReviewDialog` and `SourceCanvasNotePopOutButton` keep local copies.

`features/dev-tools/DevToolsDialog` pops out `#popout/dev-tools` under window name
`coc-dev-tools`; `entry.tsx` routes that hash to `layout/PopOutDevToolsShell`, rendering
`DevToolsPanel` under `ThemeProvider` only — the tool cards are pure client-side widgets
with no API or app-state dependencies, so the URL needs no query parameters.

## Key contexts

| Context | Purpose |
|---------|---------|
| `AppContext` | Global app state, workspace selection |
| `QueueContext` | Queue state, enqueue/cancel actions |
| `TaskContext` | Task-file selection and task-change signals |
| `ToastContext` | Toast notification queue |
| `FloatingChatsContext` | Floating chat window management |

`App.tsx` reports `AppContext.selectedRepoId` via
`client.workspaces.reportActiveWorkspace({ clientId, workspaceId })` on mount, on
workspace change, and on a 60s heartbeat. The client ID is session-scoped in
`sessionStorage` so multiple tabs report independent active workspaces without collapsing
multi-repo state. The server uses these reports to refresh that workspace's Pull Requests
and Work Items caches immediately, then every 5 minutes while activity continues.

## Key hooks

| Hook | Purpose |
|------|---------|
| `useApi` | HTTP client wrapper |
| `useWebSocket` | WebSocket connection management |
| `useMarkdownPreview` | Shared markdown rendering pipeline |
| `useMarkdownDocumentSession` | Markdown load, dirty state, save/flush, refresh, conflict, `beforeunload`, keyboard-save kernel |
| `useDiffComments` | Inline diff comment state |
| `useUnseenChat` | Read/unread tracking |

`useMarkdownDocumentSession` is shared by Notes and `MarkdownReviewEditor` through
injected I/O adapters, putting NoteEditor's load, switch-to-rich, conflict-load-disk, and
notes-changed-reload paths on one code path. Its pure helpers live in
`shared/markdown-document/markdownRichConversion` (`markdownToRichEditorHtml`,
`richEditorHtmlToMarkdown`, `buildImageMarkdown`, `insertTextAtSelection`), composing
front-matter split/compose, markdown⇄HTML, and image/PDF URL rewriting;
`rewriteHtmlImageSrc` rewrites `<img src>` and `data-pdf-url` `.attachments/…` paths to
the notes image API.

`.pdf` embeds (`![label](x.pdf)`) round-trip through the `pdfBlock` Tiptap node
(`react/features/notes/editor/extensions/pdfBlock.tsx`). Its `pdfBlockUrl` policy renders
only exact same-origin Notes `image`/`local-image` PDF routes in an unsandboxed
browser-native iframe, keeps other HTTP(S) PDFs link-only, and exposes no active URL for
unsafe values. External-open wording reads the preload-backed `isDesktopShell()`
capability; Insert PDF uploads through the notes image endpoint.

## Chat load performance (per-conversation request budget)

The target for a **warm** second open — same session, same workspace, provider already
seen — is **≤2** round-trips: process detail and `pull-request-chat-bindings?taskId=`.
(`canvases?processId=` moved to the right panel's `+` menu, so it is no longer part of
opening a chat.) The persistent `stream?warm=1` SSE EventSource is
excluded and opens only for running conversations. There is no aggregation or bootstrap
endpoint; the wins are client caching, re-keying, deferral, and cache headers.

### Static config client cache

`react/api/staticConfigCache.ts` is a module-level singleton mirroring the AppContext
`ConversationCacheEntry` `{value, cachedAt}` + 60-minute-TTL pattern — deliberately
**not** React-Query or SWR.

- `getOrFetchConfig(key, fetcher, ttlMs?)` — hit, or one fetch on a miss; dedupes
  concurrent same-key fetches; does **not** cache failures.
- `peekConfig(key)` — synchronous seed, so a warm reopen paints with no loading flash.
- `invalidateConfig(key)` — drops one key.
- `configCacheKey` — `.models` / `.reasoningEfforts` / `.effortTiers(provider)` per
  **provider**, `.llmToolsConfig(workspaceId, baseUrl)` and `.repoPreferences(workspaceId, owner)`
  per **server and workspace**. Invalidation revokes pending cache publication without
  cancelling existing callers.

Readers: `hooks/useModels.ts`, `useProviderModels.ts`, `useProviderReasoningEfforts.ts`,
`useProviderEffortTiers.ts`, `features/repo-settings/LlmToolsPanel.tsx` `loadConfig`, and
`features/chat/sessionContextDrop.ts` `useConversationRetrievalCapability`. The tool
settings and retrieval check share the selected server's key, including synchronous
warm seeds; identical workspace IDs on different servers stay isolated.
`test/setup.ts` clears the singleton in a global `beforeEach`.

Each mutation drops only its own key: `setEnabledModels` → `models:<provider>`,
`setReasoningEffort` → `reasoning-efforts:<provider>`, `effortTiers.save()` →
`effort-tiers:<provider>`, `LlmToolsPanel`'s toggle → the selected server/workspace's
LLM-tools key after a successful `updateLlmToolsConfig`.

### Workspace-scoped data is not refetched per conversation

`api/workspaceReads.ts` shares concurrent Git-info and queue reads by routed
client and workspace, releasing requests on success or failure. It retains no
settled snapshots. Explicit queue refreshes supersede pending snapshots; older
readers receive the replacement result. Scope cleanup invalidates sharing of
pending queue reads so remounts revalidate without cancelling other consumers.
Queue/history caches use
`workspaceReadCacheKey(workspaceId, source)` to isolate remote and container owners.
`taskDataLoaded` distinguishes loaded empty queues from stats-only placeholders;
`taskRevision` changes only with task snapshots and guards delayed REST writes in
the reducer. `RepoDetail`'s `useWorkspaceQueueSeed` and `RepoChatTab` reconcile on
mount and the owning socket's reconnect, including pending requests. Failed reads
retain confirmed rows and report errors; reconciliation adds no polling.

`queue/hooks/useRepoQueueStats.ts` shares eligible rows through `useRepoQueueJobs`;
the selected group's queue stays independent of its members. Owner-aware readers
exclude mismatched sources and unresolved remote selections. `RailHoverPreview`
provides anchored pointer/focus previews for running, queued and pinned controls.
`RailJobMetadata` shares status/type and execution-mode presentation. Queue and
pinned reads use `shared/queue-job-mode.ts` to batch current process modes without
transcripts, verify each execution workspace, preserve Ralph identity and omit
unknown modes. Committed mode changes invalidate active queue snapshots through
the existing WebSocket channel; pills add no browser reads or polling.
Pinned rows use the owner's complete pinned-process endpoint plus the chat list's
live pin/archive state and visibility rules; group scope does not aggregate member
pins. Unpin uses the shared `setChatPinned` action with canonical process IDs,
retains pending rows, rejects duplicate clicks and reports failures. Successful
unpins remove snapshot rows and supersede older reads; owner changes discard late
results and rollback. Row removal moves focus to a neighbor or a stable rail
control. Scope or transport changes dispose previews. Rail trigger clicks expand
the sidebar; row actions stay collapsed, and `queueJobHash` preserves owner routes.

### Collapsed-rail Git tiles

`RailGitSummary` supplies changes, sync and branch-spine tiles for Git repos and
groups with live members through `SplitWorkspacePanel`'s collapsed-only `railGit`
slot, reusing `RailHoverPreview`.
Hosts own `useRailGitSummary`'s status readers and pass their state to the rail
views. Repos read git-info plus working-tree changes from their owner; groups
batch member git-info on the group's server and list each member's own branch.
`RepoChatTab.handleRefresh` shares expanded and collapsed refresh duties,
awaiting chats, full pins, aggregate feeds and the host's Git reader independently.
Manual Git reads work with the sidebar expanded or collapsed, bypass server
freshness/backoff, and reject failures rather than returning cached or empty success.
`git/changes?refresh=true` selects Forge's strict working-tree status read;
ordinary working-tree callers retain their existing error policy.
Busy covers every domain; partial errors retain successful reads and report
through the existing toast. Refresh preserves drafts, selection, filters, scroll
and collapse without navigation, Git fetch/pull or scheduling mutations.
Changes count distinct paths with conflicts first; sync compares only against the
reported `upstream`. Unknown, failed, detached and no-upstream states never render
clean or 0/0. Reads run on mount, owner change, preview open and `ReposContext`
git-info refreshes; tiles open the expanded Git half (branch overview or member).
The repository preview's branch row embeds `BranchPickerModal` with its explicit
owner client and raw workspace id. Search, current-branch indication and paging
share the Git header picker. Owner changes discard pending reads; unsaved editor
buffers block switching. Success refreshes the rail without navigation; errors
remain accessible in the picker and existing Git links remain available.

### Collapsed-rail Admin and quota

`features.railStatusActions` (default on, live Appearance setting) adds a bottom
rail group below a separator, only when the panel has a docked `footer`. `SplitWorkspacePanel`
provides that node through `RailStatusSlotContext` to the footer while collapsed;
the footer's `StatusActions` portals a rail Admin gear (same `handleAdmin`, no
`#admin-toggle` id) and passes it as `railContainer` to its
`AgentProviderQuotaIndicator`. The indicator renders a second trigger from the same
hook and dropdown, opening the panel `right` of the rail. Expanding the sidebar
removes the triggers and closes a rail-anchored dropdown. An absent config or SPA
bootstrap flag enables the controls; an explicit saved false disables them.

`api/repoPreferences.ts` shares SPA preference reads for 30 seconds, keyed by
server origin, API prefix and workspace. `useRepoPreferences` supplies the same
response to provider and model selection; provider availability and choice
changes derive locally without refetching. All SPA preference writes and
skill/tool mutations invalidate the affected owner/workspace after success.
Failed reads are not cached, and invalidated reads cannot overwrite newer data.

`features/chat/hooks/useCrons.ts` keys `crons.list` on `[workspaceId, cloneClient]` only —
processId is not a fetch dep; the per-process view is a `useMemo([allCrons, processId])`.

`useUnseenChat`'s `markSeen` / `markAllSeen` / `markTasksSeen` / `markUnseen` return
whether seen-state actually changed (detected synchronously via a `seenMapRef`), and
`RepoChatTab` calls `scheduleUnseenRefresh()` only then, so reopening an already-seen
conversation issues no `count` call.

### Deferral past first paint

Process detail and message render are the critical path. The other two per-conversation
fetches run after first paint via `utils/runWhenIdle.ts` — `requestIdleCallback` with a
`{timeout}` bound so data still loads on a busy page, `setTimeout(cb, 0)` fallback for
Safari and jsdom, returning a disposer.

`usePrChatStatusItems` defers
only the async binding IIFE (`listChatBindingsForOrigin` + association build + detail
fan-out), guarding the idle fire with `generationRef` so an A→B switch never fires a stale
fetch. Both `cancelIdle()` in cleanup.

### Short-lived HTTP cache headers

Four static-config GETs carry `Cache-Control: private, max-age=60` via
`setStaticConfigCacheHeaders(res)` (`src/server/shared/router.ts`), on the 200 path only:
`agent-providers/agent-providers-routes.ts` (`reasoning-efforts`, `effort-tiers`),
`routes/queue-enqueue.ts` (`models`), `routes/api-workspace-routes.ts`
(`llm-tools-config`). Invalidate-on-mutate covers same-session edits, so the header only
bounds cross-reload staleness.

## Feature flags

`featureFlags.ts` holds compile-time flags (`SHOW_WELCOME_TUTORIAL`). Runtime flags come
from `GET /api/config/runtime` with typed accessors in `utils/config.ts`. Most flag-gated
features default off.

| Flag | Accessor | Default |
|---|---|---|
| `workItems.sync.enabled` | — | Usable sync UI only when `workItems.hierarchy.enabled` is also true |
| `pullRequests.autoClassifyTeam` | `pullRequestsAutoClassifyTeamEnabled` | off |
| `features.gitCrossCloneCherryPick` | `gitCrossCloneCherryPickEnabled` | on |
| `features.gitWorktreeExecution` | `isGitWorktreeExecutionEnabled()` | off |
| `features.sessionContextAttachments` | `sessionContextAttachmentsEnabled` | off |
| `features.markdownPanelPreview` | `isMarkdownPanelPreviewEnabled()` | on |
| `features.panelSourceSplit` | `isPanelSourceSplitEnabled()` | on |
| `features.explorerEditorTabs` | `isExplorerEditorTabsEnabled()` | on |
| `features.schedulerDelayHint` | `isSchedulerDelayHintEnabled()` | on |
| `features.htmlPageTab` | `htmlPageTabEnabled` | on |
| `features.quickAskSidenotes` | live server flag | — |
### Unified right panel

The desktop workspace header's single resource-panel control cycles hidden →
docked → expanded → hidden. Classic repository headers and remote/virtual TopBar
share the persisted panel-scope open store and session-only expansion store in
`WorkspaceDockToggle.tsx`. Expansion fills the workspace row while keeping its
content mounted and the header reachable. Close clears expansion synchronously;
Escape restores docked size unless another surface owns it. Programmatic opens
retain an already-expanded panel; the visibility shortcut does not expand.
Mobile clears expansion, and the cycle preserves docked width and tab drafts.
Search and Explorer select or collapse the right-edge navigator independently.
Ctrl/Cmd+T creates and activates a blank browser tab in the visible panel,
using the selected dock target's workspace and concrete clone route. Its address
input receives the existing autofocus. Panel and browser address focus own the
shortcut; other editable and terminal bindings remain scoped to their content.
Body focus routes to the single visible panel, and repeats create no tabs.
Native browser hosts forward source-qualified `onOpenMenuRequested` after
transferring keyboard focus to the SPA; only the matching active browser tab
creates a tab. The `+` and empty-state Open buttons open the shared resource menu.
Ctrl/Cmd+Shift+T (always on, no setting) anywhere in the visible panel restores user-closed web tabs newest-first from a session-only, 20-entry
stack per owner-qualified panel scope and chat (`unifiedClosedBrowserTabs.ts`).
Restores reopen the last URL and title through `browserOpenInput` with a fresh
view id and drop entries whose owner is no longer a target; native hosts forward
source-qualified `onReopenClosedRequested` like the add-tab request. Each
keypress restores at most one tab; repeats restore nothing.
Default-off `features.browserTabShortcuts` adds Ctrl/Cmd+1–9 web-tab
switching (1–8 by visible strip position, 9 the last; other tab kinds are not
numbered) with the Ctrl/Cmd+T focus ownership. Holding the platform modifier
reveals trailing, aria-hidden `Ctrl+N`/`⌘N` pills overlaid on the label tail;
tab boxes never move. Hints hide on release, another chord, blur, a hidden
document, collapse and owner changes. Desktop windows opt in through
`browser.setTabShortcuts`; focused Electron guests (`before-input-event`) and
WebView2 views (`AcceleratorKeyPressed`) then swallow those digits, return host
focus, and send `onTabShortcut` digits plus unhandled modifier holds to the
owning window. Other windows and HTML previews keep the keys.
Repository-group mode stays scoped to the group while panel requests use the
selected dock target.

The desktop three-column layout keeps the flexible middle pane usable by sharing
the left column's live, workspace-scoped width through `WorkspaceLeftWidth.ts`.
The right-panel maximum reserves that width, both resize handles, and 360px for
the middle pane; the left-panel maximum reserves the dock minimum and the same
fixed space. Viewport clamps do not replace either panel's persisted pixel width,
so the chosen size returns when space becomes available. The collapsed left rail
keeps the new-chat control, per-workspace running and queued controls, and a
workspace-scoped shortcut to the most recent non-archived Sentinel chat. The
Sentinel shortcut follows the chat list's recency and title rules, keeps the rail
collapsed, and routes through the owning local workspace or clone-qualified
remote workspace/group.
Running and queued controls expand the workspace column.

On mount and on a panel-scope chat selection change, the panel reconciles its open
bit with that chat's visible tab view: workspace-owned tabs plus the selected
chat's tabs open it, while an empty view closes it. The selected chat comes from
`selectedTaskIdByRepo[workspaceId]`. Tab descriptors and remembered active tabs
remain stored, and an explicit toggle can keep an empty panel open until the next
selection or reload.

Chat-owned tabs opened while composing with no selected chat live in the draft
`@workspace` scope. A successful matching-workspace submission copies those tabs
into the new chat before selection, rebuilding scope-based ids while preserving
order, active selection, and preview state. The draft copies remain in place, and
inheritance does not reveal a collapsed dock.

Quick Open has an explicit repo or repo-group scope. A desktop repo group owns
Ctrl/Cmd+P even while the panel is closed, and sends
one search request to the group's owning server. Selecting a member result
atomically switches the dock target, opens Explorer mode and the tree, and opens
a result-owned preview without changing the page-level group. Ordinary repos and
Ctrl/Cmd+O retain target-scoped ownership.

Ctrl/Cmd+Shift+F opens the page-level tracked-content overlay from any desktop
repo or repo-group sub-tab. The focused Git Monaco diff buffer seeds the query
through `shared/monaco/focusedSelection`, which resolves the registered editor
from DOM focus and reads its live model range only with Monaco text focus.
Both diff sides register in `MonacoFileDiffViewer`, including right-panel hosts.
Selected text stays literal and multiline: seeding disables regex, preserves
other controls, and leaves execution to Enter. With no selection, saved controls
remain intact. Repeated shortcuts focus the existing dialog; Ctrl/Cmd+F stays
with Monaco. Git review popouts have no content-search host.
Single-click or arrows select a result and read the
file through its clone-qualified owner route into a cancellable, text-only source
preview. Enter, double-click, or Open file preflights the owner and path before
opening the matched line in the unified-panel preview slot. Group results keep
the page and panel scoped to the group and carry the member owner on the tab;
stale membership, offline routing, and deleted files leave the overlay and
existing panel state intact.

Overlay controls persist per clone-qualified repo or group scope in localStorage,
while results remain in memory; reopening restores both during the page lifetime,
and a reload restores controls without searching.
The overlay keeps query controls and filters above a two-pane results/preview
area. At narrow widths it switches between the panes without unmounting results
or losing their scroll and selection. Repository and file groups use
clone-qualified identities; files show their first ten matches until explicitly
revealed, while counts include every returned hit. Collapse and reveal state
reset on each result set, and keyboard navigation follows only visible rows.
Source and row previews highlight the exact server-provided UTF-16 column span,
including regex and multiline pieces, with malformed offsets clamped by the
shared Explorer match-text splitter.

The panel holds Terminal, Notes, files, notes, canvases, and chat diffs as tabs.
The add-menu Terminal action activates the dock-target-owned tab and passes an
ephemeral request to `TerminalView`. Successful session hydration precedes empty-tab
creation through the canonical PTY lifecycle; pending creates coalesce repeated
requests. Existing sessions receive focus, and passive mounting/restoration only
hydrates. Failed hydration surfaces a terminal notice and retries on a new request.
Default-off `features.panelTabGroups` partitions saved order into fixed Tools,
Files, Web and Canvas groups in one strip row. The cap is three, with pinned,
active and preview priority; overflow uses the full saved group in a searchable
native-view-overlay portal shared with canvas compression. Fold state persists
per panel scope at `unified-right-panel:<scope>:groups`, independently of chats.
Moves stay within the kind group and bulk closes retain the panel's guards.
Canvas uses group overflow without a header count chip.

With groups off and default-on `features.panelTabReordering` set to `false`, the
strip divides tools from resources and confines moves to a section. With either
flag enabled, native drag, Alt+Arrow and tab-menu moves share `moveVisibleTab`:
per-chat `orderByScope` orders stable ids without changing ownership, activation or keyed views.
The panel's owner-qualified storage prunes stale/ephemeral ids and retains
preview replacement slots; ordering does not broaden tab restoration.
It has a searchable `+` menu and one right-edge navigator that switches between
the file tree and `ContentSearchPanel`. Both navigator bodies stay mounted after
first use, share the panel-scope navigator width, and route through the selected
dock target. The Search/Explorer pair moves between the file toolbar and tab strip,
and the navigator open state persists per panel scope.
The tab context menu resolves commands against the clicked descriptor. `Copy Path`
appears only for file tabs whose owner and workspace root resolve on the local
server; remote clone paths and non-file resources do not expose it. The docked
Explorer omits its internal Files/Search switch; the standalone Explorer page
retains it. Tab descriptors (never document bodies, terminal output, or credentials)
persist per panel scope in localStorage. Chat-owned `paste`
descriptors use a stable content hash, dedupe by chat and concrete owner, and
are excluded from storage and the `+` menu. `openUnifiedPasteTab` captures raw
text in a panel-scope/resource-id memory map. Panel writes release snapshots
when their last referencing tab closes; inherited draft/chat tabs share them.
Clearing a panel releases its snapshots. `UnifiedPasteTab` reads its snapshot by
panel scope and renders Markdown through read-only `RichEditorCore`, with a raw-text
copy action and no save or dirty-state registration. Every
hosted Sentinel chat gets one chat-owned `todo`
tab (`UnifiedTodoTab`, `resourceId` = the ledger's parent process id) reading its
ledger from the owning server through `client.sentinelTodos.get` with `full: true`;
only the descriptor persists. To-do activation hides Explorer through the existing
panel-scope navigator open bit, preserving Search mode, resource buffers and routing. Explicit reopen survives
item interactions and ledger refreshes; tab reactivation or returning from another
focused content view hides Explorer again. Panel chrome and To-do portals retain
the current view. This boundary follows the selected workspace/chat/tab, including
excursion tabs.

The panel always uses list/detail presentation:
at 660px the panes scroll independently; narrower panels use selection and Back.
Visited detail editors stay mounted across selection and resizing to retain drafts.
Detail Close remembers owner-scoped deselection and restores list focus; pending
item, dependency, PR-outcome and Coda mutations block it.
Detail notes default to expanded; explicit visibility choices share the owner/item-scoped
in-memory `SentinelTodoView` with drafts across refreshes and remounts.
Compact list headers combine wrapping titles, status, priority and shared overflow
actions; job metadata wraps below. Titles take the card's full width; a one-line
repo/Updated row sits under them and moves beside them only in wide cards
(`todo-card` container query, capped at 40%). Identical item/job titles use accessible Open job links,
while distinct job titles remain visible. Full content and controls live in details;
card text uses native selection, with attachment dragging scoped to list-card grips
and detail Attach controls. Grips also attach on click or keyboard activation.
Title pointer clicks after card text selection leave details closed; keyboard
activation opens details.
Events, manual refresh and post-write reloads share
the owner/generation-guarded loader. Writes reuse an in-flight or applied read only
once its snapshot reaches the write's `ledgerRevision`. Pending reads block duplicate manual admission;
reloads retain the snapshot, selection and drafts. Selection or movement between
tracking type and active/Done/Archived groups reveals its containing sections;
other refreshes preserve collapse choices. Collapsing a containing group clears
selection while retaining hidden editor drafts. Read failures surface through the
retry notice. Shared `sentinelTodoRecentPage` includes
all unarchived non-Done items, then recently updated Done within a 50-item budget;
active counts above 50 stay complete and archived history follows Done. Saved
fulfillment determines selection, not job completion. Older-item expansion and
section sorting apply to this selection; dependency,
Overture and Coda controls retain the full snapshot. To-do search (toolbar icon, or
Ctrl/Cmd+F only while focus is in the tab and not in its nested text fields) filters
the full snapshot, including Done, Archived and unloaded-page rows, by literal
case-insensitive words that must all occur across title, notes and Done when; results
keep section order with safe highlights and field excerpts. Selection is read-only;
Escape/Close restores the pre-search view, and search state is never remembered. Job-title previews use owner-scoped compact process reads or Ralph
whole-session task-group summaries, with abortable lazy loading and bounded
per-reference caching. List/latest and detail/all-job titles share compact
mode pills from the ledger projection, with Ralph session identity preserved and
unknown modes omitted. Owner labels resolve each job's server-qualified workspace
from cached local/remote/group metadata; the current repo omits its badge and
remote labels include the configured server name. Exact-owner target labels and
last-known offline names provide fallbacks; unavailable metadata stays explicit
and accessible. Pills add no metadata reads or polling. Execution/review labels never write item verdicts;
reference-only conversations keep navigation without job badges. Default-off live
`sentinelTodoExternalReferencesEnabled` adds typed PR/email/web reference chips to
cards and an external-link editor in the existing detail form. External replacements
and clears preserve conversation attachments; omission preserves external links.
External links follow shared desktop/web navigation without selecting the card or
starting a conversation excursion. References remain display metadata. Detail notes
store and edit raw Markdown but display inline Markdown through `SentinelTodoNotes`
(the AskUser safe renderer: raw HTML escaped, non-http(s)/mailto/relative/hash URLs
become `#`); links stop row propagation, http(s) opens the panel browser, in-app hash
links join the excursion, and a remote ledger qualifies bare `#repos/<ws>` links with
its server. Normal tracking
comes first, then an always-visible Manual tracking
section with its own add form and separate Done/Archived groups. Following an in-app To-do
Job/Ref link starts a per-window, in-memory excursion: visited hosted chats show an origin
bar (Back to Sentinel + breadcrumb) and a transient, owner-labelled pinned To-do tab that is
never persisted. The return route selects the ledger owner's workspace/process on its
concrete server, preserving matching group routes and reapplying an unchanged hash.
Back restores the list's scroll, selection, drafts and link focus. The full
contract lives in `features/repo-detail/unified-right-panel/AGENTS.md`.

### Sentinel To-do categories

Default-off live `sentinelTodoCategoriesEnabled` adds `SentinelTodoCategories`
to the To-do toolbar. Its owner-client loader reads the workspace's ordered set;
the manager creates, renames, reorders and confirms deletes with workspace-wide
item/chat counts. Writes carry set revisions. Concurrent changes retain name
drafts and require explicit revision review; stale deletion previews require a
new preview. `useSentinelTodoEvents` shares its owning-server workspace socket
between ledger and category invalidations, refreshing all chats on
`sentinel-todo-categories-changed`. Owner/transport remounts isolate drafts and
late responses. Unresolved remote owners cannot issue category requests locally.
Active normal items group by workspace category order, retaining display-status
ordering within each section. Headers expose total and attention counts; empty
categories remain visible and nonempty Uncategorized includes missing IDs.
Manual, Done, Archived and search retain their sections with category labels.
Category collapse clears contained selection while keeping editor drafts;
selection or category movement reveals the destination. Items move through the
card menu's keyboard-accessible Move to category group, by dropping an active
normal card's grip on a category section, or through Category selects in the
add/edit forms and the detail pane (non-archived items). Moves are ordinary
revisioned item updates; drops trust only the mount's drag ticket, and unaccepted
drops bubble to the Done reopening target. Add forms default to Pick
automatically (no `categoryId` sent); edit conflicts keep the category draft.

### Sentinel To-do dependencies

Default-off `sentinelTodoDependenciesEnabled` adds `SentinelTodoDependencies` to
each owner-ledger row. Typed graph and exact PR-binding drafts retain captured
revisions through conflicts; rebasing is explicit. Abortable readiness reads
refresh on any ledger revision. A prerequisite-first accessible chain navigates
the same ledger; artifact evidence opens its prerequisite content workspace's
read-only preview on the ledger's owning server.
Waiting/Ready chips and durable evidence-review warnings supplement
fulfillment status. Manual items remain tracking-only; the tab adds no job
launch/retry/cancel or authorization controls.

### Sentinel Refrains and Coda

The automation names are **Refrains** (user prompts), **Coda** (built-in to-do review) and
**Overtures** (one-shot wake-ups); wire names keep `jobs`, `scrubber` and `triggers`.
With the owning server's Refrains flags on, `SentinelRefrains` lists refrains
and hosts Coda as its pinned built-in row. Refrain dialogs, gate status,
Test gate/Resume gate and skip labels are described in the unified-right-panel
`AGENTS.md`. Create/edit auto-compact thresholds use K-token drafts with up to
three decimals; shared `utils/autoCompactThreshold.ts` converts exactly at the UI
boundary while API/storage retain positive safe integer tokens.

`SentinelCoda` mounts after the ledger loads when both live ledger and
Coda flags are enabled; its function child places one inline strip and history in
the list column below Overtures, beside the detail pane. Owner/endpoint remounts isolate async state and drafts.
Its typed owner-routed client reads config/run summaries, starts all-open/selected
assessments, cancels runs and saves revision-bound schedules. Exact owner WebSocket
invalidation and visibility-aware polling refresh runs; chat links share To-do
excursion navigation. Completed details populate a findings context shared by rows,
strip and toolbar with newest-finding precedence. Accept/Undo use recorded revisions;
bulk acceptance freezes those revisions, skips stale items, continues past conflicts
without retrying and stops on other errors. Partial results are explicit and actions
refetch the ledger/findings. Owner remounts stop remaining batch requests.
Auto-Done attribution requires the applied revision; evidence URLs allow HTTP(S).
History lists all retained statuses and lazily reads selected details with abort
and late-result guards. Its read-only log preserves finding states, audit actors,
before/after and exclusions; chat links share owner-routed excursion navigation.
The editor uses browser-safe
`schedule/scrub-cron.ts` validation/presets; the server owns writes and single-flight.

### Sentinel Overtures

`SentinelOvertures` lists owner-bound, nondelegated overtures below the cards.
PR/date authoring uses eligible normal items and owner-server capabilities.
Run now confirms a one-shot wake and never launches jobs directly.

Lifecycle and pending delivery stay separate from item/job/review state; typed
writes carry owner identity and saved revisions. Owner changes isolate async
reads and dialogs. Item links reveal only the target and its containing groups,
preserving unrelated expansion and lazy previews. Terminal Clear retains receipts;
delivered fired wakes leave rows and count automatically, falling back to the empty entry.

Ctrl/Cmd+F focuses the Explorer file filter only while focus is inside the
visible Explorer navigator column. Content tabs keep their own find behavior,
including Monaco and diff find widgets, while panel chrome falls through to
native find.

Content-search rows group hits by repo-relative file path and consume the search
response's line number plus adjacent `before`/`after` lines, so the navigator can
show source context without issuing per-result file reads.

Explorer source-file previews use `shared/file-viewer/useFileContent`: full text
through 10 MB (`10 * 1024 * 1024` UTF-8 bytes), inclusive; larger returned text
is truncated at a complete character and read-only with no save callback.
Trusted/workspace-preview files remain read-only. Native repository blob reads
accept text through 10 MB; larger reads retain the backend size error. Binary
and image read caps, diff language limits, and chat-source API limits are separate.
"Reload from disk" (unified file toolbar, or the pane's floating toolbar) calls
`useFileContent.reload`: an in-place re-read through the same owner-routed read
that confirms before discarding unsaved edits, keeps the buffer on failure or on
edits/saves during the read, and drops answers after a file/owner change.

Explorer editor tabs render the same filename-classified badge or generic
document icon as the file tree. Search-result editor tabs render a decorative
search icon.

With `features.markdownPanelPreview` enabled, unified-panel file tabs for
editable `.md` and `.markdown` files show the shared rendered Markdown view
by default. Their `PreviewPane` toolbar switches to Raw Monaco using the
same in-memory edit buffer; line-targeted navigation opens Raw. The tab's
workspace and concrete clone route continue to own file reads and saves.
Rendered tabs keep a navigation handle for history replay into Raw.
The standalone Explorer and the read-only source canvas are unaffected.

With `features.panelSourceSplit` enabled, dragging a file tab onto the right
half of the panel's editor area, or the tab menu's **Open to the Right**, shows
two file tabs side by side (at most two panes). Opens go to the focused pane;
narrow content (below two 280px panes plus the divider) shows only the focused
pane. The split is in-memory per panel scope and chat and never persisted. A
file in both panes uses one `PreviewPane` buffer; the second pane is a Monaco
editor on the same model. See `unified-right-panel/AGENTS.md`.

The panel's file editors share one navigation history per panel scope,
persisted to localStorage (`unified-right-panel:<scope>:navigation`, versioned;
unreadable entries drop on load). Its pure model stores concrete tab identity,
the file's reopen descriptor, and the Monaco selection (no scroll state).
It coalesces nearby cursor movement in place without dropping the
forward branch, bounds the stack at 50 entries, and suppresses location
recording while replaying Back or Forward. Replay reveals the selection centered
only when it is off-screen, and scrolling never records. Closing a file keeps
its locations: replaying one reopens the file as a preview tab (through the
preview slot's unsaved-edits guard) in the current chat's view and restores the
saved selection. If the replayed file fails to read, all its entries are
dropped, the reopened tab closes, and replay continues in the same direction.
The initiating input is claimed before an asynchronous read failure is known;
after missing entries are exhausted, subsequent inputs retain native behavior.
Entries of another scope are never replayed.
Alt+Left/Alt+Right (Ctrl+-/Ctrl+Shift+- on macOS) and auxiliary mouse buttons
3/4 use the same replay path only when a visible panel owns the interaction,
its active tab is a file, and a destination exists; otherwise browser behavior
is left untouched. Alt+Arrow on a focused strip tab reorders the tab instead
of stepping history.

Unified-panel tabs close on Ctrl/Cmd+W when the visible panel owns keyboard
focus, and on middle-click, through the same dirty-buffer and live terminal
guards as their close buttons. Desktop menus leave Ctrl/Cmd+W unbound to window
close, including Linux; explicit Close and Quit retain their native actions.
Electron URL/HTML guests and Windows WebView2 forward native close requests to
the owning renderer, which accepts only the matching active, visible view.
Git's portal host takes focus on clicks in nonfocusable diff content; editor and
control focus stay intact. Plain Ctrl+W in the active terminal keeps its shell
binding. The tab strip's accessible context menu provides
preview promotion, visible-strip bulk close commands, and file-only path copy and
Explorer reveal. Bulk close targets span the tools/resources divider in
rendered order, exclude tabs hidden under other chats, and run each target through
the protected close flow. File reveal retargets the dock to the owning clone and
uses the existing Explorer active-file tracking path.

Remote-target dialogs additionally fetch the selected server's `/config/runtime`
`gitWorktreeExecutionEnabled` as a **per-target capability signal**, since the local flag
says nothing about a remote host.

`features.sessionContextAttachments` turns same-workspace chat rows, process cards,
queue/history rows, process search results, Ralph session group rows, Work Item
rows/cards, Git commit rows, branch-range headers, and PR rows into copy-drag sources with
pointer-only MIME payloads, and makes the desktop repo-header Ask / Queue Task buttons
copy drop targets seeding queue-dialog chips. Payloads carry stable IDs plus safe display
metadata only (workspace/process ID, title, status, last activity; Ralph groups add
session ID, phase, and ordered child process IDs).

## coc-client integration

The SPA consumes `@plusplusoneplusplus/coc-client` for typed REST transport. Domains:
admin, processes, queue, schedules, tasks, notes, workflows, memory, memoryV2,
skills, preferences, seen-state, work-items, agentProviders, git. The git domain covers
commit/diff/branch helpers, operation history, the patch-transfer export/apply methods
behind cross-clone cherry-pick, and the worktree-execution `listWorktrees` /
`cleanupWorktree` helpers — see [git-and-prs.md](git-and-prs.md).

Local React hooks (`fetchApi`, `useWebSocket`, `seenStateApi`) wrap the client for React
state. Which server a call reaches is [clone-routing.md](clone-routing.md).
