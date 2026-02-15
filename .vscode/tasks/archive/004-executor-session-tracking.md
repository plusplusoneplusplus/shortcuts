---
status: pending
---

# 004: Wire Queue Executor to Preserve SDK Sessions and Populate Conversation Turns

**Depends on:** 001, 002, 003

---

## Goal

Update `CLITaskExecutor` in `queue-executor-bridge.ts` so that every completed AI task:

1. Keeps the SDK session alive for follow-up messages (`keepAlive: true`)
2. Stores the returned `sdkSessionId` on the process
3. Populates initial `conversationTurns` (user prompt + assistant response)
4. Extends the turns array when `executeFollowUp()` is called

After this commit the process store contains everything needed for the SPA to render a conversation thread and for subsequent follow-up calls to resume the same SDK session.

---

## Relevant Source (read before implementing)

| File | What to look at |
|---|---|
| `packages/coc/src/server/queue-executor-bridge.ts` | `executeWithAI()` (line ~244): builds `sendMessage()` options, handles result. `execute()` (line ~79): post-execution `store.updateProcess()` call. |
| `packages/coc/src/server/api-handler.ts` | `PATCH /api/processes/:id` (line ~447): currently whitelists `status`, `result`, `error`, `endTime`, `structuredResult`, `metadata`. Does **not** yet pass through `sdkSessionId` or `conversationTurns`. |
| `packages/pipeline-core/src/copilot-sdk-wrapper/types.ts` | `SendMessageOptions` (line 171): no `keepAlive` field yet — added by commit 002. `SDKInvocationResult` (line 222): `sessionId` already returned. |
| `packages/pipeline-core/src/ai/process-types.ts` | `AIProcess.sdkSessionId` (line 229) already defined. `conversationTurns` field added by commit 001. |
| `packages/coc/test/server/queue-executor-bridge.test.ts` | Existing mock setup: `mockSendMessage`, `mockIsAvailable`, `createMockStore()`. |

---

## Implementation Steps

### 1. `executeWithAI()` — add `keepAlive: true` and capture session ID

**File:** `packages/coc/src/server/queue-executor-bridge.ts`

In the `sendMessage()` call (currently lines 259-277), add `keepAlive: true` to the options object:

```ts
const result = await sdkService.sendMessage({
    prompt,
    model: task.config.model,
    workingDirectory,
    timeoutMs,
    usePool: false,
    keepAlive: true,                         // ← NEW
    onPermissionRequest: this.approvePermissions ? approveAllPermissions : undefined,
    onStreamingChunk: (chunk: string) => {
        // ... existing streaming logic unchanged ...
    },
});
```

No other callers need changing — `keepAlive` is opt-in and only meaningful for direct sessions.

### 2. `executeWithAI()` — return sessionId alongside response

The method already returns `result.sessionId` in its return value (line 286). No change needed here — the session ID propagates up to `execute()`.

### 3. `execute()` — store `sdkSessionId` and initial `conversationTurns`

**File:** `packages/coc/src/server/queue-executor-bridge.ts`

After the `executeByType()` call succeeds (around line 127), amend the `store.updateProcess()` call to include the new fields.

Extract `sessionId` and `response` from the result, then build the turns array:

```ts
const result = await this.executeByType(task, prompt);

const duration = Date.now() - startTime;
logger.debug(LogCategory.AI, `[QueueExecutor] Task ${task.id} completed in ${duration}ms`);

// Extract session and response data for conversation tracking
const sessionId = (result as any)?.sessionId;
const responseText = (result as any)?.response ?? '';

// Build initial conversation turns
const conversationTurns: ConversationTurn[] = [
    {
        role: 'user',
        content: prompt,
        timestamp: process.startTime.toISOString(),
        turnIndex: 0,
    },
    {
        role: 'assistant',
        content: responseText,
        timestamp: new Date().toISOString(),
        turnIndex: 1,
    },
];

// Update process as completed — now includes session + conversation data
try {
    await this.store.updateProcess(processId, {
        status: 'completed',
        endTime: new Date(),
        result: typeof result === 'string' ? result : JSON.stringify(result),
        sdkSessionId: sessionId,
        conversationTurns,
    });
    this.store.emitProcessComplete(processId, 'completed', `${duration}ms`);
} catch {
    // Non-fatal
}
```

**Import:** Add `ConversationTurn` to the import from `@plusplusoneplusplus/pipeline-core` (type defined in commit 001).

### 4. `executeFollowUp()` — append turns on follow-up

**File:** `packages/coc/src/server/queue-executor-bridge.ts`

The `executeFollowUp()` method (added in commit 003) should:

1. Read the existing process to get current `conversationTurns` array
2. Append a user turn before calling `sendMessage()`
3. Append an assistant turn after streaming completes
4. Persist the updated array

```ts
async executeFollowUp(processId: string, followUpPrompt: string): Promise<unknown> {
    const process = await this.store.getProcess(processId);
    if (!process) {
        throw new Error(`Process not found: ${processId}`);
    }
    if (!process.sdkSessionId) {
        throw new Error(`Process ${processId} has no SDK session — cannot follow up`);
    }

    const existingTurns: ConversationTurn[] = process.conversationTurns ?? [];
    const userTurnIndex = existingTurns.length;

    // Append user turn immediately
    const userTurn: ConversationTurn = {
        role: 'user',
        content: followUpPrompt,
        timestamp: new Date().toISOString(),
        turnIndex: userTurnIndex,
    };
    const updatedTurns = [...existingTurns, userTurn];
    await this.store.updateProcess(processId, { conversationTurns: updatedTurns });

    // Initialize output buffer for streaming
    this.outputBuffers.set(processId, '');

    const sdkService = getCopilotSDKService();
    const result = await sdkService.sendMessage({
        prompt: followUpPrompt,
        sessionId: process.sdkSessionId,        // resume existing session
        workingDirectory: process.workingDirectory,
        keepAlive: true,
        usePool: false,
        onPermissionRequest: this.approvePermissions ? approveAllPermissions : undefined,
        onStreamingChunk: (chunk: string) => {
            const existing = this.outputBuffers.get(processId) ?? '';
            this.outputBuffers.set(processId, existing + chunk);
            try {
                this.store.emitProcessOutput(processId, chunk);
            } catch { /* non-fatal */ }
        },
    });

    if (!result.success) {
        throw new Error(result.error || 'Follow-up execution failed');
    }

    // Append assistant turn
    const responseText = result.response || '(Follow-up completed — no text response)';
    const assistantTurn: ConversationTurn = {
        role: 'assistant',
        content: responseText,
        timestamp: new Date().toISOString(),
        turnIndex: userTurnIndex + 1,
    };

    const finalTurns = [...updatedTurns, assistantTurn];
    await this.store.updateProcess(processId, { conversationTurns: finalTurns });

    // Persist streaming output to disk
    const buffer = this.outputBuffers.get(processId) ?? '';
    this.outputBuffers.delete(processId);
    await this.persistOutput(processId, buffer);

    return { response: responseText, sessionId: result.sessionId };
}
```

### 5. PATCH endpoint — whitelist new fields

**File:** `packages/coc/src/server/api-handler.ts`

In the `PATCH /api/processes/:id` handler (line ~465), add passthrough for the new fields so external callers can also set them:

```ts
const updates: Partial<AIProcess> = {};
if (body.status !== undefined) { updates.status = body.status; }
if (body.result !== undefined) { updates.result = body.result; }
if (body.error !== undefined) { updates.error = body.error; }
if (body.endTime !== undefined) { updates.endTime = new Date(body.endTime); }
if (body.structuredResult !== undefined) { updates.structuredResult = body.structuredResult; }
if (body.metadata !== undefined) { updates.metadata = body.metadata; }
if (body.sdkSessionId !== undefined) { updates.sdkSessionId = body.sdkSessionId; }            // NEW
if (body.conversationTurns !== undefined) { updates.conversationTurns = body.conversationTurns; }  // NEW
```

---

## Tests

**File:** `packages/coc/test/server/queue-executor-bridge.test.ts`

Add a new `describe('session tracking and conversation turns', ...)` block.

### Test 1: `sdkSessionId is stored after task execution`

```ts
it('should store sdkSessionId on the process after successful execution', async () => {
    mockIsAvailable.mockResolvedValue({ available: true });
    mockSendMessage.mockResolvedValue({
        success: true,
        response: 'AI response',
        sessionId: 'sdk-session-abc',
    });

    const executor = new CLITaskExecutor(store);
    const task = makeTask('ai-clarification', { prompt: 'test prompt' });
    await executor.execute(task);

    const processId = `queue-${task.id}`;
    const process = store.processes.get(processId);
    expect(process?.sdkSessionId).toBe('sdk-session-abc');
});
```

### Test 2: `initial conversationTurns are populated`

```ts
it('should populate initial conversationTurns with user + assistant pair', async () => {
    mockIsAvailable.mockResolvedValue({ available: true });
    mockSendMessage.mockResolvedValue({
        success: true,
        response: 'Hello from AI',
        sessionId: 'sess-123',
    });

    const executor = new CLITaskExecutor(store);
    const task = makeTask('ai-clarification', { prompt: 'What is X?' });
    await executor.execute(task);

    const processId = `queue-${task.id}`;
    const process = store.processes.get(processId);
    expect(process?.conversationTurns).toHaveLength(2);

    const [userTurn, assistantTurn] = process!.conversationTurns!;
    expect(userTurn.role).toBe('user');
    expect(userTurn.content).toBe('What is X?');
    expect(userTurn.turnIndex).toBe(0);

    expect(assistantTurn.role).toBe('assistant');
    expect(assistantTurn.content).toBe('Hello from AI');
    expect(assistantTurn.turnIndex).toBe(1);
});
```

### Test 3: `keepAlive: true is passed to sendMessage`

```ts
it('should pass keepAlive: true to sendMessage', async () => {
    mockIsAvailable.mockResolvedValue({ available: true });
    mockSendMessage.mockResolvedValue({ success: true, response: 'ok', sessionId: 's1' });

    const executor = new CLITaskExecutor(store);
    const task = makeTask('ai-clarification', { prompt: 'test' });
    await executor.execute(task);

    expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ keepAlive: true })
    );
});
```

### Test 4: `follow-up appends turns at correct indices`

```ts
it('should append turns at correct indices on follow-up', async () => {
    // Setup: process with 2 existing turns
    const processId = 'queue-test-followup';
    store.processes.set(processId, {
        id: processId,
        status: 'completed',
        sdkSessionId: 'sess-existing',
        conversationTurns: [
            { role: 'user', content: 'initial', timestamp: '...', turnIndex: 0 },
            { role: 'assistant', content: 'reply', timestamp: '...', turnIndex: 1 },
        ],
        // ... other required fields
    } as AIProcess);

    mockIsAvailable.mockResolvedValue({ available: true });
    mockSendMessage.mockResolvedValue({ success: true, response: 'follow-up reply', sessionId: 'sess-existing' });

    const executor = new CLITaskExecutor(store);
    await executor.executeFollowUp(processId, 'What about Y?');

    const updated = store.processes.get(processId);
    expect(updated?.conversationTurns).toHaveLength(4);
    expect(updated?.conversationTurns![2].role).toBe('user');
    expect(updated?.conversationTurns![2].content).toBe('What about Y?');
    expect(updated?.conversationTurns![2].turnIndex).toBe(2);
    expect(updated?.conversationTurns![3].role).toBe('assistant');
    expect(updated?.conversationTurns![3].turnIndex).toBe(3);
});
```

### Test 5: `follow-up throws if no sdkSessionId`

```ts
it('should throw if process has no sdkSessionId', async () => {
    store.processes.set('queue-no-session', {
        id: 'queue-no-session',
        status: 'completed',
        // no sdkSessionId
    } as AIProcess);

    const executor = new CLITaskExecutor(store);
    await expect(executor.executeFollowUp('queue-no-session', 'hi'))
        .rejects.toThrow('no SDK session');
});
```

---

## Acceptance Criteria

- [ ] `sendMessage()` is called with `keepAlive: true` for all AI task types
- [ ] Every completed queue task has `sdkSessionId` stored on the process
- [ ] Every completed queue task has `conversationTurns` with initial user (index 0) + assistant (index 1) pair
- [ ] `executeFollowUp()` appends user turn at `existingTurns.length` and assistant turn at `existingTurns.length + 1`
- [ ] `executeFollowUp()` throws a clear error when `sdkSessionId` is missing
- [ ] PATCH endpoint whitelists `sdkSessionId` and `conversationTurns`
- [ ] All new tests pass (`npm run test:run` in `packages/coc/`)
- [ ] Existing queue-executor-bridge tests remain green

---

## Files Modified

| File | Change |
|---|---|
| `packages/coc/src/server/queue-executor-bridge.ts` | Add `keepAlive: true` to `sendMessage()`, store `sdkSessionId` + `conversationTurns` after execution, implement turn appending in `executeFollowUp()` |
| `packages/coc/src/server/api-handler.ts` | Whitelist `sdkSessionId` and `conversationTurns` in PATCH handler |
| `packages/coc/test/server/queue-executor-bridge.test.ts` | Add 5 tests for session tracking and conversation turns |
