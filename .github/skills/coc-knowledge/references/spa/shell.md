# Dashboard SPA — Shell & Routing

React single-page application served by `coc serve`, at
`packages/coc/src/server/spa/client/`. This file covers the entry point, module layout,
routing, pop-out windows, contexts, hooks, the per-conversation request budget, the
feature-flag surface, and the coc-client integration.

## Entry point

- `entry.tsx` — mounts `App` (main shell) or `PopOut` (floating chat window).
- `html-template.ts` — server-side HTML generation with inline bundled assets from
  `client/dist/`.
- `client/dist/` is served at the **site root**, not `/static`. Alongside the bundle it
  holds the separately-loaded assets: the Monaco workers, `pdf.worker.js`, and
  `canvas-vendor/` (`react.js`, `recharts.js`, `papaparse.js`, `tailwind.css`) — the
  library globals an extension canvas loads into its sandboxed iframe. All are built by
  `scripts/build-client.mjs`; `dist/` is gitignored.

## Module layout

```
spa/client/react/
├── App.tsx              # Root React component
├── admin/              # Admin panel & preferences UI
├── chat/               # Reusable conversation rendering
├── components/         # Shared UI components (ContextWindowIndicator)
├── contexts/           # React contexts (App, Queue, Task, Toast, FloatingChats)
├── hooks/              # 30+ custom hooks
├── layout/             # Router, TopBar, BottomNav, ThemeProvider
├── features/
│   ├── canvas/         # Canvas side panel: CanvasPanel, ExtensionCanvasView, KustoView/KustoChart
│   ├── chat/           # ChatDetail, ChatListPane, ConversationArea
│   ├── dreams/         # Workspace Dreams review panel
│   ├── memory/         # Memory V2 route: facts/review/episodes tabs, repo memory settings
│   ├── native-copilot-sessions/  # Read-only CLI Sessions tab over native Copilot/Codex/Claude stores
│   ├── notes/          # NoteEditor, Mermaid zoom/pan, sidebar, multi-root dropdown
│   ├── pull-requests/  # PR dashboard: attention groups, Team matching, queue badges, BatchCommandPanel
│   └── terminal/       # TerminalView, pin/unpin
├── processes/          # Process detail, DAG visualization
├── queue/              # EnqueueDialog, QueueView
├── repos/              # Repository views, clone/add dialogs, file explorer, Monaco editor
├── shared/             # MarkdownView, RichTextInput, SourceEditor, markdown-document helpers
├── tasks/              # Task/plan management, inline comments
├── ui/                 # Primitives (Button, Card, Dialog, Spinner, Badge, Toast)
├── welcome/            # Onboarding (WelcomeTour, FirstStepsCard, FeatureTip)
├── wiki/               # WikiView, WikiAsk, WikiGraph
├── types/              # TypeScript type definitions
├── utils/              # Utility modules
└── featureFlags.ts     # Compile-time feature flags
```

## Routing

Workspace inner-tab navigation is client-local and workspace-scoped. `AppContext`
persists `repoTabState` under `coc-repo-tab-state` and the full inner route suffix
under `coc-repo-route-state`, dropping unknown sub-tab ids on hydrate. `Router` records
the suffix for every `#repos/<workspaceId>/<subroute>` hash and expands a bare
`#repos/<workspaceId>` hash to the remembered route, then the remembered tab, then
`/chats`.

Route parsing, redirects, and stale-selection clearing live in
`layout/dashboardRoutes.ts`: `resolveDashboardRoute(hash, ctx)` turns one hash into an
ordered list of typed `RouteEffect`s — app and queue dispatches plus
`replace`/`replaceState` navigations — which `Router` runs through
`applyRouteEffects`. The parsers and hash builders are built on the per-segment
encode/decode helpers in `layout/routePath.ts` and re-exported from `layout/Router` for
backward compatibility.

Workspace switchers use `useWorkspaceNavigation()`, so TopBar, the repo grid,
process-sidebar links, and clone completion all write full hashes. `RepoDetail` treats
`chats`/`activity` and `cli-sessions`/`copilot-sessions` as logical aliases, waits for
git capability loading to finish, and falls back to the chat surface only when the
active sub-tab is absent from the resolved `visibleSubTabs` — that display fallback
does not erase the stored deep route suffix.

## Pop-out windows

**Every `#popout/*` opener must test its `window.open` result with
`popOutOpened(handle)` (`react/utils/popOutWindow.ts`), not `if (handle)`.** Inside the
Electron desktop shell the main process intercepts pop-out-shaped opens with
`{ action: 'deny' }` and rebuilds them as native windows carrying their own address bar
(`packages/coc-desktop/src/popout-window-host.ts`), so `window.open` returns `null` **on
success** there. A bare null check fires a false "Pop-out blocked" toast and skips the
`markPoppedOut` bookkeeping that drives the popped-out rails.

The desktop allow-list is narrow — same-origin `#popout/` hashes plus same-origin PDFs
— so print preview and OAuth popups still get real handles. `window.open(url, name)`
name reuse works in both hosts: a repeat open focuses the existing window. Desktop
pop-outs have no handle to poll for close, so handle-dependent restore (the canvas
panel's `handle.closed` watcher) degrades to "stays on the popped-out rail until
clicked".

Pop-out buttons draw the SVG `PopOutIcon` (`features/canvas/components/icons.tsx`),
**never a text glyph**: U+29C9 `⧉` and friends are missing from the UI font stack on
common Linux desktops, so a glyph-only button renders as an invisible click target.
`DevToolsDialog` imports the canvas icon; `MarkdownReviewDialog` and
`SourceCanvasNotePopOutButton` keep local copies of the same path data.

The sidebar Dev Tools button opens `features/dev-tools/DevToolsDialog`, whose header
carries a pop-out button. It opens `#popout/dev-tools` under the window name
`coc-dev-tools` and closes the dialog once `popOutOpened` confirms a window appeared.
`entry.tsx` routes that hash to `layout/PopOutDevToolsShell`, which renders the same
`DevToolsPanel` full-window under `ThemeProvider` only — the tool cards are pure
client-side widgets with no API or app-state dependencies, so the pop-out URL needs no
query parameters.

## Key contexts

| Context | Purpose |
|---------|---------|
| `AppContext` | Global app state, workspace selection |
| `QueueContext` | Queue state, enqueue/cancel actions |
| `TaskContext` | Active task tracking |
| `ToastContext` | Toast notification queue |
| `FloatingChatsContext` | Floating chat window management |

`App.tsx` reports `AppContext.selectedRepoId` to the server through
`client.workspaces.reportActiveWorkspace({ clientId, workspaceId })` on mount, on
workspace change, and on a 60-second heartbeat while a workspace is selected. The
client ID is session-scoped in `sessionStorage` so multiple dashboard tabs report
independent active workspaces without collapsing multi-repo state. The server uses
these reports to refresh the active workspace's Pull Requests and Work Items caches
immediately on change, then on a 5-minute interval while dashboard activity continues.

## Key hooks

| Hook | Purpose |
|------|---------|
| `useApi` | HTTP client wrapper |
| `useWebSocket` | WebSocket connection management |
| `useMarkdownPreview` | Shared markdown rendering pipeline |
| `useMarkdownDocumentSession` | Markdown document loading, dirty state, save/flush, refresh, conflict, `beforeunload`, and keyboard-save kernel |
| `useDiffComments` | Inline diff comment state |
| `useUnseenChat` | Read/unread tracking |

`useMarkdownDocumentSession` is shared by Notes and `MarkdownReviewEditor` through
injected I/O adapters. Its pure conversion helpers live in
`shared/markdown-document/markdownRichConversion` (`markdownToRichEditorHtml`,
`richEditorHtmlToMarkdown`, `buildImageMarkdown`, `insertTextAtSelection`), composing
front-matter split/compose, markdown⇄HTML, and image/PDF URL rewriting —
`rewriteHtmlImageSrc` rewrites both `<img src>` and `data-pdf-url` `.attachments/…`
paths to the notes image API. That is what puts NoteEditor's load, switch-to-rich,
conflict-load-disk, and notes-changed-reload paths on one code path.

`.pdf` image-embed markdown (`![label](x.pdf)`) round-trips through the `pdfBlock`
Tiptap node (`react/features/notes/editor/extensions/pdfBlock.tsx`). Its `pdfBlockUrl`
policy renders only exact same-origin Notes `image`/`local-image` PDF routes in an
unsandboxed browser-native iframe, keeps other HTTP(S) PDFs link-only, and exposes no
active URL for unsafe values. The same-origin external-open action uses the
preload-backed `isDesktopShell()` capability to read **Open in new window** in CoC
Desktop and **Open in new tab** in the browser; cross-origin links keep the browser
wording. The toolbar's Insert PDF button uploads through the notes image endpoint.

## Chat load performance (per-conversation request budget)

Opening a chat fans out per-conversation requests. The target for a **warm** second
open — same SPA session, same workspace, provider already seen — is **≤3** fetch
round-trips: process detail, `canvases?processId=`, and
`pull-request-chat-bindings?taskId=`. The persistent `stream?warm=1` SSE EventSource is
excluded and opens only for running conversations. The sidebar `all` list is untouched
and there is no server aggregation or bootstrap endpoint; the wins are all client
caching, re-keying, deferral, and additive cache headers.

### Static config client cache

`react/api/staticConfigCache.ts` is a module-level singleton mirroring the AppContext
`ConversationCacheEntry` `{value, cachedAt}` + 60-minute-TTL pattern — deliberately
**not** React-Query or SWR.

- `getOrFetchConfig(key, fetcher, ttlMs?)` returns a hit, fetches once on a miss,
  dedupes concurrent same-key fetches, and does **not** cache failures.
- `peekConfig(key)` is a synchronous seed so a warm reopen paints with no loading flash.
- `invalidateConfig(key)` drops one key.
- `configCacheKey` builds the keys: `.models` / `.reasoningEfforts` /
  `.effortTiers(provider)` per **provider**, `.llmToolsConfig(workspaceId)` per
  **workspace**.

The provider-config hooks (`hooks/useModels.ts`, `hooks/useProviderModels.ts`,
`hooks/useProviderReasoningEfforts.ts`, `hooks/useProviderEffortTiers.ts`) and the two
llm-tools-config consumers (`features/repo-settings/LlmToolsPanel.tsx` `loadConfig`,
`features/chat/sessionContextDrop.ts` `useConversationRetrievalCapability`) all read
through this cache, so a conversation whose provider and workspace were already seen
this session triggers **zero** config calls. `test/setup.ts` clears the singleton in a
global `beforeEach` so it stays transparent to consumer tests.

### Invalidate on mutate

Each settings mutation drops only its own key, so the next read refetches without a
page reload: `setEnabledModels` → `models:<provider>`, `setReasoningEffort` →
`reasoning-efforts:<provider>`, `effortTiers.save()` → `effort-tiers:<provider>`, and
`LlmToolsPanel`'s toggle → `llm-tools-config:<workspaceId>` after a successful
`updateLlmToolsConfig`.

### Workspace-scoped data is not refetched per conversation

`features/chat/hooks/useCrons.ts` fetches `crons.list` keyed by
`[workspaceId, cloneClient]` only — processId is not a fetch dep. The per-process view
is a `useMemo([allCrons, processId])`, so a conversation switch re-derives the filtered
list with no round-trip and only a workspace change refetches.

The unseen `count` refresh is gated on a real seen-state change: `useUnseenChat`'s
`markSeen` / `markAllSeen` / `markTasksSeen` / `markUnseen` return whether they changed
seen-state (detected synchronously via a `seenMapRef`), and `RepoChatTab` calls
`scheduleUnseenRefresh()` only when that is true — so reopening an already-seen
conversation issues no `count` call.

### Deferral past first paint

The conversation process-detail fetch and message render are the critical path. The two
remaining non-critical per-conversation fetches run after first paint via
`utils/runWhenIdle.ts` — `requestIdleCallback` with a `{timeout}` bound so the data
still loads on a busy page, with a `setTimeout(cb, 0)` fallback for Safari and jsdom,
returning a disposer.

`ChatDetail` keeps `setCanvasPanelClosed(readCanvasClosed(...))` synchronous (no
collapse-rail flash) and defers only `client.canvases.list`. `usePrChatStatusItems`
keeps its synchronous resets immediate and defers only the async binding IIFE
(`listChatBindingsForOrigin` + association build + detail fan-out), guarding the idle
fire with `generationRef` so an A→B switch never fires a stale fetch. Both effects
`cancelIdle()` in cleanup.

### Short-lived HTTP cache headers

The four static-config GET routes carry `Cache-Control: private, max-age=60` via
`setStaticConfigCacheHeaders(res)` in `src/server/shared/router.ts`, applied on the 200
path only: `agent-providers/agent-providers-routes.ts` (`reasoning-efforts`,
`effort-tiers`), `routes/queue-enqueue.ts` (`models`), and
`routes/api-workspace-routes.ts` (`llm-tools-config`). The 60s TTL is conservative
because client-side invalidate-on-mutate already covers same-session edits, so the
header only bounds cross-reload staleness.

## Feature flags

`featureFlags.ts` defines compile-time flags (`SHOW_WELCOME_TUTORIAL`). Runtime flags
come from `GET /api/config/runtime` with typed accessors in `utils/config.ts`. Most
flag-gated features are disabled by default.

| Flag | Accessor | Default |
|---|---|---|
| `workItems.sync.enabled` | — | Reports usable sync UI only when `workItems.hierarchy.enabled` is also true |
| `pullRequests.autoClassifyTeam` | `pullRequestsAutoClassifyTeamEnabled` | off |
| `features.gitCrossCloneCherryPick` | `gitCrossCloneCherryPickEnabled` | on |
| `features.gitWorktreeExecution` | `isGitWorktreeExecutionEnabled()` | off |
| `features.sessionContextAttachments` | `sessionContextAttachmentsEnabled` | off |
| `features.quickAskSidenotes` | live server flag | — |

Remote-target dialogs additionally fetch the selected server's `/config/runtime`
`gitWorktreeExecutionEnabled` as a **per-target capability signal**, since the local
flag says nothing about a remote host.

`features.sessionContextAttachments` turns same-workspace chat rows, process cards,
queue/history rows, process search results, Ralph session group rows, Work Item
rows/cards, Git commit rows, branch-range headers, and Pull Request rows into copy-drag
sources with pointer-only MIME payloads, and makes the desktop repo-header Ask / Queue
Task buttons copy drop targets that seed queue-dialog chips. Single-session payloads
carry workspace ID, process ID, title/preview, status, and last-activity metadata;
Ralph group payloads carry workspace ID, Ralph session ID, phase/status, title, last
activity, and ordered child process IDs; Work Item, commit, range, and PR payloads
carry stable IDs and references plus safe display metadata only.

## coc-client integration

The SPA consumes `@plusplusoneplusplus/coc-client` for typed REST transport. Domain
clients: admin, processes, queue, schedules, tasks, notes, workflows, wiki, memory,
memoryV2, skills, preferences, seen-state, work-items, agentProviders, git.

The git domain includes commit/diff/branch helpers, operation history, the
patch-transfer export/apply methods used by cross-clone cherry-pick, and the
worktree-execution `listWorktrees` / `cleanupWorktree` helpers. See
[git-and-prs.md](git-and-prs.md) for how the Git tab consumes them.

Local React hooks (`fetchApi`, `useWebSocket`, `seenStateApi`) wrap the client for
React state management.
