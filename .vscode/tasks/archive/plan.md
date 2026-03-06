# Fix Windows Path Detection in SPA File Path Links

## Problem

File paths shown in the CoC SPA dashboard (process detail, task preview) are not
clickable or hoverable on Windows. The markdown renderer's file-path detection
regex only matches Unix-style absolute paths (`/Users/...`, `/home/...`, etc.)
and completely ignores Windows-style paths (`D:\...`, `C:/...`).

## Root Cause (3 locations)

| # | File | Issue |
|---|------|-------|
| 1 | `packages/pipeline-core/src/editor/rendering/markdown-renderer.ts:249` | `FILE_PATH_RE` only matches Unix paths — no `[A-Z]:\` or `[A-Z]:/` support |
| 2 | `packages/pipeline-core/src/editor/rendering/markdown-renderer.ts:308` | `shortenFilePath()` only strips Unix prefixes (`/Users/`, `/home/`) — no Windows equivalent |
| 3 | `packages/coc/src/server/spa/client/react/file-path-preview.ts:128` | `resolveWorkspaceId()` uses literal `startsWith()` — fails with mixed separators |

The click handler in `App.tsx` already normalizes paths, so it should work once
paths are actually detected and wrapped.

## Plan

### TODO 1: Add Windows path regex to `FILE_PATH_RE`
**File:** `packages/pipeline-core/src/editor/rendering/markdown-renderer.ts`

Extend the regex to also match Windows absolute paths:
- `[A-Z]:\path\to\file` (backslash-separated)
- `[A-Z]:/path/to/file` (forward-slash with drive letter)
- Mixed separators: `D:\projects\shortcuts/.vscode/tasks/file.md`

Proposed regex addition (as an alternative branch in the same regex):
```
[A-Za-z]:[/\\][\w./@\\-]+
```

Combined with the existing Unix pattern using alternation `|`.

Store the **normalized** (forward-slash) version in `data-full-path` so
downstream consumers don't need to worry about backslashes.

### TODO 2: Add Windows path shortening to `shortenFilePath()`
**File:** `packages/pipeline-core/src/editor/rendering/markdown-renderer.ts`

Add rules to shorten Windows paths for display:
- `C:\Users\<user>\...` → `~\...` (or `~/...` after normalization)
- Strip common workspace prefixes when possible
- Normalize to forward slashes in the display path for consistency

### TODO 3: Normalize paths in `resolveWorkspaceId()`
**File:** `packages/coc/src/server/spa/client/react/file-path-preview.ts`

Before the `startsWith` comparison, normalize both `filePath` and `root` to use
forward slashes and consistent casing (Windows paths are case-insensitive).

```typescript
const normalize = (p: string) => p.replace(/\\/g, '/').toLowerCase();
```

### TODO 4: Add Windows path tests to file-path-detection tests
**File:** `packages/pipeline-core/test/editor/rendering/markdown-renderer.test.ts`

Add test cases for:
- `D:\projects\file.ts` — backslash Windows path
- `D:/projects/file.ts` — forward-slash Windows path
- `D:\projects\shortcuts/.vscode/tasks/plan.md` — mixed separators
- `C:\Users\John\Documents\file.md` — path shortening
- Multiple Windows paths in one line
- Windows paths inside backtick code spans (should NOT be linked)

### TODO 5: Add Windows path tests to SPA file-path-detection tests
**File:** `packages/coc/test/server/spa/client/file-path-detection.test.ts`

Mirror the pipeline-core tests at the SPA integration level.

## Risks / Notes

- The regex must not false-positive on things like `C:` alone or URL-like
  patterns (`http://...`).
- Backslashes in HTML attributes need proper escaping — storing normalized
  forward-slash paths in `data-full-path` avoids this issue.
- The server-side preview endpoint already uses Node.js `path.resolve()` which
  handles Windows paths correctly.
- The click handler in `App.tsx` already normalizes backslashes to forward
  slashes, so no changes needed there.
