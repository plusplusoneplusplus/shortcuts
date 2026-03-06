---
status: pending
---

# 002: Backend — MCP Config API Endpoints + Workspace Preference Storage

## Summary
Add two new REST endpoints to `packages/coc-server/src/api-handler.ts`:
- `GET /api/workspaces/:id/mcp-config` — returns all globally-configured MCP servers plus the workspace's enabled list.
- `PUT /api/workspaces/:id/mcp-config` — saves the workspace's enabled list to `workspaces.json` via `store.updateWorkspace`.

## Motivation
The SPA workspace settings panel (commit 004/005) needs a dedicated API to read and persist which MCP servers are active for each workspace. Piggybacking on `PATCH /api/workspaces/:id` would require the client to know the full `WorkspaceInfo` shape; a focused sub-resource endpoint is cleaner and easier to mock in tests. The global server catalogue comes from `loadDefaultMcpConfig()` so no extra config file is introduced.

## Changes

### Files to Create
- `packages/coc-server/test/mcp-config-api.test.ts` — Vitest integration tests for the two new endpoints (see **Tests** section).

### Files to Modify
- `packages/coc-server/src/api-handler.ts`
  - Add import: `import { loadDefaultMcpConfig } from '@plusplusoneplusplus/pipeline-core';`
  - Add `MCPServerConfig` to the existing named import from `@plusplusoneplusplus/pipeline-core`.
  - Register two new routes inside `registerApiRoutes()` after the existing `GET /api/workspaces/:id/git-info` block:
    1. `GET /api/workspaces/:id/mcp-config`
    2. `PUT /api/workspaces/:id/mcp-config`

### Files to Delete
- (none)

## Implementation Notes

### Route: `GET /api/workspaces/:id/mcp-config`

```ts
routes.push({
    method: 'GET',
    pattern: /^\/api\/workspaces\/([^/]+)\/mcp-config$/,
    handler: async (_req, res, match) => {
        const id = decodeURIComponent(match![1]);
        const workspaces = await store.getWorkspaces();
        const ws = workspaces.find(w => w.id === id);
        if (!ws) {
            return handleAPIError(res, notFound('Workspace'));
        }
        const { mcpServers: available } = loadDefaultMcpConfig();
        const enabled: string[] | null = ws.enabledMcpServers ?? null;
        sendJSON(res, 200, { available, enabled });
    },
});
```

Response shape:
```json
{
  "available": {
    "github": { "type": "stdio", "command": "npx", "args": ["@modelcontextprotocol/server-github"] },
    "filesystem": { "type": "stdio", "command": "npx", "args": ["@modelcontextprotocol/server-filesystem", "/"] }
  },
  "enabled": ["github"]
}
```
- `enabled: null` means the workspace has never explicitly set a preference (treat as "all enabled" on the client side).
- `enabled: []` means the workspace explicitly disabled all servers.
- `available` may be an empty object `{}` if `~/.copilot/mcp-config.json` does not exist — the endpoint still returns 200.

### Route: `PUT /api/workspaces/:id/mcp-config`

```ts
routes.push({
    method: 'PUT',
    pattern: /^\/api\/workspaces\/([^/]+)\/mcp-config$/,
    handler: async (req, res, match) => {
        const id = decodeURIComponent(match![1]);
        const workspaces = await store.getWorkspaces();
        const ws = workspaces.find(w => w.id === id);
        if (!ws) {
            return handleAPIError(res, notFound('Workspace'));
        }
        let body: any;
        try {
            body = await parseBody(req);
        } catch {
            return handleAPIError(res, invalidJSON());
        }
        if (!Object.prototype.hasOwnProperty.call(body, 'enabled')) {
            return handleAPIError(res, missingFields(['enabled']));
        }
        // enabled must be an array of strings or null
        if (body.enabled !== null && !Array.isArray(body.enabled)) {
            return handleAPIError(res, badRequest('`enabled` must be an array of strings or null'));
        }
        if (Array.isArray(body.enabled) && body.enabled.some((e: any) => typeof e !== 'string')) {
            return handleAPIError(res, badRequest('`enabled` items must be strings'));
        }
        const updated = await store.updateWorkspace(id, { enabledMcpServers: body.enabled });
        if (!updated) {
            return handleAPIError(res, notFound('Workspace'));
        }
        sendJSON(res, 200, { workspace: updated });
    },
});
```

- No validation against `available` server names is done server-side (the list may change between calls; the client is responsible for stale references).
- `enabled: null` clears the workspace preference and is stored verbatim (commit 001 defined the field as `string[] | null`).
- Uses the same `store.updateWorkspace` call as the existing `PATCH /api/workspaces/:id` handler — the `FileProcessStore` serialises the whole `WorkspaceInfo` object including the new field transparently.

### Import additions in `api-handler.ts`

The existing top-level import block already pulls from `@plusplusoneplusplus/pipeline-core`:
```ts
import type { ProcessStore, ProcessFilter, AIProcess, AIProcessStatus, AIProcessType, WorkspaceInfo, ConversationTurn } from '@plusplusoneplusplus/pipeline-core';
```
Add to that import:
```ts
import { loadDefaultMcpConfig } from '@plusplusoneplusplus/pipeline-core';
import type { MCPServerConfig } from '@plusplusoneplusplus/pipeline-core';
```
`loadDefaultMcpConfig` is synchronous and cached after the first call — no async overhead per request.

### `loadDefaultMcpConfig` behaviour recap
- Defined in `packages/pipeline-core/src/copilot-sdk-wrapper/mcp-config-loader.ts`.
- Reads `~/.copilot/mcp-config.json` on first call, then returns a cached `MCPConfigLoadResult`.
- `MCPConfigLoadResult.mcpServers` is always a `Record<string, MCPServerConfig>` — empty object `{}` on file-not-found or parse error.
- Exported from the `@plusplusoneplusplus/pipeline-core` index.

## Tests

New file: `packages/coc-server/test/mcp-config-api.test.ts`

### Test structure (Vitest, same pattern as `git-api.test.ts`)

```ts
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as http from 'http';
import { createRouter } from '../src/shared/router';
import { registerApiRoutes } from '../src/api-handler';
import type { Route } from '../src/types';
import { createMockProcessStore } from './helpers/mock-process-store';
```

Mock `loadDefaultMcpConfig` via `vi.mock`:
```ts
const mockLoadDefaultMcpConfig = vi.fn();
vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, loadDefaultMcpConfig: mockLoadDefaultMcpConfig };
});
```

Test cases:
1. **GET — workspace not found → 404**.
2. **GET — workspace found, `enabledMcpServers` undefined → `enabled: null`** in response.
3. **GET — workspace found, `enabledMcpServers: ['github']` → `enabled: ['github']`** in response.
4. **GET — `loadDefaultMcpConfig` returns non-empty map → `available` matches** in response.
5. **GET — `loadDefaultMcpConfig` returns empty map (file not found) → `available: {}`**, still 200.
6. **PUT — workspace not found → 404**.
7. **PUT — missing `enabled` field in body → 400** with `MISSING_FIELDS`.
8. **PUT — `enabled` is a non-array, non-null value → 400** with `BAD_REQUEST`.
9. **PUT — `enabled: ['github']` → 200, `store.updateWorkspace` called with `{ enabledMcpServers: ['github'] }`**.
10. **PUT — `enabled: null` → 200, `store.updateWorkspace` called with `{ enabledMcpServers: null }`**.
11. **PUT — `enabled: []` → 200**, empty array stored.
12. **PUT — invalid JSON body → 400** with `INVALID_JSON`.

The test HTTP server is spun up with `beforeAll` / `afterAll` using the same pattern as `git-api.test.ts`:
```ts
let server: http.Server;
let baseUrl: string;
let mockStore: ReturnType<typeof createMockProcessStore>;

beforeAll(async () => {
    mockStore = createMockProcessStore({
        initialWorkspaces: [{ id: 'ws-1', name: 'My Project', rootPath: '/projects/my' }],
    });
    const routes: Route[] = [];
    registerApiRoutes(routes, mockStore);
    const router = createRouter(routes);
    server = http.createServer(router);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
        server.close(err => (err ? reject(err) : resolve()))
    );
});
```

## Acceptance Criteria
- [ ] `GET /api/workspaces/:id/mcp-config` returns `{ available: Record<string, MCPServerConfig>, enabled: string[] | null }` with HTTP 200 when workspace exists.
- [ ] `GET /api/workspaces/:id/mcp-config` returns 404 when workspace does not exist.
- [ ] `PUT /api/workspaces/:id/mcp-config` with `{ enabled: string[] }` persists via `store.updateWorkspace` and returns 200 with updated workspace.
- [ ] `PUT /api/workspaces/:id/mcp-config` with `{ enabled: null }` persists `null` and returns 200.
- [ ] `PUT /api/workspaces/:id/mcp-config` with missing/invalid body returns 400.
- [ ] `npm run build` succeeds with no new TypeScript errors.
- [ ] All new tests pass (`npm run test:run` in `packages/coc-server/`).
- [ ] All existing coc-server tests continue to pass.

## Dependencies
- Depends on: **001** — `WorkspaceInfo.enabledMcpServers?: string[] | null` must exist before this commit, so `store.updateWorkspace(id, { enabledMcpServers: ... })` is type-safe.

## Assumed Prior State
- `WorkspaceInfo` in `packages/pipeline-core/src/process-store.ts` has `enabledMcpServers?: string[] | null` (added in commit 001).
- `loadDefaultMcpConfig` and `MCPServerConfig` are exported from `@plusplusoneplusplus/pipeline-core` index — confirmed at `src/index.ts` lines 319 and 341.
- `store.updateWorkspace` accepts `Partial<Omit<WorkspaceInfo, 'id'>>` — the new `enabledMcpServers` field is included in that partial automatically once commit 001 lands.
- `packages/coc-server` already depends on `@plusplusoneplusplus/pipeline-core` — no `package.json` changes are needed.
