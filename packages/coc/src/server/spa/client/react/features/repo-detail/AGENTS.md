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

## Workspace right panel

`unified-right-panel/UnifiedRightPanel.tsx` is the workspace's one right-side
surface: a single Cursor-style tab strip over Terminal, Notes, files, notes,
canvases, and chat diffs, plus a file-tree column pinned to its right edge.
`RepoDetail.tsx` renders it for a repo and `repos/RepoGroupView.tsx` for a repo
group; both gate on `dockAvailable` (`splitWorkspacePanel` + desktop) and wrap
their subtree in `UnifiedPanelHostProvider` under the same gate. There is no
second panel and no flag to switch between panels. The panel's own contract —
tab identity, entry-point seams, keep-alive, the close guards — is in
`unified-right-panel/AGENTS.md`.

`useWorkspaceDock.ts` holds the state around the panel rather than inside it:
whether it is open, how wide it is, and which workspace its contents point at.
It has no DOM. Call it once per workspace view and hand the returned
`WorkspaceDockController` to the panel. Storage keys, `DockTarget`, the width
constants, and the cross-tree open store live in `WorkspaceDockToggle.tsx`.

**Scope vs. target.** `workspaceId` is the panel's *scope*: it owns the
`split-workspace:<id>:dock-{open,width,target}` keys, the unified tab set, and
the workspace `DockNotesPanel` is keyed on. The *target* is the workspace new
terminals and file resources open against. They are the same value unless the
caller passes `targets?: readonly DockTarget[]` (`{ workspaceId, label,
disabled?, deprioritized? }`) to both `useWorkspaceDock` and the panel; that adds
a repo picker to the panel's `+` menu (`UnifiedPanelOpenMenu`) and lets the user
re-point new content while the panel's open state, tabs, and width stay put.
Omitting `targets` is a strict no-op. Changing the target never retargets an
already-open tab.

`RepoGroupView` supplies the only targets today: `getRepoGroup(groupId, baseUrl)`
mapped to the group root (`deprioritized` — it holds only `group.json`) plus every
member repo, with a stale member listed `disabled` and its reason in the label.
While that request is in flight `targets` is `undefined`, so the panel is
scope-only rather than showing an empty picker.

What the `+` menu offers depends on the *target*, not the scope. A repo-group
root has no single repository root, so `unifiedPanelOpenMenuModel` hides its
Explorer entry (`isRepoGroupWorkspaceId`); a concrete repo gets it. The entry
toggles the file-tree column — the tree is panel chrome, never a tab.

Only a panel whose target *is* its scope owns the explorer route: the tree column
gets `deepLink={target === workspaceId}`. Selecting a file otherwise writes
`#repos/<target>/explorer/<path>`, which `resolveReposRoute` reads as
`SET_SELECTED_REPO` — inside a repo group that navigates straight out of the
group on the first click. With `deepLink={false}` the selection stays local and
still persists through `explorerStateStore`.

Target switches go through `confirmDiscardExplorerEditsOnSwitch` (from
`explorer/explorerDirtyStore.ts`), so picking another member repo cannot silently
drop a dirty Monaco buffer. `dock.setTarget()` returns whether the switch was
accepted; declining leaves the selection and localStorage untouched, which lets
group Quick Open keep its dialog and highlighted result unchanged.

Persisted values are validated on read. The target
(`workspaceDockTargetStorageKey`) falls back to the first enabled
non-`deprioritized` option, then the first enabled one, then the scope. Only an
explicit `setTarget` writes; mount and workspace switches never persist.

Peer icon-only Search and Explorer controls live outside the panel and share its
cross-tree open and mode stores. The classic shell renders
`WorkspaceDockModeControls` in `RepoDetail`'s header; the remote-first shell
renders the same component in `layout/TopBar.tsx` for a concrete clone or a
`group-*` selection. My Work / My Life have no panel. Selecting an inactive mode
opens or switches the panel; selecting its active mode while open closes it.

On desktop, a repo group's mounted panel also owns Ctrl/Cmd+P while collapsed,
from every group sub-tab. The Quick Open portal may appear without changing the
stored open bit; only an accepted file selection opens Explorer mode. Ordinary
repos still require an open panel or mounted Explorer owner, Ctrl/Cmd+O remains
target-repo Exact Open, and mobile mounts no group panel listener.

`../notes/dock/DockNotesPanel.tsx` is the Notes view: search + new-note row, a
recency-ordered flat list (`dock/dockNotes.ts` holds the pure list/query/naming
helpers), a read-only markdown preview, and the two hand-off actions. The preview
is deliberately read-only — the full Notes tab can be mounted at the same time,
and sharing dirty state between two editable surfaces is out of scope.
"Insert into chat" reaches the composer through `../chat/composerInsert.ts`, a
window-event bridge (`ChatDetail` and `NewChatArea` subscribe via
`useComposerInsertListener`) because the panel is a sibling column with no React
path to the composer.

## Explorer lazy-load state

`explorer/TreeNode.tsx` derives its spinner — `isDir && isExpanded && children ===
undefined && !loadError` — instead of tracking a `loading` flag. `childrenMap`
lives in `useSyncExternalStore` (`explorerTreeCache`), so a successful fetch
re-renders and runs the effect cleanup in the same microtask, before the promise
settles a tracked flag; deriving it also keeps the two mounted Explorer panels
(RepoDetail's Explorer sub-tab + the right panel's tree column) in agreement. A failed listing sets `loadError` and
renders a `⚠` retry affordance; clicking it clears the error and re-fires the
effect. Do not reintroduce a tracked flag or swallow the fetch rejection.

## Quick Open file search

`explorer/QuickOpen.tsx` takes an explicit repo or repo-group search scope.
Repo scope asks `/api/repos/:repoId/search`; group scope calls
`repoGroupService.searchRepoGroupFiles` with the group owner's base URL. Both
debounce keystrokes, cancel superseded requests, reject stale responses, and
highlight only the returned `indices`. Ranking happens in the Rust scorer only;
`server/shared/fuzzy-file-score.ts` is its reference implementation, not a
second runtime path. Results stay rendered while the query changes; only the
first load shows `Searching files…`.

Group rows remain one flat server-ranked list. Their identity includes
`workspaceId`, their visible/accessibility label includes `repoName`, and the
dialog distinguishes no matches, no searchable members, partial results, and a
retryable total failure. `onFileSelect` receives the full result and may return
`false` to keep the query and highlight intact for a declined target switch.

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
that guard a slow early answer paints over a fast later one. The search is
repo-wide: the tree selection deliberately does not narrow it (VS Code's
behaviour). A directory's context menu offers **Find in Folder**, which switches
to the Search view and writes `<dir>/**` into the *include* glob box, so the
scope is visible and the user can edit or clear it.

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

### Narrow sidebar layout

The sidebar is resizable down to 160px, so the Search view has two shapes.
`ExplorerPanel` derives `isNarrowSidebar(sidebarWidth, isMobile)` — true under
`NARROW_SIDEBAR_WIDTH` (320px), never on mobile, where the sidebar is the whole
screen — and passes it down as `narrow`. It is a prop rather than a CSS container
query so the layout stays assertable in jsdom.

Narrow moves the `Aa` / `ab` / `.*` toggles out of the query field onto a row
below it (`togglePlacement="below"`), which cuts the field's reserved
`paddingRight` from 106px to 28px, and puts `SearchFiltersToggle` (the `…`) at the
right of that same row instead of on a row of its own. `ContentSearchToolbar`
keeps Refresh / Clear / View-as-Tree inline and folds Collapse All / Replace All /
Open in Editor behind `⋯` (`content-search-more`); every action keeps its
`data-testid` in either shape.

The action strip lives in the panel header beside the Files / Search tabs, where
the tree's own buttons sit in Files view. `ContentSearchPanel` still owns the
handlers and portals the strip into the `explorer-search-toolbar-slot` element
`ExplorerPanel` renders there; without a `toolbarSlot` it falls back to rendering
the strip at the top of its own body.

The replace chevron is drawn absolutely into the gutter both fields leave for it
(`leftGutter` on `SearchBar`, `pl-6` on the replace input) rather than in a flex
column, which would indent the whole surface. Horizontal padding across the view
is `px-2` — the query bar, filter fields, status lines and results share one left
edge.

## Language support in the preview

`PreviewPane` decides whether a blob is a *live repo document* — a real file in
this workspace, read whole, not a trusted absolute path — and only then opens a
language document and registers Monaco providers over its model
(`features/language-servers/`).

The selected repo passes its clone-qualified routing ref separately from the
workspace id. File reads/writes and the language socket resolve through that ref,
while browser document URIs and WebSocket query parameters keep the workspace id
understood by the owning server. Local repos pass an explicit local route, so a
same-id remote registry entry cannot capture a local Explorer document.

The unified right panel persists the same routing ref on every file-tab
descriptor. Its `PreviewPane`, definition-navigation callback, and target-file
loader reuse that stored owner instead of the dock's current target. Repo groups
derive each member's clone key from the concrete server that owns the group.

An LSP-managed model is moved onto a private shadow language id
(`coc-lsp-typescript`, `coc-lsp-javascript`) before the providers are
registered. Monaco registers providers per language and its bundled TypeScript
worker claims `typescript`/`javascript` globally, so a model left there would
answer every hover, completion and diagnostic twice. The shadow ids are
registered once in `explorer/monaco-setup.ts`, which copies the base language's
Monarch tokenizer and configuration; that is the only module that reads them, so
`shadowLanguage.ts` itself stays free of a runtime Monaco dependency. Reach for
the global `typescriptDefaults` switches only if you want every Monaco instance
in the page to lose its built-in support — chat source canvases and diffs
included. The model is put back on its base language when the pane goes away.

The pane also shows a `LanguageStatusBadge` in its floating toolbar. Two
statuses feed it and neither is complete alone: the document's own (`detached`,
`ready`, `unavailable`) says whether this file is synchronized, and the host
session's (`starting`, `reconnecting`, `failed`) says what the process is doing.
`languageStatus.ts` is the one place that reconciles them into a label, a tone
and whether a retry is worth offering; keep wording changes there rather than in
the component. The retry picks its own recovery — a reconnect when the socket is
down, a fresh attach when the host refused the document, and a server restart
when there is a live attachment — so one button covers all three failures. A
restart keeps the unsaved buffer: the new process gets it replayed, exactly as
after a crash.

A definition or reference in ANOTHER file goes through one global
`monaco.editor.registerEditorOpener`, installed in `explorer/monaco-setup.ts`.
Each pane claims its own model with `registerEditorNavigator`
(`features/language-servers/editorNavigation.ts`), and the opener dispatches on
the model the jump started in — that is how the target lands in the Explorer's
strip or the right panel's, whichever the user was in. The pane refuses a target
outside its own workspace and a URI that is not a `coc-file://` document, so a
dependency under `node_modules` cannot be routed through the repo's own file
endpoint. Surfaces open the target pinned and pass the position back down as
`revealLine` / `revealColumn`; the column travels with its line through the tab
descriptors and is dropped whenever the line changes without one.

## Tests

`test/spa/react/repos/explorer/TreeNode.lazyload.test.tsx` covers that behaviour
end to end against the real tree cache (`--environment jsdom`);
`TreeNode.test.ts` is a source-mirror test and must be updated alongside edits.

`test/spa/react/workspace-right-dock/` covers the panel and its controller:
`useWorkspaceDock.test.tsx` (open/width/resize plus the target rules — default,
fallback, persistence, the dirty-edit guard, and what follows the picker and what
does not), the `Unified*` / `unified*` suites for the panel itself, plus
`DockNotesPanel.test.tsx`, `dockNotes.test.ts`, and `composerInsert.test.tsx`.
The heavy views (TerminalView, ExplorerPanel, DockNotesPanel) are mocked by
source path there so xterm/Monaco never load.

The group side lives in `test/spa/react/repos/RepoGroupView.dock.test.tsx`
(breakpoint gating, target mapping, remote base URL, fetch failure) and
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
