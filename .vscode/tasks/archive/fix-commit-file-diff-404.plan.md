# Fix: Clicking a file in CoC git commit returns 404

## Problem

When a user clicks on a file in a git commit in the CoC Git tab, `CommitDetail` requests:

```
GET /api/workspaces/:id/git/commits/:hash/files/:filePath/diff
```

This endpoint **does not exist** on the server, producing a `404 Not Found` error displayed in the UI as "API error: 404 Not Found".

### Root cause

`CommitDetail.tsx` (line 26) builds the URL with `encodeURIComponent(filePath)` for the per-file diff case, but `api-handler.ts` only has:

| Endpoint | Purpose |
|---|---|
| `GET /api/…/git/commits/:hash/files` | List files changed in commit |
| `GET /api/…/git/commits/:hash/diff` | Full commit diff |
| `GET /api/…/git/branch-range/files/*/diff` | Per-file diff for branch range |

The per-file diff endpoint for a **specific commit** is missing.

## Proposed fix

Add one new route to `packages/coc-server/src/api-handler.ts`, placed **between** the full commit diff route (line ~464) and the branch-range routes:

```typescript
// GET /api/workspaces/:id/git/commits/:hash/files/*/diff — Per-file diff for a commit
routes.push({
    method: 'GET',
    pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits\/([a-f0-9]{4,40})\/files\/(.+)\/diff$/,
    handler: async (_req, res, match) => {
        const id = decodeURIComponent(match![1]);
        const hash = match![2];
        const filePath = decodeURIComponent(match![3]);
        const workspaces = await store.getWorkspaces();
        const ws = workspaces.find(w => w.id === id);
        if (!ws) {
            return handleAPIError(res, notFound('Workspace'));
        }

        const cacheKey = `${id}:commit-file-diff:${hash}:${filePath}`;
        const cached = gitCache.get<{ diff: string }>(cacheKey);
        if (cached) {
            return sendJSON(res, 200, cached);
        }

        try {
            const diff = execGitSync(`show --format="" --patch ${hash} -- ${filePath}`, ws.rootPath);
            const result = { diff };
            gitCache.set(cacheKey, result);
            sendJSON(res, 200, result);
        } catch (err: any) {
            return handleAPIError(res, badRequest('Failed to get commit file diff: ' + (err.message || 'unknown error')));
        }
    },
});
```

### Why this works

- The regex `(.+)` captures everything after `files/` and before `/diff`, including `%2F`-encoded slashes.
- `decodeURIComponent` restores the original path (e.g., `packages/coc/src/…/index.ts`).
- `git show --format="" --patch <hash> -- <filePath>` outputs only the diff for that file in the given commit.
- Response shape `{ diff: string }` matches what `CommitDetail.tsx` already expects (line 35).

## Files to change

| File | Change |
|---|---|
| `packages/coc-server/src/api-handler.ts` | Add new route after the full commit diff route (~line 464) |

## Testing

- Add a Vitest test in `packages/coc-server/src/` (or existing test file) covering:
  - Valid request returns `{ diff: string }` with 200
  - Unknown workspace returns 404
  - Cache hit returns cached result
  - Git error returns 400
- Manually verify in the CoC dashboard: click a file in a commit → diff renders without error
