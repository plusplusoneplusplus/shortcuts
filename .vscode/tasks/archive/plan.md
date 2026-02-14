# Plan: Surface Token Usage Data in pipeline-core

## Problem

The `@github/copilot-sdk` fires two token usage events (`assistant.usage` and `session.usage_info`) with rich data including input/output tokens, cache tokens, cost, duration, and quota info. The `CopilotSDKService` in `pipeline-core` completely ignores these events — the data is streamed from the SDK but silently discarded.

## Approach

Surface token usage data in `pipeline-core`'s `CopilotSDKService` by:
1. Defining a `TokenUsage` type
2. Capturing both `assistant.usage` and `session.usage_info` events
3. Aggregating token data across all turns within a single request
4. Exposing the aggregated result on `SDKInvocationResult`

Consumers (extension, pipeline-cli, deep-wiki) can then decide how to display or use the data.

## Scope

- **In scope:** `packages/pipeline-core` only — types, SDK service, and tests
- **Out of scope:** Extension UI, pipeline-cli display, deep-wiki display

## Todos

### 1. Define TokenUsage types
- File: `packages/pipeline-core/src/ai/copilot-sdk-service.ts` (or a new types file if cleaner)
- Add `TokenUsage` interface:
  ```typescript
  export interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;       // inputTokens + outputTokens
    cost?: number;             // sum of cost across turns
    duration?: number;         // sum of duration across turns
    turnCount: number;         // number of assistant.usage events received
    // From session.usage_info (last seen values)
    tokenLimit?: number;
    currentTokens?: number;
  }
  ```
- Add `tokenUsage?: TokenUsage` field to `SDKInvocationResult`

### 2. Capture `assistant.usage` events in streaming path
- File: `packages/pipeline-core/src/ai/copilot-sdk-service.ts`
- In `sendWithStreaming()`, add a `case 'assistant.usage'` handler
- Accumulate inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, cost, duration
- Increment turnCount

### 3. Capture `session.usage_info` events in streaming path
- Same file, same method
- In `sendWithStreaming()`, add a `case 'session.usage_info'` handler
- Store latest `tokenLimit` and `currentTokens`

### 4. Attach aggregated TokenUsage to the result
- After streaming completes, compute `totalTokens = inputTokens + outputTokens`
- Attach the `TokenUsage` object to the returned `SDKInvocationResult`

### 5. Handle non-streaming path (`sendWithTimeout`)
- The `sendAndWait()` API may not surface events the same way
- Investigate if usage events fire during `sendAndWait()` — if not, `tokenUsage` will be `undefined` for non-streaming calls (acceptable)
- If events are available, capture them similarly

### 6. Export TokenUsage from package public API
- Ensure `TokenUsage` is exported from `packages/pipeline-core/src/ai/index.ts`
- Verify it's accessible to consumers via the package

### 7. Add tests
- File: `packages/pipeline-core/test/ai/` (new or existing test file)
- Test token usage aggregation logic across multiple turns
- Test that TokenUsage fields are correctly accumulated
- Test that `session.usage_info` values are captured (last-seen)
- Test that `totalTokens` = `inputTokens + outputTokens`

## Notes

- The `assistant.usage` event fires per-turn; a single `sendMessage()` call can have multiple turns
- `session.usage_info` reports running totals for the session; we capture last-seen values
- Token usage is optional (`tokenUsage?: TokenUsage`) — if no events fire, it's undefined
- No breaking changes to existing interfaces (additive only)
