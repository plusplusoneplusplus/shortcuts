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
  `dist/` is gitignored.

## Module layout

```
spa/client/react/
├── App.tsx        # Root component
├── admin/         # Admin panel & preferences UI
├── chat/          # Reusable conversation rendering
├── components/    # Shared UI (ContextWindowIndicator)
├── contexts/      # App, Queue, Task, Toast, FloatingChats
├── hooks/         # 30+ custom hooks
├── layout/        # Router, TopBar, BottomNav, ThemeProvider
├── features/
│   ├── canvas/    # CanvasPanel, ExtensionCanvasView, KustoView/KustoChart
│   ├── chat/      # ChatDetail, ChatListPane, ConversationArea
│   ├── dreams/    # Workspace Dreams review panel
│   ├── memory/    # Memory V2 route
│   ├── native-copilot-sessions/   # Read-only CLI Sessions tab
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
handle-dependent restore (the canvas panel's `handle.closed` watcher) degrades to "stays
on the rail until clicked".

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
seen — is **≤3** round-trips: process detail, `canvases?processId=`, and
`pull-request-chat-bindings?taskId=`. The persistent `stream?warm=1` SSE EventSource is
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

`ChatDetail` keeps `setCanvasPanelClosed(readCanvasClosed(...))` synchronous (no
collapse-rail flash) and defers only `client.canvases.list`. `usePrChatStatusItems` defers
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
| `features.quickAskSidenotes` | live server flag | — |

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
