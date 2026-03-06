---
status: pending
---

# 004: coc SSE Replay – Parity with coc-server (Port Tests 7–10)

## Summary
Port 4 tests that exist in `packages/coc-server/test/sse-replay.test.ts` but are absent from `packages/coc/test/server/sse-replay.test.ts`, bringing the coc package's SSE replay coverage to full parity.

## Motivation
`coc-server` has 10 SSE replay tests; `coc` has only 6. The 4 missing tests cover important behavior: `requestFlush` ordering, no-flush for completed processes, full turn-structure preservation across reconnect, and `suggestions` event forwarding. Any regression in these areas would go undetected when testing the coc package in isolation.

## Changes

### Files to Create
- *(none)*

### Files to Modify
- `packages/coc/test/server/sse-replay.test.ts` — add 4 new `it` blocks within the existing `describe` block, after test 6

### Files to Delete
- *(none)*

## Implementation Notes

Copy the following 4 tests verbatim from `packages/coc-server/test/sse-replay.test.ts`, adjusting only the process IDs to avoid collision with the existing 6 tests (use `'p7b'`, `'p8b'`, `'p9b'`, `'p10b'` or similar).

### Test 7 – `requestFlush` called before snapshot for running processes
```ts
it('calls requestFlush before snapshot for running processes', async () => {
    store.requestFlush = vi.fn(async (id: string) => {
        const p = store.processes.get(id)!;
        p.conversationTurns = [
            makeTurn('user', 'First question'),
            makeTurn('assistant', 'Flushed answer'),
        ];
    });
    const process = createProcessFixture({
        id: 'p7b',
        status: 'running',
        conversationTurns: [makeTurn('user', 'First question')],
    });
    store.processes.set('p7b', process);

    const req = createMockReq();
    const res = createMockRes();
    handleProcessStream(req as any, res as any, 'p7b', store);
    await vi.waitFor(() => expect(res._chunks.length).toBeGreaterThan(0));

    expect(store.requestFlush).toHaveBeenCalledWith('p7b');
    const frames = parseSSEFrames(res._chunks);
    const snapshot = frames.find(f => f.event === 'conversation-snapshot');
    const data = JSON.parse(snapshot!.data);
    expect(data.turns).toHaveLength(2);
    expect(data.turns[1].content).toBe('Flushed answer');
});
```

### Test 8 – No `requestFlush` for completed processes
```ts
it('does not call requestFlush for completed processes', async () => {
    store.requestFlush = vi.fn();
    const process = createProcessFixture({
        id: 'p8b',
        status: 'completed',
        conversationTurns: [makeTurn('user', 'Hello'), makeTurn('assistant', 'Hi')],
    });
    store.processes.set('p8b', process);

    const req = createMockReq();
    const res = createMockRes();
    await handleProcessStream(req as any, res as any, 'p8b', store);

    expect(store.requestFlush).not.toHaveBeenCalled();
});
```

### Test 9 – Complete turn structure preserved across reconnect
```ts
it('snapshot preserves complete turn structure across reconnect', async () => {
    const turns = [
        makeTurn('user', 'Q1'), makeTurn('assistant', 'A1'),
        makeTurn('user', 'Q2'), makeTurn('assistant', 'A2'),
        makeTurn('user', 'Q3'), { ...makeTurn('assistant', 'A3'), streaming: true },
    ];
    const process = createProcessFixture({ id: 'p9b', status: 'running', conversationTurns: turns });
    store.processes.set('p9b', process);

    const req = createMockReq();
    const res = createMockRes();
    handleProcessStream(req as any, res as any, 'p9b', store);
    await vi.waitFor(() => expect(res._chunks.length).toBeGreaterThan(0));

    const frames = parseSSEFrames(res._chunks);
    const snapshot = frames.find(f => f.event === 'conversation-snapshot');
    const data = JSON.parse(snapshot!.data);
    expect(data.turns).toHaveLength(6);
    expect(data.turns.map((t: any) => t.role)).toEqual([
        'user', 'assistant', 'user', 'assistant', 'user', 'assistant',
    ]);
    expect(data.turns[5].streaming).toBe(true);
});
```

### Test 10 – `suggestions` event forwarded to SSE stream
```ts
it('forwards suggestions event to SSE stream', async () => {
    let outputCallback: ((e: ProcessOutputEvent) => void) | undefined;
    store.onProcessOutput = vi.fn((_id, cb) => {
        outputCallback = cb;
        return () => {};
    });
    const process = createProcessFixture({ id: 'p10b', status: 'running', conversationTurns: [] });
    store.processes.set('p10b', process);

    const req = createMockReq();
    const res = createMockRes();
    handleProcessStream(req as any, res as any, 'p10b', store);
    await vi.waitFor(() => expect(store.onProcessOutput).toHaveBeenCalled());

    outputCallback!({
        type: 'suggestions',
        suggestions: ['Try this', 'Or that'],
        turnIndex: 2,
    } as any);

    const frames = parseSSEFrames(res._chunks);
    const suggFrame = frames.find(f => f.event === 'suggestions');
    expect(suggFrame).toBeDefined();
    const data = JSON.parse(suggFrame!.data);
    expect(data.suggestions).toEqual(['Try this', 'Or that']);
    expect(data.turnIndex).toBe(2);
});
```

### Import additions
The `coc` SSE test imports `handleProcessStream` from `@plusplusoneplusplus/coc-server` (not local src). No import changes needed — `ProcessOutputEvent` is already imported from `@plusplusoneplusplus/pipeline-core`.

## Tests
- `requestFlush` is called before the snapshot for a running process
- `requestFlush` is NOT called for a completed process
- Snapshot turn array has correct length, roles, and `streaming` flag for a 6-turn process
- `suggestions` output event is forwarded as `event: suggestions` SSE frame with correct payload

## Acceptance Criteria
- [ ] 4 new tests pass in `coc/test/server/sse-replay.test.ts`
- [ ] `coc/test/server/sse-replay.test.ts` now has 10 tests matching `coc-server/test/sse-replay.test.ts`
- [ ] File run 3 consecutive times — all pass
- [ ] No existing tests broken

## Dependencies
- Depends on: None (purely additive, no dependency on commits 001–003)

## Assumed Prior State
- Commits 001–003 applied. The `store.requestFlush` mock pattern (from commit 002's `vi.fn()` override discipline) is established, but this commit does not use it directly — it follows the existing coc-server test pattern.
