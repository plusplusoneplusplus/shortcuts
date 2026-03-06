# Show Active Comment Count on Commit List Items

## Problem
The commit history list (`HISTORY` section in the git sidebar) shows commits as plain items with no indication of how many active (open) review comments exist for each commit. Users have no at-a-glance way to know which commits have pending review work.

## Proposed Approach
In `GitCommitItem`, after the commit is constructed, query `DiffCommentsManager` for the number of open comments whose `gitContext.commitHash` matches this commit's hash, and surface that count in the tree item label or description.

---

## Acceptance Criteria

- [ ] Each commit item in the `HISTORY` list displays the count of **active (open/unresolved)** diff comments associated with that commit hash.
- [ ] The count is **only shown when > 0** (no badge clutter on commits with no comments).
- [ ] The count updates automatically when comments are added, resolved, or deleted (i.e., the tree refreshes).
- [ ] Commits with no active comments look identical to the current UI (no regression).
- [ ] The count does **not** include resolved/closed comments.

---

## Subtasks

### 1. Expose a comment-count query API in `DiffCommentsManager`
- **File**: `src/shortcuts/git-diff-comments/diff-comments-manager.ts`
- Add a method `getActiveCommentCountByCommit(commitHash: string): number` that filters comments where `gitContext.commitHash === commitHash` and `resolved !== true`.

### 2. Pass `DiffCommentsManager` into `GitTreeDataProvider`
- **File**: `src/shortcuts/git/tree-data-provider.ts`
- Inject (or resolve via singleton/context) `DiffCommentsManager` so the provider can query counts when building tree items.

### 3. Update `GitCommitItem` to accept and render the count
- **File**: `src/shortcuts/git/git-commit-item.ts`
- Accept an optional `activeCommentCount: number` constructor parameter.
- When count > 0, append it to the item's `description` (e.g., `"8h ago · Yiheng Tao  ·  💬 3"`) or render as a `badge`-style suffix in the label.

### 4. Wire count into `GitTreeDataProvider.getTreeItem()` / `getChildren()`
- **File**: `src/shortcuts/git/tree-data-provider.ts`
- When constructing each `GitCommitItem`, call `getActiveCommentCountByCommit(commit.hash)` and pass the result.

### 5. Trigger tree refresh on comment changes
- **File**: `src/shortcuts/git/tree-data-provider.ts`
- Subscribe to `DiffCommentsManager`'s change/update event (if one exists, or add one) and fire `_onDidChangeTreeData` so counts stay in sync without a manual reload.

---

## Notes

- **Comment storage key**: comments are keyed by `comment.gitContext.commitHash` (see `diff-comments-tree-provider.ts` → `getGroupedComments()`). Pending (unstaged) changes use `null` as the hash — those should **not** appear in commit list items.
- **Display choice**: prefer appending to `description` (subtitle line) rather than changing the label, to keep the short-hash + subject visually clean. A comment icon (💬 or codicon `comment`) before the number improves scannability.
- **Performance**: `getActiveCommentCountByCommit` should be O(n) over the comment list. For typical usage (< 500 comments) this is fine inline; no caching needed initially.
- **Resolved comments**: the `DiffCommentCategoryItem` already tracks `openCount` vs `resolvedCount` — reuse that logic rather than re-implementing.
- **Test coverage**: add unit tests for the new `getActiveCommentCountByCommit` method and an integration/snapshot test for `GitCommitItem` rendering with a non-zero count.
