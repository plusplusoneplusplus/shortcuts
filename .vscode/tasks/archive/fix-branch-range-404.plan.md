# Fix: CoC Git Panel "API error: 404 Not Found" in Branch Changes

## Problem

The CoC git panel shows **"API error: 404 Not Found"** in red text inside the "BRANCH CHANGES: MAIN" section, beneath the `+2452 -255 · 41 files` stats line.

The error is surfaced in `BranchChanges.tsx` via the `filesError` state:

```tsx
// BranchChanges.tsx
.catch(err => setFilesError(err.message || 'Failed to load files'))
// rendered as:
<div className="text-xs text-[#d32f2f]">{filesError}</div>
```

This error is triggered by the `GET /api/workspaces/{id}/git/branch-range/files` API call.

---

## Root Cause Analysis

There are two code paths in `coc-server/src/api-handler.ts` that can produce a 404 for this endpoint:

### Path A — Workspace not found (HTTP 404)
```typescript
const ws = workspaces.find(w => w.id === id);
if (!ws) {
    return handleAPIError(res, notFound('Workspace')); // → HTTP 404
}
```
The `id` is extracted via `decodeURIComponent(match![1])`. If the decoded workspace ID doesn't match any entry in the store, this fires.

### Path B — Route not matched by router (HTTP 404)
In `shared/router.ts`, the router pre-decodes the **entire pathname** before route matching:
```typescript
const pathname = decodeURIComponent(parsedUrl.pathname || '/');
// matched against:
pattern: /^\/api\/workspaces\/([^/]+)\/git\/branch-range\/files$/
```
If a workspace ID contains characters that encode to `%2F` (forward slash), such as a Unix-style absolute path like `/home/user/project`, decoding the pathname reintroduces literal `/` characters. The `([^/]+)` segment then fails to match, and the router falls through to its catch-all `send404()`.

### Why branch-range works but branch-range/files doesn't
The parent component (`RepoGitTab`) successfully calls `/git/branch-range` and receives `additions`, `deletions`, and file count which are **passed as props** to `BranchChanges`. Then `BranchChanges` makes its own separate call to `/git/branch-range/files`. These are independent HTTP requests; if the workspace ID or routing is unreliable, the second call can fail even after the first succeeds (e.g., race condition, workspace re-registration, or different encoding).

---

## Key Files

| File | Role |
|---|---|
| `packages/coc-server/src/api-handler.ts` | `/git/branch-range/files` handler (lines ~524–546) |
| `packages/coc-server/src/shared/router.ts` | Custom HTTP router — pathname decoding + route matching |
| `packages/coc-server/src/git-range-service.ts` | `detectCommitRange()` — git operations |
| `packages/coc/src/server/spa/client/react/repos/BranchChanges.tsx` | Frontend component that fetches and displays files |
| `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx` | Parent that fetches `/git/branch-range` and passes props |

---

## Proposed Fix

### Option 1 (Preferred): Eliminate the redundant API call
The `/git/branch-range` response already returns the `files` array (with paths, statuses). Pass this down as a prop instead of having `BranchChanges` make a second call to `/git/branch-range/files`.

- `RepoGitTab.tsx`: pass `branchRangeData.files` as a `files` prop to `BranchChanges`
- `BranchChanges.tsx`: remove the `fetchFiles` effect; use the `files` prop directly
- This eliminates the 404-prone second request entirely

### Option 2: Fix the router's pathname decoding
Change the router to match against the **raw (still-encoded) pathname** instead of the pre-decoded one. Extract and decode only the capture groups after matching:

```typescript
// router.ts — before matching, do NOT decode entire pathname
const pathname = parsedUrl.pathname || '/';  // keep encoded

// api-handler.ts — decode only after matching
const id = decodeURIComponent(match![1]);   // already done ✓
```

This prevents encoded slashes in workspace IDs from corrupting route matching.

### Option 3: Add error resilience in BranchChanges
If the call fails, fall back to the `rangeInfo.files` prop already available from the parent (covers the case where the API is temporarily unavailable):

```tsx
.catch(() => {
    setFiles(rangeInfo?.files ?? []);  // fallback to parent data
    // optionally: setFilesError(err.message)
});
```

---

## Implementation Plan

1. **Investigate first**: Add a `console.log` or server log at the workspace-not-found check in the `/git/branch-range/files` handler to confirm which 404 path fires (workspace missing vs route missing).

2. **Implement Option 1**: Refactor `BranchChanges` to accept a `files` prop from `RepoGitTab` rather than fetching `/git/branch-range/files` independently. The data is already available from the parent's `/git/branch-range` response.

3. **Implement Option 2 as defensive fix**: Fix the router to not pre-decode the pathname, preventing workspace IDs with forward slashes from breaking route matching.

4. **Keep `/git/branch-range/files` endpoint** for backwards compatibility (other clients may call it), but it is no longer needed by the SPA.

---

## Acceptance Criteria

- The "BRANCH CHANGES" section in the CoC git panel shows the file list without any red error text.
- If the git range service returns no data, the section shows an empty file list gracefully (no error text).
- The fix works for workspace IDs that are file paths (both Windows backslash and Unix forward-slash formats).
