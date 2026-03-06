# File Diff View Deep URL

## Problem

When a user clicks a file in the Git diff panel, the URL stays at the commit level:

```
#repos/{workspaceId}/git/{commitHash}
```

The selected file is not reflected in the URL, so the view cannot be bookmarked, shared, or restored on page reload.

## Goal

Extend the hash-based deep-link system so that the selected file in the diff panel is encoded in the URL:

```
#repos/{workspaceId}/git/{commitHash}/{filePath}
```

Navigating directly to this URL should restore both the commit selection and the file diff panel.

## Acceptance Criteria

- [ ] Clicking a file in the commit diff list updates the URL hash to include the file path (URL-encoded).
- [ ] Navigating to `#repos/{wsId}/git/{hash}/{filePath}` opens the correct commit and scrolls/selects the corresponding file diff.
- [ ] Closing / deselecting the file diff panel removes the file path segment from the URL (reverts to commit-level URL).
- [ ] Browser back/forward navigation moves between file selections correctly.
- [ ] The existing commit-level deep link (`#repos/{wsId}/git/{hash}`) still works unchanged.
- [ ] Works for all three diff view types: **commit-file**, **branch-file**, and **working-tree-file** (each has its own URL shape if relevant, or file-path suffix is added consistently).

## Affected Files

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/layout/Router.tsx` | Add `parseGitFileDeepLink()` — extract filePath segment from hash; dispatch `SET_GIT_FILE_PATH` on load and hashchange |
| `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx` | Update `handleCommitFileSelect()` (and branch/working-tree variants) to write filePath into `location.hash`; clear on panel close |
| `packages/coc/src/server/spa/client/react/context/AppContext.tsx` | Add `selectedGitFilePath: string \| null` state field and `SET_GIT_FILE_PATH` / `CLEAR_GIT_FILE_PATH` actions |

## Subtasks

1. **State** — Add `selectedGitFilePath` to `AppContext` with `SET_GIT_FILE_PATH` and `CLEAR_GIT_FILE_PATH` reducers.
2. **Write URL** — In `RepoGitTab`, after setting `location.hash` for a commit, append `/{encodeURIComponent(filePath)}` when a file is selected; revert to commit hash when panel closes.
3. **Parse URL** — In `Router.tsx`, extend `parseGitCommitDeepLink()` (or add a new function) to detect the optional file-path segment and dispatch `SET_GIT_FILE_PATH`.
4. **Restore state** — In `RepoGitTab`, read `selectedGitFilePath` from context on mount and auto-open the corresponding file diff panel.
5. **Back/forward** — Ensure `hashchange` listener in `Router.tsx` also clears `selectedGitFilePath` when the hash loses the file segment.

## Notes

- File paths can contain `/`, so use `encodeURIComponent` on the entire path before appending to the hash, and `decodeURIComponent` when parsing.
- Branch-diff and working-tree diff views don't have a commit hash; consider a separate URL shape, e.g. `#repos/{wsId}/git/branch/{filePath}` or `#repos/{wsId}/git/working/{stage}/{filePath}`, or limit the feature to commit-file diffs in v1.
- The `RightPanelView` union type in `RepoGitTab.tsx` already tracks `{ type: 'commit-file'; hash: string; filePath: string }` — use this as the source of truth for URL serialization.
