---
status: pending
---

# 002: SSE Handler – Mid-Stream Client Disconnect Cleanup

## Summary
Add tests confirming that when a client closes an SSE connection mid-stream (`req.emit('close')`), the server-side subscription is removed and no further output events are written to the response.

## Motivation
The server cleanup lambda (`req.on('close', cleanup)`) cancels the `onProcessOutput` subscription and clears the heartbeat timer. This is completely untested — if it regressed, chunks would continue to be written to a destroyed response, causing node stream errors in production.

## Changes

### Files to Create
- *(none)*

### Files to Modify
- `packages/coc-server/test/sse-replay.test.ts` — add 2 new tests inside the existing `describe` block
- `packages/coc/test/server/sse-replay.test.ts` — mirror same 2 tests (package-level parity)

### Files to Delete
- *(none)*

## Implementation Notes

The existing test infrastructure in both files already provides everything needed:
- `createMockReq()` returns a `PassThrough` cast to `IncomingMessage` — it has `.emit()` so `(req as any).emit('close')` fires the close event.
- `store.onProcessOutput` is overridden per-test to capture `outputCallback`.
- `createMockRes()` captures all writes in `_chunks`.

### Test 1 – No writes after disconnect
```ts
it('stops writing chunks to response after client disconnects', async () => {
    let outputCallback: ((e: ProcessOutputEvent) => void) | undefined;
    store.onProcessOutput = vi.fn((_id, cb) => {
        outputCallback = cb;
        return () => { outputCallback = undefined; };
    });
    const process = createProcessFixture({ id: 'p-disc', status: 'running', conversationTurns: [] });
    store.processes.set('p-disc', process);

    const req = createMockReq();
    const res = createMockRes();
    handleProcessStream(req as any, res as any, 'p-disc', store);
    await vi.waitFor(() => expect(store.onProcessOutput).toHaveBeenCalled());

    // First chunk arrives before disconnect
    outputCallback!({ type: 'chunk', content: 'before-close' });
    // Client disconnects
    (req as any).emit('close');
    // Second chunk arrives after disconnect — must NOT be written
    outputCallback?.({ type: 'chunk', content: 'after-close' });

    const frames = parseSSEFrames(res._chunks);
    const chunkFrames = frames.filter(f => f.event === 'chunk');
    expect(chunkFrames).toHaveLength(1);
    expect(chunkFrames[0].data).toContain('before-close');
});
```

### Test 2 – Unsubscribe is called on disconnect
```ts
it('calls the store unsubscribe function when client disconnects', async () => {
    const unsubscribe = vi.fn();
    store.onProcessOutput = vi.fn((_id, _cb) => unsubscribe);
    const process = createProcessFixture({ id: 'p-unsub', status: 'running', conversationTurns: [] });
    store.processes.set('p-unsub', process);

    const req = createMockReq();
    const res = createMockRes();
    handleProcessStream(req as any, res as any, 'p-unsub', store);
    await vi.waitFor(() => expect(store.onProcessOutput).toHaveBeenCalled());

    (req as any).emit('close');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
});
```

### Notes
- `vi.waitFor()` is used to ensure the `onProcessOutput` subscription is registered before emitting 'close'. This avoids a race where the close fires before the handler sets up the subscription.
- `outputCallback` becomes `undefined` after unsubscribe (per the return fn in the override), so the optional call `outputCallback?.()` correctly becomes a no-op after disconnect.
- Both tests are deterministic (no timers, no real async AI) — flakiness risk is minimal. Still run 3× before commit.

## Tests
- After `req.emit('close')`: chunks emitted via `outputCallback` are not written to `res`
- After `req.emit('close')`: the unsubscribe function returned by `store.onProcessOutput` is invoked exactly once

## Acceptance Criteria
- [ ] 2 new tests pass in `coc-server/test/sse-replay.test.ts`
- [ ] 2 new tests pass in `coc/test/server/sse-replay.test.ts`
- [ ] Each file run 3 consecutive times — all pass
- [ ] No existing tests broken

## Dependencies
- Depends on: 001 (establishes mock AI patterns; this commit follows same mock-function discipline)

## Assumed Prior State
- Commit 001 has been applied: `ConversationSessionManager` streaming tests exist. This commit is independent of those — it adds to the SSE layer only.
