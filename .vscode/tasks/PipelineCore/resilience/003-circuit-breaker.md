---
status: pending
---

# 003: Add circuit breaker runtime primitive

## Summary

Add a `CircuitBreaker` class to `packages/pipeline-core/src/runtime/` that prevents repeated calls to a failing downstream service. The breaker tracks consecutive failures and, once a threshold is reached, short-circuits execution by throwing a `CircuitBreakerError` (`CIRCUIT_OPEN`) without invoking the wrapped function. After a configurable reset timeout the breaker transitions to half-open, allowing a limited number of probe attempts before fully closing or re-opening.

## Motivation

AI SDK calls, HTTP requests, and session-pool acquisitions can all target services that go down for sustained periods. Without a circuit breaker, every caller pays the full timeout/retry cost only to receive the same failure. A breaker that opens after N consecutive failures gives the downstream time to recover, reduces wasted resources, and provides an explicit signal (`CIRCUIT_OPEN` error code) that callers can handle distinctly from transient errors. This primitive must exist before commit 004+ can integrate it into `PolicyOptions`, `CopilotSDKService`, and `ServerClient`.

## Changes

### Files to Create

1. **`packages/pipeline-core/src/runtime/circuit-breaker.ts`**

   - `CircuitBreakerState` type — `'closed' | 'open' | 'half-open'`
   - `CircuitBreakerStats` interface — `{ state, failures, successes, totalRequests, lastFailureTime? }`
   - `CircuitBreakerOptions` interface:
     ```
     failureThreshold: number      // consecutive failures before opening (default 5)
     resetTimeoutMs: number        // ms to wait before half-open probe (default 30 000)
     halfOpenMaxAttempts: number   // successes needed to close again (default 1)
     onStateChange?: (from, to) => void
     ```
   - `CircuitBreakerError` class extending `PipelineCoreError` with code `ErrorCode.CIRCUIT_OPEN`. Constructor accepts `message`, optional `cause`, optional `ErrorMetadata`. Sets `this.name = 'CircuitBreakerError'`. Follow the exact pattern of `RetryExhaustedError` and `TimeoutError`.
   - `CircuitBreaker` class:
     - Private fields: `state`, `consecutiveFailures`, `consecutiveSuccesses`, `lastFailureTime`, `totalRequests`, `options` (merged with defaults).
     - `execute<T>(fn: () => Promise<T>): Promise<T>` — core method:
       - **closed**: run `fn`; on success reset failure count; on failure increment count and open if threshold reached.
       - **open**: check elapsed time vs `resetTimeoutMs`; if expired transition to half-open and fall through, otherwise throw `CircuitBreakerError`.
       - **half-open**: run `fn`; on success increment success count, close if `halfOpenMaxAttempts` reached; on failure re-open immediately.
     - `getState(): CircuitBreakerState`
     - `getStats(): CircuitBreakerStats`
     - `reset(): void` — force back to closed, zero counters.
     - All state transitions call `onStateChange` when provided.
   - `isCircuitBreakerError(error): error is CircuitBreakerError` type guard — check `instanceof` and fallback to `error.code === ErrorCode.CIRCUIT_OPEN` (same pattern as `isRetryExhaustedError`).
   - `createCircuitBreaker(options?): CircuitBreaker` factory function.

2. **`packages/pipeline-core/test/runtime/circuit-breaker.test.ts`**

   Vitest test file. See [Tests](#tests) section below.

### Files to Modify

1. **`packages/pipeline-core/src/errors/error-codes.ts`**
   - Add `CIRCUIT_OPEN: 'CIRCUIT_OPEN'` to the Control Flow section of `ErrorCode`, after `RETRY_EXHAUSTED`.
   - Update the JSDoc category list in the file header to include `CIRCUIT_OPEN`.

2. **`packages/pipeline-core/src/runtime/index.ts`**
   - Add a `// Circuit Breaker` export block re-exporting:
     `CircuitBreakerState`, `CircuitBreakerStats`, `CircuitBreakerOptions`, `CircuitBreakerError`, `CircuitBreaker`, `isCircuitBreakerError`, `createCircuitBreaker`.

3. **`packages/pipeline-core/src/index.ts`**
   - Add `CircuitBreakerState`, `CircuitBreakerStats`, `CircuitBreakerOptions`, `CircuitBreakerError`, `CircuitBreaker`, `isCircuitBreakerError`, `createCircuitBreaker` to the Runtime re-export block (lines 68-98).

4. **`packages/pipeline-core/src/runtime/policy.ts`** *(optional, minimal touch)*
   - Add `circuitBreaker?: CircuitBreaker` to `PolicyOptions`.
   - In `runWithPolicy`, if `circuitBreaker` is provided, wrap the innermost execution (`fn` or timeout-wrapped `fn`) with `circuitBreaker.execute(...)` so the breaker sits inside retry but outside timeout. This keeps the change additive — when `circuitBreaker` is omitted, behaviour is identical.
   - Update `createPolicyRunner` to pass `circuitBreaker` through.

### Files to Delete

None.

## Implementation Notes

- **State machine correctness**: The breaker has exactly three states with well-defined transitions: closed→open (threshold reached), open→half-open (reset timeout elapsed), half-open→closed (probe succeeded), half-open→open (probe failed). No other transitions are valid.
- **No timers**: Use `Date.now()` comparison in `execute()` rather than `setTimeout` to avoid dangling timers and simplify testing with `vi.useFakeTimers()`.
- **Thread safety not required**: Node.js is single-threaded; no mutex is needed. Concurrent `execute()` calls in half-open state may allow multiple probes — this is acceptable and matches standard JS circuit breaker implementations.
- **Error wrapping**: `CircuitBreakerError` should carry the state and failure count in `meta` (e.g., `{ state: 'open', failures: 5 }`) so callers can inspect without parsing messages.
- **Default values**: Provide a `DEFAULT_CIRCUIT_BREAKER_OPTIONS` constant (like `DEFAULT_RETRY_OPTIONS`) and export it.
- **Integration with policy.ts**: The circuit breaker wraps inside retry so that a `CIRCUIT_OPEN` rejection counts as a retryable failure. The default `retryOn` function should **not** retry circuit-open errors (add `isCircuitBreakerError` check to `defaultRetryOn` in retry.ts, or document that callers should configure `retryOn` accordingly). Prefer adding to `defaultRetryOn` to keep the default safe.

## Tests

**File:** `packages/pipeline-core/test/runtime/circuit-breaker.test.ts`

Test groups (mirroring the structure in `policy.test.ts`):

1. **CircuitBreakerError**
   - Creates error with correct code (`CIRCUIT_OPEN`), name, message, cause, meta.
   - `isCircuitBreakerError` returns true for instances and for `PipelineCoreError` with matching code.
   - `isCircuitBreakerError` returns false for unrelated errors.

2. **CircuitBreaker — closed state**
   - Successful calls pass through and return result.
   - Failures below threshold keep state closed.
   - Reaching `failureThreshold` transitions to open; verifies `onStateChange` callback fires with `('closed', 'open')`.

3. **CircuitBreaker — open state**
   - Calls immediately throw `CircuitBreakerError` without invoking `fn`.
   - Error metadata includes `{ state: 'open' }`.

4. **CircuitBreaker — half-open state**
   - After `resetTimeoutMs` elapses (use `vi.useFakeTimers` + `vi.advanceTimersByTime`), next call transitions to half-open.
   - Successful probe(s) close the breaker; verifies `onStateChange('half-open', 'closed')`.
   - Failed probe re-opens the breaker immediately; verifies `onStateChange('half-open', 'open')`.

5. **CircuitBreaker — reset()**
   - Calling `reset()` from any state returns to closed with zeroed counters.

6. **CircuitBreaker — getStats()**
   - Returns correct `state`, `failures`, `successes`, `totalRequests`, `lastFailureTime` after a sequence of calls.

7. **createCircuitBreaker factory**
   - Returns a working `CircuitBreaker` instance with default options.
   - Accepts partial overrides.

8. **Policy integration** *(if policy.ts is modified)*
   - `runWithPolicy` with `circuitBreaker` option wraps execution.
   - Open circuit short-circuits without invoking `fn`.
   - Retry + circuit breaker: breaker opens after threshold, retry receives `CircuitBreakerError`.

**Run command:** `cd packages/pipeline-core && npx vitest run test/runtime/circuit-breaker.test.ts`

## Acceptance Criteria

- [ ] `CIRCUIT_OPEN` exists in `ErrorCode` and `ErrorCodeType` includes it.
- [ ] `CircuitBreaker` class implements the three-state machine (closed → open → half-open → closed/open).
- [ ] `execute()` throws `CircuitBreakerError` when open without calling the wrapped function.
- [ ] `execute()` transitions to half-open after `resetTimeoutMs` and allows a probe.
- [ ] `onStateChange` callback fires on every state transition with correct from/to values.
- [ ] `reset()` returns breaker to closed state and zeroes all counters.
- [ ] `getStats()` returns accurate statistics.
- [ ] `isCircuitBreakerError` type guard works for direct instances and code-matched errors.
- [ ] All new symbols are re-exported from `runtime/index.ts` and the package root `index.ts`.
- [ ] All new tests pass: `cd packages/pipeline-core && npx vitest run test/runtime/circuit-breaker.test.ts`.
- [ ] Existing tests remain green: `cd packages/pipeline-core && npx vitest run`.
- [ ] No regressions in the extension build: `npm run compile` at repo root.

## Dependencies

- Depends on: 001
