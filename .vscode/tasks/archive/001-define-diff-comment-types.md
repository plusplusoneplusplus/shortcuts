---
status: pending
---

# 001: Define Diff Comment Types

## Summary
Add `DiffCommentSelection` and `DiffCommentContext` to `packages/pipeline-core/src/editor/types.ts`, then create `packages/coc/src/server/spa/client/diff-comment-types.ts` with `DiffCommentReply` and `DiffComment` mirroring the `TaskComment` pattern. Update `packages/pipeline-core/src/editor/index.ts` to export the two new core types.

## Motivation
All subsequent commits (API handlers, client UI, persistence) must reference a single canonical set of diff comment types. Defining the types first — with no implementation — means no commit introduces a forward dependency or copies ad-hoc shapes.

## Changes

### Files to Create
- `packages/coc/src/server/spa/client/diff-comment-types.ts` — browser-compatible client types: `DiffCommentStatus`, `DiffCommentCategory`, `DIFF_CATEGORY_INFO`, `ALL_DIFF_CATEGORIES`, `DiffCommentReply`, `DiffComment`, `DiffCommentsData`; re-exports `DiffCommentSelection` and `DiffCommentContext` from pipeline-core

### Files to Modify
- `packages/pipeline-core/src/editor/types.ts` — append `DiffCommentSelection` and `DiffCommentContext` interfaces after the existing `CommentAnchor` block (line 46)
- `packages/pipeline-core/src/editor/index.ts` — add `DiffCommentSelection` and `DiffCommentContext` to the named export list from `'./types'`

### Files to Delete
- None

## Implementation Notes

**`DiffCommentSelection`** (add to `packages/pipeline-core/src/editor/types.ts`):
```ts
/**
 * Selection range within a rendered diff view.
 * `diffLineStart`/`diffLineEnd` are 0-based indices into the rendered diff line array.
 * `oldLine*` / `newLine*` carry the corresponding source-file line numbers when known.
 */
export interface DiffCommentSelection {
    /** 0-based start index into the rendered diff line array */
    diffLineStart: number;
    /** 0-based end index into the rendered diff line array (inclusive) */
    diffLineEnd: number;
    /** Which side of the diff the selection lives on */
    side: 'added' | 'removed' | 'context';
    /** Corresponding start line in the old (left) file, if applicable */
    oldLineStart?: number;
    /** Corresponding end line in the old (left) file, if applicable */
    oldLineEnd?: number;
    /** Corresponding start line in the new (right) file, if applicable */
    newLineStart?: number;
    /** Corresponding end line in the new (right) file, if applicable */
    newLineEnd?: number;
    /** 0-based start column within the line */
    startColumn: number;
    /** 0-based end column within the line */
    endColumn: number;
}
```

**`DiffCommentContext`** (add to `packages/pipeline-core/src/editor/types.ts`):
```ts
/**
 * Identifies the diff that a comment belongs to.
 * `oldRef` / `newRef` follow the same string conventions as the git CLI
 * (commit hash, branch name, "HEAD", "INDEX", etc.).
 */
export interface DiffCommentContext {
    /** Stable repository identifier (e.g. remote URL or local root path) */
    repositoryId: string;
    /** Repo-relative file path */
    filePath: string;
    /** Base ref for the diff (left side) */
    oldRef: string;
    /** Target ref for the diff (right side) */
    newRef: string;
    /** Resolved commit hash when the comment was created (for durability) */
    commitHash?: string;
}
```

**`diff-comment-types.ts`** pattern — mirrors `task-comments-types.ts`:
- Re-export `DiffCommentSelection` and `DiffCommentContext` from `@plusplusoneplusplus/pipeline-core/editor/types`
- `DiffCommentStatus = 'open' | 'resolved'`
- `DiffCommentCategory` — same union as `TaskCommentCategory`: `'bug' | 'question' | 'suggestion' | 'praise' | 'nitpick' | 'general'`
- `DIFF_CATEGORY_INFO` — same shape as `CATEGORY_INFO`
- `ALL_DIFF_CATEGORIES` — same array as `ALL_CATEGORIES`
- `getDiffCommentCategory(comment: DiffComment): DiffCommentCategory` — same logic as `getCommentCategory`
- `DiffCommentReply` — identical shape to `TaskCommentReply` (id, author, text, createdAt, isAI?)
- `DiffComment`:
  ```ts
  export interface DiffComment {
      id: string;
      context: DiffCommentContext;          // replaces taskId
      selection: DiffCommentSelection;      // replaces CommentSelection
      selectedText: string;
      comment: string;
      status: DiffCommentStatus;
      createdAt: string;
      updatedAt: string;
      author?: string;
      category?: DiffCommentCategory;
      anchor?: import('@plusplusoneplusplus/pipeline-core/editor/types').CommentAnchor;
      replies?: DiffCommentReply[];
      aiResponse?: string;
  }
  ```
- `DiffCommentsData`:
  ```ts
  export interface DiffCommentsData {
      /** Stable key identifying the diff (e.g. "<repositoryId>:<filePath>:<oldRef>..<newRef>") */
      diffId: string;
      comments: DiffComment[];
      version: number;
  }
  ```

**Index update** — add two names to the existing export block in `packages/pipeline-core/src/editor/index.ts`:
```ts
export {
    // ... existing exports ...
    DiffCommentSelection,
    DiffCommentContext,
} from './types';
```

**Column conventions:** `startColumn`/`endColumn` in `DiffCommentSelection` use the same 0-based convention as VS Code's `Range` API so future VS Code integration requires no conversion. `CommentSelection` in pipeline-core uses 1-based values — do not change that; `DiffCommentSelection` is a distinct type.

## Tests
- Unit test: `DiffCommentSelection` with all optional fields absent still satisfies the interface (TypeScript compile check only; no runtime assertion needed at this stage)
- Unit test: `DiffComment` object with a fully populated `DiffCommentContext` and `DiffCommentSelection` can be assigned without type errors
- Unit test: `getDiffCommentCategory` returns `'general'` for a comment with no category and no prefix, and correctly parses a `[bug]` prefix
- Ensure `packages/pipeline-core` builds without errors (`npm run build` in repo root)

## Acceptance Criteria
- [ ] `DiffCommentSelection` and `DiffCommentContext` are exported from `packages/pipeline-core/src/editor/index.ts`
- [ ] `packages/coc/src/server/spa/client/diff-comment-types.ts` exists and compiles without errors
- [ ] `DiffComment.context` is typed as `DiffCommentContext` (not a plain string id)
- [ ] `DiffComment.selection` is typed as `DiffCommentSelection` (not `CommentSelection`)
- [ ] `CommentAnchor` is still re-used on `DiffComment.anchor` (no duplication)
- [ ] No existing exports from `packages/pipeline-core/src/editor/index.ts` are removed or renamed
- [ ] `npm run build` succeeds with no new TypeScript errors

## Dependencies
- Depends on: None

## Assumed Prior State
None — this is commit 1. The only prerequisite is the existing codebase state: `CommentSelection`, `CommentAnchor`, and `MarkdownComment` already present in `packages/pipeline-core/src/editor/types.ts`, and `TaskComment`/`TaskCommentReply` already present in `packages/coc/src/server/spa/client/task-comments-types.ts`.
