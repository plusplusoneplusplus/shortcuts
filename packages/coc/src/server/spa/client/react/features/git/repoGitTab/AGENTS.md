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
| `useRepoGitSelection.ts` | Right-panel routing, URL hash + AppContext sync, deep-link hydration, direct SHA lookup. |
| `useGitOperationActions.ts` | Fetch/pull/push/push-to/rebase/reset/amend/reword/drop/cherry-pick/reorder/conflict, plus all four async-job pollers. |
| `useGitAutoPullController.ts` | The per-repo auto-pull setting (written via the preferences PATCH) and a read of the server-owned schedule. Owns no timer and never pulls. |
| `useGitSkillActions.ts` | Skills list + MRU map, skill runs, Ask AI launches, queue-backed squash and conflict resolution. |
| `RepoGitListPane.tsx`, `RepoGitDetailPane.tsx`, `RepoGitOverlays.tsx` | Presentation only; everything arrives as props. |

## Invariants

- **Clone routing (AC-07).** Every hook takes `workspaceId` explicitly and reads
  its client through `useCocClient(workspaceId)`. Git, queue and preferences
  traffic must target the selected clone's server — never the page-origin
  singleton, and never a client captured from a different workspace.
- **Auto-pull runs on the server.** The timer, the dirty pre-check, the pull and
  the persisted run state all live in `src/server/git/auto-pull-*.ts`, so a repo
  pulls whether or not a tab is open and the schedule survives a reload. The
  client is a reader over `GET /api/workspaces/:id/git/auto-pull`. Do not add a
  browser timer that initiates a pull — that is exactly what was removed.
- **Auto-pull outcomes are informational, never the banner.** A background pull
  that skipped (dirty tree) or failed (non-fast-forward) is reported in the
  auto-pull dropdown. `actionError` is reserved for actions the user asked for.
- **Data does not own selection.** `refreshAll` reads and writes the right panel
  only through the injected `selection` bridge, and decides *what* to select via
  the pure `reconcileSelectionAfterRefresh`. `changed: false` means "leave the
  view alone" — distinct from `next: null`, which clears it.
- **Deep links land in one place.** The mount-time link resolves through
  `hydrateFromInitialLoad` (called by the data hook's `onInitialLoad`); a later
  link resolves in the effect watching `state.selectedGitCommitHash`. Both fall
  back to `getCommit` only when `gitCommitLookup` is on and the string is
  SHA-shaped (`isLookupCandidate`).
- **Navigation writes three things.** Component state, `location.hash`, and the
  AppContext deep-link fields are updated together by the `select*` callbacks.
  Never write one of the three at a call site.
- **Menu capability rules live in the model.** Push-to/drop require an unpushed
  commit, full-message amend requires HEAD, autosquash requires a fixup target,
  cross-clone cherry-pick is feature-flagged, and touch selection entries are
  touch-only. `buildGitContextMenuItems` reads no component state and calls no
  API — every action is an injected handler.
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
job polling, auto-pull skip/failure, base-mode switching, deep-link lookup),
and the split-workspace portal contract.

When writing hook tests: `waitFor` polls with `setTimeout`, so it never resolves
under `vi.useFakeTimers()` — advance with `advanceTimersByTimeAsync` (which
flushes microtasks) and assert synchronously. `useGitOperationPoller` returns a
fresh object each render, so memoize its members before putting it in a
`useMemo` dep array or the hook under test re-renders forever (a hang, not a
fast failure).
