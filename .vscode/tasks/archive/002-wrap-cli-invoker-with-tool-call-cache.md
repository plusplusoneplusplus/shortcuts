---
status: pending
---

# 002: Install `ToolCallCapture` in `createCLIAIInvoker` (capture only, no auto-aggregation)

## Summary
Wire `ToolCallCapture` directly into the `AIInvoker` returned by `createCLIAIInvoker` so that every AI call made via `coc run` or the server queue pipeline executor automatically captures tool-call Q&A pairs to `FileToolCallCacheStore` at `~/.coc/memory/explore-cache/raw/`. Aggregation is intentionally **not** triggered automatically — raw entries accumulate on disk and are consolidated on demand via a separate batch endpoint (planned in commit 005).

## Motivation
This is the actual wiring commit. Commit 001 threads `onToolEvent` through the options chain. This commit installs `ToolCallCapture` at the factory level, giving all consumers (`coc run`, `queue-executor-bridge`) automatic capture for free. We use `ToolCallCapture` directly rather than `withToolCallCache` because `withToolCallCache` always triggers AI-powered aggregation after each call — the user prefers raw entries to accumulate and be batch-processed on demand instead.

## Changes

### Files to Create
- (none)

### Files to Modify
- `packages/coc/src/ai-invoker.ts` — add `cacheDataDir` and `gitHash` fields to `CLIAIInvokerOptions`; import `ToolCallCapture`, `FileToolCallCacheStore`, `EXPLORE_FILTER` from `@plusplusoneplusplus/pipeline-core`; install capture handler in the returned invoker before calling through to the inner invoker

### Files to Delete
- (none)

## Implementation Notes

### New fields on `CLIAIInvokerOptions`
```ts
/** Override for the cache store data dir; defaults to ~/.coc/memory */
cacheDataDir?: string;
/** Current git HEAD hash for staleness tracking; optional — cache still works without it */
gitHash?: string;
```

### Imports to add
Add to the existing import from `@plusplusoneplusplus/pipeline-core`:
```ts
import {
    ToolCallCapture,
    FileToolCallCacheStore,
    EXPLORE_FILTER,
} from '@plusplusoneplusplus/pipeline-core';
```

### Wrapping logic (inside `createCLIAIInvoker`, replace `return invoker;`)
```ts
const store = new FileToolCallCacheStore(
    options.cacheDataDir ? { dataDir: options.cacheDataDir } : undefined
);
const capture = new ToolCallCapture(store, EXPLORE_FILTER, {
    gitHash: options.gitHash,
});
const captureHandler = capture.createToolEventHandler();

return (prompt: string, invokerOptions?: AIInvokerOptions): Promise<AIInvokerResult> => {
    const mergedOptions: AIInvokerOptions = {
        ...invokerOptions,
        onToolEvent: invokerOptions?.onToolEvent
            ? (event) => { invokerOptions.onToolEvent!(event); captureHandler(event); }
            : captureHandler,
    };
    return invoker(prompt, mergedOptions);
};
```

**No aggregation is called anywhere in this flow.** Raw files accumulate in `<dataDir>/explore-cache/raw/` until a batch endpoint (commit 005) processes them.

## Tests

`packages/coc/test/ai-invoker.test.ts` already exists with a `vi.mock` for `@plusplusoneplusplus/pipeline-core`. Add a new `describe` block for capture wiring:

1. **`ToolCallCapture` is instantiated once per factory call** — spy on `ToolCallCapture` constructor; call `createCLIAIInvoker()` twice; assert constructor called exactly twice.

2. **explore tool-complete event writes a raw file** — pass `cacheDataDir` pointing to a temp dir; invoke the invoker; simulate a `tool-complete` event for `toolName: 'grep'` via the `onToolEvent` captured from `sendMessage`'s `SendMessageOptions`; assert a `.json` file exists under `<tempDir>/explore-cache/raw/`.

3. **non-explore tool events are NOT written** — same setup but emit `toolName: 'edit_file'`; assert no `.json` file is created.

4. **caller-supplied `onToolEvent` is also called** — pass a spy as `invokerOptions.onToolEvent`; emit a tool event; assert the spy was called AND a raw file was written.

5. **`createDryRunAIInvoker` has no capture** — assert `ToolCallCapture` constructor is not called.

6. **`gitHash` forwarded to `ToolCallCapture`** — assert constructor's options arg has `gitHash` matching what was passed to `createCLIAIInvoker`.

## Acceptance Criteria
- [ ] `CLIAIInvokerOptions` has `cacheDataDir?: string` and `gitHash?: string`
- [ ] `createCLIAIInvoker` constructs a `FileToolCallCacheStore` and a `ToolCallCapture` once at factory time
- [ ] The returned invoker merges the capture handler into `onToolEvent` before calling through to the inner invoker
- [ ] No aggregation is triggered anywhere in this code path
- [ ] `createDryRunAIInvoker` is unchanged (no capture)
- [ ] Triggering a `grep` tool-complete event causes a JSON file to appear under `<cacheDataDir>/explore-cache/raw/`
- [ ] All existing `ai-invoker.test.ts` tests continue to pass

## Dependencies
- Depends on: **001** (adds `onToolEvent` to `AIInvokerOptions` and forwards it through `sendOptions` in `createCLIAIInvoker`)

## Assumed Prior State
- `AIInvokerOptions` (in `pipeline-core`) has `onToolEvent?: (event: ToolEvent) => void`
- `createCLIAIInvoker`'s internal `sendOptions` includes `onToolEvent: invokerOptions?.onToolEvent`
- `ToolCallCapture`, `FileToolCallCacheStore`, and `EXPLORE_FILTER` are all exported from `@plusplusoneplusplus/pipeline-core`
- `FileToolCallCacheStore` defaults `dataDir` to `~/.coc/memory` and `cacheSubDir` to `'explore-cache'`
