---
status: pending
---

# 007: Integrate commenting into CommitDetail, WorkingTreeFileDiff, and BranchFileDiff

## Summary

Wire `useDiffComments` into the three diff viewer pages (`CommitDetail`, `WorkingTreeFileDiff`,
`BranchFileDiff`), add `CommentSidebar` as a collapsible right panel, render
`InlineCommentPopup` when `onAddComment` fires, and pass `comments` to `UnifiedDiffViewer`.

## Motivation

All the building blocks — types (001), diff viewer props (002–004), server routes (005), and
the data hook (006) — are in place. This commit is the integration layer that wires them
together into a working end-to-end feature: click a diff line → popup → submit → comment
appears in viewer and sidebar. Nothing visible changes for users until this commit lands.

## Changes

### Files to Create

_None._

### Files to Modify

1. `packages/coc/src/server/spa/client/react/repos/CommitDetail.tsx`
2. `packages/coc/src/server/spa/client/react/repos/WorkingTreeFileDiff.tsx`
3. `packages/coc/src/server/spa/client/react/repos/BranchFileDiff.tsx`

### Files to Delete

_None._

---

## Implementation Notes

### Type bridging: `DiffComment` → `TaskComment`

`CommentSidebar` expects `comments: TaskComment[]` (from `task-comments-types`).
`useDiffComments` returns `DiffComment[]` (from commit 001).
Both types share the same core shape (`id`, `selection`, `selectedText`, `comment`, `status`,
`createdAt`, `updatedAt`, `author`). If `DiffComment` does **not** extend `TaskComment`,
define a thin local adapter in each file:

```ts
function toTaskComment(c: DiffComment): TaskComment {
    return c as unknown as TaskComment; // safe if shapes match; replace with explicit mapping if needed
}
```

Check the actual `DiffComment` definition from commit 001 before deciding — a direct cast may
suffice or a field-by-field map may be necessary.

### Popup state shape

Each component needs:

```ts
type PopupState = {
    position: { top: number; left: number };
    selection: DiffCommentSelection;
} | null;
```

Use `const [popupState, setPopupState] = useState<PopupState>(null)`.

### `useDiffComments` return shape (assumed from commit 006)

```ts
const {
    comments,   // DiffComment[]
    loading,    // boolean
    addComment, // (selection: DiffCommentSelection, text: string, category: TaskCommentCategory) => Promise<void>
    deleteComment,   // (id: string) => Promise<void>
    updateComment,   // (id: string, text: string) => Promise<void>
    resolveComment,  // (id: string) => Promise<void>
    unresolveComment,// (id: string) => Promise<void>
} = useDiffComments(wsId, context);
```

Adjust field names to match actual hook output.

### `onAddComment` signature (from commit 003)

```ts
onAddComment: (selection: DiffCommentSelection, position: { top: number; left: number }) => void
```

Handler sets `popupState`; `InlineCommentPopup.onSubmit` calls `addComment` then clears it.

### `onCommentClick` signature (from commit 003)

```ts
onCommentClick: (commentId: string) => void
```

Handler opens the sidebar (`setSidebarOpen(true)`) if it is closed.

### AI callbacks in `CommentSidebar`

`onAskAI`, `onFixWithAI`, `onResolveAllWithAI`, and `onCopyPrompt` are not applicable in the
diff-commenting context. Pass no-ops:

```ts
onAskAI={() => {}}
```

---

## Detailed Changes Per File

### 1. `CommitDetail.tsx`

**New imports:**

```ts
import { useState, useCallback } from 'react'; // already imported; ensure useState included
import { useDiffComments } from '../hooks/useDiffComments';
import { CommentSidebar } from '../tasks/comments/CommentSidebar';
import { InlineCommentPopup } from '../tasks/comments/InlineCommentPopup';
import type { DiffCommentSelection } from '../../../diff-comment-types'; // path TBD from 001
import type { TaskCommentCategory } from '../../../task-comments-types';
```

**New state:**

```ts
const [sidebarOpen, setSidebarOpen] = useState(false);
const [popupState, setPopupState] = useState<PopupState>(null);
```

**Hook call** (placed after existing state declarations):

```ts
const diffContext = filePath
    ? { repositoryId: workspaceId, filePath, oldRef: `${hash}^`, newRef: hash, commitHash: hash }
    : undefined; // comments only when a single file is scoped

const { comments, loading: commentsLoading, addComment, deleteComment, updateComment,
        resolveComment, unresolveComment } = useDiffComments(workspaceId, diffContext);
```

> If `useDiffComments` requires a non-optional context, guard with a conditional or pass a
> fallback when `filePath` is undefined (full-commit diff has no meaningful line-level
> context).

**Handlers:**

```ts
const handleAddComment = useCallback(
    (selection: DiffCommentSelection, position: { top: number; left: number }) => {
        setPopupState({ position, selection });
    },
    [],
);

const handleCommentClick = useCallback((_id: string) => {
    setSidebarOpen(true);
}, []);

const handlePopupSubmit = useCallback(
    async (text: string, category: TaskCommentCategory) => {
        if (!popupState) return;
        await addComment(popupState.selection, text, category);
        setPopupState(null);
    },
    [popupState, addComment],
);
```

**Outer layout change** — replace the outermost `<div>` className:

```tsx
// Before:
<div className="commit-detail flex flex-col h-full overflow-y-auto" data-testid="commit-detail">

// After:
<div className="commit-detail flex flex-col h-full overflow-hidden" data-testid="commit-detail">
```

**Header bar** — append a sidebar toggle button inside the `filePath` bar (or add a standalone
mini-bar when `filePath` is absent):

```tsx
{/* existing filePath div, add toggle at end */}
<div className="px-4 py-2 ... flex items-center justify-between">
    <span className="font-mono text-xs ...">{filePath}</span>
    <button
        onClick={() => setSidebarOpen(o => !o)}
        title="Toggle comments"
        className="text-xs px-2 py-0.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
        data-testid="toggle-comments-btn"
    >
        💬 {comments.length > 0 ? comments.length : ''}
    </button>
</div>
```

**Inner layout** — wrap diff section + sidebar in a flex row:

```tsx
<div className="flex flex-1 min-h-0">
    {/* existing diff section — remove overflow-y-auto from outer div; keep it here */}
    <div className="flex-1 overflow-auto px-4 py-3" data-testid="diff-section">
        {/* ... loading / error / empty states unchanged ... */}
        {diff && (
            <UnifiedDiffViewer
                diff={diff}
                fileName={filePath}
                enableComments
                showLineNumbers
                comments={comments as any}   // adapter cast — see Type bridging note
                onAddComment={handleAddComment}
                onCommentClick={handleCommentClick}
                data-testid="diff-content"
            />
        )}
    </div>

    {sidebarOpen && (
        <CommentSidebar
            taskId={workspaceId}
            filePath={filePath ?? ''}
            comments={comments as any}
            loading={commentsLoading}
            onResolve={resolveComment}
            onUnresolve={unresolveComment}
            onDelete={deleteComment}
            onEdit={(id, text) => updateComment(id, text)}
            onAskAI={() => {}}
            onCommentClick={() => {}}
            data-testid="diff-comment-sidebar"
        />
    )}
</div>
```

**Popup** — render at the bottom of the component return, outside all layout divs:

```tsx
{popupState && (
    <InlineCommentPopup
        position={popupState.position}
        onSubmit={handlePopupSubmit}
        onCancel={() => setPopupState(null)}
    />
)}
```

---

### 2. `WorkingTreeFileDiff.tsx`

Follows the same pattern as `CommitDetail`.

**Context:**

```ts
const diffContext = {
    repositoryId: workspaceId,
    filePath,
    oldRef: stage === 'staged' ? 'HEAD' : 'INDEX',
    newRef: 'working-tree',
};

const { comments, loading: commentsLoading, addComment, deleteComment, updateComment,
        resolveComment, unresolveComment } = useDiffComments(workspaceId, diffContext);
```

> Skip comments for `stage === 'untracked'` — either guard the hook call or pass a disabled
> flag if the hook supports it. Simplest: when `stage === 'untracked'`, use an empty context
> and ignore the returned data.

**Header bar** — the existing `<div data-testid="working-tree-file-diff-header">` already has
`flex items-center gap-2`; add the toggle button at the end:

```tsx
<button
    onClick={() => setSidebarOpen(o => !o)}
    title="Toggle comments"
    className="ml-auto text-xs px-2 py-0.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
    data-testid="toggle-comments-btn"
>
    💬 {comments.length > 0 ? comments.length : ''}
</button>
```

**Outer div** className: change `overflow-y-auto` → `overflow-hidden`.

**Inner flex row** wraps `data-testid="working-tree-file-diff-section"` (as `flex-1 overflow-auto`)
and the optional `CommentSidebar`.

**`UnifiedDiffViewer`** render line (inside the `diff ?` branch):

```tsx
<UnifiedDiffViewer
    diff={diff}
    fileName={filePath}
    enableComments
    showLineNumbers
    comments={comments as any}
    onAddComment={handleAddComment}
    onCommentClick={handleCommentClick}
    data-testid="working-tree-file-diff-content"
/>
```

---

### 3. `BranchFileDiff.tsx`

Same pattern.

**Context:**

```ts
const diffContext = {
    repositoryId: workspaceId,
    filePath,
    oldRef: 'branch-base',
    newRef: 'branch-head',
};
```

> `BranchFileDiff` fetches from `/git/branch-range/files/:path/diff`, a server-side computed
> range endpoint. It receives no explicit branch ref props. Use the symbolic literals
> `'branch-base'` / `'branch-head'` — these must match whatever the server uses when storing
> comments for branch-range diffs. Confirm the server-side key scheme with commit 005.

**Header bar** — the existing `<div data-testid="branch-file-diff-header">` has `flex items-center gap-2`; add the toggle button at the end (same pattern as `WorkingTreeFileDiff`).

**Outer div** className: change `overflow-y-auto` → `overflow-hidden`.

**`UnifiedDiffViewer`** render line (inside the `diff ?` branch):

```tsx
<UnifiedDiffViewer
    diff={diff}
    fileName={filePath}
    enableComments
    showLineNumbers
    comments={comments as any}
    onAddComment={handleAddComment}
    onCommentClick={handleCommentClick}
    data-testid="branch-file-diff-content"
/>
```

---

## Tests

### Unit tests (Vitest + React Testing Library)

For each of the three components, add a test file
(e.g. `CommitDetail.comment.test.tsx`, `WorkingTreeFileDiff.comment.test.tsx`,
`BranchFileDiff.comment.test.tsx`) covering:

1. **Sidebar toggle** — renders without sidebar by default; clicking the toggle button shows
   `data-testid="comment-sidebar"`.
2. **Popup on `onAddComment`** — simulate `UnifiedDiffViewer` calling `onAddComment` prop with
   a mock selection and position; assert `data-testid="inline-comment-popup"` appears.
3. **Popup submit calls `addComment`** — mock `useDiffComments`; fill textarea and submit;
   assert `addComment` was called with correct args and popup closes.
4. **Popup cancel** — click Cancel; assert popup unmounts.
5. **`onCommentClick` opens sidebar** — simulate callback; assert sidebar becomes visible.
6. **Comments passed to viewer** — mock hook returning two comments; assert
   `UnifiedDiffViewer` receives `comments` prop with those two items.
7. **Untracked files (WorkingTreeFileDiff only)** — when `stage="untracked"`, comments UI
   is not rendered (no toggle button or sidebar).

Mock `useDiffComments` via `vi.mock('../hooks/useDiffComments')` returning controllable
state.

---

## Acceptance Criteria

- [ ] Clicking the toggle button in each diff page header shows/hides `CommentSidebar`.
- [ ] `CommentSidebar` displays the comments returned by `useDiffComments`.
- [ ] Selecting lines in `UnifiedDiffViewer` and triggering `onAddComment` shows
      `InlineCommentPopup` at the correct viewport position.
- [ ] Submitting the popup calls `addComment` and the popup closes.
- [ ] Cancelling the popup closes it without saving.
- [ ] Clicking a comment badge/highlight (`onCommentClick`) opens the sidebar if closed.
- [ ] `UnifiedDiffViewer` receives `enableComments`, `showLineNumbers`, and the live
      `comments` array in all three pages.
- [ ] Untracked files in `WorkingTreeFileDiff` do not show the comment toggle or sidebar.
- [ ] No TypeScript errors at build time (`npm run build` passes).
- [ ] All new unit tests pass.

---

## Dependencies

| Commit | What this commit needs from it |
|--------|-------------------------------|
| 001    | `DiffComment`, `DiffCommentContext`, `DiffCommentSelection` types |
| 002    | `UnifiedDiffViewer` `enableComments`, `showLineNumbers`, `onLinesReady` props |
| 003    | `UnifiedDiffViewer` `onAddComment`, `onCommentClick` props |
| 004    | `UnifiedDiffViewer` `comments` prop (highlights + gutter badges) |
| 005    | Server routes for persisting/fetching diff comments |
| 006    | `useDiffComments(wsId, context)` hook |

---

## Assumed Prior State

- `DiffComment`, `DiffCommentContext`, `DiffCommentSelection` are exported from a module
  importable in the SPA client (from commit 001).
- `UnifiedDiffViewer` accepts all of: `enableComments`, `showLineNumbers`, `comments`,
  `onAddComment`, `onCommentClick` (from commits 002–004).
- `useDiffComments(wsId, context)` is importable from `../hooks/useDiffComments` and returns
  at minimum `{ comments, loading, addComment, deleteComment, updateComment, resolveComment,
  unresolveComment }` (from commit 006).
- `CommentSidebar` and `InlineCommentPopup` exist at their current paths and have the props
  listed in this file (no changes needed to those components).
- `TaskComment` and `DiffComment` are structurally compatible enough for a cast, or an adapter
  is written (one-time, local to each file).
