---
status: pending
---

# 005: Add token-bucket rate limiter runtime primitive

## Summary

Add a `RateLimiter` class implementing the token-bucket algorithm to `packages/pipeline-core/src/runtime/`. This provides throughput control over time windows, complementing the existing `ConcurrencyLimiter` (which controls parallelism). Includes a `RATE_LIMITED` error code, a `Retry-After` header parsing utility, factory function, and comprehensive tests.

## Motivation

The existing `ConcurrencyLimiter` in `map-reduce/concurrency-limiter.ts` caps how many operations run simultaneously, but does not limit the *rate* at which new operations start. When calling external APIs (especially AI endpoints), providers enforce per-second or per-minute rate limits. Without a rate limiter, burst traffic can trigger 429 responses even when concurrency is within bounds.

A token-bucket algorithm is the standard solution: tokens accumulate at a steady rate up to a maximum burst capacity. Each operation consumes tokens before proceeding. This smooths out traffic while still allowing short bursts, and it's composable with the existing retry and timeout policies in `runtime/`.

## Changes

### Files to Create

1. **`packages/pipeline-core/src/runtime/rate-limiter.ts`**

   Token-bucket rate limiter module following the established patterns in `runtime/` (see `timeout.ts`, `retry.ts`, `cancellation.ts`).

   - **`RateLimiterOptions`** interface:
     ```typescript
     interface RateLimiterOptions {
         /** Tokens added per interval */
         tokensPerInterval: number;
         /** Interval duration in milliseconds */
         intervalMs: number;
         /** Maximum burst capacity. Defaults to tokensPerInterval */
         maxBurst?: number;
     }
     ```

   - **`RateLimitError`** class extending `PipelineCoreError` with code `ErrorCode.RATE_LIMITED`:
     ```typescript
     class RateLimitError extends PipelineCoreError {
         constructor(message: string, meta?: ErrorMetadata) {
             super(message, { code: ErrorCode.RATE_LIMITED, meta });
             this.name = 'RateLimitError';
         }
     }
     ```
     Follow the same pattern as `TimeoutError`, `RetryExhaustedError`, and `CancellationError`.

   - **`RateLimiter`** class with:
     - `constructor(options: RateLimiterOptions)` — validates inputs (tokensPerInterval ≥ 1, intervalMs ≥ 1), sets `maxBurst` defaulting to `tokensPerInterval`, initializes bucket to full capacity, records `lastRefillTime = Date.now()`.
     - `acquire(tokens = 1): Promise<void>` — refills bucket based on elapsed time, if enough tokens are available consumes them and resolves immediately; otherwise enqueues the request and sets a timer for when enough tokens will have accumulated. Pending requests are served FIFO.
     - `tryAcquire(tokens = 1): boolean` — synchronous non-blocking check. Refills, then returns `true` and consumes tokens if available, `false` otherwise. Does **not** throw.
     - `getAvailableTokens(): number` — refills and returns current token count (read-only snapshot).
     - `reset(): void` — refills bucket to `maxBurst`, clears all pending waiters (reject with `RateLimitError`), resets `lastRefillTime`.
     - `dispose(): void` — alias for `reset()`, clears any outstanding timers.
     - Private `refill()` method — calculates elapsed time since `lastRefillTime`, adds `(elapsed / intervalMs) * tokensPerInterval` tokens capped at `maxBurst`, updates `lastRefillTime`. Uses fractional accumulation for precision.
     - Private queue: `Array<{ tokens: number, resolve: () => void, reject: (err: Error) => void }>` for pending `acquire` calls.
     - Private `scheduleNext()` — calculates wait time for next pending request and sets a single `setTimeout`.

   - **`isRateLimitError(error: unknown): error is RateLimitError`** — type guard checking `instanceof RateLimitError` or `PipelineCoreError` with code `RATE_LIMITED` (same dual-check pattern as `isTimeoutError`, `isRetryExhaustedError`).

   - **`parseRetryAfter(headers: Record<string, string | undefined>): number | null`** — utility function:
     - Reads `headers['retry-after']` (case-insensitive lookup).
     - If numeric string, returns value as milliseconds (`parseFloat(value) * 1000`).
     - If HTTP-date (RFC 7231), parses with `Date.parse()` and returns `targetTime - Date.now()`, minimum 0.
     - Returns `null` if header is missing or unparseable.

   - **`createRateLimiter(options: RateLimiterOptions): RateLimiter`** — factory function (mirrors `createPolicyRunner`, `createCancellationToken` pattern).

   - **Default constants** exported: `DEFAULT_RATE_LIMIT_TOKENS_PER_INTERVAL = 10`, `DEFAULT_RATE_LIMIT_INTERVAL_MS = 1000`.

2. **`packages/pipeline-core/test/runtime/rate-limiter.test.ts`**

   Vitest test file (see Tests section below).

### Files to Modify

1. **`packages/pipeline-core/src/errors/error-codes.ts`**
   - Add `RATE_LIMITED: 'RATE_LIMITED'` to the `ErrorCode` const object.
   - Place it in a new "Rate Limiting" subsection within the "Control Flow" category, after `RETRY_EXHAUSTED`:
     ```typescript
     /** Operation was rate-limited (token bucket exhausted) */
     RATE_LIMITED: 'RATE_LIMITED',
     ```
   - Update the JSDoc categories comment at the top to include `RATE_LIMITED`.

2. **`packages/pipeline-core/src/config/defaults.ts`**
   - Add a new "Rate Limiting" section:
     ```typescript
     // ============================================================================
     // Rate Limiting
     // ============================================================================

     /** Default tokens per interval for rate limiter. */
     export const DEFAULT_RATE_LIMIT_TOKENS_PER_INTERVAL = 10;

     /** Default interval in milliseconds for rate limiter. */
     export const DEFAULT_RATE_LIMIT_INTERVAL_MS = 1000;
     ```

3. **`packages/pipeline-core/src/runtime/index.ts`**
   - Add a "Rate Limiting" export block:
     ```typescript
     // Rate Limiting
     export {
         RateLimiterOptions,
         RateLimitError,
         RateLimiter,
         isRateLimitError,
         parseRetryAfter,
         createRateLimiter,
     } from './rate-limiter';
     ```

4. **`packages/pipeline-core/src/index.ts`**
   - Add to the "Runtime (Async Policies)" export section:
     ```typescript
     // Rate Limiting
     RateLimiterOptions,
     RateLimitError,
     RateLimiter,
     isRateLimitError,
     parseRetryAfter,
     createRateLimiter,
     ```
   - Add to the "Config (Centralized Defaults)" export section:
     ```typescript
     // Rate Limiting
     DEFAULT_RATE_LIMIT_TOKENS_PER_INTERVAL,
     DEFAULT_RATE_LIMIT_INTERVAL_MS,
     ```

### Files to Delete

None.

## Implementation Notes

- **Token bucket algorithm**: The bucket starts full at `maxBurst` tokens. On each `acquire`/`tryAcquire`/`getAvailableTokens` call, first refill based on elapsed time. Tokens accumulate continuously: `tokensToAdd = (elapsedMs / intervalMs) * tokensPerInterval`, capped at `maxBurst`. This means a limiter with `tokensPerInterval: 10, intervalMs: 1000` adds 1 token every 100ms.

- **FIFO queue for `acquire`**: When tokens are insufficient, callers are queued. A single `setTimeout` is used for the next pending request's estimated wait time. When the timer fires, refill and process as many queued requests as possible before scheduling the next one. This avoids spinning or polling.

- **Fractional token tracking**: Store `availableTokens` as a floating-point number internally but compare with `>=` for consumption. This prevents rounding drift over long durations.

- **Pattern consistency**: Follow the exact patterns from `timeout.ts` and `cancellation.ts`:
  - Error class extends `PipelineCoreError` with a specific `ErrorCode`
  - Type guard uses dual check (`instanceof` + code check)
  - Factory function as a simple wrapper
  - JSDoc with `@example` blocks

- **`parseRetryAfter`**: This utility is placed in the rate-limiter module because it's most commonly used in rate-limiting contexts (processing 429 responses). It handles both numeric seconds and HTTP-date formats per RFC 7231 §7.1.3.

- **No dependency on `ConcurrencyLimiter`**: Rate limiting and concurrency limiting are orthogonal. They can be composed by callers (e.g., `acquire` from rate limiter then `run` with concurrency limiter) but are independent modules.

- **Timer cleanup**: `dispose()`/`reset()` must clear any pending `setTimeout` to avoid leaks. Pending `acquire` promises are rejected with `RateLimitError` so callers aren't left hanging.

## Tests

Test file: `packages/pipeline-core/test/runtime/rate-limiter.test.ts`

Use Vitest with `vi.useFakeTimers()` for timing-sensitive tests (consistent with `policy.test.ts`). Import from `../../src/runtime` and `../../src/errors`.

### Test Groups

**`RateLimitError`**
- Creates with correct `name` ('RateLimitError'), `code` (RATE_LIMITED), and message
- Preserves metadata when provided
- `isRateLimitError()` returns `true` for `RateLimitError` instances
- `isRateLimitError()` returns `true` for generic `PipelineCoreError` with `RATE_LIMITED` code
- `isRateLimitError()` returns `false` for unrelated errors, `null`, `undefined`

**`RateLimiter` — constructor validation**
- Throws on `tokensPerInterval < 1`
- Throws on `intervalMs < 1`
- Defaults `maxBurst` to `tokensPerInterval` when not specified
- Accepts explicit `maxBurst` larger than `tokensPerInterval`

**`RateLimiter` — `tryAcquire`**
- Returns `true` and consumes tokens when available
- Returns `false` when insufficient tokens (does not throw)
- Consumes custom token amounts (`tryAcquire(3)`)
- Returns `false` immediately if requesting more than `maxBurst`
- Tokens replenish after time passes (advance fake timers)

**`RateLimiter` — `acquire`**
- Resolves immediately when tokens are available
- Waits and resolves when tokens replenish (use `vi.advanceTimersByTime`)
- Multiple queued acquires are served FIFO
- Handles burst: initial burst up to `maxBurst`, then rate-limited
- Custom token amounts work correctly

**`RateLimiter` — `getAvailableTokens`**
- Returns initial capacity (maxBurst) before any consumption
- Returns reduced count after `tryAcquire`
- Returns replenished count after time passes
- Never exceeds `maxBurst`

**`RateLimiter` — `reset`**
- Restores tokens to `maxBurst`
- Rejects pending `acquire` promises with `RateLimitError`
- After reset, `acquire` resolves immediately

**`RateLimiter` — `dispose`**
- Clears timers and rejects pending acquires
- Safe to call multiple times

**`parseRetryAfter`**
- Returns milliseconds from numeric seconds value (`'2'` → `2000`)
- Returns milliseconds from fractional seconds (`'1.5'` → `1500`)
- Parses HTTP-date format and returns delta from now
- Returns `null` for missing header
- Returns `null` for empty string
- Returns `null` for unparseable value
- Case-insensitive header lookup (`'Retry-After'`, `'retry-after'`)
- Returns `0` (not negative) when HTTP-date is in the past

**`createRateLimiter`**
- Returns a `RateLimiter` instance
- Passes options through correctly

**Integration-style (with fake timers)**
- Sustained throughput: 10 acquires over 1s with `tokensPerInterval: 10, intervalMs: 1000` should all complete within ~1s
- Burst then throttle: acquire `maxBurst` tokens instantly, then subsequent acquires are rate-limited
- Multiple concurrent `acquire` calls resolve in order

## Acceptance Criteria

- [ ] `RATE_LIMITED` exists in `ErrorCode` and is exported from the package
- [ ] `RateLimiter` correctly implements token-bucket: tokens replenish over time, burst allows temporary spikes, queue drains FIFO
- [ ] `tryAcquire` is synchronous and non-blocking
- [ ] `acquire` returns a `Promise<void>` that waits for token availability
- [ ] `reset()`/`dispose()` clears timers and rejects pending waiters
- [ ] `parseRetryAfter` handles numeric seconds, HTTP-date, and edge cases
- [ ] `isRateLimitError` type guard works with both `RateLimitError` instances and generic `PipelineCoreError` with matching code
- [ ] All new symbols are exported from `runtime/index.ts` and the main `index.ts`
- [ ] Default constants are in `config/defaults.ts` and exported from the main `index.ts`
- [ ] All tests pass: `cd packages/pipeline-core && npx vitest run test/runtime/rate-limiter.test.ts`
- [ ] Existing tests still pass: `cd packages/pipeline-core && npx vitest run`
- [ ] No TypeScript compilation errors: `cd packages/pipeline-core && npx tsc --noEmit`

## Dependencies

- Depends on: 001
