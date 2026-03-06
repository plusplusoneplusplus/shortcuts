---
status: pending
---

# 003: SSE Handler – Process-Not-Found Edge Case

## Summary
Add tests verifying that `handleProcessStream` responds with a 404 error when the requested process ID does not exist in the store, rather than crashing or silently hanging.

## Motivation
The process-not-found path is entirely untested. If `store.getProcess` returns `undefined` or `null`, the handler should close the connection with a 404 — but this is never verified. A regression would result in unhandled promise rejections or infinite-hanging SSE connections in production.

## Changes

### Files to Create
- *(none)*

### Files to Modify
- `packages/coc-server/test/sse-replay.test.ts` — add 1 new test
- `packages/coc/test/server/sse-replay.test.ts` — mirror same test

### Files to Delete
- *(none)*

## Implementation Notes

`MockProcessStore.getProcess` is a `vi.fn()` backed by `store.processes.get(id)`. If a process ID is not in `store.processes`, it naturally returns `undefined`. No override is needed — just call `handleProcessStream` with an ID that was never inserted.

### Test – 404 for unknown process
```ts
it('returns 404 when the process does not exist in the store', async () => {
    const req = createMockReq();
    const res = createMockRes();

    await handleProcessStream(req as any, res as any, 'nonexistent-id', store);

    expect(res._statusCode).toBe(404);
    expect(res._ended).toBe(true);
    // Must not emit any SSE frames (no conversation-snapshot, no status, no done)
    const frames = parseSSEFrames(res._chunks);
    expect(frames).toHaveLength(0);
});
```

### What to verify in source before implementing
Before writing the test, check `packages/coc-server/src/sse-handler.ts` for what actually happens when `getProcess()` returns `undefined`:
- If the handler already calls `res.writeHead(404)` + `res.end()` → the test above is correct as written.
- If the handler does NOT handle null today → the test will fail and the implementer must also fix the source (add a null-guard). Document this finding in the commit message.

Either way, the test is the desired contract. If the source needs fixing, that fix is part of this commit.

### Null-guard pattern to add (if missing)
```ts
const process = await store.getProcess(processId);
if (!process) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Process not found: ${processId}` }));
    return;
}
```

This should be inserted after the `store.getProcess` call at the top of `handleProcessStream`, before any SSE headers are sent.

### Notes
- This is the one commit in this series where source code may need changing alongside the test. The test is still the primary artifact.
- Run the source check first; if source already handles it, the test file is the only change.

## Tests
- `handleProcessStream` with unknown process ID → `res.writeHead(404)` + `res.end()` called, zero SSE frames written

## Acceptance Criteria
- [ ] 1 new test passes in `coc-server/test/sse-replay.test.ts`
- [ ] 1 new test passes in `coc/test/server/sse-replay.test.ts`
- [ ] If `sse-handler.ts` lacked a null-guard, the guard is added as part of this commit
- [ ] Each file run 3 consecutive times — all pass
- [ ] No existing tests broken

## Dependencies
- Depends on: None (independent of 001 and 002)

## Assumed Prior State
- Commits 001 and 002 have been applied. The `createMockReq`, `createMockRes`, `parseSSEFrames` helpers and `store` variable are already established in both test files.
