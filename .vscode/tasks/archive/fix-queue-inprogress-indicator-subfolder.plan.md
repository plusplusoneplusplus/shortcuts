---
status: in-progress
---

# Fix: Queue "in progress" indicator missing for tasks in subfolders

## Problem

In the CoC dashboard's Tasks tab, tasks inside **subfolders** (e.g., `render-view-tool-images` inside `chat-image-attach/`) do not show the "in progress" indicator badge, even though they are active in the queue. Root-level tasks (e.g., `fix-miller-c...`, `generate-t...`) display correctly.

The parent folder `coc` correctly shows "4 in progress", confirming the data is known — the rendering lookup just fails for nested items.

## Root Cause

**Path separator mismatch between server (Windows backslash) and client (forward-slash normalized keys).**

### Data flow:

1. **Server** (`task-scanner.ts`): Builds `relativePath` using Node's `path.join()` (lines 55, 99, 151 in `scanTasksRecursively`, `scanDocumentsRecursively`, `scanFoldersRecursively`), which produces **backslashes on Windows** (e.g., `coc\\chat-image-attach`). This is a **systemic issue** — a deep audit (see appendix) found the same unormalized `path.join()`/`path.resolve()`/`path.relative()` pattern across 15+ API response fields in `tasks-handler.ts`, `queue-handler.ts`, and `api-handler.ts`. The central `sendJSON()` in `api-handler.ts` does plain `JSON.stringify()` with no path normalization hook.

2. **Client hook** (`useQueueActivity.ts`): Builds `fileMap` keys using `normalizePath()` which converts all `\` → `/` (e.g., `coc/chat-image-attach/render-view-tool-images.md`).

3. **Client tree** (`TaskTree.tsx` `getNodePath`, `TaskTreeItem.tsx` `getItemPath`): Concatenates the raw `relativePath` (with backslashes from server) + `'/'` + `fileName`. Result: `coc\\chat-image-attach/render-view-tool-images.md` — **mixed separators**.

4. **Lookup fails**: `queueActivity['coc\\chat-image-attach/render-view-tool-images.md']` → `undefined` → `0` → no badge. The actual key is `'coc/chat-image-attach/render-view-tool-images.md'`.

Root-level files work because there's no `relativePath` involved — just `fileName`, no separator needed.

Folder-level badges work because `folderMap` keys are built by splitting the already-normalized `fileMap` keys on `/`.

## Fix

Normalize `relativePath` in the path-building functions on the client side. Two files need changes:

### 1. `packages/coc-server/src/spa/components/tasks/TaskTree.tsx` — `getNodePath` (lines 27-40)

Normalize backslashes in `relativePath` before concatenation:

```diff
 function getNodePath(node: TaskNode): string | null {
     if ('fileName' in node && !('documents' in node) && !('children' in node)) {
-        const rel = (node as any).relativePath || '';
+        const rel = ((node as any).relativePath || '').replace(/\\/g, '/');
         return rel ? rel + '/' + node.fileName : node.fileName;
     }
     if ('documents' in node && 'baseName' in node && !('children' in node)) {
         const firstDoc = (node as any).documents[0];
         if (firstDoc) {
-            const rel = firstDoc.relativePath || '';
+            const rel = (firstDoc.relativePath || '').replace(/\\/g, '/');
             return rel ? rel + '/' + firstDoc.fileName : firstDoc.fileName;
         }
     }
     return null;
 }
```

### 2. `packages/coc-server/src/spa/components/tasks/TaskTreeItem.tsx` — `getItemPath` (lines 43-56)

Same normalization:

```diff
 function getItemPath(item: TaskNode): string | null {
     if (isTaskDocument(item)) {
-        const rel = item.relativePath || '';
+        const rel = (item.relativePath || '').replace(/\\/g, '/');
         return rel ? rel + '/' + item.fileName : item.fileName;
     }
     if (isTaskDocumentGroup(item)) {
         const firstDoc = item.documents[0];
         if (firstDoc) {
-            const rel = firstDoc.relativePath || '';
+            const rel = (firstDoc.relativePath || '').replace(/\\/g, '/');
             return rel ? rel + '/' + firstDoc.fileName : firstDoc.fileName;
         }
     }
     return null;
 }
```

### 3. Also check `getFolderKey` in `TaskTree.tsx`

The `getFolderKey` function likely reads `folder.relativePath` for subfolder queue badge lookups (`queueFolderActivity`). If it doesn't normalize, subfolder-level badges (e.g., on `chat-image-attach` itself) will also be broken. Verify and normalize there too if needed.

## Alternative (server-side fix)

Instead of client-side normalization, normalize `relativePath` in `task-scanner.ts` before sending to the client:

```diff
- relativePath: relativePath || undefined,
+ relativePath: relativePath?.replace(/\\/g, '/') || undefined,
```

This would fix it for all consumers at once. However, the client-side fix is safer since the client already normalizes in `useQueueActivity` — making it consistent.

## Testing

- Add a Vitest test verifying `getNodePath` and `getItemPath` normalize backslashes.
- Test with a task document that has `relativePath: 'coc\\chat-image-attach'` and verify the returned path uses forward slashes.
- Verify the CoC dashboard shows "in progress" badges on tasks inside subfolders.

## Files to Change

| File | Change |
|------|--------|
| `packages/coc-server/src/spa/components/tasks/TaskTree.tsx` | Normalize `relativePath` in `getNodePath` |
| `packages/coc-server/src/spa/components/tasks/TaskTreeItem.tsx` | Normalize `relativePath` in `getItemPath` |
| `packages/coc-server/test/spa/components/tasks/TaskTree.test.tsx` | Add test for backslash normalization |
| `packages/coc-server/test/spa/components/tasks/TaskTreeItem.test.tsx` | Add test for backslash normalization |

---

## Appendix: Broader Path Separator Audit (go-deep)

A deep research audit across `packages/coc/` and `packages/coc-server/` revealed that the queue indicator bug is one symptom of a **systemic path separator problem** affecting multiple subsystems. The findings are organized by severity.

### A. Scope of the Problem

The CoC project has **three independent, divergent `normalizePath` implementations** — all private, non-exported, with different semantics:

| File | Behavior |
|------|----------|
| `App.tsx:43` | `replace(/\\/g, '/')` — slashes only |
| `file-path-preview.ts:140` | `replace(/\\/g, '/').toLowerCase()` — slashes + lowercase |
| `useQueueActivity.ts:13` | `replace(/\\/g, '/').replace(/\/+$/, '')` — slashes + strip trailing |

The gold-standard implementation (`normalizeRepoPath` in `coc-server/src/repo-utils.ts`) handles realpath, symlinks, 8.3 short names, sep→slash, lowercase on Windows, and trailing slashes — but is only used for internal `repoId` computation and is inaccessible to SPA client code.

### B. High-Severity Issues Found

#### B1. `tasks-handler.ts` — 15+ API response fields leak OS-native paths

- `path.resolve()` results returned in file/directory preview responses (lines 115, 170)
- `path.relative()` results returned in create/rename/move/archive responses (lines 422, 459, 622, 659, 674, 852, 933) — all produce backslashes on Windows
- No normalization at any `sendJSON()` callsite

#### B2. `task-scanner.ts` — `relativePath` built with `path.join()` (lines 55, 99, 151)

All three scan functions (`scanTasksRecursively`, `scanDocumentsRecursively`, `scanFoldersRecursively`) use:
```ts
const subRelativePath = relativePath ? path.join(relativePath, item) : item;
```
This produces backslashes on Windows in every `TaskDocument.relativePath`, `Task.relativePath`, and `TaskFolder.relativePath` field, all serialized raw to clients.

#### B3. `task-manager.ts` `getFeatureFolders` — internal inconsistency (lines 359-360)

```ts
const itemRelativePath = relativePath ? path.join(relativePath, item) : item;  // backslash on Win
const displayName      = relativePath ? `${relativePath}/${item}` : item;       // always forward slash
```
Same object gets backslash `relativePath` but forward-slash `displayName`.

#### B4. `queue-handler.ts:57` — broken basename extraction

```ts
const basename = filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
```
On pure-backslash Windows paths, `split('/').pop()` returns the full path (truthy), so the `\\` fallback is dead code. Mixed-separator paths like `C:\\foo/bar\\baz` produce wrong basenames. Should use `path.basename()` (as the `pipelinePath` handler 2 lines below already does).

#### B5. Client-side raw `.split('/')` on server paths (4 locations)

| File | Line | What breaks |
|------|------|-------------|
| `detail.ts` | 1645 | `taskPath.split('/').pop()` — wrong basename on Windows |
| `file-path-preview.ts` | 234 | `path.split('/').pop()` — wrong basename on Windows |
| `TaskActions.tsx` | 33 | `p.split('/')` — wrong parts on Windows |
| `TaskTree.tsx` | 172 | `p.includes('/')` check misses backslash paths — whole path used as name |

#### B6. Additional client components with raw `relativePath` concatenation

| File | Pattern |
|------|---------|
| `TasksPanel.tsx` (2×) | `` `${rel}/${item.fileName}` `` — no normalization |
| `BulkFollowPromptDialog.tsx` | `doc.relativePath + '/' + doc.fileName` — no normalization |

### C. Medium-Severity Issues

#### C1. WebSocket subscription matching — exact string `Set.has()` (websocket.ts:284,331)

`subscribedFiles` is a `Set<string>` with no normalization. If client subscribes with `docs/readme.md` (forward slash) but server broadcasts with `docs\readme.md` (Windows backslash), `Set.has()` returns false and the event is silently dropped. Currently mitigated by the fact that `broadcastFileEvent` is not called in production (dead code path).

#### C2. `hashFilePath()` in `task-comments-handler.ts:167` — separator-sensitive hashing

`SHA-256("docs/readme.md") ≠ SHA-256("docs\\readme.md")`, so mixed separators create two different storage buckets for the same physical file.

#### C3. Queue persistence cross-platform portability

- `queue-persistence.ts` stores `repoRootPath`, `workingDirectory`, `promptFilePath`, `pipelinePath` with OS-native separators
- `computeRepoId()` hashes `path.resolve()` output — different hash on Windows vs Linux for the same logical path
- `schedule-persistence.ts` stores `schedule.target` (prompt file path) raw — breaks if loaded on a different OS

#### C4. `api-handler.ts` `browseDirectory()` and `discoverPipelines()` — absolute OS paths in responses

`path.resolve()` and `path.join()` results sent to clients without normalization (lines 821-823, 879).

### D. Recommended Fix Strategy

**Phase 1 (this PR):** Fix the immediate queue indicator bug via client-side normalization in `getNodePath`, `getItemPath`, and `getFolderKey`.

**Phase 2 (follow-up):** Server-side normalization at the source:
1. Normalize `relativePath` in `task-scanner.ts` (3 lines) — fixes all downstream consumers at once
2. Create a shared `toForwardSlash(p: string)` utility in `coc-server/src/path-utils.ts`
3. Apply it in `tasks-handler.ts` response fields that use `path.relative()` / `path.resolve()`

**Phase 3 (hardening):** Address broader path hygiene:
1. Extract a single shared `normalizePath` for SPA client code (replacing the 3 private copies)
2. Fix `queue-handler.ts:57` basename extraction to use `path.basename()`
3. Fix raw `.split('/')` calls in `detail.ts`, `file-path-preview.ts`, `TaskActions.tsx`, `TaskTree.tsx`
4. Add `normalizePath` to WebSocket `subscribe-file` handler and `hashFilePath()`
5. Normalize paths in queue/schedule persistence before writing to JSON
