---
status: done
---

# 001: Add `onToolEvent` to `AIInvokerOptions` and forward in `createCLIAIInvoker`

## Summary
Add the `onToolEvent` callback to the `AIInvokerOptions` interface in `pipeline-core` and thread it through to `SendMessageOptions` inside `createCLIAIInvoker` in the CoC package. Without this plumbing, any `onToolEvent` handler injected by `withToolCallCache` is silently dropped before reaching the SDK.

## Motivation
`withToolCallCache` (in `packages/pipeline-core/src/memory/with-tool-call-cache.ts`) already constructs an `AIInvokerOptionsWithToolEvent` — a local interface that extends `AIInvokerOptions` with `onToolEvent` — and merges a capture handler onto it before calling `aiInvoker(prompt, mergedOptions)`. However, because `AIInvokerOptions` itself has no `onToolEvent` field, `createCLIAIInvoker` never reads the field when building `SendMessageOptions`. The callback is present on the options object at runtime but ignored. This commit is the prerequisite that makes the field a first-class part of the shared type so the forwarding code can be added with type safety.

## Changes

### Files to Create
- (none)

### Files to Modify

- `packages/pipeline-core/src/map-reduce/types.ts` — Add `onToolEvent?: (event: ToolEvent) => void` to `AIInvokerOptions` (around line 307, after the existing `tools?` field). Import `ToolEvent` using the same inline `import(...)` pattern already used for `Tool` on line 307: `import('../copilot-sdk-wrapper/types').ToolEvent`.

- `packages/coc/src/ai-invoker.ts` — In the `sendOptions` object inside `createCLIAIInvoker` (around line 103–115), add `onToolEvent: invokerOptions?.onToolEvent` alongside the other forwarded fields. No new imports are required; `SendMessageOptions` already declares `onToolEvent` and `AIInvokerOptions` will declare it after the `types.ts` change above.

### Files to Delete
- (none)

## Implementation Notes

**Import pattern in `AIInvokerOptions`:** The `tools` field on line 307 of `types.ts` uses an inline type import to avoid a top-level import:
```ts
tools?: import('../copilot-sdk-wrapper/types').Tool<any>[];
```
Add `onToolEvent` immediately after, using the same pattern:
```ts
onToolEvent?: (event: import('../copilot-sdk-wrapper/types').ToolEvent) => void;
```
This keeps `types.ts` free of top-level imports from sibling modules and matches the established convention.

**Forwarding in `createCLIAIInvoker`:** The `sendOptions` object in `ai-invoker.ts` already forwards `tools` from `invokerOptions` (line 114). The pattern is symmetric — add one more line:
```ts
onToolEvent: invokerOptions?.onToolEvent,
```
Note that `CLIAIInvokerOptions` does **not** need an `onToolEvent` field in this commit — it is per-call state that callers pass through `AIInvokerOptions`, not a factory-level option. The field originates from `invokerOptions` (the per-call `AIInvokerOptions`), not from the `options` factory parameter.

**`AIInvokerOptionsWithToolEvent` in `with-tool-call-cache.ts`:** After this commit, `AIInvokerOptions` will contain `onToolEvent`, making the local `AIInvokerOptionsWithToolEvent` interface redundant. The follow-on commit that wires `withToolCallCache` into the pipeline can remove that local interface and use `AIInvokerOptions` directly. Do **not** remove it in this commit to keep the diff minimal and the commits atomic.

## Tests

**Existing coverage:** `packages/coc/test/ai-invoker.test.ts` already has a pattern (`mockSendMessageCapture`) that intercepts the `SendMessageOptions` passed to the mocked `service.sendMessage`. The `mcpServers and loadDefaultMcpConfig` describe block (lines 160–216) demonstrates exactly this approach: create an invoker, call it, inspect `mockSendMessageCapture.mock.calls[0][0]`. No new mocking infrastructure is needed.

**New tests to add** in `packages/coc/test/ai-invoker.test.ts`, inside a new `describe` block (e.g. `onToolEvent forwarding`):

1. **`should forward onToolEvent from invokerOptions to SendMessageOptions`**  
   Create `const handler = vi.fn()`, call `invoker('prompt', { onToolEvent: handler })`, assert `sendOptions.onToolEvent === handler`.

2. **`should pass onToolEvent: undefined to SendMessageOptions when not provided`**  
   Call `invoker('prompt')` with no `invokerOptions`, assert `sendOptions.onToolEvent` is `undefined`.

3. **`should forward onToolEvent when other invokerOptions fields are also set`**  
   Call `invoker('prompt', { model: 'gpt-4', onToolEvent: handler })`, assert both `sendOptions.model` and `sendOptions.onToolEvent` are forwarded correctly.

There are no existing tests in `pipeline-core` for `AIInvokerOptions` itself (it is a plain interface), so no test changes are needed there.

## Acceptance Criteria
- [ ] `AIInvokerOptions` in `packages/pipeline-core/src/map-reduce/types.ts` contains `onToolEvent?: (event: import('../copilot-sdk-wrapper/types').ToolEvent) => void`
- [ ] `createCLIAIInvoker` passes `invokerOptions?.onToolEvent` into the `SendMessageOptions` object
- [ ] TypeScript build (`npm run build`) passes with no new errors
- [ ] New tests in `packages/coc/test/ai-invoker.test.ts` confirm `onToolEvent` is forwarded (or absent) in `SendMessageOptions` for the three cases above
- [ ] All existing tests in `packages/coc/test/ai-invoker.test.ts` continue to pass
- [ ] `with-tool-call-cache.ts` compiles without changes (its local `AIInvokerOptionsWithToolEvent` remains valid since it adds a field that now already exists on the base — TypeScript allows duplicate-compatible declarations)

## Dependencies
- Depends on: None

## Assumed Prior State
None — this is the first commit in the series. The following files exist at their current state:
- `packages/pipeline-core/src/map-reduce/types.ts`: `AIInvokerOptions` has `model`, `workingDirectory`, `timeoutMs`, and `tools` but no `onToolEvent`.
- `packages/coc/src/ai-invoker.ts`: `sendOptions` in `createCLIAIInvoker` forwards `model`, `workingDirectory`, `timeoutMs`, `onPermissionRequest`, `loadDefaultMcpConfig`, `mcpServers`, `onStreamingChunk`, and `tools` — but not `onToolEvent`.
- `packages/pipeline-core/src/memory/with-tool-call-cache.ts`: defines a local `AIInvokerOptionsWithToolEvent` workaround interface at line 42 to carry `onToolEvent`.
