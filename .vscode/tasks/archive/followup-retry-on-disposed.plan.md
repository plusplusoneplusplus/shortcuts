# Fix: Retry follow-up on disposed connection

## Problem

When `sendFollowUp` encounters a "Connection is disposed" error, the user's follow-up message is permanently lost. The code destroys the broken session and returns `{ success: false }` without attempting recovery. The user sees an empty "Live" response in the web UI and the message never reaches the Copilot session.

**Root cause:** The `keptAliveSessions` map still holds the session entry (it hasn't hit the 10-minute idle timeout), but the underlying JSON-RPC connection inside the `CopilotSession` object has been closed by the Copilot SDK process. When `session.send()` is called, `vscode-jsonrpc` throws `ConnectionError: Connection is disposed (code: 2)`.

**Why the existing resume path doesn't help:** `sendFollowUp` (line 825-828) only calls `resumeKeptAliveSession` when the session is NOT in `keptAliveSessions`. Since the stale session IS still in the map, the resume path is skipped entirely.

## Approach

Add retry-via-resume logic in `sendFollowUp`'s catch block. When a "Connection is disposed" (or similar transport) error occurs, destroy the broken session, attempt `client.resumeSession(sessionId)` to get a fresh connection with the same conversation history, and replay the follow-up prompt.

## Tasks

### 1. Add retry logic in `CopilotSDKService.sendFollowUp`

**File:** `packages/pipeline-core/src/copilot-sdk-wrapper/copilot-sdk-service.ts`

In the `catch` block (line 879-892), after destroying the broken session:
1. Detect if the error is a connection/transport error (check for "Connection is disposed", "connection closed", or error code 2).
2. If yes, log a warning: `"Connection disposed, attempting session resume for retry"`.
3. Call `this.resumeKeptAliveSession(sessionId, options)` to get a fresh session.
4. If resume succeeds, retry the `send`/`sendWithStreaming` call exactly once (reuse the same prompt and options).
5. If retry succeeds, return the result normally.
6. If resume fails or retry fails, return the original error (current behavior).

**Key constraint:** Only retry once to avoid infinite loops. Only retry on connection/transport errors, not on other failures (e.g., content policy, rate limits).

Pseudocode for the catch block:
```typescript
} catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isConnectionError = this.isConnectionDisposedError(error);

    logger.error(LogCategory.AI,
        `CopilotSDKService [${sessionId}]: Follow-up failed: ${errorMessage}`,
        error instanceof Error ? error : undefined);

    // Destroy the broken session
    this.keptAliveSessions.delete(sessionId);
    try { await session.destroy(); } catch { /* ignore */ }

    // Retry once via resume if this was a connection error
    if (isConnectionError) {
        logger.info(LogCategory.AI,
            `CopilotSDKService [${sessionId}]: Connection disposed, attempting resume-and-retry`);
        const resumed = await this.resumeKeptAliveSession(sessionId, options);
        if (resumed) {
            try {
                // Re-execute the follow-up with the fresh session
                // (extract the send logic into a helper to avoid duplication)
                return await this.executeFollowUpSend(resumed, sessionId, prompt, options, startTime);
            } catch (retryError) {
                const retryMsg = retryError instanceof Error ? retryError.message : String(retryError);
                logger.error(LogCategory.AI,
                    `CopilotSDKService [${sessionId}]: Retry after resume also failed: ${retryMsg}`);
                this.keptAliveSessions.delete(sessionId);
                try { await resumed.session.destroy(); } catch { /* ignore */ }
            }
        }
    }

    return { success: false, error: `Follow-up error: ${errorMessage}`, sessionId };
}
```

### 2. Extract send logic into a private helper

**File:** `packages/pipeline-core/src/copilot-sdk-wrapper/copilot-sdk-service.ts`

Extract the try-block body of `sendFollowUp` (lines 843-877) into a private method like `executeFollowUpSend(entry, sessionId, prompt, options, startTime)` to avoid duplicating the send/streaming logic between the initial attempt and the retry.

### 3. Add `isConnectionDisposedError` helper

**File:** `packages/pipeline-core/src/copilot-sdk-wrapper/copilot-sdk-service.ts`

Add a private static method:
```typescript
private static isConnectionDisposedError(error: unknown): boolean {
    if (error instanceof Error) {
        if (error.message.includes('Connection is disposed')) return true;
        if (error.message.includes('connection closed')) return true;
        if ('code' in error && (error as any).code === 2) return true;
    }
    return false;
}
```

### 4. Add tests

**File:** `packages/pipeline-core/test/copilot-sdk-wrapper/copilot-sdk-service.followup-retry.test.ts` (new)

Test cases:
- **Retry succeeds:** Mock `session.send` to throw "Connection is disposed" on first call, mock `resumeSession` to return a fresh session, verify the follow-up is retried and succeeds.
- **Retry fails:** Mock both initial send and retry send to fail, verify the original error is returned.
- **Resume fails:** Mock `resumeSession` to throw, verify the original error is returned without retry.
- **Non-connection error:** Mock `session.send` to throw a different error (e.g., "rate limit"), verify no retry is attempted.
- **Only retries once:** Verify that if the retry also throws "Connection is disposed", it does not attempt a second retry.

### 5. Update AGENTS.md

**File:** `packages/pipeline-core/AGENTS.md`

Add a note to the copilot-sdk module description about the retry-on-disposed behavior:

> **Session resilience:** `sendFollowUp` automatically retries once via `client.resumeSession()` when the underlying JSON-RPC connection is disposed. This handles cases where the Copilot SDK process restarts or the connection drops between turns in a multi-turn conversation.

## Notes

- The `resumeSession` API on the Copilot SDK client re-establishes a connection to an existing session by ID, preserving server-side conversation history. This is the correct recovery mechanism.
- The 10-minute idle timeout (`KEEP_ALIVE_IDLE_TIMEOUT_MS`) is separate from this issue — the connection can die well before the timeout due to external factors.
- No changes needed in `queue-executor-bridge.ts` — the fix is entirely within `CopilotSDKService.sendFollowUp`.
