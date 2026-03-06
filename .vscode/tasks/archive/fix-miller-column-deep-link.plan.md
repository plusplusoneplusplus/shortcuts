# Fix Miller Column Deep-Link on Windows (Backslash Path Bug)

## Problem

When directly opening a deep URL like `http://localhost:4000/#repos/ws-kss6a7/tasks/coc%5Cchat%5Csidebar-status/001-fix-sidebar-status.md`, the intermediate Miller column folders (e.g., `chat`, `sidebar-status`) disappear. Only the root column and the file preview are shown.

**Root cause:** On Windows, `folder.relativePath` uses backslash separators (e.g., `coc\chat\sidebar-status`). Three locations in `TaskTree.tsx` use `split('/')` which doesn't split on `\`, causing the entire path to be treated as a single segment. The correct pattern `split(/[\\/]/)` already exists in `useTaskTree.ts:50` (`getPathSegments`) but is not used in these locations.

## Failure Chain

| Stage | File | Line | Issue |
|-------|------|------|-------|
| URL written | `TaskTree.tsx` | 129 | `folderPath.split('/')` doesn't split `\` → whole path becomes one URL segment with `%5C` |
| URL written | `TaskTree.tsx` | 148 | Same for file click |
| Columns built | `TaskTree.tsx` | 90-91 | `folderPath.split('/')` on init → single segment matches no folder → only root column renders |
| Parent folder | `TaskTree.tsx` | 144 | `path.includes('/')` / `split('/')` won't find backslash parent |

## Approach

Fix all `split('/')` calls in `TaskTree.tsx` that operate on paths which may contain backslashes, using the same `split(/[\\/]/)` pattern from `useTaskTree.ts:50`.

Single-file change, ~4 lines modified.

## Todos

### 1. Fix init useEffect segment splitting (line 90-91)
- **File**: `packages/coc/src/server/spa/client/react/tasks/TaskTree.tsx`
- Line 90: `initialFilePath.split('/').slice(0, -1).join('/')` → `initialFilePath.split(/[\\/]/).slice(0, -1).join('/')`
- Line 91: `folderPath.split('/').filter(Boolean)` → `folderPath.split(/[\\/]/).filter(Boolean)`
- This ensures the column initialization loop correctly splits `coc\chat\sidebar-status` into `['coc', 'chat', 'sidebar-status']`

### 2. Fix handleFolderClick URL encoding (line 129)
- **File**: Same
- `folderPath.split('/').map(encodeURIComponent).join('/')` → `folderPath.split(/[\\/]/).map(encodeURIComponent).join('/')`
- Ensures URLs are written with `/` separators regardless of OS

### 3. Fix handleFileClick URL encoding and parent detection (lines 144, 148)
- **File**: Same
- Line 144: `path.includes('/') ? path.split('/').slice(0, -1).join('/')` → `path.match(/[\\/]/) ? path.split(/[\\/]/).slice(0, -1).join('/')`
- Line 148: `path.split('/').map(encodeURIComponent).join('/')` → `path.split(/[\\/]/).map(encodeURIComponent).join('/')`

### 4. Test
- Build: `npm run build`
- Run tests: `cd packages/coc && npm run test:run`
