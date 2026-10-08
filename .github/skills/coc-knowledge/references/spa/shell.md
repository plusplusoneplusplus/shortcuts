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
├── wiki/          # WikiView, WikiAsk, WikiGraph
├── types/ utils/  # Types and utility modules
└── featureFlags.ts
```

## Routing

Inner-tab navigation is client-local and workspace-scoped. `AppContext` persists
`repoTabState` under `coc-repo-tab-state` and the full inner route suffix under
`coc-repo-route-state`, dropping unknown sub-tab ids on hydrate. `Router` records the
suffix for every `#repos/<workspaceId>/<subroute>` hash and expands a bare
`#repos/<workspaceId>` hash to the remembered route, then the remembered tab, then
`/chats`.

`layout/dashboardRoutes.ts` owns parsing, redirects, and stale-selection clearing:
`resolveDashboardRoute(hash, ctx)` turns one hash into an ordered list of typed
`RouteEffect`s (app/queue dispatches plus `replace`/`replaceState` navigations) that
`Router` runs through `applyRouteEffects`. Parsers and hash builders sit on the
per-segment encode/decode helpers in `layout/routePath.ts`, re-exported from
`layout/Router`.

Workspace switchers use `useWorkspaceNavigation()`, so TopBar, the repo grid,
process-sidebar links, and clone completion all write full hashes. `RepoDetail` treats
`chats`/`activity` and `cli-sessions`/`copilot-sessions` as aliases, waits for git
capability loading, and falls back to the chat surface only when the active sub-tab is
absent from the resolved `visibleSubTabs` — that fallback does not erase the stored deep
route suffix.

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

SPA side: `desktopHtmlPageBridge()` adapts the `file` source and its attachment metadata to the page API (view `html-page:<pageId>`); web dashboards and remote-workspace paths keep the source viewer. `UnifiedHtmlPageTab` and `UnifiedBrowserTab` share `NativeViewTab` and `NativeViewNavButtons`; their Electron placeholders register with the same persistent guest layer. The HTML toolbar shows a read-only path.

### Browser profiles and preferences

`desktop-browser.json` stores the default (Electron). The Admin **Browser** page (`#admin/browser`, Configure group after AI Provider; desktop shell only, hidden on the web) hosts Desktop Preferences, which uses local IPC, not workspace-server APIs.
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
Electron emits visits after main-document completion and committed same-document
changes, including popup documents; failures/cancellation invalidate pending visits.
`updateTitle` cannot create entries. Recording preferences, deletion and bounded
URL/title search use the same store. Startup and `pruneExpired` maintain retention;
manager shutdown calls `flush` to drain queued writes even when host cleanup fails.

### Browser adapters and lifecycle

Electron browser tabs use sandboxed DOM `<webview>` guests; WebView2 uses a Windows x64 Rust STA helper ([native contracts](../../../../../packages/coc-native/AGENTS.md#desktop-webview2)).
Probes create no views; failures have no fallback/automatic installation. Navigation, layout and events are engine-neutral; related tabs/popups inherit engine/profile and downloads go to the system browser.
Pages have no CoC bridge, use normal TLS and deny sensitive permissions; HTML previews stay Electron.
WebView2 placement combines renderer-relative DIP bounds with Electron's physical screen content origin. The helper maps that origin into the parent HWND's client coordinates and DPI-scales only relative bounds, keeping pages aligned below Windows menu bars through moves, zoom and fullscreen. It raises the child HWND without activation; null bounds hide it for inactive tabs and DOM overlays.

`browser-webview-guard.ts` registers exact main SPA documents and denies every
other embedder. `sanitizeWebviewAttach` replaces renderer preferences and strips
preloads and privilege attributes. Owner/source-bound tokens expire after 30
seconds unless adopted; main wires navigation, popup, download and state handlers
at guest creation, before loading. Renderer adoption uses the first `dom-ready`,
when stock Electron exposes `getWebContentsId`, and rejects foreign/reused guests.

`BrowserWebviewLayer` mounts once beside `App` and retains each guest outside keyed workspace subtrees. Placeholders register in `browserWebviewLayerStore`; fixed hosts track their rectangles and clip to ancestor overflow viewports. Hidden hosts use visibility and pointer-events, never display. Close and `onClosed` remove guests, with identity checks rejecting late open replies.

`BrowserToolbarMenu` portals a dropdown above the live Electron page; the page title belongs in the tab label. Its Import cookies action opens `BrowserCookieImportDialog` with an editable domain and JSON or `name=value` pairs.

Optional `browser.importCookies(viewId, domain, cookies, relatedEngine?)` accepts a null view id for blank tabs and imports into the related or configured engine profile without opening a page. An existing view id retains its own engine and ownership. The call routes through registered-main-frame, owner-checked desktop IPC to the tab’s retained engine profile, independent of its redirected URL. WebView2 retains its hidden import controller until a replacement controller exists or shutdown, preserving session cookies before the first page.

Main-process validation rejects unrelated domains, invalid fields and partitioned cookies before writes; engine failures omit cookie values. Imports coordinate with profile cleanup and never navigate. JSON retains attributes and exact values, including literal double quotes and backslashes escaped with JSON syntax. Pairs retain quotes/backslashes literally, trim surrounding spaces, and default to host-only, secure session cookies at `/` with SameSite Lax. Values reject controls, non-ASCII characters, spaces, semicolons and commas; pairs reject controls before trimming. Size and batch limits apply.

Electron `cookies.set` and WebView2 `CreateCookie`/`AddOrUpdateCookie` receive values without unquoting or decoding. Import compatibility does not guarantee site authentication. Cookie text stays in dialog memory. Native surfaces use `useNativeViewPlacement` to hide for overlapping DOM content and explicit `data-native-view-overlay` elements. DOM webviews stay visible under menus, dialogs and toasts.
The sandbox preload captures renderer pointer/focus events. Owner-validated `browser-host-focus` IPC restores renderer focus and sends the visible WebView2 view a `focus-host` command, which transfers native keyboard focus to its parent HWND without joining input queues.

The browser toolbar handles Ctrl+L (Cmd+L on macOS); native engines forward
`onFocusAddressRequested` to the owning renderer after returning host keyboard
focus. Only the matching active, visible browser tab focuses and selects its
complete editable address, including unsent edits.

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
| `TaskContext` | Active task tracking |
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
  **provider**, `.llmToolsConfig(workspaceId)` per **workspace**.

Readers: `hooks/useModels.ts`, `useProviderModels.ts`, `useProviderReasoningEfforts.ts`,
`useProviderEffortTiers.ts`, `features/repo-settings/LlmToolsPanel.tsx` `loadConfig`, and
`features/chat/sessionContextDrop.ts` `useConversationRetrievalCapability` — so an
already-seen provider+workspace triggers **zero** config calls. `test/setup.ts` clears the
singleton in a global `beforeEach`.

Each mutation drops only its own key: `setEnabledModels` → `models:<provider>`,
`setReasoningEffort` → `reasoning-efforts:<provider>`, `effortTiers.save()` →
`effort-tiers:<provider>`, `LlmToolsPanel`'s toggle → `llm-tools-config:<workspaceId>`
after a successful `updateLlmToolsConfig`.

### Workspace-scoped data is not refetched per conversation

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
| `features.markdownPanelPreview` | `markdownPanelPreviewEnabled` | off |
| `features.htmlPageTab` | `htmlPageTabEnabled` | on |
| `features.quickAskSidenotes` | live server flag | — |
### Unified right panel

The desktop workspace header exposes one visibility toggle for the resource-tabbed
right panel. The classic repository header and remote/virtual TopBar use the same
persisted panel-scope open store. Search and Explorer are peer controls inside the
panel; they select or collapse the right-edge navigator without closing the panel.
Ctrl/Cmd+T creates and activates a blank browser tab in the visible panel,
using the selected dock target's workspace and concrete clone route. Its address
input receives the existing autofocus. Panel and browser address focus own the
shortcut; other editable and terminal bindings remain scoped to their content.
Body focus routes to the single visible panel, and repeats create no tabs.
Native browser hosts forward source-qualified `onOpenMenuRequested` after
transferring keyboard focus to the SPA; only the matching active browser tab
creates a tab. The `+` and empty-state Open buttons open the shared resource menu.
Repository-group mode stays scoped to the group while panel requests use the
selected dock target.

The desktop three-column layout keeps the flexible middle pane usable by sharing
the left column's live, workspace-scoped width through `WorkspaceLeftWidth.ts`.
The right-panel maximum reserves that width, both resize handles, and 360px for
the middle pane; the left-panel maximum reserves the dock minimum and the same
fixed space. Viewport clamps do not replace either panel's persisted pixel width,
so the chosen size returns when space becomes available. The collapsed left rail
receives per-workspace running and queued counts from `RepoDetail`; each nonzero
state has its own accessible control, and selecting one expands the workspace
column.

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
Ctrl/Cmd+P across all of its sub-tabs even while the panel is closed, and sends
one search request to the group's owning server. Selecting a member result
atomically switches the dock target, opens Explorer mode and the tree, and opens
a result-owned preview without changing the page-level group. Ordinary repos and
Ctrl/Cmd+O retain target-scoped ownership.

Ctrl/Cmd+Shift+F opens the page-level tracked-content overlay from any desktop
repo or repo-group sub-tab. Single-click or arrows select a result and read the
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
The strip's divider splits tools (workspace tabs plus the chat's canvases, which
stay chat-owned) from resources (files, diffs, external); tabs never reorder
across it. It has a searchable `+` menu and one right-edge navigator that switches between
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
copy action and no save or dirty-state registration. The full contract lives in
`features/repo-detail/unified-right-panel/AGENTS.md`.

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
guards as their close buttons. Git's portal host takes focus on clicks in
nonfocusable diff content through a native DOM capture listener; editor and
control focus stay intact. Plain Ctrl+W inside the active terminal retains its
shell binding. The tab strip's accessible context menu provides
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
admin, processes, queue, schedules, tasks, notes, workflows, wiki, memory, memoryV2,
skills, preferences, seen-state, work-items, agentProviders, git. The git domain covers
commit/diff/branch helpers, operation history, the patch-transfer export/apply methods
behind cross-clone cherry-pick, and the worktree-execution `listWorktrees` /
`cleanupWorktree` helpers — see [git-and-prs.md](git-and-prs.md).

Local React hooks (`fetchApi`, `useWebSocket`, `seenStateApi`) wrap the client for React
state. Which server a call reaches is [clone-routing.md](clone-routing.md).
