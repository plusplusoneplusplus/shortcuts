# repo-detail

TopBar repo navigation and the per-repo detail view.

## RepoTabStrip kernel decomposition

`RepoTabStrip.tsx` is the top-bar repo navigation surface (visible tabs, agent
pills, overflow menu, context menu, add/edit dialogs). Its navigation logic lives
in three extracted kernels so the component stays composition glue:

- `repoTabModel.ts` — pure, DOM-light helpers: queue-status mapping
  (`buildRepoQueueStatusMap`), overflow flags (`computeRepoOverflowState`),
  visible-set math (`computeVisibleRepoIds` / `computeVisibleAgentIds`),
  `flattenGroups`, accessible labels, `getRepoDisplayName`, drag drop-position
  helpers, and `REPO_TAB_DRAG_MIME`.
- `useRepoTabSelection.ts` — the single `selectRepo(wsId, agentId?)` command used
  by every tab, agent pill, agent submenu, and overflow row. It switches the
  active agent (falsy `agentId` = no agent), selects the workspace, and forces
  `onRefresh` only when the SAME workspace id is re-selected under a different
  agent. Keep all selection surfaces routed through this — the same workspace id
  can exist under multiple agents in container mode.
- `useRepoTabOrdering.ts` — persisted `repoTabOrder`/`gitGroupOrder` load, save,
  reset, customize mode, drag/drop reordering, and polite live-region messages.
  The flat ordered id list is passed in via `allRepoIdsRef` (a ref, not a value)
  because that list is derived from the hook's own `repoTabOrder`; a ref breaks
  the render-time dependency cycle and keeps the drag callbacks stable. Pure order
  math is in `../../repos/repoOrder`.

`RepoTabStrip.tsx` re-exports the model symbols (`getRepoDisplayName`,
`getRepoQueueStatusInfo`, `computeVisibleRepoIds`, `computeVisibleAgentIds`, and
the queue-status types) that RepoDetail, TopBar, and the tab-strip test suites
import.

## RepoCopilotTab Agent Skills

`RepoCopilotTab.tsx` shares `useWorkspaceSkillsController` with
`RepoSettingsTab`; it injects the default SPA client resolver and passes the
controller to `AgentSkillsPanel`. Keep workspace skill loading, detail, config,
toggle, delete, and extra-folder behavior in that controller instead of adding
tab-local copies. `AgentSkillsPanel` and its focused child components are the
visual layer.

## Clone routing

`RepoDetail.tsx` runs its workspace-scoped calls (work-items badge, queue seed,
Resume Queue) through `getCocClientForWorkspace(ws.id)` so a remote clone hits its
own server. `/chat/launch-terminal` deliberately stays on the local-origin
`fetchApi` — it spawns a terminal on whichever machine runs the server. The queue
store is still fed by the LOCAL websocket only, so remote-sourced rows can be
overwritten by a local `REPO_QUEUE_UPDATED`; per-clone queue WS fan-in is the fix.

## Workspace right dock

`WorkspaceRightDock.tsx` hosts three views — Terminal, Explorer, and a compact
read-only Notes panel — as underline tabs in one 35px header row. The dock body
renders from `RepoDetail.tsx` for a repo and `repos/RepoGroupView.tsx` for a repo
group; both gate on `splitWorkspacePanel` + desktop.

**Scope vs. target.** `workspaceId` is the dock's *scope*: it owns the
`split-workspace:<id>:dock-{open,view,width,target}` keys, and it is what
`DockNotesPanel` is keyed on. The *target* is the workspace `TerminalView` and
`ExplorerPanel` are keyed on and pointed at. They are the same value unless the
caller passes `targets?: readonly DockTarget[]` (`{ workspaceId, label, disabled?,
deprioritized? }`) to both `useWorkspaceDock` and `WorkspaceRightDock`; that
renders a `<select>` picker (`workspace-dock-target-picker`) in the header row and
lets the user re-point the content while the panel's open/view/width stay put.
Omitting `targets` is a strict no-op.

`RepoGroupView` supplies the only targets today: `getRepoGroup(groupId, baseUrl)`
mapped to the group root (`deprioritized` — it holds only `group.json`) plus every
member repo, with a stale member listed `disabled` and its reason in the label.
While that request is in flight `targets` is `undefined`, so the dock is
scope-only rather than showing an empty picker.

Which views the dock offers comes from `dockViewsForWorkspace(target)` in
`WorkspaceDockToggle.tsx` — the *target*, not the scope. A repo-group root has no
single repository root, so it gets `terminal|notes` and never mounts
`ExplorerPanel` (no Monaco load); a concrete repo gets `terminal|explorer|notes`.
Memoize that array on the target string: `useDockView`'s effect depends on it and
a fresh array every render loops forever (shows up as a hang, not a fast failure).

Every available view stays mounted once the dock has been opened, with the
inactive ones hidden via `display:none`, so the PTY session, explorer tree, and
selected note survive a view switch, a dock close, or a sub-tab change. A target
switch deliberately remounts Terminal and Explorer — the same teardown a workspace
switch already causes — and rehydrates through `explorerStateStore` and pinned
terminal sessions rather than a per-target mount map.

Only a dock whose target *is* its scope owns the explorer route:
`WorkspaceRightDock` passes `deepLink={target === workspaceId}` to
`ExplorerPanel`. Selecting a file otherwise writes
`#repos/<target>/explorer/<path>`, which `resolveReposRoute` reads as
`SET_SELECTED_REPO` — inside a repo group that navigates straight out of the
group on the first click. With `deepLink={false}` the selection stays local and
still persists through `explorerStateStore`.

Target switches go through `confirmDiscardExplorerEditsOnSwitch` (from
`explorer/explorerDirtyStore.ts`), so picking another member repo cannot silently
drop a dirty Monaco buffer; declining leaves the selection and localStorage
untouched.

Persisted values are validated on read. The view (`workspaceDockViewStorageKey`)
falls back to the first available one — a stored `explorer` must not strand a
group root on a hidden tab. The target (`workspaceDockTargetStorageKey`) falls
back to the first enabled non-`deprioritized` option, then the first enabled one,
then the scope. Only explicit `setView` / `setTarget` calls write; mount and
workspace switches never persist.

The open/close toggle lives outside the body and shares a cross-tree store: the
classic shell renders it in `RepoDetail`'s header, while the remote-first shell's
`layout/TopBar.tsx` renders `WorkspaceDockToggleButton` for a concrete clone *or*
a `group-*` selection under the virtual header. My Work / My Life have no dock.

`../notes/dock/DockNotesPanel.tsx` is the Notes view: search + new-note row, a
recency-ordered flat list (`dock/dockNotes.ts` holds the pure list/query/naming
helpers), a read-only markdown preview, and the two hand-off actions. The preview
is deliberately read-only — the full Notes tab can be mounted at the same time,
and sharing dirty state between two editable surfaces is out of scope.
"Insert into chat" reaches the composer through `../chat/composerInsert.ts`, a
window-event bridge (`ChatDetail` and `NewChatArea` subscribe via
`useComposerInsertListener`) because the dock is a sibling column with no React
path to the composer.

## Explorer lazy-load state

`explorer/TreeNode.tsx` derives its spinner — `isDir && isExpanded && children ===
undefined && !loadError` — instead of tracking a `loading` flag. `childrenMap`
lives in `useSyncExternalStore` (`explorerTreeCache`), so a successful fetch
re-renders and runs the effect cleanup in the same microtask, before the promise
settles a tracked flag; deriving it also keeps the two mounted Explorer panels
(RepoDetail tab + right dock) in agreement. A failed listing sets `loadError` and
renders a `⚠` retry affordance; clicking it clears the error and re-fires the
effect. Do not reintroduce a tracked flag or swallow the fetch rejection.

## Quick Open file search

`explorer/QuickOpen.tsx` debounces keystrokes and asks
`/api/repos/:repoId/search` per query, then highlights using the `indices` the
server returned rather than re-deriving the match locally. Ranking happens in the
Rust scorer only; `server/shared/fuzzy-file-score.ts` is its reference
implementation, not a second runtime path. Results stay rendered while the query
changes; only the first load shows `Loading files…`.

`ExactOpen.tsx` and `ExplorerPanel.tsx` still call `/search` per query. That endpoint
is backed by a cached repo listing (`RepoTreeService.invalidateFileListCache`), so
its cost is a fuzzy scan, not a repo walk.

## Explorer content search

The Explorer sidebar has two views, not two modes: `ExplorerPanel.tsx` renders
either the tree (Breadcrumbs + filter `SearchBar` + `FileTree`) or
`ContentSearchPanel.tsx`, and each one's state outlives the other being shown.
That is why the search view's state lives in `explorerStateStore` rather than in
component state — query, toggles and the chosen view are persisted per workspace
in localStorage; the *results* are held in a module-level in-memory map in the
same file, because a 500-match payload does not belong in localStorage and a
reload should re-run the query rather than replay a stale answer.

`ContentSearchPanel` calls `explorerApi.searchContent` →
`GET /api/repos/:repoId/search/content`. Two rules drive its request effect: a
typed change waits `SEARCH_DEBOUNCE_MS` (250 ms) of quiet, while a toggle change
re-runs the query it already has with no delay — the toggle *is* the intent and
no keystroke is coming. Every request carries an `AbortSignal` plus a monotonic
run id, and a response is dropped unless its run id is still the newest; without
that guard a slow early answer paints over a fast later one. The search is scoped
to the directory selected in the tree via `resolveSearchScope`, which walks up to
the parent when the selection is a file.

The server owns every default and every cap — the panel sends only what the user
chose. A 400 is the route's answer for an unparseable pattern and carries the
engine's own message, so it renders inline against the query box
(`content-search-regex-error`); anything else is generic and retryable. Zero
matches is the `empty` state, never an error.

Clicking a match sets `previewFile` with a `line`, which threads through
`PreviewPane` → `MonacoFileEditor.revealLine` → `revealEditorLine`. Monaco is
revealed both on mount and from an effect keyed on `[revealLine, value]`, because
the content arrives after the editor does and a second hit in an already-open
file has no mount to piggyback on.

`SearchBar.tsx` is shared by both views. Its `data-testid`s derive from a
`testIdPrefix` (`<prefix>-bar` / `-input` / `-clear` / `-toggle-<id>`) whose
default reproduces the file-filter bar's long-standing ids — do not hardcode them
again.

## Tests

`test/spa/react/repos/explorer/TreeNode.lazyload.test.tsx` covers that behaviour
end to end against the real tree cache (`--environment jsdom`);
`TreeNode.test.ts` is a source-mirror test and must be updated alongside edits.

`test/spa/react/workspace-right-dock/` covers the dock: `WorkspaceRightDock.test.tsx`
(tabs, keep-alive, persistence, resize, group-vs-repo view sets),
`WorkspaceDockTarget.test.tsx` (the target picker — default/fallback/persistence,
the dirty-edit guard, what follows the picker and what does not),
`WorkspaceDockMergedHeader.test.tsx` (single-row header, incl. picker + portaled
terminal toolbar), `DockNotesPanel.test.tsx`, `dockNotes.test.ts`, and
`composerInsert.test.tsx`. The heavy views (TerminalView, ExplorerPanel,
DockNotesPanel) are mocked by source path there so xterm/Monaco never load.

The group side lives in `test/spa/react/repos/RepoGroupView.dock.test.tsx`
(flag/breakpoint gating, target mapping, remote base URL, fetch failure) and
`test/spa/react/TopBar.repo-group.test.tsx` (the TopBar toggle for `group-*`).

`QuickOpen.behavior.test.tsx` asserts the one-fetch-per-open contract against a
mocked `explorerApi` (`--environment jsdom`; stub `Element.prototype.scrollIntoView`,
which jsdom does not implement). `QuickOpen.test.ts` is a source-mirror test.

`ContentSearchPanel.test.tsx` drives the search view against a mocked
`explorerApi` under fake timers — every UX state, the debounce, the
toggle-re-runs-immediately rule, and the stale-response-discard guard.
`ContentSearchResults.test.tsx` covers grouping and UTF-16 highlighting;
`ExplorerPanel.contentsearch.test.tsx` covers the view switch and click-to-open-
at-line. `ExplorerPanel.persist.test.ts` is a source-mirror test over
`ExplorerPanel.tsx` imports — update it alongside edits to that import block.

`test/spa/react/repos/RepoTabStrip*.test.tsx` cover the component (tabs, overflow,
agent highlight, queue indicators). `repoTabModel.test.ts`,
`useRepoTabSelection.test.tsx`, and `useRepoTabOrdering.test.tsx` cover the kernels
directly. Run with `node scripts/run-vitest.mjs <files>`.
