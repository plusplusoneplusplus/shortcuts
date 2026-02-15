---
status: pending
---

# 004: Add retry for transient errors in SDK sendMessage

## Summary
Wire the existing `withRetry()` utility from `runtime/retry.ts` into `CopilotSDKService.sendMessageDirect()` and `sendMessageWithPool()` so that transient SDK failures (network blips, temporary unavailability, rate limits) are automatically retried with exponential backoff. Retry is opt-in via a new `retry` field on `SendMessageOptions` to preserve backward compatibility.

## Motivation
Most SDK failures are transient — ECONNREFUSED, ETIMEDOUT, HTTP 429/502/503, and brief Copilot service outages. Today a single transient error fails the entire operation, forcing callers to implement their own retry loops. The `withRetry()` utility and error classification infrastructure already exist (commits 001–002); this commit connects them at the SDK service layer where they have the highest impact. Every consumer of `sendMessage()` benefits without code changes.

## Changes

### Files to Create
- `packages/pipeline-core/test/ai/copilot-sdk-retry.test.ts` — Dedicated test file for SDK retry behavior:
  - Tests retry with `retry: true` (default options) and `retry: { attempts: 4, delayMs: 500 }` (custom)
  - Tests that retry is disabled by default (no `retry` field → single attempt)
  - Tests transient error recovery (fail twice, succeed on third attempt)
  - Tests non-transient errors are NOT retried (e.g. `AI_RESPONSE_PARSE_FAILED`)
  - Tests session cleanup on each retry (destroy old session before creating new one)
  - Tests pool path: session destroyed via `pool.destroy()`, new session acquired on retry
  - Tests `RetryExhaustedError` surfaces when all attempts fail
  - Tests cancellation errors abort immediately (no retry)
  - Tests `onAttempt` callback integration for logging

### Files to Modify
- `packages/pipeline-core/src/copilot-sdk-wrapper/types.ts`
  - Add `retry?: RetryOptions | boolean` field to `SendMessageOptions` interface
  - Add import for `RetryOptions` from `../runtime/retry`
  - JSDoc: `boolean` = use defaults (`{ attempts: 3, delayMs: 1000, backoff: 'exponential' }`), object = custom config, `undefined`/absent = retry disabled

- `packages/pipeline-core/src/copilot-sdk-wrapper/copilot-sdk-service.ts`
  - Add imports: `withRetry`, `RetryOptions`, `DEFAULT_RETRY_OPTIONS` from `../runtime/retry`; `isTransientError` from error classification (commit 001 — if not yet available, use a local predicate checking error codes `TIMEOUT`, `AI_INVOCATION_FAILED`, `UNKNOWN` against Node.js system errors `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, `EAI_AGAIN`)
  - Add private helper `resolveRetryOptions(retry?: RetryOptions | boolean): RetryOptions | undefined` — returns `undefined` when retry is disabled, `DEFAULT_RETRY_OPTIONS` with transient-error predicate when `true`, or the user-supplied object merged with the transient-error predicate as default `retryOn`
  - In `sendMessageDirect()`: extract the core logic (from `ensureClient()` through session destroy) into an inner async function; wrap it with `withRetry(innerFn, retryOpts)` when retry is enabled. Each attempt must: (1) create a fresh session, (2) on failure, destroy that session in the catch block before the error propagates to `withRetry`, (3) let `withRetry` decide whether to retry
  - In `sendMessageWithPool()`: similarly extract the acquire → send → release/destroy logic into an inner function; wrap with `withRetry()`. On each failed attempt, destroy the session via `pool.destroy(session)` so the next attempt gets a fresh session
  - Add debug logging: `CopilotSDKService: Retry attempt {n}/{max} after transient error: {message}`

### Files to Delete
None.

## Implementation Notes
- **Session cleanup is critical**: each retry attempt must start with a fresh session. In `sendMessageDirect`, the existing `finally` block already destroys the session — move session creation inside the retried closure so each attempt gets its own session. In `sendMessageWithPool`, similarly move `pool.acquire()` inside the closure.
- **Default retry predicate**: use `isTransientError()` from commit 001's error classification. If that function doesn't exist yet (since commit 001 may not be merged), create a local `isTransientSDKError(error: unknown): boolean` that checks: (a) Node.js system error codes (`ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, `EAI_AGAIN`), (b) `PipelineCoreError` with code `TIMEOUT` or `AI_INVOCATION_FAILED`, (c) error messages containing `429`, `502`, `503`, `504`, `rate limit`, `temporarily unavailable`. This can be replaced by `isTransientError()` once commit 001 lands.
- **Non-retryable errors**: cancellation errors (`CancellationError`) are already handled by `withRetry`'s default `retryOn`. Parse errors (`AI_RESPONSE_PARSE_FAILED`) and config errors should not be retried — the transient predicate naturally excludes them.
- **Backward compatibility**: when `retry` is `undefined` (the default), `sendMessageDirect` and `sendMessageWithPool` execute exactly as they do today — no `withRetry` wrapper, no behavior change.
- **Error propagation**: when retry is enabled and all attempts exhaust, `withRetry` throws `RetryExhaustedError`. The existing catch block in both methods converts this to `{ success: false, error: "..." }` — no caller-visible change in return type.
- **Pool sessions**: `sendMessageWithPool` already marks sessions for destruction on error (`shouldDestroySession = true`). The retry wrapper must ensure each attempt acquires a fresh session from the pool rather than reusing a broken one.

## Tests
- **File**: `packages/pipeline-core/test/ai/copilot-sdk-retry.test.ts`
- **Framework**: Vitest (consistent with pipeline-core test suite)
- **Mock strategy**: Mock the SDK module (same pattern as `copilot-sdk-service.test.ts`) with `createSession` returning mock sessions whose `sendAndWait` can be programmed to fail N times then succeed
- **Key test cases**:
  1. `retry: true` — transient error on attempts 1-2, success on attempt 3 → returns success
  2. `retry: true` — all 3 attempts fail with transient error → returns `{ success: false }` with retry-exhausted context
  3. `retry: { attempts: 5 }` — custom attempt count honored
  4. No `retry` field — single attempt, transient error → immediate failure (no retry)
  5. `retry: true` — non-transient error (e.g., parse error) → immediate failure (no retry)
  6. `retry: true` — cancellation error → immediate failure (no retry)
  7. Session cleanup — verify `session.destroy()` called before each retry in direct mode
  8. Pool cleanup — verify `pool.destroy(session)` called before each retry in pool mode
  9. `retry: true` with `usePool: true` — retry works through pool path
  10. Logging — verify debug log emitted for each retry attempt

## Acceptance Criteria
- [ ] `SendMessageOptions.retry` field exists and accepts `boolean | RetryOptions | undefined`
- [ ] `sendMessageDirect()` retries transient errors when `retry` is enabled
- [ ] `sendMessageWithPool()` retries transient errors when `retry` is enabled
- [ ] Default behavior (no `retry` field) is unchanged — single attempt, no retry
- [ ] `retry: true` uses sensible defaults: 3 attempts, 1s base delay, exponential backoff
- [ ] Non-transient errors (parse, config, cancellation) are not retried
- [ ] Each retry attempt uses a fresh session (old session destroyed first)
- [ ] `RetryExhaustedError` is caught and converted to `{ success: false }` result
- [ ] All new tests pass (`npm run test:run` in `packages/pipeline-core/`)
- [ ] Existing SDK service tests still pass (no regressions)
- [ ] No changes to public API surface beyond the new optional `retry` field

## Dependencies
- Depends on: 001, 002
