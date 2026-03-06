---
status: pending
---

# 001: ConversationSessionManager – Streaming Chunks Delivery & Timer Safety

## Summary
Verify that `onStreamingChunk` is actually invoked with each individual chunk when a mock AI implementation fires them, and that `destroyAll()` properly clears the background cleanup timer to prevent leaks.

## Motivation
The existing test for `onStreamingChunk` only asserts the callback is *passed through* to the underlying `sendMessage` function. It never confirms the callback is actually *called* with real chunk data. The cleanup timer is also never verified to be cleared on `destroyAll()`, leaving a potential timer leak in test environments.

## Changes

### Files to Create
- *(none)*

### Files to Modify
- `packages/coc/test/server/wiki/conversation-session-manager.test.ts` — add two new `describe` blocks with 4 new tests total

### Files to Delete
- *(none)*

## Implementation Notes

### Test 1 – `onStreamingChunk` receives all chunks in order
```ts
it('should invoke onStreamingChunk for each chunk emitted by mock AI', async () => {
    const chunks: string[] = [];
    const mockSend = vi.fn().mockImplementation(async (_prompt: string, opts?: any) => {
        opts?.onStreamingChunk?.('chunk-A');
        opts?.onStreamingChunk?.('chunk-B');
        opts?.onStreamingChunk?.('chunk-C');
        return 'chunk-Achunk-Bchunk-C';
    });
    const manager = createManager({ sendMessage: mockSend });
    const session = manager.create();
    await manager.send(session.sessionId, 'Hello', {
        onStreamingChunk: (c) => chunks.push(c),
    });
    expect(chunks).toEqual(['chunk-A', 'chunk-B', 'chunk-C']);
});
```

### Test 2 – accumulated response matches joined chunks
```ts
it('should return the full accumulated response from a streaming mock AI', async () => {
    const mockSend = vi.fn().mockImplementation(async (_prompt: string, opts?: any) => {
        opts?.onStreamingChunk?.('Hello');
        opts?.onStreamingChunk?.(' world');
        return 'Hello world';
    });
    const manager = createManager({ sendMessage: mockSend });
    const session = manager.create();
    const result = await manager.send(session.sessionId, 'test');
    expect(result.response).toBe('Hello world');
});
```

### Test 3 – turnCount increments even for streaming sends
After the streaming send resolves, `turnCount` should be 1 (the existing test only does this for a non-streaming mock; add a streaming-mock variant for completeness).

### Test 4 – `destroyAll()` clears the cleanup timer
```ts
it('should clear the cleanup interval timer on destroyAll', () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const manager = createManager({ cleanupIntervalMs: 1000 });
    manager.destroyAll();
    expect(clearSpy).toHaveBeenCalled();
    vi.useRealTimers();
    clearSpy.mockRestore();
});
```
Use `vi.useFakeTimers()` / `vi.useRealTimers()` so the test does not depend on wall-clock time. Wrap in a try/finally block to ensure `vi.useRealTimers()` is always called.

### Key pattern
The mock AI for streaming follows the exact same pattern used in `executor-session-tracking.test.ts` (lines 228–234) — call `opts.onStreamingChunk(chunk)` synchronously inside `mockImplementation`. This is safe because `ConversationSessionManager.send()` awaits the `sendMessage` promise, so all chunks fire before the promise resolves.

## Tests
- `onStreamingChunk` is called once per chunk, in order
- Final `result.response` equals the joined chunk string
- `turnCount` increments to 1 after a streaming send
- `destroyAll()` calls `clearInterval` (timer cleanup verified)

## Acceptance Criteria
- [ ] All 4 new tests pass in isolation: `npx vitest run packages/coc/test/server/wiki/conversation-session-manager.test.ts`
- [ ] Run the file 3 consecutive times — all pass (no flakiness)
- [ ] No existing tests in the file are broken

## Dependencies
- Depends on: None

## Assumed Prior State
None — this is the first commit. Modifies a single existing test file using the existing `createManager()` factory already defined in that file.
