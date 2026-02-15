---
status: pending
---

# 009: Extract hardcoded timeouts to config/defaults

## Summary

Centralise scattered hardcoded timeout and back-off constants into `config/defaults.ts` and replace magic numbers at each call-site with named imports. In the map-reduce executor, swap the hand-rolled linear back-off (`1000 * (attempt + 1)`) for the existing `calculateDelay()` from `runtime/retry.ts`. Document the SDK 120-second non-streaming constraint with a named constant. No behavioural changes — pure constant extraction and comment improvements.

## Motivation

Several timeout and back-off values are duplicated as magic numbers across `server-client.ts`, `executor.ts`, and `copilot-sdk-service.ts`. This makes tuning difficult, obscures intent, and risks inconsistency if a value is changed in one place but not another. Extracting them into `config/defaults.ts` — which already serves as the single source of truth for pipeline-core defaults — improves discoverability and prepares the ground for future user-configurable overrides.

## Changes

### Files to Create

_None._

### Files to Modify

1. **`packages/pipeline-core/src/config/defaults.ts`**
   - Add under a new `// HTTP / Network` section:
     ```ts
     /** Default HTTP request timeout for fire-and-forget clients (5 s). */
     export const DEFAULT_HTTP_REQUEST_TIMEOUT_MS = 5000;

     /** Maximum back-off cap for network retry loops (30 s). */
     export const DEFAULT_BACKOFF_CAP_MS = 30_000;
     ```
   - Add under the existing `// Timeouts` section:
     ```ts
     /**
      * SDK non-streaming timeout ceiling (120 s).
      * The Copilot SDK's sendAndWait has a hardcoded 120-second limit on the
      * session.idle event. Requests exceeding this are automatically promoted
      * to streaming mode in CopilotSDKService. Do NOT raise this value without
      * a corresponding SDK change.
      */
     export const DEFAULT_NON_STREAMING_TIMEOUT_MS = 120_000;
     ```

2. **`src/shortcuts/ai-service/server-client.ts`**
   - Import `DEFAULT_HTTP_REQUEST_TIMEOUT_MS` and `DEFAULT_BACKOFF_CAP_MS` from `pipeline-core` (or inline the constants if cross-package import is undesirable — check existing import patterns first).
   - Replace the literal `5000` in `httpRequest()` options (`timeout: 5000`) → `timeout: DEFAULT_HTTP_REQUEST_TIMEOUT_MS`.
   - Replace the literal `30_000` in the back-off cap (`Math.min(this.backoffMs * 2, 30_000)`) → `Math.min(this.backoffMs * 2, DEFAULT_BACKOFF_CAP_MS)`.

3. **`packages/pipeline-core/src/map-reduce/executor.ts`**
   - Import `calculateDelay` from `../runtime/retry` and `DEFAULT_RETRY_DELAY_MS` from `../config/defaults`.
   - In `executeMapItem`, replace `await this.delay(1000 * (attempt + 1))` (line 426) with:
     ```ts
     const delay = calculateDelay(attempt + 1, DEFAULT_RETRY_DELAY_MS, 'linear', DEFAULT_BACKOFF_CAP_MS);
     await this.delay(delay);
     ```
     This preserves the existing linear-ish behaviour (`1000 * (attempt + 1)` ≈ linear with base 1000) while using the shared utility.

4. **`packages/pipeline-core/src/copilot-sdk-wrapper/copilot-sdk-service.ts`**
   - Import `DEFAULT_NON_STREAMING_TIMEOUT_MS` from `../config/defaults`.
   - Replace the magic `120000` on line 608 with `DEFAULT_NON_STREAMING_TIMEOUT_MS`.
   - Enhance the existing inline comment to reference the named constant, e.g.:
     ```ts
     // Auto-promote to streaming when timeout exceeds DEFAULT_NON_STREAMING_TIMEOUT_MS
     // (SDK's sendAndWait has hardcoded 120s limit on session.idle)
     ```

### Files to Delete

_None._

## Implementation Notes

- `server-client.ts` lives in the VS Code extension (`src/shortcuts/`), not in `pipeline-core`. Verify whether the extension already imports from `pipeline-core` — if so, import the new constants from there. If not, define small local constants that mirror the values and add a `// Mirrors DEFAULT_HTTP_REQUEST_TIMEOUT_MS from pipeline-core` comment.
- The executor's current back-off formula `1000 * (attempt + 1)` with `attempt` starting at 0 yields delays 1000, 2000, 3000 … — this matches `calculateDelay` with strategy `'linear'`, base 1000, and attempt values 1, 2, 3 (since `calculateDelay` uses `baseDelayMs * attempt` for linear). Verify the mapping: executor `attempt=0` → `calculateDelay(attempt + 1, ...)` → `1000 * 1 = 1000`. ✓
- The `DEFAULT_BACKOFF_CAP_MS` value (30 000) already matches `DEFAULT_RETRY_OPTIONS.maxDelayMs` in `retry.ts`. The new constant in `defaults.ts` provides a single import point for non-retry contexts (like `server-client.ts`).
- Do not change the 120 s threshold behaviour in `copilot-sdk-service.ts`; only extract the magic number and add documentation.

## Tests

1. **`packages/pipeline-core/test/config/defaults.test.ts`** (new or existing):
   - Assert `DEFAULT_HTTP_REQUEST_TIMEOUT_MS === 5000`.
   - Assert `DEFAULT_BACKOFF_CAP_MS === 30_000`.
   - Assert `DEFAULT_NON_STREAMING_TIMEOUT_MS === 120_000`.

2. **`packages/pipeline-core/test/map-reduce/executor.test.ts`** (update existing):
   - Confirm retry delay in `executeMapItem` uses `calculateDelay` by verifying the delay pattern matches linear back-off (spy/stub `delay` and check values across retries).

3. **`src/test/suite/server-client.test.ts`** (update existing if present):
   - Verify HTTP requests use `DEFAULT_HTTP_REQUEST_TIMEOUT_MS` as the timeout value.
   - Verify back-off capping at `DEFAULT_BACKOFF_CAP_MS`.

## Acceptance Criteria

- [ ] No magic timeout/back-off numbers remain in the four modified files.
- [ ] `config/defaults.ts` exports `DEFAULT_HTTP_REQUEST_TIMEOUT_MS`, `DEFAULT_BACKOFF_CAP_MS`, and `DEFAULT_NON_STREAMING_TIMEOUT_MS`.
- [ ] The 120 000 ms constant in `copilot-sdk-service.ts` is replaced with the named import and an explanatory comment.
- [ ] The executor's retry delay uses `calculateDelay()` from `runtime/retry.ts`.
- [ ] All existing tests pass with no behavioural changes (same delay values, same timeout thresholds).
- [ ] New/updated tests verify the default values are correctly wired.

## Dependencies

- Depends on: 002
