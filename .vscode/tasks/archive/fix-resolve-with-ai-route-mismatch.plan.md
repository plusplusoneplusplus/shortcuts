# Fix: `resolve-with-ai` endpoint returns "Missing required field: filePath"

## Problem

**URL:** `POST /api/comments/{wsId}/{taskPath}/resolve-with-ai`
**Error:** `{"error":"Missing required field: filePath"}`

The SPA frontend (`useTaskComments.ts:251`) calls a `/resolve-with-ai` endpoint that **does not exist** on the backend. The backend only registers a `/batch-resolve` route for the same functionality.

### Root Cause: Route Mismatch

| Layer | Endpoint suffix | File | Line |
|-------|----------------|------|------|
| **Frontend** | `/resolve-with-ai` | `packages/coc/src/server/spa/client/react/hooks/useTaskComments.ts` | 251 |
| **Backend** | `/batch-resolve` | `packages/coc/src/server/task-comments-handler.ts` | 419 |

Because the router matches routes in registration order, and `/resolve-with-ai` doesn't match any specific pattern (no UUID for `askAiPattern`, no `/batch-resolve` suffix for `batchResolvePattern`), it falls through to the **greedy `collectionPattern`** (`/api/comments/:wsId/(.+)`) which interprets the full suffix as `taskPath = "...plan.md/resolve-with-ai"` and dispatches to the "create comment" POST handler — which requires `filePath`, `selection`, `selectedText`, and `comment` in the body.

### Route Registration Order (POST routes)

1. `replyPattern` → `/:uuid/replies` — ✗ no UUID
2. `askAiPattern` → `/:uuid/ask-ai` — ✗ no UUID
3. `batchResolvePattern` → `/batch-resolve` — ✗ suffix is `resolve-with-ai`
4. **`collectionPattern`** → `/(.+)` — ✓ **greedy match captures everything** → triggers "create comment" → error

## Recommended Fix

**Option B (Preferred): Change the frontend URL to `/batch-resolve`**

Update the frontend to call the existing backend endpoint. This is simpler — no backend changes needed, just align the frontend to the actual API.

**Files to change:**
- `packages/coc/src/server/spa/client/react/hooks/useTaskComments.ts` (line 251) — change `/resolve-with-ai` → `/batch-resolve`
- `packages/coc/test/spa/react/comments/useTaskComments.test.tsx` (~5 occurrences) — update mock URL checks

**Option A (Alternative): Add `/resolve-with-ai` as an alias route on the backend**

Add a second regex pattern that matches `/resolve-with-ai` and reuses the same handler as `/batch-resolve`. This avoids frontend changes but adds unnecessary route duplication.

## Implementation Details (Option B)

### 1. Update frontend hook in `useTaskComments.ts`

In `packages/coc/src/server/spa/client/react/hooks/useTaskComments.ts` (line 251), change the URL suffix from `/resolve-with-ai` to `/batch-resolve`:

```typescript
// Before
const response = await fetch(`/api/comments/${wsId}/${taskPath}/resolve-with-ai`, { ... });
// After
const response = await fetch(`/api/comments/${wsId}/${taskPath}/batch-resolve`, { ... });
```

### 2. Update tests in `useTaskComments.test.tsx`

In `packages/coc/test/spa/react/comments/useTaskComments.test.tsx`, update all occurrences of `/resolve-with-ai` to `/batch-resolve` (~5 places).

### 3. Build & verify

Run `npm run build` and relevant tests to confirm the fix.

## Todos

1. **Update frontend URL** in `useTaskComments.ts` — change `/resolve-with-ai` → `/batch-resolve`
2. **Update test assertions** in `useTaskComments.test.tsx` — change all `/resolve-with-ai` → `/batch-resolve`
3. **Build & verify** — `npm run build` + run relevant tests
