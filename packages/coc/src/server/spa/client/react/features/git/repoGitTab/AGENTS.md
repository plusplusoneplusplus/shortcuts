# RepoGitTab controller family

Behavior for the Git tab. `../RepoGitTab.tsx` is a composition shell: it owns
only the local UI state nothing else needs (open modals, search visibility,
touch selection, context-menu position), the keyboard shortcuts, the websocket
refresh, and the two layouts. Everything else lives here.

| Module | Owns |
| --- | --- |
| `types.ts` | `RightPanelView`, `SkillMenuContext`, `GitContextMenuState`, `GitRepoStateInfo`, `RefreshSelectionOptions`. Import types from here inside the family. |
| `selectionModel.ts` | Pure right-panel transitions — `reconcileSelectionAfterRefresh`, `selectedCommitHashOf`, `selectedHashesOf`. No React state. |
| `commitIdentity.ts` | `matchCommitsByIdentity` — heuristic old→new commit matching after a rewrite. |
| `gitPrompts.ts` | Every string handed to the queue or the floating chat (commit / multi-commit / branch-range / skill / squash / conflict). |
| `gitContextMenuModel.ts` | `buildGitContextMenuItems` — the right-click menu as a pure function of (target, capabilities, handlers). |
| `useTransientToast.ts` | The single bottom-right toast surface shared by every action. |
| `useRepoGitData.ts` | Commits (pagination + search), branch range + base mode, repo state, client-side caches, `lastRefreshedAt`, `refreshAll`, initial load. |
| `knownCommit.ts` | One-slot hand-off of an already-read commit from an opener (`openPanelGitCommit`) to `restorePersistedView`, keyed by data workspace and exact hash. |
| `useRepoGitSelection.ts` | Right-panel selection state (view, hunk target, direct SHA lookup) only — no routing. Every `select*` call only touches its own state; `RepoGitTab` reports the resulting view upward through `onViewChange`, and the host turns that into its own addressing (`useSplitGitPanel`'s `coc://git` page). `hydrateFromInitialLoad`/`switchViewScope` apply a host-persisted view back in. |
| `useGitOperationActions.ts` | Fetch/pull/push/push-to/rebase/reset/amend/reword/drop/cherry-pick/reorder/conflict, plus all four async-job pollers. |
| `useGitAutoPullController.ts` | The per-repo auto-pull setting (written via the preferences PATCH) and a read of the server-owned schedule. Owns no timer and never pulls. |
| `useGitSkillActions.ts` | Skills list + MRU map, skill runs, Ask AI launches, queue-backed squash and conflict resolution. |
| `useDirtyDetailGuard.tsx` | Save / Don't Save / Cancel prompt before a user selection replaces an edited working-tree diff. `RepoGitTab` wraps the selection's select/navigate functions with `guard`; data-driven `setView` stays unguarded. |
| `RepoGitListPane.tsx`, `RepoGitOverlays.tsx` | Presentation only; everything arrives as props. |
| `RepoGitDetailPane.tsx` | Detail routing and an owner/commit-keyed review host. Commit and branch file routes keep the shared navigator mounted; same-commit navigation preserves chat and the file panel. All working changes use `ReviewFiles` with repository/stage/path selection IDs and `WorkingTreeFileDiff`, forwarding concrete ownership, refresh and dirty/save hooks. |

## Invariants

- **Clone routing (AC-07).** Every hook takes `workspaceId` explicitly and reads
  its client through `useCocClient(workspaceId)`. Git, queue and preferences
  traffic must target the selected clone's server — never the page-origin
  singleton, and never a client captured from a different workspace.
  `RepoGitTab` remounts its body when `useCloneBaseUrl(workspaceId)` changes, so
  a route that resolves after first paint reloads every hook against the right
  server; do not rely on hook dependency lists to pick up a new client.
  `repoGitTab-lateRoute.test.tsx` is the fence.
- **Shared preference reads.** Auto-pull, file-view settings and skill MRU data
  use `api/repoPreferences.ts`; preference writes and recorded skill usage
  invalidate the same server/API-prefix/workspace entry after success.
- **Auto-pull runs on the server.** The timer, the dirty and in-progress
  (rebase/merge/cherry-pick) pre-checks, the pull and the persisted run state all
  live in `src/server/git/auto-pull-*.ts`, so a repo pulls whether or not a tab is
  open and the schedule survives a reload. A `pull --rebase` that stops on a
  conflict is aborted (`failed-conflict`); auto-pull never leaves a repo
  mid-rebase. The client is a reader over `GET /api/workspaces/:id/git/auto-pull`.
  Do not add a browser timer that initiates a pull — that is exactly what was removed.
- **Auto-pull outcomes are informational, never the banner.** A background pull
  that skipped (dirty tree, operation in progress) or failed (non-fast-forward,
  rolled-back conflict) is reported in the
  auto-pull dropdown. `actionError` is reserved for actions the user asked for.
- **Data does not own selection.** `refreshAll` reads and writes the right panel
  only through the injected `selection` bridge, and decides *what* to select via
  the pure `reconcileSelectionAfterRefresh`. `changed: false` means "leave the
  view alone" — distinct from `next: null`, which clears it. The hash picker uses
  this same forced refresh:
  retained selections survive, missing selections fall back to the first commit
  or clear on an empty page. Navigation during a pending refresh wins. Request
  generations reject superseded reads and results from disposed owners.
- **Selection attachment ownership.** `RepoGitTab.sourceSelectionId` identifies
  the concrete source clone. The list pane forwards it through `CommitList` to
  commit drag payloads. The detail pane forwards it as
  `attachmentDestinationId` to file-diff, working-tree, commit and branch-range
  viewers; their payloads retain the raw workspace id. Inline review chats forward
  that owner as `sourceSelectionId` through every placement. Git review openers serialize
  that identity as `sourceSelectionId` and resolve the endpoint from the explicit
  owner. Explicit local owners never inherit an active remote endpoint. Repo-group
  hosts derive the member clone key from their server-qualified group selection.
  Never read global clone selection to choose the attachment destination.
- **Page owner and data owner are separate; the split lives with the host.**
  `workspaceId` is the git data (every request, cache, preference, websocket
  subscription and pop-out); the panel page owner and group member distinction
  is `PanelGitCommitTarget.routeWorkspaceId` / `SplitGitPanelOptions.memberId`
  in `unified-right-panel/panelGitCommit.ts` / `useSplitGitPanel.ts`. This
  family never derives the page owner by reading the globally selected repo.
- **Persisted views land in one place.** The mount-time view resolves through
  `hydrateFromInitialLoad` (called by the data hook's `onInitialLoad`); a host
  switching to another view scope (an external open changed the right panel's
  `coc://git` address while this tab was already mounted) resolves through
  `switchViewScope`. Both go through the single `restorePersistedView`
  resolver: a commit in the loaded page, or the one an opener handed over
  (`knownCommit.ts`), shows at once; anything else is re-read by exact hash
  with `getCommit`, whatever `gitCommitLookup` says, and a commit that is gone
  leaves a `restoreNotFound` notice. The `branch-range` and `working-changes`
  sentinels belong to the `coc://git` grammar
  (`unified-right-panel/unifiedPanelAddresses.ts`). Search-box SHA lookups
  (`lookupCommit`) are the only path gated on `gitCommitLookup` and
  `isLookupCandidate`; the sidebar lists paginated history only.
- **A view scope belongs to exactly one host.** The host passes `restoreView`
  (what to apply) and bumps `viewScopeKey` only on a genuine external change —
  never on an echo of this hook's own selection — and `switchViewScope` reacts
  to that key changing, not to the view it already applied. See
  `unified-right-panel/useSplitGitPanel.ts` for how the key is computed from
  the panel's own `coc://git` tab address versus what the detail itself just
  wrote through `onViewChange`.
- **Late lookups are cancelled.** `openCommitBySha` captures a generation that a
  clone re-route or unmount invalidates; a response from an obsolete generation
  writes neither the view nor anything else.
- **Navigation writes only local state here.** Every `select*` callback only
  calls `setView`/`setHunkTarget`; `RepoGitTab` reports the resulting view
  upward through `onViewChange`, and the host (`useSplitGitPanel`) is the only
  thing that turns a view into an address. This family never reads or writes
  the URL hash.
- **Menu capability rules live in the model.** Push-to/drop require an unpushed
  commit, full-message amend requires HEAD, autosquash requires a fixup target,
  cross-clone cherry-pick is feature-flagged, and touch selection entries are
  touch-only. `buildGitContextMenuItems` reads no component state and calls no
  API — every action is an injected handler.
- **Every enqueue names its effort.** `enqueueChat` is the only place a Git-tab
  queue job is built. A modal-launched run passes the user's resolved
  `aiSelection`; an unattended launch (conflict resolution) names a tier itself
  rather than omitting `config` and inheriting the server default. `config` and
  `payload.context` are omitted only when genuinely empty.
- **Squash matches by object identity.** `squashCommits` locates each selection
  with `commits.indexOf`, so callers must pass the same instances the hook was
  rendered with.
- **Split-workspace portals.** The hoisted toolbar portal renders OUTSIDE the
  list's `onClickCapture` wrapper: portaled React events still bubble through
  the React tree, so keeping it inside makes every Pull/refresh click steal the
  shared detail pane from the chat.

## Tests

`test/spa/react/RepoGitTab.test.ts` and several files under
`test/spa/react/repos/` assert on source text. They read the concatenated
family via `test/spa/helpers/repo-git-tab-source.ts` — add any new module to
`REPO_GIT_TAB_MODULES` there.

Behavioural coverage lives in `test/spa/react/repos/repoGitTab-*.test.ts(x)`:
the pure models, the controller hooks (clone routing, workspace-switch cleanup,
job polling, auto-pull skip/failure, base-mode switching, deep-link lookup,
skill-run and conflict-resolution enqueue payloads), and the split-workspace
portal contract.

When writing hook tests: `waitFor` polls with `setTimeout`, so it never resolves
under `vi.useFakeTimers()` — advance with `advanceTimersByTimeAsync` (which
flushes microtasks) and assert synchronously. `useGitOperationPoller` returns a
fresh object each render, so memoize its members before putting it in a
`useMemo` dep array or the hook under test re-renders forever (a hang, not a
fast failure).
