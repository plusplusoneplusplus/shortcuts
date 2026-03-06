# Plan: Remove Direct-AI Fallback from Comment Resolve Handlers

## Problem

`registerTaskCommentsRoutes` accepts `bridge?: MultiRepoQueueExecutorBridge` as an optional
parameter. When the bridge is absent (or enqueueing fails), the resolve handlers fall back to
calling AI directly and synchronously (`createCLIAIInvoker`). This fallback path is unnecessary:
in production `coc serve`, the bridge is always provided, and we don't want to silently degrade
to a different execution model.

## Approach

1. Make `bridge` a **required** parameter in `registerTaskCommentsRoutes`.
2. Remove the per-comment resolve fallback block (~lines 693–720, task-comments-handler.ts).
3. Remove the batch-resolve fallback block (~lines 819–846, task-comments-handler.ts).
4. Return a clear `503` error (bridge/queue unavailable) if `enqueueResolveTask` returns
   `undefined` or throws, instead of silently falling back.
5. Remove `createCLIAIInvoker` import from task-comments-handler.ts if it is no longer used
   (the legacy Q&A path at ~line 757 still uses it — keep the import if that path remains).
6. Update the test file `task-comments-batch-resolve.test.ts` to remove any 200-fallback
   expectations and always expect 202.

## Files to Change

| File | Change |
|------|--------|
| `packages/coc-server/src/task-comments-handler.ts` | Make `bridge` required; remove two fallback blocks; return 503 on queue failure |
| `packages/coc/src/server/index.ts` | No change needed — bridge is already always passed |
| `packages/coc-server/src/task-comments-batch-resolve.test.ts` | Remove 200-path expectations |

## Notes

- The Q&A (`askAI`) path in task-comments-handler.ts (~line 757) uses `createCLIAIInvoker` as
  its **primary** path (not a fallback) — do NOT touch it.
- No change needed in `packages/coc/src/server/index.ts` since it already passes the bridge.
