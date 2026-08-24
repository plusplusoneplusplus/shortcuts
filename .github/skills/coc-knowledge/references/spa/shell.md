# Dashboard SPA — Shell & Routing

React-based single-page application served by `coc serve`. Located at `packages/coc/src/server/spa/client/`.

## Entry Point & Shell

- `entry.tsx` — Mounts `App` (main shell) or `PopOut` (floating chat window)
- `html-template.ts` — Server-side HTML generation with inline bundled assets from `client/dist/`
- `client/dist/` is served at the **site root** (not `/static`). Alongside `bundle.js`/`bundle.css` it holds the separately-loaded assets: the Monaco workers, `pdf.worker.js`, and `canvas-vendor/` (`react.js`, `recharts.js`, `papaparse.js`, `tailwind.css`) — the library globals an extension canvas loads into its sandboxed iframe. All are built by `scripts/build-client.mjs`; `dist/` is gitignored.

## Module Layout

```
spa/client/react/
├── App.tsx              # Root React component
├── admin/              # Admin panel & preferences UI
├── chat/               # Reusable conversation rendering
├── components/         # Shared UI components (ContextWindowIndicator)
├── contexts/           # React contexts (App, Queue, Task, Toast, FloatingChats)
├── hooks/              # 30+ custom hooks
├── layout/             # Layout (Router, TopBar, BottomNav, ThemeProvider)
├── features/
│   ├── canvas/         # Canvas side panel: CanvasPanel + ExtensionCanvasView (sandboxed iframe) + KustoView/KustoChart (Kusto query canvas) for AI co-edited documents, code, custom extension, and Kusto canvases
│   ├── chat/           # Chat UI: ChatDetail, ChatListPane, ConversationArea
│   ├── dreams/         # Workspace Dreams review panel with feature/opt-in states, queue-backed run-now task summary, provider-attributed Activity/Admin AI Provider visibility, filters, plain-language card guidance, source evidence links, and card lifecycle actions
│   ├── memory/         # Memory V2 route, facts/review/episodes tabs, repo memory settings section
│   ├── native-copilot-sessions/  # Read-only CLI Sessions tab over native Copilot/Codex/Claude stores (see CLI Sessions Tab)
│   ├── notes/          # Notes UI: NoteEditor, Mermaid zoom/pan, sidebar, multi-root dropdown with modifier/range root selection and bulk root removal (useNotesRoots)
│   ├── pull-requests/  # PR dashboard: attention groups, provider-derived PR helpers, shared provider-id/displayName Team author matching, Team auto-classification triggers, real diff-stat queue badges/risk, deterministic review summary, BatchCommandPanel
│   └── terminal/       # Terminal UI: TerminalView, pin/unpin
├── processes/          # Process detail, DAG visualization
├── queue/              # Queue management (EnqueueDialog, QueueView)
├── repos/              # Repository views, clone/add dialogs, file explorer, Monaco editor
├── shared/             # Feature-level shared (MarkdownView, RichTextInput, SourceEditor, markdown-document session helpers)
├── tasks/              # Task/plan management, inline comments
├── ui/                 # UI primitives (Button, Card, Dialog, Spinner, Badge, Toast)
├── welcome/            # Onboarding (WelcomeTour, FirstStepsCard, FeatureTip)
├── wiki/               # Wiki UI (WikiView, WikiAsk, WikiGraph)
├── types/              # TypeScript type definitions
├── utils/              # Utility modules
└── featureFlags.ts     # Compile-time feature flags
```

Workspace inner-tab navigation is also client-local and workspace-scoped.
`AppContext` persists `repoTabState` under `coc-repo-tab-state` and the full
inner route suffix under `coc-repo-route-state`, dropping unknown sub-tab ids on
hydrate. `Router` records the suffix for every `#repos/<workspaceId>/<subroute>`
hash and expands bare `#repos/<workspaceId>` hashes to the remembered route,
then the remembered tab, then `/chats`. Route parsing, legacy redirects, and
stale-selection clearing live in `layout/dashboardRoutes.ts`: `resolveDashboardRoute(hash, ctx)`
turns one hash into an ordered list of typed `RouteEffect`s (app/queue dispatches
plus `replace`/`replaceState` navigations), which `Router` runs via
`applyRouteEffects`; the parsers and hash builders are built on the per-segment
encode/decode helpers in `layout/routePath.ts` and are re-exported from
`layout/Router` for backward compatibility. Workspace switchers use
`useWorkspaceNavigation()` so TopBar, repo grid, process-sidebar links, and
clone completion all write full hashes. `RepoDetail` treats `chats`/`activity`
and `cli-sessions`/`copilot-sessions` as logical aliases, waits for git
capability loading to finish, and falls back to the chat surface only when the
active sub-tab is absent from the resolved `visibleSubTabs`; that display
fallback does not erase the stored deep route suffix.

Every `#popout/*` opener must test its `window.open` result with
`popOutOpened(handle)` (`react/utils/popOutWindow.ts`) rather than `if (handle)`.
Inside the Electron desktop shell the main process intercepts pop-out-shaped
opens with `{ action: 'deny' }` and rebuilds them as native windows carrying
their own address bar (`packages/coc-desktop/src/popout-window-host.ts`), so
`window.open` returns `null` on success there. A bare null check fires a false
"Pop-out blocked" toast and skips the `markPoppedOut` bookkeeping that drives the
popped-out rails. The desktop allow-list is narrow (same-origin `#popout/` hashes
plus same-origin PDFs), so print preview and OAuth popups still get real handles.
`window.open(url, name)` name reuse works in both hosts: a repeat open focuses
the existing window. Desktop pop-outs have no handle to poll for close, so
handle-dependent restore (the canvas panel's `handle.closed` watcher) degrades to
"stays on the popped-out rail until clicked".

The sidebar Dev Tools button opens `features/dev-tools/DevToolsDialog`, whose
header carries a pop-out button. It opens `#popout/dev-tools` under the window
name `coc-dev-tools` and closes the dialog once `popOutOpened` confirms a window
appeared. `entry.tsx` routes that hash to `layout/PopOutDevToolsShell`, which
renders the same `DevToolsPanel` full-window under `ThemeProvider` only — the
tool cards are pure client-side widgets with no API or app-state dependencies,
so the pop-out URL needs no query parameters.

Pop-out buttons draw the SVG `PopOutIcon` (`features/canvas/components/icons.tsx`),
never a text glyph: U+29C9 `⧉` and friends are missing from the UI font stack on
common Linux desktops, so a glyph-only button renders as an invisible click
target. `DevToolsDialog` imports the canvas icon; `MarkdownReviewDialog` and
`SourceCanvasNotePopOutButton` keep local copies of the same path data.

## Key Contexts

| Context | Purpose |
|---------|---------|
| `AppContext` | Global app state, workspace selection |
| `QueueContext` | Queue state, enqueue/cancel actions |
| `TaskContext` | Active task tracking |
| `ToastContext` | Toast notification queue |
| `FloatingChatsContext` | Floating chat window management |

`App.tsx` reports `AppContext.selectedRepoId` to the server through
`client.workspaces.reportActiveWorkspace({ clientId, workspaceId })` on mount,
workspace changes, and a 60-second heartbeat while a workspace is selected. The
client ID is session-scoped in `sessionStorage` so multiple dashboard tabs can
report independent active workspaces without collapsing multi-repo state. The
server uses these recent active-workspace reports to refresh the active
workspace's Pull Requests and Work Items caches immediately on active-workspace
changes and then on a 5-minute interval while dashboard activity remains
present.

## Key Hooks

| Hook | Purpose |
|------|---------|
| `useApi` | HTTP client wrapper |
| `useWebSocket` | WebSocket connection management |
| `useMarkdownPreview` | Shared markdown rendering pipeline |
| `useMarkdownDocumentSession` | Shared markdown document loading, dirty state, save/flush, refresh, conflict, beforeunload, and keyboard-save kernel used by Notes and MarkdownReviewEditor through injected I/O adapters. Pure conversion helpers live in `shared/markdown-document/markdownRichConversion` (`markdownToRichEditorHtml`, `richEditorHtmlToMarkdown`, `buildImageMarkdown`, `insertTextAtSelection`) composing front matter split/compose, markdown⇄HTML, and image/PDF URL rewriting (`rewriteHtmlImageSrc` rewrites both `<img src>` and `data-pdf-url` `.attachments/…` paths to the notes image API) so NoteEditor's load/switch-to-rich/conflict-load-disk/notes-changed-reload paths share one code path. `.pdf` image-embed markdown (`![label](x.pdf)`) round-trips through the `pdfBlock` Tiptap node (`react/features/notes/editor/extensions/pdfBlock.tsx`). Its `pdfBlockUrl` policy renders only exact same-origin Notes `image`/`local-image` PDF routes in an unsandboxed browser-native iframe, keeps other HTTP(S) PDFs link-only, and exposes no active URL for unsafe values. The same-origin external-open action uses the preload-backed `isDesktopShell()` capability to say **Open in new window** in CoC Desktop and **Open in new tab** in the browser; cross-origin links keep the browser wording. The toolbar's Insert PDF button uploads via the notes image endpoint. |
| `useDiffComments` | Inline diff comment state |
| `useUnseenChat` | Read/unread tracking |

## Chat load performance (per-conversation request budget)

Opening a chat used to fan out ~11 separate requests
(`pull-request-chat-bindings`, `models`, `reasoning-efforts`, `effort-tiers`,
`loops`, `llm-tools-config`, `canvases`, the sidebar `all`, the process detail
`queue_<id>`, `stream?warm=1`, and the unseen `count`). Most were redundant —
static provider/workspace config is identical across conversations, and several
workspace-scoped calls refetched on every conversation switch. The target is a
**warm** second open (same SPA session, same workspace, provider already seen)
that issues **≤3** fetch round-trips — process detail, `canvases?processId=`,
and `pull-request-chat-bindings?taskId=` — excluding the persistent
`stream?warm=1` SSE EventSource (which opens only for running conversations).
The sidebar `all` list is left untouched and there is no new server
aggregation/bootstrap endpoint; the wins are all client caching, re-keying,
deferral, and additive cache headers.

- **Static config client cache** — `react/api/staticConfigCache.ts` is a
  module-level singleton mirroring the AppContext `ConversationCacheEntry`
  `{value, cachedAt}` + 60-min-TTL pattern (deliberately **not** React-Query/SWR).
  `getOrFetchConfig(key, fetcher, ttlMs?)` returns a cache hit, fetches once on a
  miss, dedupes concurrent same-key fetches, and does **not** cache failures;
  `peekConfig(key)` is a synchronous seed used so a warm reopen paints with no
  loading flash; `invalidateConfig(key)` drops one key; `configCacheKey` builds
  the keys (`.models`/`.reasoningEfforts`/`.effortTiers(provider)` per **provider**,
  `.llmToolsConfig(workspaceId)` per **workspace**). The provider-config hooks
  (`hooks/useModels.ts`, `hooks/useProviderModels.ts`,
  `hooks/useProviderReasoningEfforts.ts`, `hooks/useProviderEffortTiers.ts`) and
  the two llm-tools-config consumers (`features/repo-settings/LlmToolsPanel.tsx`
  `loadConfig`, `features/chat/sessionContextDrop.ts`
  `useConversationRetrievalCapability`) all read through this cache, so a
  conversation whose provider/workspace was already seen this session triggers
  **zero** config calls. `test/setup.ts` clears the singleton in a global
  `beforeEach` so it stays transparent to consumer tests.
- **Invalidate-on-mutate** — each settings mutation drops only its own key so the
  next read refetches without a page reload: `setEnabledModels` →
  `models:<provider>`, `setReasoningEffort` → `reasoning-efforts:<provider>`,
  `effortTiers.save()` → `effort-tiers:<provider>`, and `LlmToolsPanel`'s toggle
  → `llm-tools-config:<workspaceId>` after a successful `updateLlmToolsConfig`.
- **Workspace-scoped data is not refetched per conversation** —
  `features/chat/hooks/useCrons.ts` fetches `crons.list` keyed by
  `[workspaceId, cloneClient]` only (processId is dropped from the fetch dep); the
  per-process view is a `useMemo([allCrons, processId])`, so a conversation switch
  re-derives the filtered list with no round-trip and only a workspace change
  refetches. The unseen `count` refresh is gated on a real seen-state change:
  `useUnseenChat`'s `markSeen`/`markAllSeen`/`markTasksSeen`/`markUnseen` now
  return whether they changed seen-state (detected synchronously via a
  `seenMapRef`), and `RepoChatTab` only calls `scheduleUnseenRefresh()` when that
  boolean is true — so reopening an already-seen conversation issues no `count`
  call.
- **Deferral past first paint** — the conversation process-detail fetch + message
  render is the critical path; the two remaining non-critical per-conversation
  fetches run after first paint via `utils/runWhenIdle.ts`
  (`requestIdleCallback` with a `{timeout}` bound so the data still loads
  automatically on a busy page, `setTimeout(cb, 0)` fallback for Safari/jsdom;
  returns a disposer). `ChatDetail` keeps
  `setCanvasPanelClosed(readCanvasClosed(...))` synchronous (no collapse-rail
  flash) and defers only `client.canvases.list`; `usePrChatStatusItems` keeps its
  synchronous resets immediate and defers only the async binding IIFE
  (`listChatBindingsForOrigin` + association build + detail fan-out), guarding the
  idle fire with `generationRef` so an A→B switch never fires a stale fetch. Both
  effects `cancelIdle()` in cleanup.
- **Short-lived HTTP cache headers** — the four static-config GET routes carry
  `Cache-Control: private, max-age=60` (so a cold reload within the window skips
  the round-trip) via `setStaticConfigCacheHeaders(res)` in
  `src/server/shared/router.ts`, applied on the 200 path only:
  `agent-providers/agent-providers-routes.ts` (`reasoning-efforts`, `effort-tiers`),
  `routes/queue-enqueue.ts` (`models`), and `routes/api-workspace-routes.ts`
  (`llm-tools-config`). The 60s TTL is conservative because client-side
  invalidate-on-mutate already covers same-session edits, so the header only
  bounds cross-reload staleness.

## Feature Flags

`featureFlags.ts` defines compile-time flags (e.g., `SHOW_WELCOME_TUTORIAL`). Runtime feature flags are exposed through `GET /api/config/runtime` and SPA helpers in `utils/config.ts`; `workItems.sync.enabled` only reports usable sync UI when both it and `workItems.hierarchy.enabled` are true. Most features gated by flags are disabled by default. Pull Requests Team auto-classification is gated by `pullRequests.autoClassifyTeam` / `pullRequestsAutoClassifyTeamEnabled` and is disabled by default. The Git tab's cross-clone cherry-pick UI is gated by `features.gitCrossCloneCherryPick` / `gitCrossCloneCherryPickEnabled` and is enabled by default. Isolated Git worktree execution for Work Item and Ralph launches is gated by `features.gitWorktreeExecution` / `gitWorktreeExecutionEnabled` (disabled by default); the SPA reads it through the typed `isGitWorktreeExecutionEnabled()` accessor in `utils/config.ts`, and remote-target dialogs additionally fetch the selected server's `/config/runtime` `gitWorktreeExecutionEnabled` as a per-target capability signal. Chat composer drag/drop session-context attachments are gated by `features.sessionContextAttachments` / `sessionContextAttachmentsEnabled`; when enabled, same-workspace chat rows, process cards, queue/history process rows, process search result cards, Ralph session group rows, Work Item rows/cards, Git commit rows, Git branch-range headers, and Pull Request rows become copy-drag sources using custom pointer-only MIME payloads, and desktop repo-header Ask/Queue Task buttons become copy drop targets that seed queue-dialog chips. Single-session payloads contain workspace ID, process ID, title/preview, status, and last-activity metadata; Ralph group payloads contain workspace ID, Ralph session ID, phase/status, title/display label, last activity, and ordered child process IDs. Work Item, commit, range, and PR payloads contain stable IDs/references plus safe display metadata only.

Quick Ask side-notes are gated by the live server flag `features.quickAskSidenotes`. In chat, selecting text in an assistant turn's `MarkdownView` raises a floating pill (`Cmd/Ctrl+J` alternative); the answer attaches a 💡 bubble to the message's collected Side notes row and opens a compact popover. Once answered, the popover is a multi-turn thread: `QuickAskTurnLayer` passes `QuickAskSidenotePopover`'s `reply` control (turns + `Ask a follow-up…` row) whenever the host wires `onFollowUp`, matching the notes and PDF surfaces. Follow-ups go through `useQuickAskSidenotes.followUpSidenote(id, question)` → `POST /api/processes/:id/sidenotes/:noteId/follow-up`, which persists the turn so the thread survives a reload; `retrySidenoteTurn(id, turnIndex)` re-runs a failed turn (index 0 falls back to the original lookup). The live thread is `ClientSideNote.thread`, derived from the persisted `turns` on hydrate; a follow-up in flight marks only its own turn `asking`, so the chip never flips to a spinner. Cap is `MAX_QUICK_ASK_TURNS` (10). Components live under `features/chat/quick-ask/` (`useQuickAskSidenotes`, the selection and anchoring helpers, `QuickAskPill`, `QuickAskSidenotePopover`, and `QuickAskTurnLayer`), with data plumbed from `ChatDetail` through `ConversationArea` to `ConversationTurnBubble`. `QuickAskPill` is a split pill: **✨ Ask AI** (expands into the inline question input) and, when `QuickAskTurnLayer` receives `onAttachContext`, a divider plus **📎 Attach**, which sends the selected text to `useAttachedContext().add(turnIndex, 'assistant', snippet)` and dismisses the pill. `ChatDetail` wraps that `add` in `handleAttachContext`, which also focuses the composer (`richTextRef.current?.focus()`) so the user can start typing right after attaching; the same wrapper serves the right-click menu path. Because the whole layer is mounted only under `features.quickAskSidenotes`, the Attach pill is hidden when that flag is off; the right-click **Attach as context** menu item is the flag-independent path.

The rich Notes editor uses the same selection controls and answer endpoint through `NoteQuickAskLayer`. A successful answer is stored in the note's existing `[^qa-<id>]` reference plus JSON definition format. New definitions optionally persist the exact selected text and its surrounding prefix/suffix; legacy `{"a":"..."}` and `{"q":"...","a":"..."}` payloads remain byte-stable. `SidenoteRefExtension` keeps the payload on the inline ✨ atom and resolves it into a presentation-only `note-quick-ask-anchor` ProseMirror decoration, a 2px dotted blue underline that can span inline formatting without entering the Markdown. Repeated text is disambiguated with context and chip position, unresolved edited anchors omit only the underline, and deleting the chip removes its decoration and serialized definition. The persistence extension remains registered when the flag is off so saved side-notes survive edits; creation and popover controls are inactive, matching the existing saved-chip visibility behavior.

## coc-client Integration

The SPA consumes `@plusplusoneplusplus/coc-client` for typed REST transport. Domain clients: admin, processes, queue, schedules, tasks, notes, workflows, wiki, memory, memoryV2, skills, preferences, seen-state, work-items, agentProviders, git. The git domain includes commit/diff/branch helpers, operation history, patch-transfer export/apply methods used by cross-clone cherry-pick flows, and the worktree-execution `listWorktrees` / `cleanupWorktree` helpers. All four branch-range helpers (`getBranchRange`, `listBranchRangeFiles`, `getBranchRangeDiff`, `getBranchRangeFileDiff`) accept a `base` query of `default-branch` (default) or `upstream`. The Git tab's branch-range view exposes this as a **vs main | unpushed** toggle in `BranchCommitStrip`, labeled with the server-resolved `baseRef`; `upstream` diffs against `@{upstream}` so only unpushed commits show. `useBranchRangeBaseMode` remembers the choice per workspace in localStorage, `useBranchRangeCache` keys entries by `workspaceId:baseMode` (an explicit Refresh drops every mode for the workspace), and `createBranchRangeDiffSource` carries the mode into its file-diff URLs and cache key. When the branch has no upstream the server falls back to the default branch and sets `baseModeFallback`, which the strip surfaces as a one-line note. Branch-range pop-out URLs serialize the mode as `&base=upstream`; the default mode is omitted. `features/git/RepoGitTab.tsx` is a composition shell over the controller family in `features/git/repoGitTab/`: `useRepoGitData` (commits, branch range, repo state, caches, `refreshAll`), `useRepoGitSelection` (right-panel routing, URL hash + AppContext sync, deep links, direct SHA lookup), `useGitOperationActions` (every mutation plus all four job pollers), `useGitAutoPullController`, `useGitSkillActions`, the pure `selectionModel` / `gitPrompts` / `gitContextMenuModel`, and the `RepoGitListPane` / `RepoGitDetailPane` / `RepoGitOverlays` presentation components. Every hook takes `workspaceId` explicitly and reads its client through `useCocClient(workspaceId)`, so all git, queue and preferences traffic targets the selected clone's server. `useGitOperationActions` owns the pull poller and hands it to `useGitAutoPullController`, so a manual and an automatic pull can never poll concurrently; auto-pull skips/failures report through the shared `useTransientToast` rather than the `actionError` banner. The Git tab treats async git operation responses with `jobId` as pending work, polling operation history until terminal status before refreshing; failed Drop Commit jobs render the tab-level action-error banner. Pull, rebase autosquash, drop commit, and reorder share the `useGitOperationPoller` hook (`features/git/hooks/`), which owns each poll's `setInterval` in a ref and clears it on unmount and repo switch, captures the workspace id plus a generation token per `start()` to drop stale ticks, and routes terminal jobs through per-operation `onSuccess`/`onFailure`/`onMissing`/`isComplete` callbacks (lifecycle in the hook, refresh/error semantics in the caller); pull additionally keeps its `pulling` flag and exposes the active job id to the WebSocket `git-changed` handler. The same-clone commit context menu opens `BranchPickerModal` as a local-branch selector for `Cherry-pick to branch…`, sends selected commit hashes oldest-first through `client.git.cherryPick(..., { hashes, targetBranch })`, shows server dirty/conflict errors in the tab action banner, refreshes on success, and keeps the user on the original branch after the server switches back. When enabled, both the single-commit and multi-commit Git context menus open `CrossCloneCherryPickModal` with a `commits[]` (multi-commit selections are ordered oldest-first via `orderOldestFirst`), which lists current-CoC registered workspaces plus online registered remote-CoC workspaces using typed workspace/git-info clients, groups targets by normalized remote URL, recommends same-remote clones, labels each target with its CoC server, requires explicit cross-remote confirmation, and requires explicit dirty-target stash opt-in. The modal exports the whole range as one concatenated `git am` mailbox and reports the applied count ("applied k of N", or a partial count with the conflicting commit on a mid-range conflict). Local targets call `git.exportCommitPatches` + `git.applyCommitPatch` directly; remote targets call the initiating server's `servers.cherryPickTransfer` orchestrator with `source.commitHashes`.

Local React hooks (`fetchApi`, `useWebSocket`, `seenStateApi`) wrap the client for React state management.
