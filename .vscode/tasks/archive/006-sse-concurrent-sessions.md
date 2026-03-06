---
status: pending
---

# 006: SSE Concurrent Sessions & Chat-Switch Isolation

## Summary
Add tests verifying that simultaneous SSE connections to two different processes are fully isolated — each receives only its own snapshot and chunks — and that closing one connection (simulating a chat switch) does not affect the other.

## Motivation
The "jumping between chats" scenario is untested: a user switches from chat A to chat B while A is actively streaming. The old EventSource for A is torn down (client-side `req.emit('close')`) and a new one for B is opened. There is no server-side test verifying: (a) A's subscription is removed, (b) B's subscription is unaffected, (c) A receives no further writes after close.

## Changes

### Files to Create
- `packages/coc-server/test/sse-concurrent-sessions.test.ts` — new test file (3 tests)
- `packages/coc/test/server/sse-concurrent-sessions.test.ts` — mirror (package import)

### Files to Modify
- *(none)*

### Files to Delete
- *(none)*

## Implementation Notes

### Test setup
Each test uses **two independent `MockProcessStore` instances** (one per process) to ensure complete isolation. Alternatively, one store can hold both processes if `onProcessOutput` per-id routing is supported — check if the mock store's `onProcessOutput` override can differentiate by ID. If not, use two store instances.

```ts
let storeA: MockProcessStore;
let storeB: MockProcessStore;
let callbackA: ((e: ProcessOutputEvent) => void) | undefined;
let callbackB: ((e: ProcessOutputEvent) => void) | undefined;

beforeEach(() => {
    storeA = createMockProcessStore();
    storeB = createMockProcessStore();
    storeA.onProcessOutput = vi.fn((_id, cb) => { callbackA = cb; return () => { callbackA = undefined; }; });
    storeB.onProcessOutput = vi.fn((_id, cb) => { callbackB = cb; return () => { callbackB = undefined; }; });
});
```

### Test 1 – Two concurrent connections get their own snapshots
```ts
it('two concurrent SSE connections to different processes each receive their own snapshot', async () => {
    const processA = createProcessFixture({
        id: 'chat-A',
        status: 'running',
        conversationTurns: [makeTurn('user', 'Hello from A'), makeTurn('assistant', 'Reply A')],
    });
    const processB = createProcessFixture({
        id: 'chat-B',
        status: 'running',
        conversationTurns: [makeTurn('user', 'Hello from B')],
    });
    storeA.processes.set('chat-A', processA);
    storeB.processes.set('chat-B', processB);

    const reqA = createMockReq(); const resA = createMockRes();
    const reqB = createMockReq(); const resB = createMockRes();

    handleProcessStream(reqA as any, resA as any, 'chat-A', storeA);
    handleProcessStream(reqB as any, resB as any, 'chat-B', storeB);

    await vi.waitFor(() =>
        resA._chunks.length > 0 && resB._chunks.length > 0
    );

    const snapshotA = parseSSEFrames(resA._chunks).find(f => f.event === 'conversation-snapshot');
    const snapshotB = parseSSEFrames(resB._chunks).find(f => f.event === 'conversation-snapshot');

    expect(JSON.parse(snapshotA!.data).turns).toHaveLength(2);
    expect(JSON.parse(snapshotB!.data).turns).toHaveLength(1);
    expect(JSON.parse(snapshotA!.data).turns[0].content).toBe('Hello from A');
    expect(JSON.parse(snapshotB!.data).turns[0].content).toBe('Hello from B');
});
```

### Test 2 – Closing A's connection does not affect B
```ts
it('closing SSE connection A (chat switch) does not affect connection B live stream', async () => {
    const processA = createProcessFixture({ id: 'switch-A', status: 'running', conversationTurns: [] });
    const processB = createProcessFixture({ id: 'switch-B', status: 'running', conversationTurns: [] });
    storeA.processes.set('switch-A', processA);
    storeB.processes.set('switch-B', processB);

    const reqA = createMockReq(); const resA = createMockRes();
    const reqB = createMockReq(); const resB = createMockRes();

    handleProcessStream(reqA as any, resA as any, 'switch-A', storeA);
    handleProcessStream(reqB as any, resB as any, 'switch-B', storeB);

    await vi.waitFor(() =>
        storeA.onProcessOutput.mock.calls.length > 0 &&
        storeB.onProcessOutput.mock.calls.length > 0
    );

    // Chunk arrives on both before switch
    callbackA!({ type: 'chunk', content: 'A-before-switch' });
    callbackB!({ type: 'chunk', content: 'B-before-switch' });

    // User switches: close A
    (reqA as any).emit('close');

    // Chunks after switch: A should be ignored, B should still arrive
    callbackA?.({ type: 'chunk', content: 'A-after-switch' }); // callbackA is now undefined
    callbackB!({ type: 'chunk', content: 'B-after-switch' });

    const framesA = parseSSEFrames(resA._chunks);
    const framesB = parseSSEFrames(resB._chunks);

    const chunksA = framesA.filter(f => f.event === 'chunk').map(f => JSON.parse(f.data).content);
    const chunksB = framesB.filter(f => f.event === 'chunk').map(f => JSON.parse(f.data).content);

    expect(chunksA).toEqual(['A-before-switch']);            // stopped at switch
    expect(chunksB).toEqual(['B-before-switch', 'B-after-switch']); // unaffected
});
```

### Test 3 – Switch pattern: close A, open B, each gets correct snapshot
```ts
it('chat-switch pattern: close A, immediately open B, B gets correct snapshot', async () => {
    const processA = createProcessFixture({
        id: 'seq-A',
        status: 'running',
        conversationTurns: [makeTurn('user', 'A turn')],
    });
    const processB = createProcessFixture({
        id: 'seq-B',
        status: 'running',
        conversationTurns: [makeTurn('user', 'B turn 1'), makeTurn('assistant', 'B answer')],
    });
    storeA.processes.set('seq-A', processA);
    storeB.processes.set('seq-B', processB);

    // Connect to A
    const reqA = createMockReq(); const resA = createMockRes();
    handleProcessStream(reqA as any, resA as any, 'seq-A', storeA);
    await vi.waitFor(() => resA._chunks.length > 0);

    // Switch: close A, open B
    (reqA as any).emit('close');
    const reqB = createMockReq(); const resB = createMockRes();
    handleProcessStream(reqB as any, resB as any, 'seq-B', storeB);
    await vi.waitFor(() => resB._chunks.length > 0);

    // B should have 2-turn snapshot; A should have stopped
    const snapshotB = parseSSEFrames(resB._chunks).find(f => f.event === 'conversation-snapshot');
    expect(JSON.parse(snapshotB!.data).turns).toHaveLength(2);
    expect(JSON.parse(snapshotB!.data).turns[1].content).toBe('B answer');

    // A is closed — no more writes after 'close'
    callbackA?.({ type: 'chunk', content: 'ghost-chunk' });
    const chunksA = parseSSEFrames(resA._chunks).filter(f => f.event === 'chunk');
    expect(chunksA).toHaveLength(0);
});
```

### Notes on store isolation
If `MockProcessStore.onProcessOutput` is always a single global `vi.fn()` override (not keyed by process ID), the two-store approach above is the safest pattern. Check the mock implementation first — if it supports per-ID routing, a single store can be used.

### Flakiness mitigation
- `vi.waitFor()` with default 1000ms timeout for async SSE setup.
- No wall-clock timers, no real AI calls.
- `callbackA` becomes `undefined` after unsubscribe, so optional chaining `callbackA?.()` makes post-close calls a no-op.
- Run each file 3 consecutive times before commit.

## Tests
- Two concurrent SSE connections get only their own snapshots
- Closing A's connection after a switch stops all writes to A's response while B's stream continues unaffected
- Sequential switch (close A → open B) delivers B's correct snapshot while A is fully stopped

## Acceptance Criteria
- [ ] 3 tests pass in `coc-server/test/sse-concurrent-sessions.test.ts`
- [ ] 3 tests pass in `coc/test/server/sse-concurrent-sessions.test.ts`
- [ ] Each file run 3 consecutive times — all pass
- [ ] No existing tests broken

## Dependencies
- Depends on: 002 (disconnect cleanup validated), 005 (reconnect pattern with two req instances established)

## Assumed Prior State
- Commits 001–005 applied. The `(req as any).emit('close')` pattern, `vi.waitFor()` usage, and `createMockProcessStore` + `createProcessFixture` helpers are all validated in prior commits.
