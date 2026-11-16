# RepoGitTab controller family

`../RepoGitTab.tsx` owns local chrome, shortcuts, websocket refresh, and layout. Behavior lives in this directory.

| Module | Owns |
| --- | --- |
| `types.ts` | Shared types. Import them from here inside the family. |
| `selectionModel.ts` | `reconcileSelectionAfterRefresh`, `selectedCommitHashOf`, `selectedHashesOf`. |
| `commitIdentity.ts` | `matchCommitsByIdentity` after a rewrite. |
| `gitPrompts.ts` | Strings sent to the queue or floating chat. |
| `gitContextMenuModel.ts` | `buildGitContextMenuItems`. No component state, no API calls. |
| `useRepoGitData.ts` | Pages, search, branch range, caches, `refreshAll`. |
| `knownCommit.ts` | One already-read commit handed from `openPanelGitCommit` to restore, keyed by workspace and hash. |
| `useRepoGitSelection.ts` | View and hunk only. `onViewChange` is how the host addresses `coc://git`. |
| `useGitOperationActions.ts` | Mutations and the four async-job pollers. |
| `useGitAutoPullController.ts` | Preference write and schedule read. No timer and no pull. |
| `useGitSkillActions.ts` | Skills, Ask AI, queue-backed squash and conflict resolution. |
| `useDirtyDetailGuard.tsx` | Prompt before a user selection replaces an edited working-tree diff. Data-driven `setView` stays unguarded. |
| `RepoGitDetailPane.tsx` | Detail routing. Working-tree row click opens `working-tree-all` with `filePath` and `stage`. |

## Invariants

- Every hook takes `workspaceId` and reads `useCocClient(workspaceId)`. `RepoGitTab` remounts when `useCloneBaseUrl(workspaceId)` changes. Do not rely on hook deps to pick up a new client. Fence: `repoGitTab-lateRoute.test.tsx`.
- Preferences and skill MRU use `api/repoPreferences.ts` and invalidate that cache after a successful write.
- Auto-pull runs in `src/server/git/auto-pull-*.ts`. A conflicted `pull --rebase` is aborted (`failed-conflict`). The client only reads `GET /api/workspaces/:id/git/auto-pull`. Outcomes stay in the dropdown. `actionError` is for actions the user asked for.
- `refreshAll` changes selection only through `reconcileSelectionAfterRefresh`. `changed: false` leaves the view. `next: null` clears it. Navigation during a refresh wins. Generations reject superseded and disposed results. Its in-flight guard skips only the history/branch-range reads; working changes and repo state re-read on every call. A host `reloadRequest` change runs it while `detailOpen`.
- `sourceSelectionId` is the concrete clone. Payloads keep the raw workspace id. Pass this owner and `repoRoot` to `WorkingTree`; its file drags reference current disk paths within that workspace, with deletions disabled. Never read global clone selection for the attachment destination. This family does not derive the page owner from the globally selected repo. Page vs data owner lives in `panelGitCommit.ts` and `useSplitGitPanel.ts`.
- Mount restore is `hydrateFromInitialLoad`. External address changes are `switchViewScope`, which reacts to `viewScopeKey`, not to an echo of `onViewChange`. Both use `restorePersistedView`. A missing commit sets `restoreNotFound`. Search-box SHA lookup is the only path gated on `gitCommitLookup`. This family never writes the URL hash. `openCommitBySha` drops obsolete generations.
- `enqueueChat` is the only Git-tab queue builder. Unattended launches name a tier. Omit `config` and `payload.context` only when empty.
- `squashCommits` uses `commits.indexOf`. Pass the same instances the hook rendered.
- The hoisted toolbar portal stays outside the list's `onClickCapture`, or Pull and refresh steal the shared detail pane.

## Tests

Source-mirror tests read `test/spa/helpers/repo-git-tab-source.ts`. Add modules to `REPO_GIT_TAB_MODULES`. Behavior: `test/spa/react/repos/repoGitTab-*`. Under fake timers, advance with `advanceTimersByTimeAsync`. Memoize `useGitOperationPoller` members before a `useMemo` dep array or the hook loops.
