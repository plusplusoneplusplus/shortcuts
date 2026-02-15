---
status: pending
---

# 001: Add transient/permanent error classification to PipelineCoreError

## Summary
Add an `ErrorSeverity` type (`'transient' | 'permanent' | 'unknown'`) and a `classifyError` utility that maps each `ErrorCode` to a severity, enabling retry logic to distinguish retryable errors from non-retryable ones. Wire the new `isTransientError` helper into the existing `defaultRetryOn` predicate.

## Motivation
This is the foundation commit for the 12-commit resilience series. Without classifying errors by severity, retry logic and future circuit-breaker code cannot distinguish between retryable failures (network timeout, 503, pool exhaustion) and non-retryable ones (auth failure, malformed CSV, invalid template). Separating this commit isolates the type-level and classification changes from all downstream consumers, making each subsequent commit smaller and independently reviewable.

## Changes

### Files to Create
- (none)

### Files to Modify
- `packages/pipeline-core/src/errors/error-codes.ts` — Add `ErrorSeverity` type literal union. Add `ERROR_SEVERITY_MAP` constant mapping every `ErrorCode` value to its severity. Export `classifyError(error): ErrorSeverity` and `isTransientError(error): boolean` helpers.
- `packages/pipeline-core/src/errors/pipeline-core-error.ts` — Add optional `severity?: ErrorSeverity` field to the `ErrorMetadata` interface. Add optional readonly `severity?: ErrorSeverity` property to `PipelineCoreError` (auto-populated from `classifyError` in the constructor when not explicitly provided). Include `severity` in `toDetailedString()` output and `toJSON()` serialization.
- `packages/pipeline-core/src/errors/index.ts` — Re-export `ErrorSeverity`, `classifyError`, and `isTransientError` from the errors barrel.
- `packages/pipeline-core/src/runtime/retry.ts` — Update `defaultRetryOn` to call `isTransientError` for `PipelineCoreError` instances: if the error is a `PipelineCoreError`, return `isTransientError(error)` instead of unconditional `true`. Non-`PipelineCoreError` errors continue to return `true` (preserving backward compatibility for unknown errors).
- `packages/pipeline-core/test/errors/pipeline-core-error.test.ts` — Add test suites for `classifyError`, `isTransientError`, severity on `PipelineCoreError`, and the updated `defaultRetryOn` behavior.

### Files to Delete
- (none)

## Implementation Notes
- `ERROR_SEVERITY_MAP` should be a `Record<ErrorCodeType, ErrorSeverity>` keyed by every value in the `ErrorCode` const object so that adding a new code without a mapping produces a compile-time error.
- Classification of each code:
  - **Transient:** `TIMEOUT`, `AI_INVOCATION_FAILED`, `AI_POOL_EXHAUSTED`, `FILE_SYSTEM_ERROR`, `QUEUE_TASK_TIMEOUT`, `QUEUE_TASK_FAILED`, `MAP_REDUCE_MAP_FAILED`
  - **Permanent:** `CSV_PARSE_ERROR`, `TEMPLATE_ERROR`, `MISSING_VARIABLE`, `PERMISSION_DENIED`, `PIPELINE_INPUT_INVALID`, `PIPELINE_CONFIG_INVALID`, `AI_RESPONSE_PARSE_FAILED`, `PROMPT_RESOLUTION_FAILED`, `SKILL_RESOLUTION_FAILED`, `FILE_NOT_FOUND`
  - **Unknown:** `UNKNOWN`, `CANCELLED`, `RETRY_EXHAUSTED`, `PIPELINE_EXECUTION_FAILED`, `PIPELINE_FILTER_FAILED`, `MAP_REDUCE_SPLIT_FAILED`, `MAP_REDUCE_REDUCE_FAILED`, `QUEUE_NOT_RUNNING`, `INPUT_GENERATION_FAILED`
- `classifyError` should accept `unknown` and handle: (a) `PipelineCoreError` → look up `error.code`; (b) Node.js `ErrnoException` → call `mapSystemErrorCode` first then look up; (c) anything else → `'unknown'`.
- `isTransientError(error)` is simply `classifyError(error) === 'transient'`.
- The `PipelineCoreError` constructor change is additive (optional property, defaults via `classifyError(this)`), so all existing call sites remain valid.
- `CANCELLED` is classified as `'unknown'` (not transient) because cancellation is already handled separately by `isCancellationError` in retry predicates; it must never be retried.
- The `defaultRetryOn` change narrows retries for `PipelineCoreError` instances only. Plain `Error` objects and other types still return `true` to avoid breaking callers that throw non-pipeline errors.

## Tests
- `classifyError` returns `'transient'` for each transient error code (TIMEOUT, AI_INVOCATION_FAILED, AI_POOL_EXHAUSTED, FILE_SYSTEM_ERROR, QUEUE_TASK_TIMEOUT, QUEUE_TASK_FAILED, MAP_REDUCE_MAP_FAILED)
- `classifyError` returns `'permanent'` for each permanent error code (CSV_PARSE_ERROR, TEMPLATE_ERROR, MISSING_VARIABLE, PERMISSION_DENIED, PIPELINE_INPUT_INVALID, PIPELINE_CONFIG_INVALID, AI_RESPONSE_PARSE_FAILED, PROMPT_RESOLUTION_FAILED, SKILL_RESOLUTION_FAILED, FILE_NOT_FOUND)
- `classifyError` returns `'unknown'` for UNKNOWN, CANCELLED, RETRY_EXHAUSTED, and composite codes
- `classifyError` returns `'unknown'` for plain `Error`, string, null, and undefined inputs
- `classifyError` maps Node.js `ErrnoException` (e.g., ETIMEDOUT → transient, EACCES → permanent)
- `isTransientError` returns `true` only for transient-classified errors
- `PipelineCoreError` constructor auto-populates `severity` from code when not explicitly set
- `PipelineCoreError.severity` can be overridden via `meta.severity`
- `toDetailedString()` includes severity in output
- `toJSON()` includes severity field
- `defaultRetryOn` returns `true` for transient `PipelineCoreError`
- `defaultRetryOn` returns `false` for permanent `PipelineCoreError`
- `defaultRetryOn` returns `false` for cancelled errors (existing behavior preserved)
- `defaultRetryOn` returns `true` for plain `Error` (backward compatibility)

## Acceptance Criteria
- [ ] `ErrorSeverity` type is exported from `packages/pipeline-core/src/errors/index.ts`
- [ ] `classifyError` and `isTransientError` are exported from the errors barrel
- [ ] Every value in `ErrorCode` has a mapping in `ERROR_SEVERITY_MAP` (enforced by `Record<ErrorCodeType, ErrorSeverity>`)
- [ ] `PipelineCoreError` instances expose a readonly `severity` property
- [ ] `defaultRetryOn` no longer retries permanent `PipelineCoreError` instances
- [ ] `defaultRetryOn` still retries plain `Error` objects (no breaking change)
- [ ] All existing tests in `pipeline-core-error.test.ts` continue to pass
- [ ] New classification tests pass for every error code
- [ ] `npm run test:run` in `packages/pipeline-core/` passes with zero failures

## Dependencies
- Depends on: None
