---
status: done
---

# 003: Update client to handle partial comment resolution

## Summary

Update the SPA client's `useTaskComments` hook and `MarkdownReviewEditor` to handle partial resolution — where the server only returns IDs of comments the AI actually resolved via tool calls — and provide appropriate user feedback distinguishing resolved vs. unresolved comments.

## Motivation

With commit 002, the server's `batch-resolve` and per-comment `ask-ai?commandId=resolve` endpoints now return `{ revisedContent, commentIds }` where `commentIds` only contains IDs the AI explicitly resolved via the `resolve_comment` tool. The client currently assumes all comments get resolved unconditionally: `fixWithAI` always calls `resolveComment(id)` at line 355, and `resolveWithAI` resolves every ID in the returned array at line 306. This commit makes the client respect partial resolution and shows the user how many comments were actually addressed.

## Changes

### Files to Create
- None

### Files to Modify

- `packages/coc/src/server/spa/client/react/hooks/useTaskComments.ts` — Update `fixWithAI` and `resolveWithAI` logic, update `FixWithAIResult` type
- `packages/coc/src/server/spa/client/react/shared/MarkdownReviewEditor.tsx` — Update `handleFixWithAI` and `handleResolveAllWithAI` toast messages for partial resolution

### Files to Delete
- None

## Implementation Notes

### 1. Update `FixWithAIResult` type (useTaskComments.ts, line 49–51)

Add a `resolved` boolean field so callers know whether the AI actually resolved the comment:

```ts
export interface FixWithAIResult {
    revisedContent: string;
    resolved: boolean;
}
```

### 2. Update `fixWithAI` (useTaskComments.ts, lines 318–364)

Currently at line 335, the async path already destructures `commentIds` from the poll result:
```ts
const result = await pollTaskResult<{ revisedContent: string; commentIds: string[] }>(taskId);
```
But the sync path at line 340 only reads `revisedContent`. Both paths then unconditionally call `resolveComment(id)` at line 355.

**Change:** In both the async (line 332–336) and sync (line 337–341) paths, also extract `commentIds`. After writing the revised file, only call `resolveComment(id)` if the target comment's ID appears in `commentIds`:

```ts
// Replace line 354–355:
// Step 3 — resolve only if AI actually resolved it
const wasResolved = commentIds.includes(id);
if (wasResolved) {
    await resolveComment(id);
}
await refresh();
return { revisedContent, resolved: wasResolved };
```

The sync path needs to parse `commentIds` from the response:
```ts
const data = await aiRes.json();
revisedContent = data.revisedContent;
commentIds = data.commentIds ?? [];
```

Declare `commentIds` as `let commentIds: string[] = []` alongside `revisedContent` at line 330.

### 3. Update `resolveWithAI` (useTaskComments.ts, lines 266–316)

The existing logic at lines 278–292 already extracts `commentIds` from both async and sync paths, and lines 306–310 resolve all returned IDs and return `{ revisedContent, resolvedCount: commentIds.length }`. Since the server now only returns actually-resolved IDs, this naturally works correctly.

**Change:** Update `ResolveWithAIResult` (line 44–47) to include `totalCount` so the UI can distinguish partial resolution:

```ts
export interface ResolveWithAIResult {
    revisedContent: string;
    resolvedCount: number;
    totalCount: number;
}
```

In the `resolveWithAI` function, compute total open comments before the API call and return it:

```ts
// Before the fetch at line 271, capture the open count:
const openComments = comments.filter(c => c.status === 'open');
const totalCount = openComments.length;

// At line 310, update the return:
return { revisedContent, resolvedCount: commentIds.length, totalCount };
```

Note: `resolveWithAI` is a `useCallback` with deps `[wsId, taskPath, resolveComment, refresh]` (line 315). Adding `comments` to the dependency array is needed since we now read from it.

### 4. Update `handleResolveAllWithAI` toast (MarkdownReviewEditor.tsx, lines 435–443)

Currently shows a generic success message at line 439:
```ts
addToast(`${result.resolvedCount} comments resolved. Document updated.`, 'success');
```

**Change:** Show a partial-resolution message when `resolvedCount < totalCount`:

```ts
if (result.resolvedCount === result.totalCount) {
    addToast(`All ${result.resolvedCount} comments resolved. Document updated.`, 'success');
} else if (result.resolvedCount === 0) {
    addToast(`AI could not resolve any of the ${result.totalCount} comments. Document may still have been updated.`, 'warning');
} else {
    addToast(`${result.resolvedCount} of ${result.totalCount} comments resolved. Document updated.`, 'success');
}
```

The toast system (`useGlobalToast` from `ToastContext`) supports `'success' | 'error' | 'warning' | 'info'` via `ToastItem['type']`.

### 5. Update `handleFixWithAI` toast (MarkdownReviewEditor.tsx, lines 445–453)

Currently shows `'Comment fixed. Document updated.'` unconditionally at line 449.

**Change:** Use the new `resolved` field from `FixWithAIResult`:

```ts
const result = await fixWithAI(id, rawContent, filePath);
setRawContent(result.revisedContent);
if (result.resolved) {
    addToast('Comment fixed and resolved. Document updated.', 'success');
} else {
    addToast('AI updated the document but did not resolve the comment (it may need clarification).', 'info');
}
```

### Key patterns to preserve

- `pollTaskResult<T>` (line 85–102) uses generic typing; the type parameter `{ revisedContent: string; commentIds: string[] }` is already used in `fixWithAI` line 335. No change needed there.
- `resolveComment` (line 222–224) calls `updateCommentFn(id, { status: 'resolved' })` — this is the single-comment status-flip API call. Keep using it as-is.
- `mountedRef` guard pattern (e.g., line 320, 360) must be preserved for all state updates.

## Tests

- **`fixWithAI` partial resolution:** Mock server returning `{ revisedContent: '...', commentIds: [] }` (empty — AI didn't resolve). Assert `resolveComment` is NOT called and `result.resolved === false`.
- **`fixWithAI` full resolution:** Mock server returning `{ revisedContent: '...', commentIds: ['target-id'] }`. Assert `resolveComment` IS called and `result.resolved === true`.
- **`resolveWithAI` partial resolution:** With 5 open comments, mock server returning `commentIds` with 3 IDs. Assert `resolveComment` called 3 times, `result.resolvedCount === 3`, `result.totalCount === 5`.
- **`resolveWithAI` full resolution:** All IDs returned. Assert `resolvedCount === totalCount`.
- **Toast messages:** In MarkdownReviewEditor, mock `resolveWithAI` returning partial counts. Assert `addToast` receives the "X of Y" message format.

## Acceptance Criteria

- [ ] `fixWithAI` only calls `resolveComment(id)` when the server response includes the comment ID in `commentIds`
- [ ] `fixWithAI` returns `{ revisedContent, resolved: boolean }` — callers can distinguish outcomes
- [ ] `resolveWithAI` returns `{ revisedContent, resolvedCount, totalCount }` — callers know how many were addressed
- [ ] `resolveWithAI` adds `comments` to its `useCallback` dependency array
- [ ] Toast in `handleResolveAllWithAI` shows "X of Y" when partial, "All X" when full, and a warning when zero
- [ ] Toast in `handleFixWithAI` distinguishes "fixed and resolved" from "updated but not resolved"
- [ ] No regressions: when all comments are resolved, behavior is identical to pre-change
- [ ] The revised file content is still written even when resolution is partial (document edits and comment resolution are independent)

## Dependencies
- Depends on: 002

## Assumed Prior State

From **001:**
- `SendMessageOptions` and `ISessionOptions` in pipeline-core's SDK wrapper accept `tools?: Tool<any>[]`

From **002:**
- Server `batch-resolve` endpoint (`POST /comments/:wsId/:taskPath/batch-resolve`) returns `{ revisedContent: string; commentIds: string[] }` where `commentIds` only contains IDs the AI explicitly resolved via `resolve_comment` tool calls
- Server per-comment `ask-ai` with `commandId: 'resolve'` also returns `{ revisedContent: string; commentIds: string[] }` with the same partial-resolution semantics
- Both the queue path (202 → poll) and sync fallback path include `commentIds` in their response shape
- A `resolve_comment` tool is defined server-side and passed to AI sessions, allowing AI to explicitly signal which comments it addressed
