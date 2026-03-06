---
status: pending
---

# 002: Tool Call Capture

## Summary

`ToolCallCapture` is a passive event listener that observes tool execution lifecycle events (`ToolEvent`) and persists Q&A pairs to the `ToolCallCacheStore` from commit 001. It normalizes raw tool arguments into human-readable question strings and is designed to be non-blocking — capture errors are logged but never propagated to the caller.

## Motivation

The capture layer sits between the AI SDK's `onToolEvent` callback and the persistence store. By isolating it in its own commit, we can:
- Test the event filtering, arg normalization, and store-write flow independently of aggregation/retrieval.
- Verify the contract with `ToolCallCacheStore.writeRaw()` before building higher layers.
- Keep the diff small and reviewable — pure event handling, no AI dependencies.

## Changes

### Files to Create

- `packages/pipeline-core/src/memory/tool-call-capture.ts` — `ToolCallCapture` class: event handler factory, arg normalization, store writes
- `packages/pipeline-core/test/memory/tool-call-capture.test.ts` — Vitest tests

### Files to Modify

(none expected)

### Files to Delete

(none)

## Implementation Notes

### ToolEvent Shape (from `copilot-sdk-wrapper/types.ts:346-361`)

The capture layer consumes `ToolEvent` objects emitted by `CopilotSDKService.sendWithStreaming()`:

```typescript
interface ToolEvent {
    type: 'tool-start' | 'tool-complete' | 'tool-failed';
    toolCallId: string;
    toolName?: string;
    parentToolCallId?: string;
    parameters?: Record<string, unknown>;  // populated on tool-start
    result?: string;                       // populated on tool-complete
    error?: string;                        // populated on tool-failed
}
```

**Critical observation:** `parameters` is only populated on `tool-start` events, while `result` is only populated on `tool-complete` events. To produce a Q&A entry, the capture must correlate the two events by `toolCallId`. This requires an in-memory map to hold pending `tool-start` data until the matching `tool-complete` arrives.

### Class: `ToolCallCapture`

```typescript
import { ToolCallCacheStore, ToolCallFilter, ToolCallQAEntry } from './tool-call-cache-types';
import { ToolEvent } from '../copilot-sdk-wrapper/types';
import { getLogger, LogCategory } from '../logger';

export interface ToolCallCaptureOptions {
    /** Stable hash of the repository root. Used to tag entries. */
    repoHash?: string;
    /** Current git HEAD hash. Used for cache invalidation. */
    gitHash?: string;
    /** If true, also capture tool-failed events (default: false). */
    captureFailures?: boolean;
}

export class ToolCallCapture {
    private readonly store: ToolCallCacheStore;
    private readonly filter: ToolCallFilter;
    private readonly options: ToolCallCaptureOptions;
    /** In-flight tool calls: toolCallId → { toolName, args } */
    private readonly pending: Map<string, { toolName: string; args: Record<string, unknown> }>;
    private _capturedCount: number;

    constructor(
        store: ToolCallCacheStore,
        filter: ToolCallFilter,
        options?: ToolCallCaptureOptions,
    );

    /** Number of Q&A entries successfully written. */
    get capturedCount(): number;

    /**
     * Returns a callback compatible with `SendMessageOptions.onToolEvent`.
     * Usage: `sendMessage({ onToolEvent: capture.createToolEventHandler() })`
     */
    createToolEventHandler(): (event: ToolEvent) => void;

    /**
     * Convert raw tool arguments into a human-readable question string.
     * Exported for testability.
     */
    normalizeToolArgs(toolName: string, args: Record<string, unknown>): string;
}
```

### Constructor

```typescript
constructor(store: ToolCallCacheStore, filter: ToolCallFilter, options?: ToolCallCaptureOptions) {
    this.store = store;
    this.filter = filter;
    this.options = options ?? {};
    this.pending = new Map();
    this._capturedCount = 0;
}
```

### `createToolEventHandler()` — Event Flow

Returns a synchronous callback `(event: ToolEvent) => void`. The handler is synchronous at the call site — store writes are fire-and-forget Promises with `.catch()` to swallow errors.

**Event handling logic:**

1. **`tool-start`**: Store `{ toolName, args: event.parameters }` in `this.pending` keyed by `event.toolCallId`. No store write. If `event.toolName` is missing, skip.

2. **`tool-complete`**: Look up the pending entry. If found and the filter passes (`this.filter(toolName, args)`):
   - Call `this.normalizeToolArgs(toolName, args)` to produce the question string.
   - Build a `ToolCallQAEntry`:
     ```typescript
     {
         id: event.toolCallId,
         toolName,
         question: normalizedQuestion,
         answer: event.result ?? '',
         args,
         gitHash: this.options.gitHash,
         timestamp: Date.now(),
         parentToolCallId: event.parentToolCallId,
     }
     ```
   - Call `this.store.writeRaw(entry)` — fire-and-forget with error logging.
   - Increment `this._capturedCount`.
   - Remove from `this.pending`.

3. **`tool-failed`**: If `this.options.captureFailures` is true, follow the same flow as `tool-complete` but use `event.error` as the answer (prefixed with `[ERROR] `). Otherwise, just clean up `this.pending`.

4. **Missing pending entry**: If `tool-complete`/`tool-failed` arrives without a matching `tool-start` (e.g., tool started outside observation window), log a debug warning and skip. Do not throw.

5. **Error wrapping**: The entire handler body is wrapped in `try/catch`. Errors are logged via `getLogger().warn(LogCategory.Memory, ...)` and swallowed.

```typescript
createToolEventHandler(): (event: ToolEvent) => void {
    return (event: ToolEvent) => {
        try {
            switch (event.type) {
                case 'tool-start':
                    this.handleToolStart(event);
                    break;
                case 'tool-complete':
                    this.handleToolComplete(event);
                    break;
                case 'tool-failed':
                    this.handleToolFailed(event);
                    break;
            }
        } catch (err) {
            getLogger().warn(LogCategory.Memory, `ToolCallCapture: error handling ${event.type} for ${event.toolName ?? '?'}: ${err}`);
        }
    };
}
```

### `handleToolStart(event)` — Private

```typescript
private handleToolStart(event: ToolEvent): void {
    if (!event.toolName) return;
    this.pending.set(event.toolCallId, {
        toolName: event.toolName,
        args: event.parameters ?? {},
    });
}
```

### `handleToolComplete(event)` — Private

```typescript
private handleToolComplete(event: ToolEvent): void {
    const pendingEntry = this.pending.get(event.toolCallId);
    this.pending.delete(event.toolCallId);

    if (!pendingEntry) {
        getLogger().debug(LogCategory.Memory, `ToolCallCapture: no pending tool-start for ${event.toolCallId}, skipping`);
        return;
    }

    const { toolName, args } = pendingEntry;

    if (!this.filter(toolName, args)) return;

    const question = this.normalizeToolArgs(toolName, args);
    const entry: ToolCallQAEntry = {
        id: event.toolCallId,
        toolName,
        question,
        answer: event.result ?? '',
        args,
        gitHash: this.options.gitHash,
        timestamp: Date.now(),
        parentToolCallId: event.parentToolCallId,
    };

    // Fire-and-forget — errors are logged, never thrown
    this.store.writeRaw(entry).then(
        () => { this._capturedCount++; },
        (err) => { getLogger().warn(LogCategory.Memory, `ToolCallCapture: failed to write entry ${event.toolCallId}: ${err}`); },
    );
}
```

**Note on `_capturedCount` increment:** Since `writeRaw` is async and fire-and-forget, `_capturedCount` is incremented in the `.then()` success handler, not synchronously. This means `capturedCount` reflects successfully persisted entries, not attempted ones. Tests should `await` the store mock's promise to verify count.

### `handleToolFailed(event)` — Private

```typescript
private handleToolFailed(event: ToolEvent): void {
    const pendingEntry = this.pending.get(event.toolCallId);
    this.pending.delete(event.toolCallId);

    if (!this.options.captureFailures || !pendingEntry) return;

    const { toolName, args } = pendingEntry;
    if (!this.filter(toolName, args)) return;

    const question = this.normalizeToolArgs(toolName, args);
    const entry: ToolCallQAEntry = {
        id: event.toolCallId,
        toolName,
        question,
        answer: `[ERROR] ${event.error ?? 'Unknown error'}`,
        args,
        gitHash: this.options.gitHash,
        timestamp: Date.now(),
        parentToolCallId: event.parentToolCallId,
    };

    this.store.writeRaw(entry).then(
        () => { this._capturedCount++; },
        (err) => { getLogger().warn(LogCategory.Memory, `ToolCallCapture: failed to write failed entry ${event.toolCallId}: ${err}`); },
    );
}
```

### `normalizeToolArgs()` — Normalization Rules

Converts tool name + args into a short, natural-language question. This is the human-readable "question" in the Q&A pair that will be used for similarity matching during retrieval.

```typescript
normalizeToolArgs(toolName: string, args: Record<string, unknown>): string {
    switch (toolName) {
        case 'grep': {
            const pattern = String(args.pattern ?? '');
            const path = args.path ? ` in ${args.path}` : '';
            return `Search for '${pattern}'${path}`;
        }
        case 'view': {
            const filePath = String(args.path ?? '');
            const range = args.view_range;
            if (Array.isArray(range) && range.length === 2) {
                return `View file ${filePath} lines ${range[0]}-${range[1]}`;
            }
            return `View file ${filePath}`;
        }
        case 'glob': {
            const pattern = String(args.pattern ?? '');
            const path = args.path ? ` in ${args.path}` : '';
            return `Find files matching ${pattern}${path}`;
        }
        case 'task': {
            // task(explore) subagent — the prompt IS the question
            const prompt = String(args.prompt ?? '');
            const agentType = args.agent_type ? ` (${args.agent_type})` : '';
            // Truncate long prompts to keep the question concise
            const truncated = prompt.length > 200 ? prompt.substring(0, 200) + '...' : prompt;
            return truncated || `Task${agentType}`;
        }
        case 'web_search': {
            return String(args.query ?? 'Web search');
        }
        case 'web_fetch': {
            return `Fetch ${String(args.url ?? 'URL')}`;
        }
        case 'powershell': {
            const cmd = String(args.command ?? '');
            const truncated = cmd.length > 150 ? cmd.substring(0, 150) + '...' : cmd;
            return `Run command: ${truncated}`;
        }
        case 'edit': {
            const filePath = String(args.path ?? '');
            return `Edit file ${filePath}`;
        }
        case 'create': {
            const filePath = String(args.path ?? '');
            return `Create file ${filePath}`;
        }
        default: {
            // Fallback: "toolName: JSON.stringify(args)" truncated
            const argsStr = JSON.stringify(args);
            const truncated = argsStr.length > 150 ? argsStr.substring(0, 150) + '...' : argsStr;
            return `${toolName}: ${truncated}`;
        }
    }
}
```

**Design decisions:**
- `task` tool uses `args.prompt` directly — the prompt is already a natural-language question (e.g., "How does auth work?"). Agent type is appended in parens for context.
- Long prompts/commands are truncated to keep question strings manageable for future similarity matching.
- `view` with `view_range` includes line numbers — important for distinguishing partial reads.
- The default fallback serializes args as JSON — better than losing data, and consolidation can refine later.

### Pending Map Lifecycle

The `pending` Map grows as `tool-start` events arrive and shrinks on `tool-complete`/`tool-failed`. In normal operation, every start has a matching complete/failed. Edge cases:
- **Orphaned starts** (no matching complete): These accumulate in `pending`. Since `ToolCallCapture` is scoped to a single `sendMessage` call, the Map is GC'd when the capture instance is released. No explicit cleanup timer is needed.
- **Orphaned completes** (no matching start): Logged and skipped, as documented above.

### Non-Blocking Guarantee

Three levels of protection:
1. **Outer try/catch** in `createToolEventHandler()` — catches synchronous errors (e.g., normalization bugs).
2. **Fire-and-forget** `writeRaw()` — async errors caught by `.catch()` in the Promise chain.
3. **CopilotSDKService already wraps** `onToolEvent` calls in `try/catch` (lines 1660, 1734 of copilot-sdk-service.ts) — double protection.

### Logger Usage

```typescript
import { getLogger, LogCategory } from '../logger';
// LogCategory.Memory = 'Memory' (logger.ts:37)
getLogger().warn(LogCategory.Memory, `ToolCallCapture: ...`);
getLogger().debug(LogCategory.Memory, `ToolCallCapture: ...`);
```

All log messages are prefixed with `ToolCallCapture:` for easy filtering.

## Tests

Test file: `packages/pipeline-core/test/memory/tool-call-capture.test.ts`

Use Vitest. Mock `ToolCallCacheStore` with `vi.fn()` methods. No file I/O needed.

### Test Setup

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolCallCapture } from '../../src/memory/tool-call-capture';
import type { ToolCallCacheStore, ToolCallFilter, ToolCallQAEntry } from '../../src/memory/tool-call-cache-types';
import type { ToolEvent } from '../../src/copilot-sdk-wrapper/types';

function createMockStore(): ToolCallCacheStore {
    return {
        writeRaw: vi.fn().mockResolvedValue(undefined),
        // ...other methods as no-op mocks
    } as unknown as ToolCallCacheStore;
}

function makeStartEvent(id: string, toolName: string, params: Record<string, unknown>): ToolEvent {
    return { type: 'tool-start', toolCallId: id, toolName, parameters: params };
}

function makeCompleteEvent(id: string, toolName: string, result: string): ToolEvent {
    return { type: 'tool-complete', toolCallId: id, toolName, result };
}

function makeFailedEvent(id: string, toolName: string, error: string): ToolEvent {
    return { type: 'tool-failed', toolCallId: id, toolName, error };
}
```

### Test Cases

1. **Filter correctly includes tool events**
   - Create filter that accepts only `grep` and `view`.
   - Send tool-start + tool-complete for `grep` → verify `writeRaw` called.
   - Send tool-start + tool-complete for `view` → verify `writeRaw` called.

2. **Filter correctly excludes tool events**
   - Create filter that rejects `edit`.
   - Send tool-start + tool-complete for `edit` → verify `writeRaw` NOT called.

3. **Normalizes args for grep**
   - Input: `{ pattern: "auth", path: "src/" }` → Output: `"Search for 'auth' in src/"`
   - Input: `{ pattern: "TODO" }` (no path) → Output: `"Search for 'TODO'"`

4. **Normalizes args for glob**
   - Input: `{ pattern: "**/*.test.ts" }` → Output: `"Find files matching **/*.test.ts"`
   - Input: `{ pattern: "*.md", path: "docs/" }` → Output: `"Find files matching *.md in docs/"`

5. **Normalizes args for view**
   - Input: `{ path: "src/auth.ts" }` → Output: `"View file src/auth.ts"`
   - Input: `{ path: "src/auth.ts", view_range: [10, 20] }` → Output: `"View file src/auth.ts lines 10-20"`

6. **Normalizes args for task(explore)**
   - Input: `{ prompt: "How does auth work?", agent_type: "explore" }` → Output: `"How does auth work?"`
   - Input: `{ prompt: "" }` → Output: `"Task"`
   - Input: `{ prompt: "A".repeat(250) }` → truncated to 200 chars + "..."

7. **Normalizes args for other tools (powershell, edit, create, web_search, web_fetch)**
   - Verify each produces a sensible string.

8. **Normalizes args with default fallback**
   - Unknown tool `foo` with args `{ x: 1 }` → `"foo: {\"x\":1}"`

9. **Writes raw entry on tool-complete**
   - Send tool-start then tool-complete for an accepted tool.
   - Await the mock `writeRaw` promise.
   - Verify the `ToolCallQAEntry` passed to `writeRaw` has correct fields: `id`, `toolName`, `question` (normalized), `answer` (event.result), `args`, `gitHash`, `timestamp`, `parentToolCallId`.

10. **Ignores tool-start events (no store write)**
    - Send only tool-start → verify `writeRaw` NOT called.

11. **Ignores tool-failed events by default**
    - Send tool-start + tool-failed → verify `writeRaw` NOT called.

12. **Captures tool-failed when captureFailures=true**
    - Create capture with `{ captureFailures: true }`.
    - Send tool-start + tool-failed → verify `writeRaw` called with answer starting with `[ERROR]`.

13. **Non-blocking: capture errors don't propagate**
    - Mock `writeRaw` to reject with an error.
    - Send tool-start + tool-complete → handler does NOT throw.
    - Verify error is logged (optional: spy on `getLogger()`).

14. **Tracks captured count**
    - Send 3 accepted tool-complete events.
    - Await the store mock promises.
    - Verify `capture.capturedCount === 3`.

15. **Handles orphaned tool-complete (no matching start)**
    - Send tool-complete without prior tool-start → verify `writeRaw` NOT called, no error thrown.

16. **Handles tool-start with missing toolName**
    - Send tool-start with `toolName: undefined` → verify it's ignored (not added to pending).

17. **Passes gitHash and parentToolCallId through to entry**
    - Create capture with `{ gitHash: 'abc123' }`.
    - Send tool-start with `parentToolCallId: 'parent-1'`, then tool-complete.
    - Verify entry has `gitHash: 'abc123'` and `parentToolCallId: 'parent-1'`.

## Acceptance Criteria

- [ ] `ToolCallCapture` correctly filters tool-complete events using the provided `ToolCallFilter`
- [ ] `normalizeToolArgs` produces readable question strings for grep, glob, view, task, powershell, edit, create, web_search, web_fetch, and unknown tools
- [ ] Long prompts/commands are truncated (200 chars for task, 150 for powershell/fallback)
- [ ] Q&A entries are written via `store.writeRaw()` with all required fields populated
- [ ] `tool-start` events are buffered (not written) — only used to capture args for the matching complete
- [ ] `tool-failed` events are ignored by default, captured when `captureFailures: true`
- [ ] Orphaned events (complete without start, start without complete) are handled gracefully
- [ ] Capture errors (store write failures, normalization bugs) are logged but never thrown
- [ ] `capturedCount` reflects successfully persisted entries
- [ ] All tests pass via `npm run test:run` in `packages/pipeline-core/`
- [ ] No dependency on AI SDK internals — only consumes the public `ToolEvent` interface

## Dependencies

- Depends on: 001 (Tool Call Cache Types & Store — provides `ToolCallCacheStore`, `ToolCallFilter`, `ToolCallQAEntry`)

## Assumed Prior State

From commit 001, these types and interfaces exist:

- **`ToolCallFilter`** = `(toolName: string, args: Record<string, unknown>) => boolean` — predicate that decides which tool calls to capture.
- **`ToolCallQAEntry`** = `{ id: string, toolName: string, question: string, answer: string, args: Record<string, unknown>, gitHash?: string, timestamp: number, parentToolCallId?: string }` — the raw Q&A record persisted to disk.
- **`ToolCallCacheStore`** interface with `writeRaw(entry: ToolCallQAEntry): Promise<void>` — atomic, write-queue-serialized persistence.
- **`FileToolCallCacheStore`** class implementing `ToolCallCacheStore` — writes to `explore-cache/raw/` under the memory data directory.

From the existing codebase:

- **`ToolEvent`** (from `packages/pipeline-core/src/copilot-sdk-wrapper/types.ts:346-361`) — the event interface emitted by `CopilotSDKService` during streaming.
- **`getLogger()`** / **`LogCategory.Memory`** (from `packages/pipeline-core/src/logger.ts`) — logging infrastructure.
- **`SendMessageOptions.onToolEvent`** (from `copilot-sdk-wrapper/types.ts:326`) — the callback slot where `createToolEventHandler()` output is plugged in.
