---
status: pending
---

# 004: Add `POST /api/memory/aggregate-tool-calls` batch aggregation endpoint

## Summary

Adds a manually-triggered HTTP endpoint that reads all raw tool-call Q&A files from
`explore-cache/raw/`, runs `ToolCallCacheAggregator.aggregate()` (AI-powered consolidation),
writes the result to `explore-cache/consolidated.json`, and deletes the raw files.
No auto-triggering — the caller decides when to run this.

## Motivation

After commits 001-003, raw Q&A files accumulate in `~/.coc/memory/explore-cache/raw/*.json`
whenever an AI session makes explore-type tool calls. There is no mechanism to merge them.
This commit adds the single manual trigger that collapses the raw backlog into a deduplicated,
clustered index. Keeping it as a separate commit isolates the server-layer changes (new route,
new options type, new handler) from the earlier ingestion work, and keeps the `coc-server`
package free of AI SDK dependencies by threading an `AIInvoker` in from the `coc` package.

## Changes

### Files to Create

- `packages/coc-server/src/memory/tool-call-aggregation-handler.ts` — standalone async handler
  for `POST /api/memory/aggregate-tool-calls`. Accepts `dataDir` and an optional `AIInvoker`,
  orchestrates the `FileToolCallCacheStore` → `ToolCallCacheAggregator` pipeline, and returns
  a typed JSON response. Keeping this in its own file mirrors the `memory-config-handler.ts`
  pattern and makes the handler unit-testable in isolation.

### Files to Modify

- `packages/coc-server/src/memory/memory-routes.ts` — add `MemoryRouteOptions` interface and
  update `registerMemoryRoutes` signature to accept it; register the new POST route.

- `packages/coc/src/server/index.ts` — pass `{ aggregateToolCallsAIInvoker: createCLIAIInvoker({ approvePermissions: true }) }`
  to the `registerMemoryRoutes` call so the endpoint has a live AI backend.

### Files to Delete

- (none)

## Implementation Notes

### `MemoryRouteOptions` interface (`memory-routes.ts`)

```ts
import type { AIInvoker } from '@plusplusoneplusplus/pipeline-core';

export interface MemoryRouteOptions {
  /**
   * AI invoker for the POST /api/memory/aggregate-tool-calls endpoint.
   * When absent the endpoint returns 503 Service Unavailable.
   */
  aggregateToolCallsAIInvoker?: AIInvoker;
}
```

Update function signature (backwards-compatible — third param is optional):

```ts
export function registerMemoryRoutes(
  routes: Route[],
  dataDir: string,
  options?: MemoryRouteOptions,
): void
```

Add the new route at the end of the function, before the closing brace:

```ts
routes.push({
  method: 'POST',
  pattern: '/api/memory/aggregate-tool-calls',
  handler: async (req, res) => {
    await handleAggregateToolCalls(req, res, dataDir, options?.aggregateToolCallsAIInvoker);
  },
});
```

---

### `tool-call-aggregation-handler.ts` (new file)

```ts
import * as http from 'http';
import type { AIInvoker } from '@plusplusoneplusplus/pipeline-core';
import { FileToolCallCacheStore, ToolCallCacheAggregator } from '@plusplusoneplusplus/pipeline-core';
import { sendJson, send500 } from '../router';
import { readMemoryConfig } from './memory-config-handler';
```

**Response shapes:**

```ts
// 503 — no AI invoker configured
{ error: 'AI invoker not configured' }

// 200 — nothing to do
{ aggregated: false, reason: 'no raw entries' }

// 200 — aggregation ran
{ aggregated: true, rawCount: number, consolidatedCount: number }

// 500 — unexpected error
{ error: string }
```

**Full handler:**

```ts
export async function handleAggregateToolCalls(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  dataDir: string,
  aiInvoker?: AIInvoker,
): Promise<void> {
  if (!aiInvoker) {
    sendJson(res, { error: 'AI invoker not configured' }, 503);
    return;
  }

  try {
    const config = readMemoryConfig(dataDir);
    const store = new FileToolCallCacheStore({ dataDir: config.storageDir });
    const stats = await store.getStats();

    if (stats.rawCount === 0) {
      sendJson(res, { aggregated: false, reason: 'no raw entries' });
      return;
    }

    const rawCountBefore = stats.rawCount;
    const aggregator = new ToolCallCacheAggregator(store);
    await aggregator.aggregate(aiInvoker);

    const statsAfter = await store.getStats();
    sendJson(res, {
      aggregated: true,
      rawCount: rawCountBefore,
      consolidatedCount: statsAfter.consolidatedCount,
    });
  } catch (err) {
    send500(res, err instanceof Error ? err.message : String(err));
  }
}
```

**Key design decisions:**

- `readMemoryConfig(dataDir)` provides `storageDir`; `FileToolCallCacheStore({ dataDir: storageDir })` maps to `~/.coc/memory/explore-cache/` by default (the store appends `explore-cache` internally via `cacheSubDir`).
- `ToolCallCacheAggregator.aggregate()` already handles the safety-first write-then-delete invariant: `consolidated.json` is written before any raw file is deleted. The handler does not need to replicate that logic.
- No request body is read — this is a trigger-only endpoint. A future extension could accept `{ model?, batchThreshold? }` but that is out of scope here.
- The AI call inside `aggregate()` can be slow (seconds to tens of seconds). This is acceptable for a manually-triggered batch endpoint. No timeout is imposed at the handler layer; the `AIInvoker` itself carries its own timeout.
- `503` is used (not `400` or `501`) because the absence of `aiInvoker` is a server-side configuration issue, not a client error.

---

### `packages/coc/src/server/index.ts`

Change line ~239 from:

```ts
registerMemoryRoutes(routes, dataDir);
```

to:

```ts
import { createCLIAIInvoker } from '../ai-invoker';

// …
registerMemoryRoutes(routes, dataDir, {
  aggregateToolCallsAIInvoker: createCLIAIInvoker({ approvePermissions: true }),
});
```

`createCLIAIInvoker` is already imported in `queue-executor-bridge.ts` and `task-comments-handler.ts` within the same package, so this import is consistent with established usage. `approvePermissions: true` matches the pattern used in `queue-executor-bridge.ts` for server-side AI work where the human is not interactively present to approve each tool call.

## Tests

### Unit tests — `packages/coc-server/test/tool-call-aggregation-handler.test.ts` (new file)

Follow the same Vitest setup as `memory-config-handler.test.ts` (import directly, call handler with `http.IncomingMessage`/`http.ServerResponse` mocks or use a lightweight `MockResponse` helper).

- **503 when aiInvoker is undefined**
  Call `handleAggregateToolCalls(req, res, tmpDir, undefined)`.
  Assert status 503, body `{ error: 'AI invoker not configured' }`.

- **200 `{ aggregated: false }` when rawCount is 0**
  Write a `memory-config.json` pointing to a fresh `storageDir` (no raw files present).
  Pass a mock `aiInvoker` (should NOT be called).
  Assert status 200, body `{ aggregated: false, reason: 'no raw entries' }`.
  Assert mock `aiInvoker` was never called.

- **200 `{ aggregated: true }` with correct counts on success**
  Write N raw `.json` files into `<storageDir>/explore-cache/raw/`.
  Provide a mock `aiInvoker` that returns a valid consolidated JSON array.
  Assert status 200, body `{ aggregated: true, rawCount: N, consolidatedCount: <array length> }`.
  Assert raw directory is empty after the call.
  Assert `consolidated.json` exists.

- **500 on aiInvoker error**
  Provide a mock `aiInvoker` that returns `{ success: false, error: 'timeout' }`.
  Assert status 500, body contains an `error` string.
  Assert raw files are NOT deleted (safety invariant: `aggregate()` throws before delete).

### Integration tests — `packages/coc-server/test/memory-routes.test.ts` (extend existing)

Add a new `describe('POST /api/memory/aggregate-tool-calls', ...)` block.
Update `makeServer` to accept optional `MemoryRouteOptions` and forward to `registerMemoryRoutes`.

- **503 when options not passed (no aiInvoker)**
  Use existing `makeServer(tmpDir)` (no options) and POST to the endpoint.
  Assert 503.

- **200 `{ aggregated: false }` when raw dir is empty**
  Pass a mock `aiInvoker` via `makeServer(tmpDir, { aggregateToolCallsAIInvoker: mockInvoker })`.
  Assert 200, `aggregated === false`.

- **200 `{ aggregated: true }` when raw files exist**
  Seed the raw dir with a few JSON files, provide a mock `aiInvoker`.
  POST to the endpoint.
  Assert 200, `aggregated === true`, `rawCount` matches seeded count.

## Acceptance Criteria

- [ ] `POST /api/memory/aggregate-tool-calls` returns 503 when no `AIInvoker` is configured
- [ ] Returns `{ aggregated: false, reason: 'no raw entries' }` when raw dir is empty or non-existent
- [ ] Returns `{ aggregated: true, rawCount, consolidatedCount }` after a successful AI aggregation run
- [ ] Raw files in `explore-cache/raw/` are deleted after successful aggregation
- [ ] `explore-cache/consolidated.json` is written (or updated) after successful aggregation
- [ ] Returns 500 on any unexpected error (AI failure, I/O error)
- [ ] `registerMemoryRoutes` signature change is backwards-compatible (third param optional)
- [ ] `packages/coc/src/server/index.ts` passes a live `createCLIAIInvoker` to the route
- [ ] All new and existing `memory-routes` and `memory-config-handler` tests continue to pass
- [ ] New unit tests for `handleAggregateToolCalls` cover all five scenarios above

## Dependencies

- Depends on: 001 (raw file writing infrastructure), 002 (FileToolCallCacheStore), 003 (ToolCallCacheAggregator)

## Assumed Prior State

- `FileToolCallCacheStore` exists in `packages/pipeline-core/src/memory/tool-call-cache-store.ts`
  and is exported from `packages/pipeline-core/src/memory/index.ts`.
- `ToolCallCacheAggregator` exists in `packages/pipeline-core/src/memory/tool-call-cache-aggregator.ts`
  and is exported from the same index.
- `registerMemoryRoutes(routes, dataDir)` is already registered in
  `packages/coc/src/server/index.ts` and handles the full set of `/api/memory/*` CRUD routes.
- `createCLIAIInvoker` exists in `packages/coc/src/ai-invoker.ts` and is the standard way to
  create an `AIInvoker` in the `coc` package; it is already used in `queue-executor-bridge.ts`
  and `task-comments-handler.ts`.
- `sendJson`, `send500` helper functions are available in `packages/coc-server/src/router.ts`.
- `readMemoryConfig(dataDir)` is exported from `memory-config-handler.ts` and returns a
  `MemoryConfig` with a `storageDir` field pointing to the memory storage directory (default
  `~/.coc/memory`); `FileToolCallCacheStore({ dataDir: storageDir })` then resolves to
  `~/.coc/memory/explore-cache/` as the cache root.
