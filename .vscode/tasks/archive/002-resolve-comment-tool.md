---
status: done
---

# 002: Wire resolve_comment tool into server comment resolution

## Summary

Define a `resolve_comment` custom tool using the SDK's `defineTool()` helper, inject it into both the queue and sync AI paths for comment resolution, and change the response to only include comment IDs that AI explicitly resolved via tool calls.

## Motivation

Currently `executeResolveComments` (queue-executor-bridge.ts:863-886) returns `commentIds: payload.commentIds` — every open comment passed in — regardless of whether AI actually addressed them. The sync fallback in task-comments-handler.ts (lines 604-634 for single, 685-748 for batch) does the same. This commit adds a `resolve_comment` tool so AI explicitly marks each comment it addresses, and only those IDs flow back to the client.

## Changes

### Files to Create

- `packages/coc/src/server/resolve-comment-tool.ts` — Factory that creates a per-invocation `resolve_comment` tool and a resolution tracker

### Files to Modify

- `packages/coc/src/server/task-comments-handler.ts` — Update `buildBatchResolvePrompt` and both resolve handlers to use the tool
- `packages/coc/src/server/queue-executor-bridge.ts` — Update `executeResolveComments` to pass tools and extract resolved IDs
- `packages/coc/src/ai-invoker.ts` — Add `tools` to `CLIAIInvokerOptions` and thread through to `SendMessageOptions`

### Files to Delete

- None

## Implementation Notes

### 1. New file: `resolve-comment-tool.ts`

Create a factory function `createResolveCommentTool()` that returns `{ tool, getResolvedIds }`:

```ts
import { defineTool } from '@plusplusoneplusplus/pipeline-core';

interface ResolveCommentArgs {
    commentId: string;
    summary: string;
}

export function createResolveCommentTool() {
    const resolvedIds = new Map<string, string>(); // commentId → summary

    const tool = defineTool<ResolveCommentArgs>('resolve_comment', {
        description: 'Mark a comment as resolved after addressing it in the revised document. Call once per comment you actually fix.',
        parameters: {
            type: 'object',
            properties: {
                commentId: { type: 'string', description: 'The comment ID from the prompt' },
                summary: { type: 'string', description: 'Brief description of what was changed' },
            },
            required: ['commentId', 'summary'],
        },
        handler: (args) => {
            resolvedIds.set(args.commentId, args.summary);
            return { resolved: true, commentId: args.commentId };
        },
    });

    return {
        tool,
        getResolvedIds: () => [...resolvedIds.keys()],
        getResolutions: () => new Map(resolvedIds),
    };
}
```

Key design decisions:
- Uses raw JSON schema (not Zod) for `parameters` since the SDK's `Tool<TArgs>` interface accepts `Record<string, unknown>` (see `node_modules/@github/copilot-sdk/dist/types.d.ts:105`).
- `defineTool()` is re-exported from pipeline-core (commit 001 assumption). It returns `Tool<T>` with proper type inference.
- The handler is synchronous — no async needed since it only records state.
- Per-invocation factory pattern: each AI call gets its own `resolvedIds` Map, avoiding cross-request contamination.
- Returns a `Map<commentId, summary>` so callers can optionally surface the summary.

### 2. Update `buildBatchResolvePrompt` (task-comments-handler.ts:869-906)

Add tool-usage instructions to the prompt's `# Instructions` section (after line 903). The existing instructions at lines 900-903 tell AI to modify sections and output the revised document. Append:

```
5. You have a `resolve_comment` tool available. For each comment you address, call `resolve_comment` with the comment's ID and a brief summary of the change.
6. Do NOT call `resolve_comment` for comments you cannot address (e.g., ambiguous, need clarification, out of scope).
```

The comment IDs are already emitted in the prompt at line 890: `` **ID:** `${c.id}` ``, so AI has the IDs available.

### 3. Update `executeResolveComments` (queue-executor-bridge.ts:863-886)

Currently calls `this.executeWithAI(task, aiPrompt)` at line 879 and blindly returns `commentIds: payload.commentIds` at line 884.

Changes:
- Import `createResolveCommentTool` from `./resolve-comment-tool`.
- Before calling `executeWithAI`, create the tool: `const { tool, getResolvedIds } = createResolveCommentTool()`.
- Pass `tools: [tool]` to the AI call. Since `executeWithAI` (line 617) calls `this.aiService.sendMessage(...)` at line 652, we need to thread tools through. Two options:

  **Option A (preferred):** Add an optional `tools` parameter to `executeWithAI`:
  - Change signature at line 617 from `executeWithAI(task, prompt)` to `executeWithAI(task, prompt, options?: { tools?: Tool<any>[] })`.
  - In the `sendMessage` call at line 652, spread the tools: `tools: options?.tools`.
  - This is minimal and doesn't affect other callers of `executeWithAI`.

  **Option B:** Inline the AI call in `executeResolveComments`. Less DRY.

- After `executeWithAI` returns, replace line 884:
  ```ts
  // Before: commentIds: payload.commentIds
  const resolvedIds = getResolvedIds();
  // Fall back to all IDs if tool wasn't called (backward compat with models that don't use tools)
  const commentIds = resolvedIds.length > 0 ? resolvedIds : payload.commentIds;
  ```

This fallback is important: if the model ignores the tool (older models, or the tool wasn't registered properly), we preserve existing behavior.

### 4. Update sync fallback in `task-comments-handler.ts`

**Single-comment resolve (lines 604-634):**
Currently at line 625: `createCLIAIInvoker({ approvePermissions: false })`. The invoker is called at line 626 and result checked at line 627-630.

After commit 001, `CLIAIInvokerOptions` will support `tools`. Update:
```ts
const { tool, getResolvedIds } = createResolveCommentTool();
const invoker = createCLIAIInvoker({ approvePermissions: false, tools: [tool] });
```
At line 634, change the response to conditionally include the commentId:
```ts
const resolvedIds = getResolvedIds();
const wasResolved = resolvedIds.includes(comment.id) || resolvedIds.length === 0;
return sendJSON(res, 200, { revisedContent, commentId: wasResolved ? comment.id : undefined });
```

**Batch resolve (lines 729-746):**
Same pattern — create tool, pass to invoker, filter commentIds in the response at lines 743-746:
```ts
const resolvedIds = getResolvedIds();
const commentIds = resolvedIds.length > 0 ? resolvedIds : openComments.map(c => c.id);
sendJSON(res, 200, { revisedContent, commentIds });
```

### 5. Update `ai-invoker.ts`

Add `tools` to `CLIAIInvokerOptions` interface (line 31-44):
```ts
/** Custom tools to expose to the AI session */
tools?: Tool<any>[];
```

Thread it into `sendOptions` in `createCLIAIInvoker` (line 97-105):
```ts
const sendOptions: SendMessageOptions = {
    prompt,
    model,
    workingDirectory: options.workingDirectory,
    timeoutMs,
    onPermissionRequest: permissionHandler,
    loadDefaultMcpConfig: options.loadMcpConfig !== false,
    onStreamingChunk: options.onChunk,
    tools: options.tools,  // <-- add this line
};
```

Import `Tool` type from pipeline-core (add to existing import at line 17-22).

## Tests

### Unit tests in new file: `packages/coc/test/server/resolve-comment-tool.test.ts`

- **`createResolveCommentTool` returns a valid Tool shape**: assert `tool.name === 'resolve_comment'`, `tool.handler` is a function, `tool.parameters` has the expected JSON schema
- **Handler records resolved IDs**: call `tool.handler({ commentId: 'c1', summary: 'fixed typo' }, invocationStub)`, then assert `getResolvedIds()` returns `['c1']`
- **Multiple calls accumulate**: call handler 3 times with different IDs, assert all 3 appear in `getResolvedIds()`
- **Duplicate calls deduplicate (Map semantics)**: call handler twice with same ID, assert `getResolvedIds()` has length 1
- **Separate invocations are isolated**: create two tools, call one, assert the other's `getResolvedIds()` is empty

### Updates to existing test file: `packages/coc/test/server/task-comments-batch-resolve.test.ts`

- **`buildBatchResolvePrompt` includes tool instructions**: assert prompt contains `resolve_comment` and `Do NOT call`
- **Batch resolve response uses tool-resolved IDs**: mock the invoker to simulate tool calls, verify response `commentIds` only includes resolved ones
- **Fallback when no tool calls made**: verify all IDs returned when `getResolvedIds()` is empty (backward compat)

### Updates to: `packages/coc/test/server/queue-executor-bridge.test.ts`

- **`executeResolveComments` passes tools to sendMessage**: spy on `aiService.sendMessage` and assert `tools` array contains a tool named `resolve_comment`
- **Resolved IDs from tool calls used in result**: mock tool handler invocations, verify returned `commentIds` matches

## Acceptance Criteria

- [ ] `resolve_comment` tool is defined with correct name, JSON schema parameters (`commentId`, `summary`), and a handler that records resolved IDs
- [ ] `buildBatchResolvePrompt` output includes instructions for using the `resolve_comment` tool
- [ ] Queue path (`executeResolveComments`) passes the tool via `sendMessage({ tools: [tool] })` and returns only tool-resolved comment IDs
- [ ] Sync fallback paths (single-comment and batch) pass the tool to `createCLIAIInvoker` and filter returned comment IDs
- [ ] `ai-invoker.ts` `CLIAIInvokerOptions` accepts `tools` and threads them to `SendMessageOptions`
- [ ] Backward compatibility: when AI doesn't call the tool, all comment IDs are returned (fallback behavior)
- [ ] All new and updated tests pass (`npm run test:run` in `packages/coc/`)

## Dependencies

- Depends on: 001 (adds `tools?: Tool<any>[]` to `SendMessageOptions` and `ISessionOptions`, re-exports `Tool`, `ToolHandler`, `defineTool` from `@plusplusoneplusplus/pipeline-core`)

## Assumed Prior State

- `SendMessageOptions` (pipeline-core `types.ts`) has a `tools?: Tool<any>[]` field that is threaded through `CopilotSDKService.sendMessage()` into `ISessionOptions` and ultimately to the SDK's `client.createSession({ tools })`.
- `defineTool`, `Tool`, and `ToolHandler` are re-exported from `@plusplusoneplusplus/pipeline-core` so consumers can `import { defineTool, Tool } from '@plusplusoneplusplus/pipeline-core'`.
- The SDK's `Tool<TArgs>` interface (from `@github/copilot-sdk`) accepts `parameters` as either a Zod schema or raw JSON schema `Record<string, unknown>` (confirmed at `node_modules/@github/copilot-sdk/dist/types.d.ts:105`).
