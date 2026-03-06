# Plan: Commit Review UI — Match Branch Changes Style

## Problem

The **UNPUSHED commits** section in the Git tree view shows individual commits that expand to reveal changed files, but the file items lack the visual polish of the **BRANCH CHANGES** section:

| Aspect | Branch Changes (`GitRangeFileItem`) | Commits (`GitCommitFileItem`) |
|---|---|---|
| Status badge | `M` / `A` / `D` icon | Status prefix in description |
| +/− stats | `+74 −0` shown per file | **Not shown** |
| Right-panel diff | `gitDiffComments.openWithReview` (preview mode) | `gitView.openCommitFileDiff` (may open new tab) |
| Directory path | Not shown (filename only) | `• src/utils` shown |

The user wants:
1. Clicking a commit expands to show a file list styled like Branch Changes.
2. Clicking a file opens the diff in the right panel (preview-mode, reusing the same tab).

---

## Approach

Minimal changes to three layers:

1. **Data layer** — fetch per-file `additions`/`deletions` alongside the existing status info when loading commit files.
2. **Model layer** — add `additions` / `deletions` fields to `GitCommitFile`.
3. **View layer** — update `GitCommitFileItem` to render stats and use `gitDiffComments.openWithReview` (same command as branch changes) so the right-panel preview behavior is identical.

---

## Files to Change

| File | Change |
|---|---|
| `src/shortcuts/git/types.ts` | Add `additions?: number; deletions?: number` to `GitCommitFile` |
| `src/shortcuts/git/git-log-service.ts` | Use `git show --numstat` (or a combined call) to populate stats |
| `src/shortcuts/git/git-commit-file-item.ts` | Render `+X −Y` in description; switch command to `gitDiffComments.openWithReview` |
| `src/shortcuts/git/tree-data-provider.ts` | Pass stat data through when constructing `GitCommitFileItem` children |

---

## Todos

1. [x] **Investigate stat fetching** — Determined to use a separate `git diff-tree --numstat` call merged into `getCommitFiles()` results.

2. [x] **Update `GitCommitFile` type** — Add optional `additions` and `deletions` number fields to the interface/type.

3. [x] **Update `getCommitFiles()` in `git-log-service.ts`** — Parse `--numstat` output and merge additions/deletions into each `GitCommitFile` result.

4. [x] **Update `GitCommitFileItem`** — 
   - Display `+additions −deletions` in the description (matching `GitRangeFileItem` format).
   - Change the `command` from `gitView.openCommitFileDiff` to `gitDiffComments.openWithReview` with the commit file context (this ensures preview-tab reuse and right-panel behavior).
   - Added `commitFile` getter for `DiffReviewEditorProvider` compatibility.

5. [x] **Validate diff opening** — Confirmed `DiffReviewEditorProvider` correctly handles the `commitFile` context passed from `GitCommitFileItem`, and opens in the right panel in preview mode (no new tab per click).

6. [x] **Update tests** — Fixed existing tests and added new tests for `getCommitFiles()` (stat parsing) and `GitCommitFileItem` (description format, command, commitFile getter).

---

## Notes

- `GitRangeFileItem` uses `gitDiffComments.openWithReview` and passes `item.commitFile` with `isRangeFile: true`. For single commit files, `isRangeFile` should remain `false`/`undefined`, so `DiffReviewEditorProvider` takes the single-commit code path — only the preview-mode tab reuse behavior is adopted.
- The status badge rendering (M/A/D) in `GitRangeFileItem` uses `resourceUri` with file decoration support. Consider applying the same technique to `GitCommitFileItem` for visual consistency, but this is optional stretch work.
- No changes needed to the Branch Changes section or `GitRangeFileItem`.
