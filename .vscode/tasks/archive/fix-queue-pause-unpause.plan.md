# Fix: Queue Pause/Unpause Not Working

## Problem

The pause (⏸) and resume (▶) buttons on the **Queue** tab in the CoC server SPA dashboard do nothing when clicked. The queue continues processing as if the button was never pressed.

## Root Cause

`fetchApi` in `useApi.ts` only accepts a single `path` argument and ignores any additional options:

```ts
// useApi.ts — current signature
export async function fetchApi(path: string): Promise<any> {
    const res = await fetch(getApiBase() + path);  // ← no options forwarded
    ...
}
```

In `RepoQueueTab.tsx`, the pause/resume handler calls `fetchApi` with a second `{ method: 'POST' }` argument that is **silently discarded** by JavaScript (extra args are ignored):

```ts
await fetchApi(endpoint + '?repoId=...', { method: 'POST' });
//                                        ^^^^^^^^^^^^^^^^^^^ dropped!
```

The result is a **GET** request to `/api/queue/pause` (or `/api/queue/resume`), but the backend only registers these as **POST** routes — so the request gets a 404/405 and the queue state never changes.

Other queue actions (`handleCancel`, `handleMoveUp`, `handleMoveToTop`) work correctly because they use raw `fetch()` directly with explicit `{ method: 'POST' }`.

## Affected Files

| File | Role |
|------|------|
| `packages/coc/src/server/spa/client/react/hooks/useApi.ts` | `fetchApi` helper — missing options parameter |
| `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx` | Calls `fetchApi` expecting POST support |

## Fix

### Option A (Recommended): Extend `fetchApi` to accept `RequestInit` options

Update the signature so it forwards options to `fetch()`:

```ts
export async function fetchApi(path: string, options?: RequestInit): Promise<any> {
    const res = await fetch(getApiBase() + path, options);
    if (!res.ok) {
        throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
}
```

This is the minimal fix — one line changed, one parameter added. No callers break because the new parameter is optional.

### Option B (Alternative): Use raw `fetch` in the handler

Replace `fetchApi` with direct `fetch` in `handlePauseResume`, matching the pattern used by `handleCancel`/`handleMoveUp`/`handleMoveToTop`. This avoids changing the shared helper but is less consistent going forward.

## Todos

1. **fix-fetchApi** — ✅ Add optional `options?: RequestInit` parameter to `fetchApi` in `useApi.ts` and forward it to `fetch()`
2. **verify-callers** — ✅ Audit all `fetchApi` call sites to confirm none are broken by the change (all existing callers pass only `path`, so they're safe)
3. **add-test** — ✅ Add/update test for `handlePauseResume` in `RepoQueueTab` to verify it sends a POST request
4. **manual-verify** — ✅ Build and manually verify pause/unpause works in the dashboard

## Notes

- The backend handlers (`queue-handler.ts` lines 753–806) are correct — they properly handle `POST /api/queue/pause?repoId=...` and `POST /api/queue/resume?repoId=...`.
- The `RepoSchedulesTab.tsx` has a similar `handlePauseResume` but it correctly uses raw `fetch()` with `{ method: 'PATCH' }`, so it's not affected.
