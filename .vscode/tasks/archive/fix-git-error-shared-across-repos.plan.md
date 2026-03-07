# Fix: Git Action Error Message Shared Across Repos

## Problem

In the CoC server dashboard, when a git action (pull/push/fetch) fails in one repo, the error message persists in the Git tab and incorrectly appears when the user navigates to a different repo. This is because the `actionError` and `refreshError` React state in `RepoGitTab` is never cleared when the `workspaceId` prop changes.

## Root Cause

**File:** `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx`

The `useEffect` that runs when `workspaceId` changes resets `error` and `loading`, but does **not** reset `actionError` or `refreshError`:

```ts
useEffect(() => {
    setLoading(true);
    setError(null);         // ✅ reset
    // setActionError(null) ← MISSING
    // setRefreshError(null) ← MISSING
    ...
}, [workspaceId, ...]);
```

**File:** `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx` (line ~278)

`RepoGitTab` is rendered without a `key` prop, so React re-renders (not re-mounts) it on repo switch, leaving stale state intact:

```tsx
{activeSubTab === 'git' && <RepoGitTab workspaceId={ws.id} />}
// ↑ missing key={ws.id}
```

## Proposed Fix

**Option A (preferred) — Add `key` prop in `RepoDetail.tsx`:**

```tsx
{activeSubTab === 'git' && <RepoGitTab key={ws.id} workspaceId={ws.id} />}
```

Forces full remount of `RepoGitTab` on every repo switch, so all local state (including `actionError` and `refreshError`) is reset automatically. No changes needed in `RepoGitTab.tsx`.

**Option B (alternative) — Clear errors in the `useEffect` in `RepoGitTab.tsx`:**

```ts
useEffect(() => {
    setLoading(true);
    setError(null);
    setActionError(null);   // add
    setRefreshError(null);  // add
    ...
}, [workspaceId, ...]);
```

Option A is simpler and more robust (covers any future state variables), so it is preferred.

## Tasks

1. Add `key={ws.id}` to `<RepoGitTab>` in `RepoDetail.tsx`
2. Verify the fix by switching between repos after a failed pull — the error should not carry over
3. Add or update a test to assert that `RepoGitTab` resets error state on workspace change

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx` | Add `key={ws.id}` to `<RepoGitTab>` render |

## Notes

- No server-side changes needed — error state is purely client-side React state.
- The `error` state (initial load) is already reset correctly; only `actionError` and `refreshError` are affected.
- `packages/coc-server` also has a copy of this SPA code — check if changes need to be mirrored there.
