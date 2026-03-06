---
status: done
---

# 003: Thread Attachments Through AI Invoker

## Summary

Extend the `AIInvoker` type and `createAIInvoker` factory in the VS Code extension layer to accept and forward optional attachments to `sdkService.sendMessage()`, enabling callers to pass images (or other file references) through the unified invoker interface.

## Motivation

Commits 001–002 added `attachments` to `SendMessageOptions` and wired forwarding inside `CopilotSDKService`. However, the VS Code-side `AIInvoker` type (`(prompt, {model?}) → Promise`) has no attachment parameter, so callers cannot pass attachments through the standard invoker factory. This commit is the bridge between the SDK attachment support and all VS Code features that use `createAIInvoker`.

## Changes

### Files to Create
- (none)

### Files to Modify

- **`src/shortcuts/ai-service/ai-invoker-factory.ts`** — Three changes:
  1. Import the `Attachment` type from `@plusplusoneplusplus/pipeline-core`
  2. Add `attachments?: Attachment[]` to the `AIInvoker` call-site options (second parameter)
  3. Forward `attachments` in the `sdkService.sendMessage()` call

- **`src/shortcuts/ai-service/index.ts`** — Re-export the `Attachment` type from pipeline-core if not already re-exported, so consumers can import it alongside `AIInvoker`.

- **`src/test/suite/ai-invoker-factory.test.ts`** — Add tests for attachment threading.

### Files to Delete
- (none)

## Implementation Notes

### Type signature changes

**`AIInvoker` type (line 96–99) — before:**
```typescript
export type AIInvoker = (
    prompt: string,
    options?: { model?: string }
) => Promise<AIInvokerResult>;
```

**After:**
```typescript
export type AIInvoker = (
    prompt: string,
    options?: { model?: string; attachments?: Attachment[] }
) => Promise<AIInvokerResult>;
```

This is a backward-compatible widening: existing callers that pass `{ model }` or no options continue to compile. The `Attachment` type comes from `@plusplusoneplusplus/pipeline-core` (defined in `packages/pipeline-core/src/copilot-sdk-wrapper/types.ts` via commit 001).

### Pipeline-core `AIInvokerOptions` alignment

The pipeline-core `AIInvokerOptions` in `packages/pipeline-core/src/map-reduce/types.ts` also needs an `attachments` field to keep the two `AIInvoker` types structurally compatible. However, that change belongs to commit 001 (SDK wrapper types). If commit 001 did not add `attachments` to `AIInvokerOptions`, this commit should add it there too — but the preferred approach is to keep pipeline-core changes in commits 001–002 and only touch VS Code-side files here.

**Decision:** This commit only modifies the VS Code-side `AIInvoker` type in `ai-invoker-factory.ts`. If the pipeline-core `AIInvokerOptions` needs `attachments`, that should be done in commit 001 or a separate pipeline-core-only commit.

### How attachments are forwarded

In `createAIInvoker`, the returned closure (line 144) currently destructures `invokeOptions?.model`. After this commit:

```typescript
return async (prompt: string, invokeOptions?: { model?: string; attachments?: Attachment[] }): Promise<AIInvokerResult> => {
    const model = invokeOptions?.model || defaultModel;
    const attachments = invokeOptions?.attachments;
    // ...
    const result = await sdkService.sendMessage({
        prompt,
        model,
        workingDirectory,
        timeoutMs: effectiveTimeoutMs,
        loadDefaultMcpConfig: loadMcpConfig,
        onPermissionRequest: approvePermissions ? approveAllPermissions : undefined,
        attachments  // NEW — forwarded to SDK
    });
```

The `attachments` property is only meaningful for the SDK path. The CLI and clipboard fallback paths ignore it (they only accept a text prompt). This is acceptable — attachments are an SDK-only feature.

### Import changes in `ai-invoker-factory.ts`

Add `Attachment` to the existing import from `@plusplusoneplusplus/pipeline-core` (line 18):

```typescript
import { getCopilotSDKService, AIInvocationResult, approveAllPermissions, Attachment } from '@plusplusoneplusplus/pipeline-core';
```

If the `Attachment` type is not yet exported from pipeline-core's public API (it may be in the `copilot-sdk-wrapper` sub-module only), ensure it is re-exported from `packages/pipeline-core/src/index.ts`. This should already be done by commit 001.

### Re-export in `index.ts`

Add `Attachment` to the re-exports from `ai-invoker-factory.ts` (line 174–181) so consumers can do:

```typescript
import { createAIInvoker, AIInvoker, Attachment } from '../ai-service';
```

Alternatively, consumers can import `Attachment` directly from `@plusplusoneplusplus/pipeline-core`. The re-export is a convenience.

## Tests

Add to `src/test/suite/ai-invoker-factory.test.ts`:

1. **"AIInvoker type should accept attachments in options"** — Create an invoker via `createAIInvoker`, verify it can be called with `{ attachments: [...] }` without type errors (compile-time test, runtime just checks no crash).

2. **"should accept attachments option alongside model"** — Verify the options type accepts both `model` and `attachments` together.

3. **"should work without attachments (backward compatibility)"** — Existing callers passing `{ model }` or no options should still work (this is partially covered by existing tests but worth an explicit assertion).

4. **"attachments should be ignored for CLI backend"** — When backend is `copilot-cli`, calling the invoker with attachments should not cause an error; the attachments are simply not forwarded.

Note: Full integration testing (verifying attachments reach the SDK session) requires an actual SDK connection. The unit tests focus on type safety and ensuring the parameter flows through without errors.

## Acceptance Criteria

- [ ] `AIInvoker` type accepts optional `attachments` parameter in the options object
- [ ] `createAIInvoker` closure forwards `attachments` to `sdkService.sendMessage()` in the SDK path
- [ ] CLI and clipboard fallback paths are unaffected (no error when attachments present, attachments silently ignored)
- [ ] `Attachment` type is re-exported from `src/shortcuts/ai-service/index.ts`
- [ ] All existing tests pass (no regressions)
- [ ] New tests cover attachment parameter acceptance and backward compatibility
- [ ] Builds without errors (`npm run compile`)

## Dependencies
- Depends on: 001, 002

## Assumed Prior State
`SendMessageOptions` has an `attachments?: Attachment[]` field (commit 001). `CopilotSDKService.sendMessage()` forwards `attachments` to the SDK session's `send()` call (commit 002). The `Attachment` type is exported from `@plusplusoneplusplus/pipeline-core`.
