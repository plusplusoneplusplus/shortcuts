---
status: pending
commit: "fix(coc): smart-append consecutive content items in timeline buffer"
files:
  - packages/coc/src/server/queue-executor-bridge.ts
  - packages/coc/test/server/queue-executor-bridge.test.ts
dependencies: []
---

# 001 — Smart-append consecutive content items in timeline buffer

## Problem

Each SDK token delta (typically 1–3 words) calls `appendTimelineItem()` which unconditionally pushes a new `TimelineItem` into the timeline buffer. This creates hundreds of tiny `{ type: 'content', content: 'word' }` entries per assistant turn. The AI Execution Dashboard chat component renders each `TimelineItem` on its own line, producing a word-per-line layout. The bloated array also inflates persisted JSON on disk.

## Solution

Modify `appendTimelineItem()` to **merge** consecutive content items instead of always pushing. When the last item in the buffer is `type: 'content'` and the incoming item is also `type: 'content'`, concatenate their `content` strings in place. Tool events (`tool-start`, `tool-complete`, `tool-failed`) always push a new entry, acting as natural merge boundaries.

Key properties:
- The **first** item's timestamp is kept when merging (earliest timestamp wins).
- `emitProcessOutput()` is called **before** `appendTimelineItem()` (lines 342/624), so per-token SSE streaming is completely unaffected.
- The two `onStreamingChunk` call-sites (line 340 initial, line 622 follow-up) require **no changes** — they still pass content items; the method itself handles merging.

## Changes

### `packages/coc/src/server/queue-executor-bridge.ts`

**`appendTimelineItem()` — lines 890-895**

Current code:

```typescript
private appendTimelineItem(processId: string, item: TimelineItem): void {
    if (!this.timelineBuffers.has(processId)) {
        this.timelineBuffers.set(processId, []);
    }
    this.timelineBuffers.get(processId)!.push(item);
}
```

Replace with:

```typescript
private appendTimelineItem(processId: string, item: TimelineItem): void {
    if (!this.timelineBuffers.has(processId)) {
        this.timelineBuffers.set(processId, []);
    }
    const buffer = this.timelineBuffers.get(processId)!;
    const last = buffer.length > 0 ? buffer[buffer.length - 1] : undefined;
    // Merge consecutive content items to avoid word-per-line rendering
    if (last && last.type === 'content' && item.type === 'content') {
        last.content = (last.content ?? '') + (item.content ?? '');
    } else {
        buffer.push(item);
    }
}
```

No other production code changes required. The `onStreamingChunk` callbacks at lines 335-348 (follow-up) and 612-630 (initial) continue to call `appendTimelineItem()` with `{ type: 'content', ... }` items — the method now merges them transparently.

### `packages/coc/test/server/queue-executor-bridge.test.ts`

All changes are inside the `describe('timeline population during execution')` block (starts line 3716).

#### 1. Update: `'should append content chunks to assistant turn timeline'` (line 3757)

This test sends two consecutive content chunks `'Hello '` and `'world'`. With merging, the timeline should contain **1** merged item instead of 2.

Current assertions (lines 3782-3786):

```typescript
expect(assistantTurn!.timeline.length).toBe(2);
expect(assistantTurn!.timeline[0].type).toBe('content');
expect(assistantTurn!.timeline[0].content).toBe('Hello ');
expect(assistantTurn!.timeline[1].type).toBe('content');
expect(assistantTurn!.timeline[1].content).toBe('world');
```

Replace with:

```typescript
expect(assistantTurn!.timeline.length).toBe(1);
expect(assistantTurn!.timeline[0].type).toBe('content');
expect(assistantTurn!.timeline[0].content).toBe('Hello world');
```

#### 2. Update: `'should have accurate timestamps in chronological order'` (line 3921)

This test sends: `chunk1` → `tool-start` → `tool-complete` → `chunk2`. With merging, no consecutive content items exist (tool events break the sequence), so timeline length stays **4**. No assertion changes needed — the existing test already validates the correct boundary behavior.

#### 3. Update: `'should populate timeline for follow-up messages'` (line 4013)

This test sends: `'follow-up text'` → `tool-start` → `tool-complete`. Only one content chunk before the tool, so length stays **3**. No changes needed.

#### 4. Update: `'should interleave content and tool events in chronological order'` (line 4055)

This test sends: content → tool-start → tool-complete → content → tool-start → tool-complete → content. Each content chunk is separated by tool events, so no merging occurs. Timeline length stays **7**. No changes needed.

#### 5. New test: `'should merge consecutive content chunks into single timeline item'`

Add after the updated test at ~line 3787:

```typescript
it('should merge consecutive content chunks into single timeline item', async () => {
    mockSendMessage.mockImplementation(async (opts: any) => {
        if (opts.onStreamingChunk) {
            opts.onStreamingChunk('Hello ');
            opts.onStreamingChunk('beautiful ');
            opts.onStreamingChunk('world');
        }
        return { success: true, response: 'Hello beautiful world', sessionId: 'sess-tl-merge' };
    });

    const executor = new CLITaskExecutor(store);
    const task: QueuedTask = {
        id: 'task-tl-merge',
        type: 'ai-clarification',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: { prompt: 'test' },
        config: {},
    };

    await executor.execute(task);

    const process = await store.getProcess('queue_task-tl-merge');
    const assistantTurn = process!.conversationTurns!.find(t => t.role === 'assistant');
    expect(assistantTurn).toBeDefined();
    expect(assistantTurn!.timeline.length).toBe(1);
    expect(assistantTurn!.timeline[0].type).toBe('content');
    expect(assistantTurn!.timeline[0].content).toBe('Hello beautiful world');
});
```

#### 6. New test: `'should not merge content across tool event boundaries'`

Add after the previous new test:

```typescript
it('should not merge content across tool event boundaries', async () => {
    mockSendMessage.mockImplementation(async (opts: any) => {
        if (opts.onStreamingChunk) opts.onStreamingChunk('before ');
        if (opts.onToolEvent) {
            opts.onToolEvent({ type: 'tool-start', toolCallId: 'tc-bnd-1', toolName: 'grep' });
        }
        if (opts.onStreamingChunk) opts.onStreamingChunk('after');
        return { success: true, response: 'before after', sessionId: 'sess-tl-bnd' };
    });

    const executor = new CLITaskExecutor(store);
    const task: QueuedTask = {
        id: 'task-tl-bnd',
        type: 'ai-clarification',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: { prompt: 'test' },
        config: {},
    };

    await executor.execute(task);

    const process = await store.getProcess('queue_task-tl-bnd');
    const assistantTurn = process!.conversationTurns!.find(t => t.role === 'assistant');
    expect(assistantTurn).toBeDefined();
    // content → tool-start → content = 3 items (tool breaks merge)
    expect(assistantTurn!.timeline.length).toBe(3);
    expect(assistantTurn!.timeline[0].type).toBe('content');
    expect(assistantTurn!.timeline[0].content).toBe('before ');
    expect(assistantTurn!.timeline[1].type).toBe('tool-start');
    expect(assistantTurn!.timeline[2].type).toBe('content');
    expect(assistantTurn!.timeline[2].content).toBe('after');
});
```

#### 7. New test: `'should preserve first timestamp when merging content items'`

Add after the previous new test:

```typescript
it('should preserve first timestamp when merging content items', async () => {
    mockSendMessage.mockImplementation(async (opts: any) => {
        if (opts.onStreamingChunk) {
            opts.onStreamingChunk('first ');
            opts.onStreamingChunk('second');
        }
        return { success: true, response: 'first second', sessionId: 'sess-tl-tstamp' };
    });

    const executor = new CLITaskExecutor(store);
    const task: QueuedTask = {
        id: 'task-tl-tstamp',
        type: 'ai-clarification',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: { prompt: 'test' },
        config: {},
    };

    await executor.execute(task);

    const process = await store.getProcess('queue_task-tl-tstamp');
    const assistantTurn = process!.conversationTurns!.find(t => t.role === 'assistant');
    expect(assistantTurn).toBeDefined();
    expect(assistantTurn!.timeline.length).toBe(1);
    // Timestamp should be a valid Date (the first chunk's timestamp)
    expect(assistantTurn!.timeline[0].timestamp).toBeInstanceOf(Date);
});
```

#### 8. New test: `'should handle complex merge boundaries with multiple tool types'`

Add after the previous new test:

```typescript
it('should handle complex merge boundaries with multiple tool types', async () => {
    mockSendMessage.mockImplementation(async (opts: any) => {
        // content → content → tool-start → tool-complete → content → content
        if (opts.onStreamingChunk) opts.onStreamingChunk('a');
        if (opts.onStreamingChunk) opts.onStreamingChunk('b');
        if (opts.onToolEvent) {
            opts.onToolEvent({ type: 'tool-start', toolCallId: 'tc-cx-1', toolName: 'view' });
            opts.onToolEvent({ type: 'tool-complete', toolCallId: 'tc-cx-1', toolName: 'view', result: 'ok' });
        }
        if (opts.onStreamingChunk) opts.onStreamingChunk('c');
        if (opts.onStreamingChunk) opts.onStreamingChunk('d');
        return { success: true, response: 'abcd', sessionId: 'sess-tl-cx' };
    });

    const executor = new CLITaskExecutor(store);
    const task: QueuedTask = {
        id: 'task-tl-cx',
        type: 'ai-clarification',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: { prompt: 'test' },
        config: {},
    };

    await executor.execute(task);

    const process = await store.getProcess('queue_task-tl-cx');
    const assistantTurn = process!.conversationTurns!.find(t => t.role === 'assistant');
    expect(assistantTurn).toBeDefined();
    // merged-content('ab') → tool-start → tool-complete → merged-content('cd')
    expect(assistantTurn!.timeline.length).toBe(4);
    expect(assistantTurn!.timeline[0].type).toBe('content');
    expect(assistantTurn!.timeline[0].content).toBe('ab');
    expect(assistantTurn!.timeline[1].type).toBe('tool-start');
    expect(assistantTurn!.timeline[2].type).toBe('tool-complete');
    expect(assistantTurn!.timeline[3].type).toBe('content');
    expect(assistantTurn!.timeline[3].content).toBe('cd');
});
```

## Acceptance Criteria

- [ ] `appendTimelineItem()` merges consecutive `type: 'content'` items by concatenating `content` strings
- [ ] Tool events (`tool-start`, `tool-complete`, `tool-failed`) always push new entries (never merged)
- [ ] First item's timestamp is preserved when merging
- [ ] SSE streaming (`emitProcessOutput`) unaffected — still emits per-token
- [ ] Existing test updated: `'should append content chunks to assistant turn timeline'` expects 1 merged item
- [ ] Existing tests unchanged: chronological order, follow-up, interleave (no consecutive content in those)
- [ ] 4 new tests passing: merge, boundary, timestamp preservation, complex boundaries
- [ ] `npm run test` passes (full suite)

## Risk Assessment

**Low risk.** The change is ~8 lines in a single private method. SSE streaming is unaffected because `emitProcessOutput()` is called before `appendTimelineItem()`. The timeline buffer is only consumed for persisting conversation turns and for the dashboard UI — both benefit from fewer, larger items.
