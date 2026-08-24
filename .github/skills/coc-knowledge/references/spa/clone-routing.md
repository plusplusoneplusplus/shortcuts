# Dashboard SPA — Clone routing

The transport layer under the remote-first shell: how a REST call or WebSocket for a
workspace reaches the server that owns it, and which seam each feature wires into.
The shell UI that surfaces these workspaces is [remote-shell.md](remote-shell.md).

## Clone routing primitives

A remote clone's REST and WebSocket traffic is routed to its server's `baseUrl` through
opt-in primitives; the default `getSpaCocClient()` singleton and the
repos-list/git-info aggregation stay on the page origin.

| Primitive | Behavior |
|---|---|
| `getCocClientFor(baseUrl?)` (`api/cocClient.ts`) | Default singleton when omitted, else a per-`baseUrl`-cached `CocClient` whose REST (`/api` base) and `events` WebSocket target that origin |
| `resolveCloneBaseUrl(ref, repos)` (`repos/cloneRouting.ts`) | Maps a workspace object, workspace id, or clone key to its remote `baseUrl` (`undefined` when local) |
| `cloneWsUrl(path, baseUrl?)` (`api/wsUrl.ts`) | With a `baseUrl`, derives `ws(s)://{host:port}{path}` (http→ws, https→wss) keeping path and query verbatim; without one, reproduces `window.location` behavior |

The shared `/ws` process-event stream (`useWebSocket` → `getSpaCocClient().events`) is
already baseUrl-aware through the SDK's `buildWebSocketUrl`.

### Clone registry

`repos/cloneRegistry.ts` is the seam: a module-level `cloneKey → baseUrl` map plus a
`workspaceId → cloneKeys` index for remote workspaces only, which
`aggregateRemoteWorkspaces` populates on every repo refresh via `registerCloneBaseUrls`
(full replace, covering online **and** cached/offline rows; cleared when the flag is off
or the registry is unavailable).

Remote markers carry
`remote.cloneKey = remote:${encodeURIComponent(serverId)}:${encodeURIComponent(workspaceId)}`.
`repos/cloneIdentity.ts` centralizes clone-key build/parse, selection ids, and
path-only fallback resolution: `#repos/ws-*` links that no longer match a registered
workspace are matched by the legacy root-path hash to the migrated local workspace, or
to a single unambiguous remote clone key. Unique remote workspace ids resolve directly;
when cached rows collide on workspace id, `ReposContext` records the selected clone key
with `setActiveCloneForRouting(...)` so bare workspace-id service calls from the
selected `RepoDetail` reach the chosen server.

The registry exposes:

- `lookupCloneBaseUrl(workspaceIdOrCloneKey)`
- `getCocClientForWorkspace(id)` — `getCocClientFor(lookupCloneBaseUrl(id))`, falling
  back to `getSpaCocClient()` for a local or unknown id so local behavior is unchanged
- `cloneApiBase(id)` — absolute remote REST base for hand-built URLs such as the
  `EventSource` process stream
- `cloneWsUrlForWorkspace(path, id)`
- `remoteCloneApiBase(id)` — absolute remote REST base, or `undefined` for a local id,
  so call sites hard-coding a relative `/api/...` URL (NoteEditor image URLs) keep that
  literal locally
- `requestForWorkspace(id, url, options?)` — clone-routed analog of `requestSpaApi`
  that fetches a **relative** api path against the clone, with the same
  `toSpaCocRequestOptions` and error translation

The routing hooks `useResolveCloneBaseUrl()`, `useCocClient(ref?)`, and
`useCloneWsUrl(ref?)` resolve a bare workspace id through this registry with no
`ReposContext` dependency, so they are safe in deep per-tab components and unit tests;
a workspace **object** resolves from its own marker.

**No-local-fallthrough guarantee.** A selected remote clone's clone key, or its bare
workspace id when unique or active-disambiguated, resolves to its `baseUrl`, so its
clone-scoped REST and WS never hit the default local client. An offline-selected clone
still resolves to its last-known `baseUrl` — degrading to empty or cached UI, never a
silent local call — because cached and offline rows are registered too.

### Path→workspace resolution must fold remote rows back in

`ReposContext` dispatches only the **local** `listWorkspaces()` result into
`AppContext`; remote workspaces merge into the repos list only. Any surface resolving a
clicked file path — the docked source canvas and its tree, the note editor, the floating
markdown-review dialog — must go through `repos/workspacesWithRemote.ts`:
`useWorkspacesWithRemote()` inside `<ReposProvider>`, or the non-hook
`withRemoteWorkspaces(workspaces)` above it (App.tsx's `coc-open-markdown-review`
handler), which reads the module-level snapshot `getRemoteWorkspacesSnapshot()`
published by `aggregateRemoteWorkspaces`. Skipping this makes a remote `.md` link
resolve to no workspace ("No matching workspace found").

Both NoteEditorIO adapters (`tasks/TasksNoteEditorIO.ts`,
`tasks/WorkspaceFileNoteEditorIO.ts`) route load/save/upload through
`getCocClientForWorkspace(workspaceId)` and prefix image URLs with
`remoteCloneApiBase(workspaceId)`.

## Per-feature wiring

Wiring sits at the per-feature hook or service seam where a `workspaceId` is already
the input.

**React components and hooks call `useCocClient(workspaceId)`** for all clone-scoped
REST: `useGitInfo`, `TerminalView` (terminal list/pin), `ChatDetail` (every
`processes`/`queue`/`notes`/`canvases`/`skills` call), `RepoSchedulesTab` (schedule CRUD
and notes-git status), `WorkItemSection` and `WorkItemHierarchyTree`,
`WorkItemExecuteDialog` (skill list), `PullRequestsTab`
(list/suggestions/roster/classification), and `NativeCliSessionsPanel` (native CLI
session list and detail, read off `workspace.rootPath` on the host machine).

**Non-React services taking a `workspaceId`** resolve via
`getCocClientForWorkspace(workspaceId)`: `explorerApi.*`, `notesApi.*`, and
`useRecentSkills` (per-workspace preferences get/patch).

**Components routing inline** through the registry seams — `requestForWorkspace` for raw
fetches, `getCocClientForWorkspace` for typed calls: `EnqueueDialog` (`/summary` and
`/skills/all` loads, the `queue.enqueue` mutation, `recordSkillUsage`),
`RepoSettingsTab` (mcp-config, instructions, processes, description PATCH, plus Agent
Skills through its injected `useWorkspaceSkillsController` resolver),
`useMcpServerInspectorController` (tool discovery, server detail,
add/update/migrate/delete, the tools allow-list PUT, and — via `cloneApiBase` — the raw
`mcp-oauth/start` fetch and its status poller, so an OAuth token is stored on the host
owning the repo), `RepoDetail` (work-items badge preview), `WorkItemsTab` (commit file
list), and `BranchPickerModal` (branch list/switch).

`EnqueueDialog`'s Workspace dropdown merges local `appState.workspaces` with remote
workspaces from `ReposContext.repos` (via `useReposOptional`, filtered by
`isRemoteWorkspace`). Remote rows are labeled `name [serverLabel]` and rendered
`disabled` with an `(offline)` suffix when `remote.offline`. Selecting a remote
workspace routes the enqueue to its server through the same seam — no enqueue-path logic
is remote-specific.

### QuickOpen searches on the server

`QuickOpen` (Ctrl+P) fetches nothing when the dialog opens. It debounces keystrokes
(`SEARCH_DEBOUNCE_MS`, 40ms) into a single aborted-on-change `explorerApi.searchFiles`
call and renders the server's ranking as-is. Highlighting uses the `indices` each
result carries — the positions the scorer actually matched — via `splitIndices` +
`highlightMatches`, so the highlight cannot disagree with the ranking.

**Do not reintroduce a bulk `listFiles` fetch or client-side `rankFuzzyMatches`:** on a
large repo the path list is multiple megabytes and matching it on the render thread
stalls typing. `ExactOpen` already used the same server-search shape.

### Ralph

Ralph source routing is transient and exact. `RepoDetail` threads its clone-qualified
selection ID through Activity, direct-goal, and Notes launch surfaces;
`PopOutChatShell` mounts `ReposProvider` and passes its parsed clone base URL as the
source fallback. `RalphStartPanel` resolves that source against the current targets
before reading `/fs/blob?path=...`, so an unresolved remote source cannot fall through
to the local API. Same-target grilling starts use that target's
`processes/:id/ralph-start` so the grilling session is reused; cross-workspace or
cross-server starts use the selected target's `ralph-launch` with its physical
`workspaceId`. Direct-goal launches forward `folderPath` and `workingDirectory` only on
an exact source-target match. Remote server IDs and effective URLs stay in component
state and are never persisted into process or Ralph session data.

The Ralph workflow pane routes its whole data flow to the clone: the per-session journal
read (`useRalphSessionView` → `workspaces.ralphSession`) resolves through
`getCocClientForWorkspace(workspaceId)`, and the continue/new-loop/resume mutations
(`RalphWorkflowPaneContainer` / `RalphWorkflowPane`) go through
`useCocClient(workspaceId)`. The bare local singleton 404s a remote-only session as
"Ralph session not found".

### Activity, workflows, and events

The Activity write path `useSendMessage` routes `processes.sendMessage` /
`promoteToRalph` through `getCocClientForWorkspace(workspaceId)`, and `useChatSSE` opens
its `EventSource` at `cloneApiBase(workspaceId)`.

`features/workflow/workflow-api.ts` resolves every Workflows (pipelines) call
(list/content/save/generate/refine/create/delete/run) via
`getCocClientForWorkspace(workspaceId)`, and `WorkflowRunHistory` routes its
`/queue/history` read the same way — that route answers 200 with an **empty** list for
an unknown `repoId`, so a missed route shows "no runs" rather than failing. Because
`runWorkflow` enqueues on the serving host, the returned process exists only there:
`WorkflowDetailView` takes a `workspaceId` and uses it for both the process fetch and
the SSE stream URL, built off the routed client's own `baseUrl`. Remote repo rows get
their workflow list from a per-workspace `/summary` fetch in
`remoteWorkspaceAggregation` (keyed by workspace id and clone key, empty for
offline/cached rows); the active-task list still comes from the local queue WebSocket.

The global `/ws` event stream is mirrored per-clone by `RemoteCloneEventBridge`
(`features/remote-shell/`, rendered inside `ReposProvider`): one
`getCocClientFor(baseUrl).events.connect(...)` socket per **online** remote clone
(deduped by `baseUrl`, reconciled as clones connect and disconnect), feeding every
message into App's shared `onMessage`. Without it `useWebSocket` only listens to the
local `/ws`, so a remote task's `process-updated` never arrives and its sidebar row
stays stuck "running" while the per-process SSE shows the conversation completing. This
is the global-events counterpart to per-process `useChatSSE` routing.

The terminal PTY socket (`useTerminalWebSocket`) resolves the clone baseUrl from the
registry and passes it into `cloneWsUrl`. The `/ws` comment subscriptions
(`useTaskComments`, `git/hooks/use*Comments`) already route through `cloneWsUrl`.

### Git diff layer

`WorkingTree`, `WorkingTreeFileDiff`, `WorkingTreeAllComments`, and the comment hooks
(`useDiffComments`, `useAllCommitComments`, `useFileCommentCounts`,
`useCommitCommentTotals`) use `useCocClient(workspaceId)` for REST git calls; their
`/ws` subscriptions stay on `cloneWsUrl`. `useClassification` /
`useCommitClassificationStatus` route PR classify-diff through
`/api/origins/:originId/classify-diff*` with workspace/repo metadata and commit
classify-diff through `/api/repos/:id/classify-diff*`, both via
`useCocClient(workspaceId)`.

The `DiffSource` factories (`createCommitDiffSource`, `createBranchRangeDiffSource`,
`createPrDiffSource` in `git/diff/diffSource.ts`) resolve their path-builder client via
`getCocClientForWorkspace(id)`, and `fetchDiffFromSource(workspaceId, url)` +
`useCachedDiff` fetch the relative diff url through `requestForWorkspace`.
`useFileDiff(url, fullUrl?, workspaceId?)` threads the id from `FileDiffPanel`, and the
non-React `diffCommentApi` (`patchDiffComment`, `deleteDiffCommentById`) routes via
`getCocClientForWorkspace(wsId)`.

The Git tab's review-chat and preference surfaces route the same way:
`useCommitChatBinding` (binding read, queue enqueue, binding create, fresh-chat reset),
`usePrChatBinding` (queue enqueue), `useFilesViewMode` (repo preferences get/update),
and `CommitDetail`'s `git.commitDiffPath` builder.

### Notes, PDFs, and quick ask

`usePaperAnnotations` (sidecar GET plus the resolve and turns PATCHes),
`PdfAnnotationsLayer` (follow-up answer, annotation DELETE,
`paperAnnotationsExportUrl`), `PdfQuickAskLayer`, `PdfRegionAskLayer`, and
`NoteQuickAskLayer` all call `requestForWorkspace(workspaceId, path, opts)`.

Two distinct failures motivate this, and the second is the dangerous one:

- The paper-annotations routes begin with `resolveWorkspaceOrFail`, so a local-origin
  call hard-404s — loud and obvious.
- `POST /api/quick-ask/answer?workspace=` only validates the id **shape** and never
  looks the workspace up, so a local-origin call runs the model on the **wrong host**
  with the wrong workspace's model config and returns 200.

The same class of bug hit chat Quick Ask side-notes: `useQuickAskSidenotes` sends its
hydrate GET, lookup POST, and DELETE through `requestForWorkspace`, because
`/api/processes/:id/sidenotes` only calls `isValidWorkspaceId`. A local-origin call for
a remote clone answered 200 while the manager created a real
`{dataDir}/repos/<remote-id>/chat-sidenotes/<sha256(processId)>.json` tree on the
**local** disk, and the POST's local `processExists` check then failed anyway.

`NoteEditorIO`'s `imageApiUrl` / `localImageApiUrl` / `ingestPaper` build their URLs
from a `notesApiBase(workspaceId)` helper (`cloneApiBase` when remote, the literal
`/api` when local) because those URLs are consumed by `<img src>`, `data-pdf-url`, or a
raw `fetch`. `noteMarkdown`'s `rewriteImageSrcToRelative` accepts an optional
`scheme://host` prefix on every pattern, so a remote clone's origin is never baked into
the persisted `.md`.
