# Fix Copy Path Mixed Separators on Windows

## Problem

In the CoC SPA Tasks panel, right-clicking a file and choosing **Copy Path** produces paths with mixed separators on Windows:

```
coc\pipeline/pipeline-dag-visualization.spec.md
```

Expected on Windows: `coc\pipeline\pipeline-dag-visualization.spec.md`

## Root Cause

Two layers construct the path with different separator conventions:

1. **Server** (`pipeline-core/src/tasks/task-scanner.ts`): `relativePath` is built via `path.join()`, which uses `\` on Windows (e.g., `coc\pipeline`).
2. **Client** (`coc/src/server/spa/client/react/tasks/TasksPanel.tsx`, `buildFileCtxInfo`): Concatenates `relativePath` and `fileName` with a hardcoded `/`:
   ```ts
   const p = rel ? `${rel}/${item.fileName}` : item.fileName;
   ```

This produces `coc\pipeline/file.spec.md` — mixed separators.

## Approach

Normalize `relativePath` to use forward slashes (`/`) in the server API response layer. This is the cleanest fix because:

- The SPA is a web client — forward slashes are the web standard for paths.
- The server already hardcodes `/` in places (e.g., `archive/` prefix check in `tasks-handler.ts` line 307).
- `buildFileCtxInfo` already uses `/` to join.
- No platform-detection logic needed in the browser.

## Todos

### 1. Normalize `relativePath` in tasks-handler API response

**File:** `packages/coc/src/server/tasks-handler.ts`

In the GET `/tasks/:wsId/tree` handler (and any other endpoint returning `TaskDocument`/`TaskFolder` objects), normalize all `relativePath` values by replacing `\` with `/` before sending JSON.

Alternatively, normalize at the scanner level in `pipeline-core/src/tasks/task-scanner.ts` where `path.join()` is used to build `relativePath` (lines 55, 99, 151). Replace `path.join` with a POSIX-normalized join or `.replace(/\\/g, '/')` after joining.

**Preferred location:** `task-scanner.ts` — normalize at the source so all consumers (VS Code extension, CoC SPA) get consistent POSIX paths.

### 2. Normalize `folderPath` in folder Copy Path

**File:** `packages/coc/src/server/spa/client/react/tasks/TasksPanel.tsx` (line ~487)

`folder.relativePath` is also used directly for folder Copy Path. If we normalize at the scanner level, this is already fixed. Otherwise, normalize here too.

### 3. Fix Copy Absolute Path join

**File:** `packages/coc/src/server/spa/client/react/tasks/TasksPanel.tsx` (line ~373)

```ts
const abs = [rootPath, tasksFolder, ctxItem.renamePath].filter(Boolean).join('/');
```

`rootPath` on Windows is like `D:\projects\shortcuts`, so joining with `/` also creates mixed paths. This should also be normalized — either all forward slashes or use the OS separator. Since `rootPath` comes from the server, normalizing it to `/` would be simplest.

### 4. Update `buildFolderTree` path splitting

**File:** `packages/pipeline-core/src/tasks/task-scanner.ts` (line ~302)

```ts
const pathParts = doc.relativePath.split(path.sep);
```

If `relativePath` is normalized to `/`, this split must also use `/` instead of `path.sep`.

### 5. Add/update tests

- **`packages/pipeline-core/test/tasks/task-scanner.test.ts`**: Verify `relativePath` always uses `/` on all platforms.
- **`packages/coc/test/spa/react/FileContextMenu.test.tsx`**: Verify Copy Path produces consistent separators.
