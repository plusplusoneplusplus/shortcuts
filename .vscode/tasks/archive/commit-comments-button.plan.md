# Plan: Show Comments Button on Commit Items

## Problem

In the Git tab's History view, individual files under a commit already have a comment button (inline action) to open the diff with review. However, clicking on the **commit itself** has no way to surface all comments across all files in that commit. The user needs a button at the commit level that reveals all comment files for that commit in the diff-comments sidebar.

## Current State

- `GitCommitItem` has `contextValue = 'gitCommit'` with no comment-related inline actions.
- It already receives `activeCommentCount` and shows a 💬 badge in the description when > 0.
- `DiffCommentsTreeDataProvider` already groups comments by `commitHash → filePath`, so commit-level category nodes (`DiffCommentCategoryItem`) exist in the tree.
- The `gitView` shows the diff-comments section separately (below Working Changes / History).

## Proposed Approach

Add a "Show Comments" inline button on `GitCommitItem` (only when it has active comments) that:
1. Focuses the `gitView` / diff-comments tree section.
2. Reveals and expands the commit's category node in `DiffCommentsTreeDataProvider`.

This mirrors how `gitDiffComments.openFileWithReview` works for file-level items.

---

## Tasks

### 1. New command: `gitDiffComments.showCommentsForCommit`

**File:** `src/shortcuts/git-diff-comments/diff-comments-commands.ts`

- Register the command in `DiffCommentsCommands.registerCommands()`.
- Handler receives a `GitCommitItem` argument.
- Execute: `vscode.commands.executeCommand('gitView.focus')` then call the tree provider's reveal method.

### 2. Reveal method on tree provider

**File:** `src/shortcuts/git-diff-comments/diff-comments-tree-provider.ts`

- Add `revealCommitCategory(commitHash: string): Promise<void>` on `DiffCommentsTreeDataProvider`.
- Uses `this._view?.reveal(categoryItem, { expand: true, select: true, focus: false })`.
- Must call `getChildren()` or look up from internal state to find the right `DiffCommentCategoryItem`.

### 3. Update `GitCommitItem` contextValue

**File:** `src/shortcuts/git/git-commit-item.ts`

- Change `contextValue` from the constant `'gitCommit'` to a computed value:
  - `'gitCommit_hasComments'` when `activeCommentCount > 0`
  - `'gitCommit'` otherwise
- This allows `when` clauses in `package.json` to conditionally show the button.

### 4. Register inline menu action

**File:** `package.json`

- Add command contribution for `gitDiffComments.showCommentsForCommit`:
  ```json
  {
    "command": "gitDiffComments.showCommentsForCommit",
    "title": "Show Comments",
    "icon": "$(comment-discussion)"
  }
  ```
- Add inline menu entry under `view/item/context`:
  ```json
  {
    "command": "gitDiffComments.showCommentsForCommit",
    "when": "view == gitView && viewItem == gitCommit_hasComments",
    "group": "inline@1"
  }
  ```

### 5. Wire up DiffCommentsManager reference

**File:** `src/shortcuts/git/tree-data-provider.ts` or `src/extension.ts`

- Ensure `DiffCommentsCommands` can access `DiffCommentsTreeDataProvider` instance to call `revealCommitCategory`.
- Check existing wiring — `DiffCommentsManager` is already injected into `GitTreeDataProvider`; the same instance should be usable.

---

## Files Touched

| File | Change |
|------|--------|
| `src/shortcuts/git/git-commit-item.ts` | Make `contextValue` dynamic based on `activeCommentCount` |
| `src/shortcuts/git-diff-comments/diff-comments-tree-provider.ts` | Add `revealCommitCategory(commitHash)` method |
| `src/shortcuts/git-diff-comments/diff-comments-commands.ts` | Register `gitDiffComments.showCommentsForCommit` command |
| `package.json` | Add command + inline menu entry for `gitCommit_hasComments` |
| `src/extension.ts` | Pass tree provider ref to commands if not already wired |

## Notes

- The button should only appear when `activeCommentCount > 0` (controlled by `contextValue`).
- No new storage or data model changes needed — `DiffCommentCategoryItem` already exists.
- Consistent with existing pattern: `gitDiffComments.openFileWithReview` for files, `gitDiffComments.showCommentsForCommit` for commits.
