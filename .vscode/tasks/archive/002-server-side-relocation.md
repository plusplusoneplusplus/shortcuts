---
status: done
---

# 002: Add Server-Side Anchor Relocation on Comment Retrieval

## Summary

When the GET `/api/comments/:wsId/:taskPath` endpoint returns comments, read the current file content from disk, run `batchRelocateAnchors` from pipeline-core to update stale `selection` positions, and persist relocated positions back to the JSON file so relocation isn't repeated on subsequent fetches.

## Motivation

This is a separate commit because it builds on commit 001 (correct anchor creation) and adds a distinct runtime behavior: relocating existing anchors when file content has drifted. Keeping it isolated makes the relocation logic independently testable and revertable.

## Changes

### Files to Modify

- `packages/coc/src/server/task-comments-handler.ts` — Add relocation logic to the `TaskCommentsManager.getComments()` method and the GET collection handler. Import `batchRelocateAnchors`, `needsRelocationCheck` from pipeline-core. Add a new method `relocateComments(comments, workspaceRootPath, taskPath)` to the manager class. Modify the GET handler at line ~520 to resolve the workspace path, read file content, and call the relocation method before returning.

### Implementation Detail

**1. New import (top of file, after existing pipeline-core imports ~line 26):**

```ts
import {
    batchRelocateAnchors,
    needsRelocationCheck,
} from '@plusplusoneplusplus/pipeline-core';
import type { BaseAnchorData } from '@plusplusoneplusplus/pipeline-core';
```

**2. New method on `TaskCommentsManager` (after `getComments`, ~line 197):**

Add `relocateComments(workspaceId: string, taskPath: string, comments: TaskComment[], rootPath: string): Promise<TaskComment[]>`:

- Resolve the absolute file path: `path.join(rootPath, taskPath)`.
- Read file content via `fs.promises.readFile`. If the file doesn't exist or read fails, return comments unchanged (no relocation possible).
- Filter comments that have an `anchor` field and where `needsRelocationCheck(content, anchor, selection.startLine, selection.endLine, selection.startColumn, selection.endColumn)` returns `true`.
- If no comments need relocation, return early (no write).
- Build a `Map<string, BaseAnchorData>` keyed by comment `id` from the filtered comments' `anchor` fields. The `CommentAnchor` interface (line 93-99) is structurally identical to `BaseAnchorData` (both have `selectedText`, `contextBefore`, `contextAfter`, `originalLine`, `textHash`), so the anchor can be passed directly.
- Call `batchRelocateAnchors(content, anchorsMap)` → `Map<string, AnchorRelocationResult>`.
- For each result where `found === true`, update the corresponding comment's `selection` to `{ startLine, endLine, startColumn, endColumn }` from the result. Also update the comment's `anchor.originalLine` to the new `startLine` so future fallback uses the relocated position.
- Call `this.writeComments(workspaceId, taskPath, comments)` to persist the relocated positions.
- Return the updated comments array.

**3. Modify GET collection handler (~line 520-535):**

After fetching comments (line 529), resolve the workspace root path using `resolveWorkspacePath(wsId)`. If a root path is available and comments are non-empty, call `manager.relocateComments(wsId, taskPath, comments, rootPath)`. The `resolveWorkspacePath` helper already exists at line 410 but is scoped inside `registerTaskCommentsRoutes` — either pass the resolver as a parameter to the manager method, or perform relocation inline in the handler. The cleaner approach: do relocation in the handler, keeping the manager class focused on storage.

Revised handler pseudo-structure:

```ts
handler: async (_req, res, match) => {
    const [, wsId, taskPath] = match!;
    // ... validation ...
    try {
        let comments = await manager.getComments(wsId, taskPath);
        if (comments.length > 0) {
            const rootPath = await resolveWorkspacePath(wsId);
            if (rootPath) {
                comments = await relocateCommentsIfNeeded(
                    manager, wsId, taskPath, comments, rootPath
                );
            }
        }
        sendJSON(res, 200, { comments });
    } catch { ... }
}
```

**4. Relocation helper function (inside `registerTaskCommentsRoutes`, after `enqueueResolveTask` ~line 451):**

Define `relocateCommentsIfNeeded(manager, wsId, taskPath, comments, rootPath)` as a local async function:

- Computes `absolutePath = path.join(rootPath, taskPath)`.
- Reads file content; returns `comments` unchanged on failure.
- Builds the `needsRelocationCheck` filter and `batchRelocateAnchors` map.
- Applies results and calls `manager.writeComments(...)` — but `writeComments` is private. Two options:
  - **(a)** Make `writeComments` package-internal (remove `private`, or add a dedicated `persistComments` public method).
  - **(b)** Add a public `updateCommentSelections(wsId, taskPath, updates: Map<string, {selection, anchorOriginalLine}>)` method that reads, patches, and writes internally.
  
  **Decision: option (a)** — simplest change. Remove the `private` modifier from `writeComments` (line 200) or add a thin public wrapper. The method is already used internally; exposing it within the package is safe since this is a server-only module.

**Key edge cases:**

- Comments without an `anchor` field (pre-commit-001 comments): skip relocation, return as-is.
- File not found on disk (deleted files): skip relocation, return as-is.
- `batchRelocateAnchors` returns `found: false` for a comment: leave its selection unchanged.
- All comments pass `needsRelocationCheck` as `false` (no drift): skip the write entirely.
- Concurrent GET requests: the atomic write pattern (temp + rename, line 211-214) already handles this.

## Tests

- **Unit: `relocateCommentsIfNeeded` relocates stale comments** — Create a comments JSON with an anchor, modify the source file so the selected text moves down 2 lines, call the GET endpoint, assert that `selection.startLine` is updated by +2 and the JSON file on disk is also updated.
- **Unit: skips relocation when no anchor** — Comment without `anchor` field → selection unchanged.
- **Unit: skips relocation when file missing** — `taskPath` points to nonexistent file → comments returned as-is, no error.
- **Unit: skips relocation when text hasn't drifted** — `needsRelocationCheck` returns false → no write to disk.
- **Unit: `found: false` result leaves selection unchanged** — Anchor text completely removed from file → original selection preserved.
- **Unit: persists relocated positions** — After relocation, a second GET should return the same relocated positions without re-running relocation (verify `needsRelocationCheck` returns false on second call).

## Acceptance Criteria

- [x] GET `/api/comments/:wsId/:taskPath` returns comments with relocated `selection` positions when file content has drifted
- [x] Comments without anchors are returned unchanged
- [x] Relocated positions are persisted to the JSON file (no repeated relocation on subsequent GETs)
- [x] File-not-found and read errors are handled gracefully (comments returned as-is)
- [x] No relocation write occurs when no comments have drifted
- [x] Single-comment GET endpoint (`/:id`) also returns the relocated position (inherits from updated storage)
- [x] Existing tests continue to pass
- [x] New tests cover all edge cases listed above

## Dependencies

- Depends on: 001

## Assumed Prior State

Anchors are created with correct source positions (from commit 001).
