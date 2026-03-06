# Git Diff Commenting

Add inline commenting support to the CoC dashboard's git diff viewer (commits, working-tree changes, and branch diffs), mirroring the existing Markdown Review Editor's comment UX.

## Context

The CoC SPA dashboard already has:

- **`UnifiedDiffViewer`** — renders syntax-highlighted unified diffs for commits, staged/unstaged files, and branch ranges. Lines are plain `<div>`s keyed by array index with no identity attributes or selection awareness.
- **Markdown Review Editor** — a fully featured inline commenting system (`SelectionToolbar`, `InlineCommentPopup`, `CommentSidebar`, `CommentCard`, `CommentReply`) backed by `TaskCommentsManager` REST API. Comments use `CommentSelection` (line/column ranges) and `CommentAnchor` (fuzzy relocation).

The goal is to let users select text in any diff view and attach comments, with the same UX affordances (add, edit, resolve, delete, AI ask, threaded replies) the markdown reviewer already provides.

## Acceptance Criteria

1. **Select-to-comment on diffs** — Users can select text on any line (added, removed, or context) in `UnifiedDiffViewer` and a floating "Add comment" toolbar appears.
2. **Comment popup** — Clicking "Add comment" opens an inline popup with a textarea; submitting creates a comment anchored to the selected diff lines.
3. **Comment sidebar** — A toggleable sidebar lists all comments for the current diff, grouped by file in multi-file diffs. Clicking a comment scrolls to its anchor.
4. **Inline gutter markers** — Lines with comments show a visual indicator (icon or highlight) in the diff view.
5. **Full comment lifecycle** — Edit, resolve/unresolve, delete, and threaded replies work identically to the markdown reviewer.
6. **AI integration** — "Ask AI" on a comment works via the existing queued AI flow.
7. **Persistence** — Comments are persisted per workspace and keyed by a stable diff reference (repo + ref range + file path). They survive page reloads.
8. **Commit diffs** — Commenting works on single-commit diffs (`CommitDetail`).
9. **Working-tree diffs** — Commenting works on staged and unstaged file diffs (`WorkingTreeFileDiff`).
10. **Branch-range diffs** — Commenting works on branch comparison diffs (`BranchFileDiff`).
11. **Comment relocation** — When the diff changes (e.g., new commits to a branch), existing comments relocate using anchor context matching; orphaned comments are flagged.
12. **Mobile** — The comment popup renders as a `BottomSheet` on narrow viewports (matching existing behavior).

## Subtasks

### 1. Extend `UnifiedDiffViewer` with line identity and selection support

- Parse hunk headers (`@@ -a,b +c,d @@`) to compute old/new line numbers per rendered line.
- Add `data-diff-line-index`, `data-old-line`, `data-new-line`, and `data-line-type` attributes to each line `<div>`.
- Add an optional line-number gutter column (old | new) alongside the existing `+/-/space` prefix.
- Export a `DiffLine` type: `{ index: number; type: LineType; oldLine?: number; newLine?: number; content: string }`.
- Expose parsed lines via an optional `onLinesReady?: (lines: DiffLine[]) => void` callback or a ref.

### 2. Define the `DiffCommentSelection` data model

- Create `DiffCommentSelection` extending the concept of `CommentSelection` with diff-specific fields:
  ```ts
  interface DiffCommentSelection {
    diffLineStart: number;    // index into rendered diff lines
    diffLineEnd: number;
    side: 'added' | 'removed' | 'context';
    oldLineStart?: number;    // source file line (old side)
    oldLineEnd?: number;
    newLineStart?: number;    // source file line (new side)
    newLineEnd?: number;
    startColumn: number;
    endColumn: number;
  }
  ```
- Create `DiffCommentContext` to capture the git reference:
  ```ts
  interface DiffCommentContext {
    repositoryId: string;
    filePath: string;
    oldRef: string;           // e.g., commit hash, "HEAD", "INDEX"
    newRef: string;
    commitHash?: string;      // for single-commit diffs
  }
  ```
- Extend `TaskComment` or create a `DiffComment` type that includes these plus all existing fields (status, anchor, replies, etc.).

### 3. Build selection-to-comment bridge in `UnifiedDiffViewer`

- Add `mouseup` / `selectionchange` listener on the diff container.
- On text selection, determine which diff lines are spanned using the `data-*` attributes.
- Compute viewport-relative position for the `SelectionToolbar`.
- New props on `UnifiedDiffViewer`:
  ```ts
  enableComments?: boolean;
  comments?: DiffComment[];
  onAddComment?: (selection: DiffCommentSelection, selectedText: string, position: { top: number; left: number }) => void;
  onCommentClick?: (comment: DiffComment) => void;
  ```

### 4. Add inline comment highlights and gutter markers

- When `comments` prop is provided, highlight the corresponding diff lines with a background color (yellow for open, green for resolved — matching markdown reviewer).
- Render a comment-count badge or icon in the line-number gutter for lines with comments.
- Clicking a gutter marker scrolls the sidebar to that comment.

### 5. Create `useDiffComments` hook

- Similar to `useTaskComments` but keyed by `DiffCommentContext` instead of task file path.
- Derive a stable storage key: `sha256(repoId + oldRef + newRef + filePath)`.
- CRUD operations via the existing `/api/comments/` endpoints (reuse `TaskCommentsManager`).
- Load comments on mount; re-fetch when the diff context changes.
- Provide `addComment`, `editComment`, `resolveComment`, `deleteComment`, `addReply`, `askAI` methods.

### 6. Integrate commenting into `CommitDetail`, `WorkingTreeFileDiff`, `BranchFileDiff`

- Wrap `UnifiedDiffViewer` with a layout that includes the `CommentSidebar` (right panel or drawer).
- Pass `enableComments`, `comments`, and callback props.
- Show `InlineCommentPopup` when `onAddComment` fires.
- Wire up all sidebar actions to `useDiffComments`.
- For multi-file views (`CommitDetail` with file list), filter comments by currently selected file.

### 7. Comment persistence and storage key design

- Server-side: store under `{dataDir}/diff-comments/{wsId}/{storageKey}.json`.
- Consider whether to reuse `TaskCommentsManager` with a different path prefix or create a dedicated `DiffCommentsManager`.
- Add a `GET /api/diff-comment-counts/:wsId` endpoint for badge counts on file lists (so users can see which files have comments before opening).
- Support listing all comments for a given commit hash or ref range.

### 8. Anchor relocation for diffs

- When a diff changes (user re-fetches or new commit), run anchor matching using `selectedText`, `contextBefore`, `contextAfter` from `CommentAnchor`.
- Match against the new diff lines; update `diffLineStart`/`diffLineEnd` if the content shifted.
- If no match found, mark the comment as orphaned (visual indicator + filter option in sidebar).

### 9. Tests

- Unit tests for hunk-header parsing and line-number computation.
- Unit tests for `DiffCommentSelection` mapping (selection → model → highlight).
- Unit tests for storage key generation and anchor relocation.
- Integration tests for `useDiffComments` hook (mock API).
- Component tests for `UnifiedDiffViewer` with comments enabled (render highlights, gutter markers).
- E2e smoke test: select text → add comment → verify sidebar → resolve → verify highlight change.

## Notes

- **Reuse over rebuild** — The `SelectionToolbar`, `InlineCommentPopup`, `CommentSidebar`, `CommentCard`, and `CommentReply` components are all reusable without modification. The main new work is in `UnifiedDiffViewer` (line identity, selection handling, highlights) and the data model / hook layer.
- **Storage key stability** — For working-tree diffs, the "ref" is transient (staged/unstaged). Comments on working-tree diffs should be keyed by `(repoId, filePath, "working-tree")` and treated as ephemeral — cleared when the file is committed or changes are discarded.
- **Multi-file diffs** — `CommitDetail` can show a full commit diff (all files concatenated). Commenting should work per-file section. The hunk-header parser already handles `diff --git a/... b/...` boundaries.
- **Performance** — For large diffs (1000+ lines), comment highlight rendering should use a virtualized or windowed approach, or at minimum avoid re-rendering the entire diff when a single comment changes.
- **Future: side-by-side mode** — The current viewer is unified only. A future side-by-side mode would need the `side` field in `DiffCommentSelection`, which is already included in the proposed model.
