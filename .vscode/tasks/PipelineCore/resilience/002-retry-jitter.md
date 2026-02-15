---
status: pending
---

# 002: Add jitter support to retry backoff calculations

## Summary

Add configurable jitter to `calculateDelay()` in the retry module so that concurrent operations don't all retry at exactly the same instant. Expose a `jitter` option on `RetryOptions` (and propagate through `PolicyOptions`), default it to `true` (±20%), and replace the ad-hoc linear backoff in `MapReduceExecutor` with a call to the shared `calculateDelay()`.

## Motivation

When many parallel map-reduce items fail simultaneously (e.g. rate-limit 429s from an AI provider), deterministic backoff causes a **thundering herd**: every retry fires at the same millisecond, overwhelming the downstream service again. Adding randomized jitter spreads retries across a time window and dramatically reduces collision probability. This is a well-established reliability pattern (see AWS Architecture Blog — "Exponential Backoff and Jitter").

The map-reduce executor at line 426 also has its own hand-rolled linear backoff (`1000 * (attempt + 1)`) that diverges from the centralized retry module. Consolidating it onto `calculateDelay()` removes duplication and ensures jitter applies everywhere.

## Changes

### Files to Create

_None._

### Files to Modify

1. **`packages/pipeline-core/src/runtime/retry.ts`**
   - Add `jitter` field to `RetryOptions` interface:
     ```ts
     /** Jitter to apply to backoff delay. true = ±20% (default), number = explicit factor 0-1, false = none */
     jitter?: boolean | number;
     ```
   - Add `jitter: true` to `DEFAULT_RETRY_OPTIONS`.
   - Extend `calculateDelay()` signature with an optional `jitterFactor` parameter (default `0`).
   - After computing the base delay and capping at `maxDelayMs`, apply jitter:
     ```ts
     if (jitterFactor > 0) {
         delay = delay * (1 + (Math.random() * 2 - 1) * jitterFactor);
         delay = Math.max(0, delay); // never negative
     }
     ```
   - In `withRetry()`, resolve the jitter option to a numeric factor (`true` → `0.2`, `false`/`undefined` → `0`, number → clamp to `[0, 1]`) and pass it through to `calculateDelay()`.

2. **`packages/pipeline-core/src/runtime/policy.ts`**
   - Add `jitter` field to `PolicyOptions`:
     ```ts
     /** Jitter for retry backoff. true = ±20%, number = explicit factor 0-1. Default: true */
     jitter?: boolean | number;
     ```
   - Forward `jitter` into the `RetryOptions` object built inside `runWithPolicy()`.
   - Add `jitter: true` to `DEFAULT_POLICY_OPTIONS`.

3. **`packages/pipeline-core/src/runtime/index.ts`**
   - No new exports needed — `RetryOptions` and `calculateDelay` are already exported.

4. **`packages/pipeline-core/src/map-reduce/executor.ts`**
   - Import `calculateDelay` from `'../runtime/retry'`.
   - Replace the ad-hoc backoff at line ~426:
     ```diff
     - await this.delay(1000 * (attempt + 1));
     + await this.delay(calculateDelay(attempt + 1, 1000, 'linear', 30000, 0.2));
     ```
     This preserves the existing linear growth while adding ±20% jitter and a 30 s cap.

5. **`packages/pipeline-core/test/runtime/policy.test.ts`**
   - Add new `describe('calculateDelay with jitter', ...)` block with statistical tests.
   - Add jitter-related tests for `withRetry` and `runWithPolicy`.

### Files to Delete

_None._

## Implementation Notes

- `Math.random()` is sufficient here — cryptographic randomness is unnecessary for backoff jitter.
- The jitter is applied **after** the `maxDelayMs` cap, meaning the actual delay can slightly exceed `maxDelayMs` (by up to `maxDelayMs * jitterFactor`). This is intentional: capping again would skew the distribution for delays near the maximum and reduce the jitter's effectiveness at preventing thundering herd.
- The `jitter` parameter on `calculateDelay()` is added as a trailing optional argument (default `0`) so all existing call-sites and tests remain valid without changes.
- The executor change is intentionally minimal: only the delay expression changes, keeping the surrounding retry-loop structure untouched.

## Tests

1. **`calculateDelay` jitter range** — Call `calculateDelay(2, 1000, 'exponential', 30000, 0.2)` 200 times. Assert every result is within `[base * 0.8, base * 1.2]` where `base = 2000`.
2. **`calculateDelay` jitter=0 unchanged** — Verify `calculateDelay()` with `jitterFactor=0` returns deterministic values identical to current behavior.
3. **`calculateDelay` jitter distribution** — Over 500 runs, assert the mean is within ±5% of the base delay (ensures jitter is centered, not biased).
4. **`withRetry` resolves jitter option** — `jitter: true` → 0.2 factor, `jitter: 0.5` → 0.5 factor, `jitter: false` → deterministic. Mock `Math.random` to verify exact delay values.
5. **`runWithPolicy` forwards jitter** — Verify `PolicyOptions.jitter` is passed through to `withRetry`.
6. **Executor uses calculateDelay** — Verify the executor import change doesn't break existing map-reduce executor tests (run existing test suite).
7. **Jitter factor clamping** — Values > 1 are clamped to 1, values < 0 are clamped to 0.

## Acceptance Criteria

- [ ] `RetryOptions.jitter` accepts `boolean | number`; defaults to `true` in `DEFAULT_RETRY_OPTIONS`.
- [ ] `calculateDelay()` with `jitterFactor > 0` returns values within the expected `[delay*(1-f), delay*(1+f)]` range.
- [ ] `calculateDelay()` with `jitterFactor = 0` (or omitted) returns identical results to the current implementation (backward-compatible).
- [ ] `PolicyOptions` exposes `jitter` and forwards it to `withRetry`.
- [ ] The ad-hoc backoff in `MapReduceExecutor.executeMapItem` uses `calculateDelay()` instead of `1000 * (attempt + 1)`.
- [ ] All existing tests in `policy.test.ts` continue to pass.
- [ ] New statistical jitter tests pass reliably (no flaky failures).
- [ ] `npm run test:run` in `packages/pipeline-core/` passes.

## Dependencies

- Depends on: None
