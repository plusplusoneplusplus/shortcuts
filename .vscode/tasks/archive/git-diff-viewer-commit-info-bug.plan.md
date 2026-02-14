# Git Diff Viewer: Unrelated Commit Info Bug

## Problem Statement

When opening a file in the Git Diff Viewer (branch changes view), unrelated commit information is displayed alongside the file diff. This is particularly noticeable for **newly created files**, where commit info from unrelated commits in the branch appears unexpectedly.

## Expected Behavior

- Newly created files should show only the file content as an addition (all green/added lines)
- No unrelated commit metadata should be mixed into the diff view
- Each file's diff should only contain information relevant to that specific file's changes

## Actual Behavior

- Opening a file in git diff viewer shows commit info from other commits in the branch
- Purely new files display unrelated commit metadata
- The commit info appears to "leak" from other changes in the branch

## Investigation Areas

- [x] Examine how branch changes are collected (`git diff` commands used)
- [x] Review `GitDiffReviewEditorProvider` for how diff content is fetched
- [x] Check if diff content aggregation is incorrectly merging multiple commits
- [x] Investigate the webview rendering logic for commit metadata display
- [x] Verify the git command parameters when comparing branches vs working tree

## Root Cause (FOUND)

The bug was in `src/shortcuts/git-diff-comments/diff-content-provider.ts`:

When `getRangeDiffContent()` calls `execGit(['merge-base', baseRef, headRef], ...)`, the output includes a trailing newline (e.g., `03bb8f3bf193dc62508741bf25daa0d05a238f00\n`).

This merge-base string is then passed to `getFileAtRef(filePath, mergeBase, ...)`, which executes `git show ${ref}:${gitPath}`. With the trailing newline, this becomes:

```
git show 03bb8f3bf193dc62508741bf25daa0d05a238f00
:path/to/file
```

Git interprets this as showing the commit itself (reading `:path/to/file` from stdin), which outputs the commit metadata (author, date, message, diff output) instead of the file content.

## Fix Applied

Added `.trim()` to the merge-base output in `getRangeDiffContent()`:

```typescript
mergeBase = execGit(['merge-base', baseRef, headRef], repositoryRoot).trim();
```

## Tests Added

Added comprehensive tests in `src/test/suite/diff-content-provider.test.ts`:
- `should return file content for new files, not commit info`
- `should return correct content for existing files`  
- `should handle modified files correctly in range diff`

All 6639 tests passing.

## Files Changed

- `src/shortcuts/git-diff-comments/diff-content-provider.ts` - Added `.trim()` to merge-base output
- `src/test/suite/diff-content-provider.test.ts` - Added 3 comprehensive tests

## Notes

- The `git-range-service.ts` already trims its `execGit` results, so it wasn't affected
- This bug only manifested in the branch changes view (range diff) because that's the only code path using `getRangeDiffContent()`
