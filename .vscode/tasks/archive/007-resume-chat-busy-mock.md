---
status: pending
---

# 007: resume-chat – Mock-AI Cold Resume & Concurrent Resume Edge Cases

## Summary
Replace the flaky `setTimeout`-dependent resume-chat tests with a mock-store + mock-AI approach, and add three new edge-case tests: cold resume with a null `sdkSessionId`, a concurrent duplicate resume returning a conflict error, and AI unavailable during cold resume.

## Motivation
The existing `resume-chat` integration tests rely on `setTimeout(500ms)` / `setTimeout(1000ms)` delays to let the server start a process before forcing state via `store.updateProcess`. This is inherently flaky on slow CI machines. Additionally, three important edge cases are completely untested: (1) `sdkSessionId` is missing but there is conversation history (cold resume should still be attempted), (2) two concurrent resume requests for the same process ID (race condition), and (3) AI service is unavailable during a cold resume attempt.

## Changes

### Files to Create
- *(none)*

### Files to Modify
- `packages/coc/test/server/resume-chat.test.ts` — add new `describe` block using `createMockProcessStore` + `createMockSDKService`; keep existing tests (they are the acceptance baseline, even if flaky)

### Files to Delete
- *(none)*

## Implementation Notes

### New `describe` block: `'POST /api/queue/:id/resume-chat (mock store)'`

Motivation for a parallel describe rather than replacing existing: the existing tests exercise the real `FileProcessStore` + real HTTP server path and serve as baseline. The new block uses the mock store to be deterministic.

### Mock setup
```ts
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../helpers/mock-sdk-service';
// ... existing imports unchanged ...

describe('POST /api/queue/:id/resume-chat (mock store)', () => {
    let store: MockProcessStore;
    let sdkMocks: ReturnType<typeof createMockSDKService>;
    let server: ExecutionServer;

    beforeEach(async () => {
        store = createMockProcessStore();
        sdkMocks = createMockSDKService();
        // Wire the mock SDK into the module (same vi.mock pattern as executor-session-tracking.test.ts)
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir: os.tmpdir() });
    });

    afterEach(async () => { await server.close(); });
});
```

**Important:** The `vi.mock('@plusplusoneplusplus/pipeline-core', ...)` override injecting `sdkMocks.service` must be at the module level (same as in `executor-session-tracking.test.ts`). Since the existing test file uses `FileProcessStore` at module scope, check whether these mocks can coexist. If there's a conflict, put this describe block in a **new file** `packages/coc/test/server/resume-chat-mock.test.ts` instead.

### Test 1 – Cold resume with null `sdkSessionId`
```ts
it('creates a new process (cold resume) when sdkSessionId is null', async () => {
    const processId = 'proc-null-sid';
    const completedProcess = {
        ...createProcessFixture({ id: processId, status: 'completed' }),
        sdkSessionId: null,
        conversationTurns: [
            { role: 'user', content: 'Hello', timestamp: new Date(), timeline: [] },
            { role: 'assistant', content: 'Hi', timestamp: new Date(), timeline: [] },
        ],
    };
    store.processes.set(processId, completedProcess);

    const res = await postJSON(server, `/api/queue/${processId}/resume-chat`, { message: 'Follow up' });

    // Cold resume should create a new task
    expect([200, 201]).toContain(res.status);
    const body = await res.json();
    expect(body.newTaskId ?? body.taskId).toBeDefined();
});
```

### Test 2 – Concurrent resume requests return conflict on second
```ts
it('returns 409 or 429 when two simultaneous resume requests target the same process', async () => {
    const processId = 'proc-concurrent';
    const completedProcess = {
        ...createProcessFixture({ id: processId, status: 'completed' }),
        sdkSessionId: 'sdk-sess-concurrent',
        conversationTurns: [
            { role: 'user', content: 'Q', timestamp: new Date(), timeline: [] },
        ],
    };
    store.processes.set(processId, completedProcess);

    // Fire two concurrent requests — at least one should fail with a conflict/busy error
    const [res1, res2] = await Promise.all([
        postJSON(server, `/api/queue/${processId}/resume-chat`, { message: 'Request 1' }),
        postJSON(server, `/api/queue/${processId}/resume-chat`, { message: 'Request 2' }),
    ]);

    const statuses = [res1.status, res2.status];
    // One should succeed; the other should indicate conflict (409) or too-many-requests (429)
    expect(statuses.some(s => s === 200 || s === 201)).toBe(true);
    expect(statuses.some(s => s === 409 || s === 429 || s === 503)).toBe(true);
});
```

### Test 3 – AI unavailable during cold resume
```ts
it('returns 503 when AI is unavailable during cold resume', async () => {
    sdkMocks.mockIsAvailable.mockResolvedValue({ available: false });

    const processId = 'proc-no-ai';
    const completedProcess = {
        ...createProcessFixture({ id: processId, status: 'completed' }),
        sdkSessionId: null,
        conversationTurns: [
            { role: 'user', content: 'Q', timestamp: new Date(), timeline: [] },
        ],
    };
    store.processes.set(processId, completedProcess);

    const res = await postJSON(server, `/api/queue/${processId}/resume-chat`, { message: 'Follow up' });
    expect([503, 400]).toContain(res.status);
});
```

### Source code investigation before implementing
Before writing tests, read `packages/coc/src/server/queue-handler.ts` (the resume-chat handler) to verify:
1. How it checks for `sdkSessionId` (null vs undefined vs empty string)
2. Whether it has any mutex/lock to prevent concurrent resumes
3. What error code it returns for AI unavailable

If the concurrent resume test reveals no existing guard, document the gap in the commit message — the test alone (and its expected 409) will serve as the contract.

### Whether to create a new file
If `vi.mock` at module level conflicts with the existing describe blocks (which use real `FileProcessStore`), create `packages/coc/test/server/resume-chat-mock.test.ts` instead of modifying `resume-chat.test.ts`. Note the decision in the commit message.

### Flakiness mitigation
- Use `createMockProcessStore` — no real filesystem, no `setTimeout` delays.
- `vi.mock` for SDK service at module level is deterministic.
- For the concurrent test: use `Promise.all` with immediate requests — no timing gaps.
- Run the modified/new file 3 consecutive times before commit.

## Tests
- Cold resume creates a new process when `sdkSessionId` is null
- Two simultaneous resume requests result in one success and one conflict/busy error
- AI unavailable during cold resume returns a 503 (or 400 with appropriate error)

## Acceptance Criteria
- [ ] 3 new tests pass (in `resume-chat.test.ts` or `resume-chat-mock.test.ts`)
- [ ] File run 3 consecutive times — all pass
- [ ] Existing resume-chat tests are not broken
- [ ] `buildContextPrompt` unit tests still pass (they are unaffected)

## Dependencies
- Depends on: None (independent — tests a different layer than SSE commits)

## Assumed Prior State
- Commits 001–006 applied. The `createMockSDKService` helper (from `packages/coc/test/helpers/mock-sdk-service.ts`) and `createMockProcessStore` are established and used across multiple test files. The `vi.mock` pattern for SDK injection is validated in `executor-session-tracking.test.ts`.
