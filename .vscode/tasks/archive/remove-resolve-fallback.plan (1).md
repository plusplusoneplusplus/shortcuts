# Plan: Remove Direct-AI Fallback from Comment Resolve Handlers

## Problem

`registerTaskCommentsRoutes` accepts `bridge?: MultiRepoQueueExecutorBridge` as an optional
parameter. When the bridge is absent (or enqueueing fails), the resolve handlers fall back to
calling AI directly and synchronously (`createCLIAIInvoker`). This fallback path is unnecessary:
- In production `coc serve`, the bridge is always constructed and passed unconditionally
  (`packages/coc/src/server/index.ts:165–173, 231`)
- There is only **one** caller of `registerTaskCommentsRoutes` in the entire codebase
- The fallback is dead code and silently degrades to a different execution model

Multi-model verification (Claude, GPT-5.2, Gemini) confirmed removal is safe, with one additional
finding: **the SPA client also has a "sync fallback path" in `useTaskComments.ts`** that handles
HTTP 200 responses. That dead client-side code must also be removed.

## Approach

1. Make `bridge` a **required** parameter in `registerTaskCommentsRoutes`
2. Remove the per-comment resolve fallback block in `task-comments-handler.ts`
3. Remove the batch-resolve fallback block in `task-comments-handler.ts`; return HTTP 503 on queue failure
4. Remove the client-side "sync fallback path" (200-response handling) from `useTaskComments.ts`
5. Update tests to only expect HTTP 202 (never 200) for resolve operations

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/task-comments-handler.ts` | Make `bridge` required; remove per-comment resolve fallback (~lines 693–734); remove batch-resolve fallback (~lines 819–868); return 503 on queue failure |
| `packages/coc/src/server/spa/client/react/hooks/useTaskComments.ts` | Remove "Sync fallback path" handling for HTTP 200 in both per-comment resolve (~lines 357–368) and batch-resolve (~lines 303–319); always expect 202 + taskId |
| `packages/coc/test/server/task-comments-batch-resolve.test.ts` | Remove `[200, 202]` expectations; expect only 202 |

## What NOT to Change

- `createCLIAIInvoker` is still used as the **primary** path for the Q&A (`ask-ai`) command
  (~line 756 in task-comments-handler.ts) — do NOT remove it or its import
- `packages/coc/src/server/index.ts` — already always passes the bridge, no change needed

## Verification Summary

| Verifier | Verdict | Confidence |
|----------|---------|-----------|
| Claude Sonnet 4.6 | ✅ Confirmed | High |
| GPT-5.2 | ❌ Refuted (client-side concern) | Medium |
| Gemini 3 Pro | ✅ Confirmed | High |
| **Synthesized** | **⚠️ Safe with client cleanup** | **High** |

GPT-5.2's refusal was based on the client (`useTaskComments.ts`) explicitly handling the 200 path.
The plan now includes removing that client-side dead code, resolving the conflict.
