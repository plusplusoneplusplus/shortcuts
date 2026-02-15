---
status: pending
---

# 011: Add retry to session pool factory

## Summary

Wrap the `this.factory()` call inside `SessionPool.createAndAddSession()` with `withRetry()` so that transient session-creation failures are retried automatically instead of immediately depleting the pool.

## Motivation

When the session factory fails (e.g. network hiccup, temporary SDK unavailability), the error currently bubbles up immediately from `createAndAddSession()`. Because `acquire()` increments towards `maxSessions` only after a successful creation, a transient failure means the caller gets an error and must retry the entire acquire flow externally. If multiple concurrent callers hit the same transient issue, the pool can appear unresponsive even though the underlying problem is momentary. Adding retry at the factory level keeps this concern encapsulated inside the pool and avoids pool depletion under transient conditions.

## Changes

### Files to Create

- **`packages/pipeline-core/test/ai/session-pool-factory-retry.test.ts`**
  New test file covering factory retry behaviour in the session pool.

### Files to Modify

- **`packages/pipeline-core/src/copilot-sdk-wrapper/types.ts`**
  - Add `factoryRetryAttempts?: number` to the `SessionPoolConfig` interface (default: 2).
  - Add the default value (`factoryRetryAttempts: 2`) to `DEFAULT_SESSION_POOL_CONFIG`.

- **`packages/pipeline-core/src/copilot-sdk-wrapper/session-pool.ts`**
  - Import `withRetry` from `'../runtime/retry'` and `isTransientError` from the error utilities introduced in commit 001.
  - Add a `factoryRetryAttempts` readonly field, read from a new optional `factoryRetryAttempts` property on `SessionPoolOptions` (default: 2).
  - In `createAndAddSession()`, wrap `this.sessionFactory()` with `withRetry()`:
    ```typescript
    const session = await withRetry(
        () => this.sessionFactory(),
        {
            attempts: this.factoryRetryAttempts,
            delayMs: 1000,
            backoff: 'exponential',
            retryOn: (error) => isTransientError(error),
            onAttempt: (attempt, maxAttempts, lastError) => {
                if (attempt > 1) {
                    logger.warn(LogCategory.AI,
                        `SessionPool: Factory retry attempt ${attempt}/${maxAttempts}` +
                        (lastError instanceof Error ? `: ${lastError.message}` : ''));
                }
            },
            operationName: 'SessionPool.factory',
        }
    );
    ```
  - Add `factoryRetryAttempts` to `SessionPoolOptions` interface with JSDoc.

### Files to Delete

None.

## Implementation Notes

- `isTransientError` is the error classifier introduced in commit 001 of this series. If commit 001 has not yet landed, a local predicate checking for common transient patterns (e.g. `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, rate-limit status codes) can be used as a temporary stand-in, or the default `retryOn` (retry all except cancellation) can be used until the classifier is available.
- The `factoryRetryAttempts` default of 2 means: 1 initial attempt + 1 retry. This keeps latency bounded while handling the most common single-blip failures.
- The 1 s base delay with exponential backoff gives a 1 s wait before the single retry (with `attempts: 2`, only one delay is ever applied).
- The retry is scoped to `createAndAddSession()` only—it does not affect `sendAndWait` or any other session operation.
- `SessionPoolOptions.factoryRetryAttempts` is plumbed from `SessionPoolConfig` so that the VS Code extension settings can eventually expose it without touching pool internals.

## Tests

Add `packages/pipeline-core/test/ai/session-pool-factory-retry.test.ts` with Vitest:

1. **Factory transient failure → retry → success**
   - Create a factory that fails once with a transient error, then succeeds on the second call.
   - Call `pool.acquire()`. Assert it resolves with a valid session.
   - Assert the factory was called exactly 2 times.

2. **Factory exhausts retries → propagates `RetryExhaustedError`**
   - Create a factory that always throws a transient error.
   - Configure `factoryRetryAttempts: 3`.
   - Call `pool.acquire()`. Assert it rejects with a `RetryExhaustedError`.
   - Assert the factory was called exactly 3 times.

3. **Non-transient error is not retried**
   - Create a factory that throws a non-transient error (e.g. `TypeError`).
   - Call `pool.acquire()`. Assert it rejects with the original error (not `RetryExhaustedError`).
   - Assert the factory was called exactly 1 time.

4. **`factoryRetryAttempts: 1` disables retry**
   - Configure `factoryRetryAttempts: 1` (single attempt, no retry).
   - Factory throws a transient error.
   - Assert immediate failure after 1 call.

5. **Retry logs warning on subsequent attempts**
   - Spy on logger to verify `warn` is called with retry attempt info when `attempt > 1`.

## Acceptance Criteria

- [ ] `SessionPoolConfig` and `SessionPoolOptions` include `factoryRetryAttempts` with default 2.
- [ ] `createAndAddSession()` uses `withRetry()` with exponential backoff and the transient-error predicate.
- [ ] Retry attempts are logged at warn level for observability.
- [ ] Non-transient errors are not retried and propagate immediately.
- [ ] All new tests pass: `cd packages/pipeline-core && npm run test:run`.
- [ ] Existing session pool tests continue to pass (no behavioural change for factories that succeed on first call).
- [ ] No VS Code dependencies introduced in the pool module.

## Dependencies

- Depends on: 001, 006
