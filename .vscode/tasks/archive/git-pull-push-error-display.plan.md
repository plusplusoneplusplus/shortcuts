# Plan: Display Git Pull/Push Errors in the SPA

## Problem

When `git pull` or `git push` fails, the server returns HTTP 200 with `{ success: false, error: "..." }`. The frontend's `fetchApi` utility only throws on non-2xx HTTP status codes — so the error payload is silently swallowed. The `catch` block in `handlePull`/`handlePush` never fires, `setActionError` is never called, and the user sees no feedback.

Screenshot evidence: a `pull` request returns `{ success: false, error: "Command failed: git pull --rebase\nerror: cannot pull with rebase: You have unstaged changes.\nerror: Please commit or sta..." }` with HTTP 200 — which the current code treats as success.

## Current Flow

```
handlePull → fetchApi (POST /git/pull) → res.ok=true → returns { success: false, error: "..." }
                                                         ↑ no throw → catch never fires → error silently ignored
```

## Proposed Fix

Update `handlePull`, `handlePush`, and `handleFetch` in `RepoGitTab.tsx` to inspect the returned `{ success, error }` shape and surface the `error` string via `setActionError`.

**No server changes needed** — the server already returns the right data.

## Scope

- **In:** Surfacing pull/push/fetch errors in the existing inline `actionError` bar.
- **Out:** Changing the server response format, changing HTTP status codes, adding new UI components (the existing red inline error bar is sufficient).

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx` | After `await fetchApi(...)` in `handlePull`, `handlePush`, and `handleFetch`, check `result.success === false` and throw (or call `setActionError`) with `result.error`. |

## Implementation Tasks

### 1. Fix `handleFetch`
```diff
- await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/fetch`, { method: 'POST' });
- refreshAll();
+ const result = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/fetch`, { method: 'POST' });
+ if (result.success === false) throw new Error(result.error || 'Fetch failed');
+ refreshAll();
```

### 2. Fix `handlePull`
```diff
- await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/pull`, {
-     method: 'POST',
-     headers: { 'Content-Type': 'application/json' },
-     body: JSON.stringify({ rebase: true }),
- });
- refreshAll();
+ const result = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/pull`, {
+     method: 'POST',
+     headers: { 'Content-Type': 'application/json' },
+     body: JSON.stringify({ rebase: true }),
+ });
+ if (result.success === false) throw new Error(result.error || 'Pull failed');
+ refreshAll();
```

### 3. Fix `handlePush`
```diff
- await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/push`, { method: 'POST' });
- refreshAll();
+ const result = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/push`, { method: 'POST' });
+ if (result.success === false) throw new Error(result.error || 'Push failed');
+ refreshAll();
```

After throwing, the existing `catch (err: any)` block already calls `setActionError(err.message || '...')`, so the error will appear in the inline red bar below the git panel header.

## Error UX

The existing `actionError` inline bar (already present in the component) will display the full git error message, e.g.:

> Command failed: git pull --rebase  
> error: cannot pull with rebase: You have unstaged changes.  
> error: Please commit or stash them.

No new UI components are needed.

## Test Coverage

Update or add tests in the RepoGitTab test file to assert that when `fetchApi` resolves with `{ success: false, error: "some error" }`, the error message is rendered in the `[data-testid="git-action-error"]` element.
