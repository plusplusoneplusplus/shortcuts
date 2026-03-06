# Context: Git Diff Commenting

## User Story
Add inline commenting support to the CoC dashboard's git diff viewer (commits, working-tree changes, and branch diffs), mirroring the existing Markdown Review Editor's comment UX — so users can select text in any diff view and attach comments with the same add/edit/resolve/delete/AI-ask/threaded-reply affordances.

## Goal
Extend `UnifiedDiffViewer` with line identity and selection awareness, then wire the existing comment UI components (`SelectionToolbar`, `InlineCommentPopup`, `CommentSidebar`) into all three diff viewer pages via a new `useDiffComments` hook backed by a dedicated server-side `DiffCommentsManager`.

## Commit Sequence
1. Define diff comment types
2. Add line identity to UnifiedDiffViewer
3. Add selection detection to UnifiedDiffViewer
4. Add comment highlights and gutter markers
5. Create DiffCommentsManager and server routes
6. Create `useDiffComments` hook
7. Integrate commenting into CommitDetail, WorkingTreeFileDiff, BranchFileDiff
8. Implement anchor relocation for changed diffs
9. Add integration and e2e tests

## Key Decisions
- Reuse all existing comment UI components unchanged (`SelectionToolbar`, `InlineCommentPopup`, `CommentSidebar`, `CommentCard`, `CommentReply`)
- New server storage at `~/.coc/diff-comments/{wsId}/{sha256(repoId+oldRef+newRef+filePath)}.json`
- Working-tree diffs use key `sha256(repoId+filePath+'working-tree')` and are flagged ephemeral
- `DiffCommentSelection` and `DiffCommentContext` types live in `pipeline-core/src/editor/types.ts`; client `DiffComment` type in `coc/.../diff-comment-types.ts`
- `enableComments` prop on `UnifiedDiffViewer` is opt-in; existing renders unaffected
- Orphaned comments (anchor lost after diff change) are flagged client-side only — not persisted

## Conventions
- Mirrors `TaskCommentsManager` / `useTaskComments` / `task-comments-types.ts` patterns exactly
- Route prefix: `/api/diff-comments/` (parallel to `/api/comments/`)
- SHA-256 storage keys (consistent with existing task-comments approach)
- Vitest for all tests; `@testing-library/react` for component/hook tests
- `data-testid` attributes follow existing naming conventions in the codebase
