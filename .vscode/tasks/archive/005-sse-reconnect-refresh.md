---
status: pending
---

# 005: SSE Reconnect-After-Refresh Integration Tests

## Summary
Add a new test file covering the full page-refresh recovery scenario: a client connects to a running SSE stream, disconnects, then reconnects — verifying it receives the full conversation snapshot (including any turns that arrived between disconnect and reconnect) and continues to receive live chunks.

## Motivation
This is the highest-priority gap: the primary recovery mechanism after a browser refresh is completely untested end-to-end. The `conversation-snapshot` replay is the core feature that makes refresh-recovery work, but no test exercises the full disconnect → reconnect → snapshot → live-chunks cycle.

## Changes

### Files to Create
- `packages/coc-server/test/sse-reconnect.test.ts` — new test file (3 tests)
- `packages/coc/test/server/sse-reconnect.test.ts` — mirror (imports from package instead of src)

### Files to Modify
- *(none)*

### Files to Delete
- *(none)*

## Implementation Notes

### File header (coc-server version)
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ConversationTurn, ProcessOutputEvent } from '@plusplusoneplusplus/pipeline-core';
import { handleProcessStream } from '../src/sse-handler';
import { createMockProcessStore, createProcessFixture } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';
```

For `coc` version, replace the `handleProcessStream` import:
```ts
import { handleProcessStream } from '@plusplusoneplusplus/coc-server';
import { createMockProcessStore, createProcessFixture } from '../helpers/mock-process-store';
```

### Helpers (local to this file — copied pattern from sse-replay.test.ts)
```ts
function createMockReq() { return new PassThrough() as unknown as IncomingMessage; }
function createMockRes() {
    const _chunks: string[] = [];
    return {
        writeHead: vi.fn((status: number) => { res._statusCode = status; }),
        flushHeaders: vi.fn(),
        write: vi.fn((chunk: string) => { _chunks.push(chunk); return true; }),
        end: vi.fn(() => { res._ended = true; }),
        _chunks, _ended: false, _statusCode: 200,
    } as any;
    // capture by ref trick: use a proper let binding in real implementation
}
function makeTurn(role: 'user' | 'assistant', content: string): ConversationTurn {
    return { role, content, timestamp: new Date('2026-01-01'), timeline: [] };
}
function parseSSEFrames(chunks: string[]) {
    return chunks.join('').split('\n\n').filter(Boolean).map(block => {
        const lines = block.split('\n');
        const event = lines.find(l => l.startsWith('event:'))?.slice(6).trim() ?? 'message';
        const data = lines.find(l => l.startsWith('data:'))?.slice(5).trim() ?? '';
        return { event, data };
    });
}
```

### Test 1 – Reconnect receives same snapshot
```ts
it('reconnect after page refresh receives the full conversation snapshot again', async () => {
    const turns = [makeTurn('user', 'First'), makeTurn('assistant', 'Response')];
    const process = createProcessFixture({ id: 'p-refresh', status: 'running', conversationTurns: turns });
    store.processes.set('p-refresh', process);

    // First connection
    const req1 = createMockReq(); const res1 = createMockRes();
    handleProcessStream(req1 as any, res1 as any, 'p-refresh', store);
    await vi.waitFor(() => expect(res1._chunks.length).toBeGreaterThan(0));
    (req1 as any).emit('close'); // simulate page refresh / tab close

    // Second connection (after refresh)
    const req2 = createMockReq(); const res2 = createMockRes();
    handleProcessStream(req2 as any, res2 as any, 'p-refresh', store);
    await vi.waitFor(() => expect(res2._chunks.length).toBeGreaterThan(0));

    const frames2 = parseSSEFrames(res2._chunks);
    const snapshot2 = frames2.find(f => f.event === 'conversation-snapshot');
    expect(snapshot2).toBeDefined();
    const data2 = JSON.parse(snapshot2!.data);
    expect(data2.turns).toHaveLength(2);
    expect(data2.turns[0].content).toBe('First');
    expect(data2.turns[1].content).toBe('Response');
});
```

### Test 2 – Snapshot after reconnect includes turns added between connections
```ts
it('snapshot on reconnect includes turns that arrived between disconnect and reconnect', async () => {
    const process = createProcessFixture({
        id: 'p-newturns',
        status: 'running',
        conversationTurns: [makeTurn('user', 'Q1')],
    });
    store.processes.set('p-newturns', process);

    // First connection — connect and immediately disconnect
    const req1 = createMockReq(); const res1 = createMockRes();
    handleProcessStream(req1 as any, res1 as any, 'p-newturns', store);
    await vi.waitFor(() => expect(res1._chunks.length).toBeGreaterThan(0));
    (req1 as any).emit('close');

    // Simulate AI replying between connections (store updated)
    process.conversationTurns!.push(makeTurn('assistant', 'A1'));
    process.conversationTurns!.push(makeTurn('user', 'Q2'));

    // Second connection — should see all 3 turns
    const req2 = createMockReq(); const res2 = createMockRes();
    handleProcessStream(req2 as any, res2 as any, 'p-newturns', store);
    await vi.waitFor(() => expect(res2._chunks.length).toBeGreaterThan(0));

    const frames2 = parseSSEFrames(res2._chunks);
    const snapshot2 = frames2.find(f => f.event === 'conversation-snapshot');
    const data2 = JSON.parse(snapshot2!.data);
    expect(data2.turns).toHaveLength(3);
    expect(data2.turns[2].content).toBe('Q2');
});
```

### Test 3 – Partial streaming turn preserved across reconnect
```ts
it('snapshot on reconnect preserves streaming:true flag on a partial assistant turn', async () => {
    const partialTurn = { ...makeTurn('assistant', 'So far...'), streaming: true };
    const process = createProcessFixture({
        id: 'p-partial',
        status: 'running',
        conversationTurns: [makeTurn('user', 'Tell me'), partialTurn],
    });
    store.processes.set('p-partial', process);

    const req1 = createMockReq(); const res1 = createMockRes();
    handleProcessStream(req1 as any, res1 as any, 'p-partial', store);
    await vi.waitFor(() => expect(res1._chunks.length).toBeGreaterThan(0));
    (req1 as any).emit('close');

    const req2 = createMockReq(); const res2 = createMockRes();
    handleProcessStream(req2 as any, res2 as any, 'p-partial', store);
    await vi.waitFor(() => expect(res2._chunks.length).toBeGreaterThan(0));

    const frames2 = parseSSEFrames(res2._chunks);
    const snapshot2 = frames2.find(f => f.event === 'conversation-snapshot');
    const data2 = JSON.parse(snapshot2!.data);
    expect(data2.turns[1].streaming).toBe(true);
    expect(data2.turns[1].content).toBe('So far...');
});
```

### Flakiness mitigation
- `vi.waitFor()` with default 1000ms timeout replaces any `setTimeout` delay.
- No real timers — all async is resolved via `vi.waitFor()` polling.
- No AI calls — store is seeded directly.
- Run each file 3 consecutive times before commit.

## Tests
- Reconnect gets the full snapshot it missed during the first connection
- Turns added between disconnect and reconnect appear in the new snapshot
- `streaming: true` on a partial turn is preserved in the reconnect snapshot

## Acceptance Criteria
- [ ] 3 tests pass in `coc-server/test/sse-reconnect.test.ts`
- [ ] 3 tests pass in `coc/test/server/sse-reconnect.test.ts`
- [ ] Each file run 3 consecutive times — all pass
- [ ] No existing tests broken

## Dependencies
- Depends on: 002 (the disconnect cleanup — `req.emit('close')` pattern is established and proven there)

## Assumed Prior State
- Commit 002 is applied: mid-stream disconnect tests exist and the `(req as any).emit('close')` pattern is validated. This commit reuses the same pattern in a new file.
