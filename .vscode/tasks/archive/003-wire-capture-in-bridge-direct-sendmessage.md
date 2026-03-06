---
status: pending
---

# 003: Wire `ToolCallCapture` into direct `sendMessage` calls in `queue-executor-bridge`

## Summary
Composes `ToolCallCapture` (with `EXPLORE_FILTER`) into the `onToolEvent` callback inside `CLITaskExecutor.executeWithAI()`, so that the non-pipeline "ask/chat" AI path also persists read-only tool Q&A pairs to `~/.coc/memory/explore-cache/raw/`.

## Motivation
Commits 001–002 cover the pipeline path (`createCLIAIInvoker` → `AIInvoker` → `executePipeline`). The `executeWithAI` private method in `CLITaskExecutor` (queue-executor-bridge.ts, line 889) calls `this.aiService.sendMessage(...)` **directly** — bypassing `AIInvoker` entirely — and is used for all non-pipeline task types (ai-clarification, chat, custom, follow-prompt, task-generation). Without this commit, every conversational/chat AI session produces zero cache entries, leaving a gap in the memory ingestion pipeline.

## Changes

### Files to Create
- (none)

### Files to Modify
- `packages/coc/src/server/queue-executor-bridge.ts` — add a shared `FileToolCallCacheStore` class field, import the three new symbols, and compose `ToolCallCapture` into the existing `onToolEvent` handler inside `executeWithAI`

### Files to Delete
- (none)

## Implementation Notes

### 1. New imports
Add to the existing named import from `@plusplusoneplusplus/pipeline-core` (around line 36):
```ts
FileToolCallCacheStore, ToolCallCapture, EXPLORE_FILTER,
```
All three are exported from `packages/pipeline-core/src/memory/index.ts` and re-exported from the package root.

### 2. New class field on `CLITaskExecutor`
`FileToolCallCacheStore` has a **write-queue** (`writeQueue: Promise<void>`) that serializes concurrent atomic writes. Creating one store per `executeWithAI` call would give each call its own isolated write queue, losing the serialization guarantee under parallel tasks. Therefore, declare a single shared instance as a private readonly field.

Add after the `getWsServer` field declaration (around line 151):
```ts
/** Shared store for tool-call Q&A capture (explore cache). */
private readonly toolCallCacheStore: FileToolCallCacheStore;
```

Initialize in the constructor (after `this.getWsServer = options.getWsServer;`, around line 163):
```ts
this.toolCallCacheStore = new FileToolCallCacheStore(
    this.dataDir ? { dataDir: path.join(this.dataDir, 'memory') } : undefined,
);
```

**Why `path.join(this.dataDir, 'memory')`:** `this.dataDir` is the `.coc` data root (e.g. `~/.coc`). `FileToolCallCacheStore`'s `dataDir` option is the `memory` subdirectory (defaults to `~/.coc/memory` when omitted). Passing `path.join(this.dataDir, 'memory')` keeps the store co-located with the rest of `.coc` data when a custom `dataDir` is configured, while the default (`undefined`) path falls through to the correct `os.homedir()/.coc/memory` default.

### 3. Compose `ToolCallCapture` into `executeWithAI`

The existing `onToolEvent` inline lambda (lines 954–1010) contains an **early `return`** on line 971 for `suggest_follow_ups` tool-complete events. If the capture handler were appended at the end of the lambda body, it would never be called for those events. While `suggest_follow_ups` is not in `EXPLORE_FILTER` (so no write would happen anyway), future-proofing requires the **extract-and-compose** pattern so every event — including ones with early returns — flows through both handlers independently.

**Implementation inside `executeWithAI`** (insert just before the `const result = await this.aiService.sendMessage({...})` call at line 924):

```ts
// Capture read-only tool calls for the memory cache.
// Create capture handler defensively — errors must not break task execution.
let captureHandler: ((event: ToolEvent) => void) | undefined;
try {
    const capture = new ToolCallCapture(this.toolCallCacheStore, EXPLORE_FILTER);
    captureHandler = capture.createToolEventHandler();
} catch (err) {
    getLogger().warn(LogCategory.AI, `[QueueExecutor] ToolCallCapture setup failed: ${err}`);
}
```

Then **extract the existing inline `onToolEvent` body** into a named local constant before the `sendMessage` call, and pass a composed handler:

```ts
const existingToolEventHandler = (event: ToolEvent) => {
    // ... existing body of onToolEvent (lines 955–1009) goes here verbatim ...
};

const result = await this.aiService.sendMessage({
    // ... all existing options unchanged ...
    onToolEvent: captureHandler
        ? (event: ToolEvent) => {
            try { existingToolEventHandler(event); } catch { /* non-fatal */ }
            try { captureHandler!(event); } catch { /* non-fatal */ }
        }
        : existingToolEventHandler,
});
```

This mirrors the `mergeToolEventHandlers` helper from `with-tool-call-cache.ts` (lines 46–57) but is implemented inline to avoid an additional import/function. The existing handler is always called first to preserve SSE/timeline behavior.

### 4. Optional: post-call aggregation (defer to follow-up)
`withToolCallCache` triggers `ToolCallCacheAggregator.aggregateIfNeeded()` non-blocking after the AI call. Adding this here would require importing `ToolCallCacheAggregator` and creating a separate AI invoker reference just for aggregation — that increases scope. **Skip for this commit; track as follow-up.** Add a `// TODO(004): trigger ToolCallCacheAggregator.aggregateIfNeeded() after sendMessage` comment at the end of the `try` block in `executeWithAI`.

### 5. `ToolEvent` type
`ToolEvent` is already imported into `queue-executor-bridge.ts` at line 34 (via `import type { ..., ToolEvent } from '@plusplusoneplusplus/pipeline-core'`). No extra import needed.

## Tests

**Existing test infrastructure** (`packages/coc/test/server/queue-executor-bridge.test.ts`):
- Mocks `@plusplusoneplusplus/pipeline-core` with `vi.mock` spread (`...actual`) at line 53
- `mockSendMessage` is the spy on `aiService.sendMessage`

**New test: verify capture handler receives tool events**

Add a new `describe` block or `it` case inside `describe('CLITaskExecutor')`:

```ts
describe('ToolCallCapture integration', () => {
    it('should call ToolCallCapture.createToolEventHandler with tool events during executeWithAI', async () => {
        // Arrange
        const mockWriteRaw = vi.fn().mockResolvedValue('123-view.json');
        vi.spyOn(
            (await import('@plusplusoneplusplus/pipeline-core')).FileToolCallCacheStore.prototype,
            'writeRaw',
        ).mockImplementation(mockWriteRaw);

        const toolStartEvent = { type: 'tool-start', toolCallId: 'tc1', toolName: 'view', parameters: { path: '/foo.ts' } };
        const toolCompleteEvent = { type: 'tool-complete', toolCallId: 'tc1', toolName: 'view', result: 'file content' };

        mockSendMessage.mockImplementation(async (opts: any) => {
            opts.onToolEvent?.(toolStartEvent);
            opts.onToolEvent?.(toolCompleteEvent);
            return { success: true, response: 'ok', sessionId: 'sess-1' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-cap-1',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'Explain this code' },
            config: { timeoutMs: 5000 },
            displayName: 'Capture test',
        };

        // Act
        await executor.execute(task);

        // Assert — writeRaw should have been called once (view tool passes EXPLORE_FILTER)
        expect(mockWriteRaw).toHaveBeenCalledOnce();
        const entry = mockWriteRaw.mock.calls[0][0];
        expect(entry.toolName).toBe('view');
        expect(entry.question).toContain('/foo.ts');
        expect(entry.answer).toBe('file content');
    });

    it('should not capture suggest_follow_ups events (not in EXPLORE_FILTER)', async () => {
        const mockWriteRaw = vi.fn().mockResolvedValue('ts.json');
        vi.spyOn(
            (await import('@plusplusoneplusplus/pipeline-core')).FileToolCallCacheStore.prototype,
            'writeRaw',
        ).mockImplementation(mockWriteRaw);

        mockSendMessage.mockImplementation(async (opts: any) => {
            opts.onToolEvent?.({ type: 'tool-start',    toolCallId: 'sfup1', toolName: 'suggest_follow_ups', parameters: {} });
            opts.onToolEvent?.({ type: 'tool-complete', toolCallId: 'sfup1', toolName: 'suggest_follow_ups', result: '{"suggestions":[]}' });
            return { success: true, response: 'ok', sessionId: 'sess-2' };
        });

        const executor = new CLITaskExecutor(store);
        await executor.execute({
            id: 'task-noc-1', type: 'ai-clarification', priority: 'normal',
            status: 'running', createdAt: Date.now(),
            payload: { prompt: 'test' }, config: {}, displayName: 'no capture',
        });

        expect(mockWriteRaw).not.toHaveBeenCalled();
    });
});
```

**What to verify:** `mockWriteRaw` is called with a `ToolCallQAEntry` whose `toolName`, `question`, and `answer` match the simulated `tool-start`/`tool-complete` events, confirming the capture path is wired end-to-end without breaking existing task execution behavior.

## Acceptance Criteria
- [ ] `FileToolCallCacheStore` is instantiated once as a shared field in `CLITaskExecutor` (constructor), not per-call
- [ ] `ToolCallCapture` + `EXPLORE_FILTER` are imported from `@plusplusoneplusplus/pipeline-core`
- [ ] Every `executeWithAI` call creates a fresh `ToolCallCapture` wrapping the shared store
- [ ] The existing `onToolEvent` SSE/timeline logic is preserved and always called first
- [ ] `ToolCallCapture` errors (construction or handler) do not propagate to callers — task execution continues unaffected
- [ ] `suggest_follow_ups` `tool-complete` early-return path still fires its SSE event correctly (existing behavior unchanged)
- [ ] Unit test: `view` tool events result in `writeRaw` being called with a correctly shaped `ToolCallQAEntry`
- [ ] Unit test: `suggest_follow_ups` events do **not** trigger `writeRaw`
- [ ] `npm run build` passes with no new TypeScript errors
- [ ] Existing `queue-executor-bridge.test.ts` tests remain green

## Dependencies
- Depends on: 001, 002 (for context/consistency, though this path is independent of `AIInvoker`)

## Assumed Prior State
- `AIInvokerOptions` has `onToolEvent` (added in commit 001)
- `createCLIAIInvoker` wraps its result with `withToolCallCache` (added in commit 002)
- `FileToolCallCacheStore`, `ToolCallCapture`, `EXPLORE_FILTER` are exported from `@plusplusoneplusplus/pipeline-core` via `packages/pipeline-core/src/memory/index.ts` (already present in codebase)
- `ToolEvent` type is already imported in `queue-executor-bridge.ts` (line 34)
- `path` is already imported in `queue-executor-bridge.ts` (line 59)
