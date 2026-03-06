# Fix: Git Push Returns "API error: 400 Bad Request" in CoC Git Tab

## Problem

When the user clicks the **Push** button in the CoC dashboard Git tab, a `400 Bad Request` error is displayed:

```
API error: 400 Bad Request
```

## Root Cause

The client sends a `POST` request with **no body**:

```typescript
// packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx
const result = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/push`, {
    method: 'POST',
    // ← no body, no Content-Type header
});
```

The server handler blindly calls `parseBody(req)` and wraps any failure in `invalidJSON()` (HTTP 400):

```typescript
// packages/coc-server/src/api-handler.ts — git/push route
let body: any = {};
try {
    body = await parseBody(req);
} catch {
    return handleAPIError(res, invalidJSON());  // ← fires when body is empty
}
```

`parseBody` rejects on an empty request body, which triggers the 400 response.

## Proposed Fix

Two complementary changes, both small:

### 1. Server-side (primary fix) — `packages/coc-server/src/api-handler.ts`

Make the push route resilient to a missing/empty body. Replace the hard `catch → 400` with a soft fallback to an empty object:

```typescript
// Before
let body: any = {};
try {
    body = await parseBody(req);
} catch {
    return handleAPIError(res, invalidJSON());
}

// After
let body: any = {};
try {
    body = await parseBody(req);
} catch {
    body = {};   // empty body is acceptable; setUpstream defaults to false
}
```

### 2. Client-side (defensive) — `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx`

Send an explicit JSON body so the server never sees an empty body:

```typescript
// Before
const result = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/push`, {
    method: 'POST',
});

// After
const result = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
});
```

## Files to Change

| File | Change |
|------|--------|
| `packages/coc-server/src/api-handler.ts` | Gracefully handle empty body in the `git/push` route handler |
| `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx` | Add `Content-Type` header and empty JSON body to push call |

## Testing

1. Build: `npm run build`
2. Start the CoC server: `coc serve`
3. Open the dashboard → Git tab → click **Push**
4. Verify no "400 Bad Request" error appears
5. Verify the push succeeds (or shows a meaningful git error if remote rejects it)
6. Run existing tests: `npm run test:run` in `packages/coc-server` and `packages/coc`

## Notes

- The `setUpstream` feature (push with `-u origin <branch>`) is not yet exposed in the UI; the fix preserves that path for future use.
- Other git action routes (fetch, pull) should be audited for the same empty-body pattern to prevent recurrence.
