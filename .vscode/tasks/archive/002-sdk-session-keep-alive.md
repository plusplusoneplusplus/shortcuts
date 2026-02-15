---
status: pending
---

# 002: SDK Session Keep-Alive and Follow-Up Message Support

**Depends on:** 001
**Commit message:** `Add SDK session keep-alive and follow-up message support`

---

## Problem

Direct SDK sessions (`usePool: false`) are destroyed in the `finally` block of `sendMessageDirect()` immediately after the first message completes (line ~663-675 of `copilot-sdk-service.ts`). Multi-turn conversation requires keeping a session alive across multiple user messages so the AI retains context from earlier turns.

## Current Behaviour

```
sendMessageDirect()
  → client.createSession()
  → session.sendAndWait() / sendWithStreaming()
  → finally { session.destroy() }   ← always destroys
```

The `activeSessions` map exists solely for cancellation (`abortSession`); it does **not** extend the session lifetime beyond the single `sendMessageDirect` call.

## Desired Behaviour

1. When `keepAlive: true` is passed in `SendMessageOptions`, the session survives after `sendMessage` returns.
2. A new `sendFollowUp(sessionId, prompt, options?)` method sends subsequent messages to a kept-alive session.
3. Sessions are explicitly destroyed via `destroySession(sessionId)` or automatically after an idle timeout (default 10 minutes).

---

## Design

### 1. New `keepAlive` option on `SendMessageOptions`

**File:** `packages/pipeline-core/src/copilot-sdk-wrapper/types.ts`

Add to the `SendMessageOptions` interface:

```ts
/**
 * When true, the session is NOT destroyed after the first message completes.
 * The returned `sessionId` can be passed to `sendFollowUp()` for multi-turn conversation.
 * Only applies to direct sessions (usePool: false).
 * @default false
 */
keepAlive?: boolean;
```

No other type changes needed here — `SDKInvocationResult` already carries `sessionId`.

### 2. Kept-alive session store

**File:** `packages/pipeline-core/src/copilot-sdk-wrapper/copilot-sdk-service.ts`

Add a **separate** map from `activeSessions` (which is for in-flight cancellation):

```ts
interface KeptAliveSession {
    session: ICopilotSession;
    createdAt: number;
    lastUsedAt: number;
}

/** Sessions kept alive for multi-turn conversation */
private keptAliveSessions: Map<string, KeptAliveSession> = new Map();

/** Default idle timeout for kept-alive sessions (10 minutes) */
private static readonly KEEP_ALIVE_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/** Cleanup interval for kept-alive sessions (1 minute) */
private static readonly KEEP_ALIVE_CLEANUP_INTERVAL_MS = 60 * 1000;

/** Timer handle for kept-alive session cleanup */
private keepAliveCleanupTimer?: ReturnType<typeof setInterval>;
```

**Rationale for a separate map:** `activeSessions` entries are removed as soon as the request completes; kept-alive sessions must persist across requests. Mixing the two would break the existing cancellation/tracking contract.

### 3. Modify `sendMessageDirect()` — conditional destroy

In the `finally` block (~line 663), change:

```ts
// Before
finally {
    if (session) {
        this.untrackSession(session.sessionId);
        try {
            await session.destroy();
        } catch (destroyError) { /* ... */ }
    }
}

// After
finally {
    if (session) {
        this.untrackSession(session.sessionId);
        if (options.keepAlive && result?.success) {
            // Preserve session for follow-up messages
            const now = Date.now();
            this.keptAliveSessions.set(session.sessionId, {
                session,
                createdAt: now,
                lastUsedAt: now,
            });
            this.ensureKeepAliveCleanupTimer();
            logger.debug(LogCategory.AI,
                `CopilotSDKService [${session.sessionId}]: Session kept alive for follow-up`);
        } else {
            try {
                await session.destroy();
                logger.debug(LogCategory.AI,
                    `CopilotSDKService [${session.sessionId}]: Session destroyed`);
            } catch (destroyError) {
                logger.debug(LogCategory.AI,
                    `CopilotSDKService [${session.sessionId}]: Warning: Error destroying session: ${destroyError}`);
            }
        }
    }
}
```

A small refactor: capture the result into a local `let result: SDKInvocationResult` before the `finally` block so `keepAlive` can be gated on success. On failure, always destroy to avoid leaking broken sessions.

### 4. `sendFollowUp()` method

**File:** `packages/pipeline-core/src/copilot-sdk-wrapper/copilot-sdk-service.ts`

```ts
/**
 * Options for follow-up messages on a kept-alive session.
 */
export interface SendFollowUpOptions {
    /** Optional timeout in milliseconds (default: DEFAULT_AI_TIMEOUT_MS) */
    timeoutMs?: number;
    /** Callback for streaming chunks */
    onStreamingChunk?: (chunk: string) => void;
}

/**
 * Send a follow-up message to a kept-alive session.
 *
 * @param sessionId - The session ID returned from a previous sendMessage({ keepAlive: true }) call
 * @param prompt - The follow-up prompt
 * @param options - Optional timeout and streaming settings
 * @returns SDKInvocationResult with the same sessionId
 * @throws Error if the session is not found or has been destroyed
 */
public async sendFollowUp(
    sessionId: string,
    prompt: string,
    options?: SendFollowUpOptions,
): Promise<SDKInvocationResult> {
    const logger = getLogger();
    const entry = this.keptAliveSessions.get(sessionId);
    if (!entry) {
        return {
            success: false,
            error: `Session ${sessionId} not found or has expired`,
        };
    }

    const { session } = entry;
    const startTime = Date.now();
    const timeoutMs = options?.timeoutMs ?? CopilotSDKService.DEFAULT_TIMEOUT_MS;

    // Track for cancellation during the call
    this.trackSession(session);

    try {
        let response: string;
        let tokenUsage: TokenUsage | undefined;
        let turnCount = 0;

        if ((options?.onStreamingChunk || timeoutMs > 120000) && session.on && session.send) {
            const streamingResult = await this.sendWithStreaming(
                session, prompt, timeoutMs, options?.onStreamingChunk,
            );
            response = streamingResult.response;
            tokenUsage = streamingResult.tokenUsage;
            turnCount = streamingResult.turnCount;
        } else {
            const result = await this.sendWithTimeout(session, prompt, timeoutMs);
            response = result?.data?.content || '';
        }

        // Update last-used timestamp
        entry.lastUsedAt = Date.now();

        const durationMs = Date.now() - startTime;
        logger.debug(LogCategory.AI,
            `CopilotSDKService [${sessionId}]: Follow-up completed in ${durationMs}ms`);

        if (!response && turnCount > 0) {
            return { success: true, response: '', sessionId, tokenUsage };
        }
        if (!response) {
            return { success: false, error: 'No response received', sessionId, tokenUsage };
        }

        return { success: true, response, sessionId, tokenUsage };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(LogCategory.AI,
            `CopilotSDKService [${sessionId}]: Follow-up failed: ${errorMessage}`,
            error instanceof Error ? error : undefined);

        // Destroy the broken session
        this.keptAliveSessions.delete(sessionId);
        try { await session.destroy(); } catch { /* ignore */ }

        return { success: false, error: `Follow-up error: ${errorMessage}`, sessionId };
    } finally {
        this.untrackSession(sessionId);
    }
}
```

### 5. `destroySession()` public method

**File:** `packages/pipeline-core/src/copilot-sdk-wrapper/copilot-sdk-service.ts`

```ts
/**
 * Explicitly destroy a kept-alive session and free its resources.
 *
 * @param sessionId - The session ID to destroy
 * @returns true if the session was found and destroyed, false if not found
 */
public async destroyKeptAliveSession(sessionId: string): Promise<boolean> {
    const logger = getLogger();
    const entry = this.keptAliveSessions.get(sessionId);
    if (!entry) {
        logger.debug(LogCategory.AI,
            `CopilotSDKService [${sessionId}]: Kept-alive session not found for destroy`);
        return false;
    }

    this.keptAliveSessions.delete(sessionId);
    try {
        await entry.session.destroy();
        logger.debug(LogCategory.AI,
            `CopilotSDKService [${sessionId}]: Kept-alive session destroyed`);
    } catch (error) {
        logger.debug(LogCategory.AI,
            `CopilotSDKService [${sessionId}]: Warning: Error destroying kept-alive session: ${error}`);
    }
    return true;
}
```

### 6. Idle timeout cleanup

Add a private method and timer management, mirroring the pattern from `SessionPool`:

```ts
/**
 * Start the keep-alive cleanup timer (idempotent).
 */
private ensureKeepAliveCleanupTimer(): void {
    if (this.keepAliveCleanupTimer) { return; }
    this.keepAliveCleanupTimer = setInterval(() => {
        this.cleanupIdleKeptAliveSessions().catch(() => { /* ignore */ });
    }, CopilotSDKService.KEEP_ALIVE_CLEANUP_INTERVAL_MS);

    // Don't block Node exit
    if (this.keepAliveCleanupTimer.unref) {
        this.keepAliveCleanupTimer.unref();
    }
}

/**
 * Destroy kept-alive sessions that have been idle beyond the timeout.
 */
private async cleanupIdleKeptAliveSessions(): Promise<number> {
    const logger = getLogger();
    const now = Date.now();
    const expired: string[] = [];

    for (const [sessionId, entry] of this.keptAliveSessions) {
        if (now - entry.lastUsedAt > CopilotSDKService.KEEP_ALIVE_IDLE_TIMEOUT_MS) {
            expired.push(sessionId);
        }
    }

    for (const sessionId of expired) {
        const entry = this.keptAliveSessions.get(sessionId);
        if (entry) {
            this.keptAliveSessions.delete(sessionId);
            try { await entry.session.destroy(); } catch { /* ignore */ }
            logger.debug(LogCategory.AI,
                `CopilotSDKService [${sessionId}]: Idle kept-alive session cleaned up`);
        }
    }

    if (expired.length > 0) {
        logger.debug(LogCategory.AI,
            `CopilotSDKService: Cleaned up ${expired.length} idle kept-alive session(s)`);
    }

    // Stop the timer when no sessions remain
    if (this.keptAliveSessions.size === 0 && this.keepAliveCleanupTimer) {
        clearInterval(this.keepAliveCleanupTimer);
        this.keepAliveCleanupTimer = undefined;
    }

    return expired.length;
}
```

### 7. Update `cleanup()` / `dispose()`

In the existing `cleanup()` method (line ~808), add destruction of kept-alive sessions **before** the active-sessions loop:

```ts
// Destroy all kept-alive sessions
const keepAlivePromises: Promise<void>[] = [];
for (const [, entry] of this.keptAliveSessions) {
    keepAlivePromises.push(entry.session.destroy().catch(() => {}));
}
this.keptAliveSessions.clear();
if (this.keepAliveCleanupTimer) {
    clearInterval(this.keepAliveCleanupTimer);
    this.keepAliveCleanupTimer = undefined;
}
await Promise.allSettled(keepAlivePromises);
```

### 8. Export new symbols from package index

**File:** `packages/pipeline-core/src/copilot-sdk-wrapper/types.ts` — already exports `SendMessageOptions` (which now includes `keepAlive`). No new type file needed.

**File:** `packages/pipeline-core/src/copilot-sdk-wrapper/copilot-sdk-service.ts` — export `SendFollowUpOptions`:

```ts
export { SendFollowUpOptions } from './copilot-sdk-service';
```

**File:** `packages/pipeline-core/src/index.ts` — add to the AI Service export block:

```ts
SendFollowUpOptions,
```

No other re-export wiring needed; `CopilotSDKService` already exposes the new public methods.

---

## File Change Summary

| File | Change |
|---|---|
| `packages/pipeline-core/src/copilot-sdk-wrapper/types.ts` | Add `keepAlive?: boolean` to `SendMessageOptions` |
| `packages/pipeline-core/src/copilot-sdk-wrapper/copilot-sdk-service.ts` | Add `KeptAliveSession` interface, `keptAliveSessions` map, cleanup timer, modify `sendMessageDirect()` finally block, add `sendFollowUp()`, `destroyKeptAliveSession()`, `ensureKeepAliveCleanupTimer()`, `cleanupIdleKeptAliveSessions()`, update `cleanup()` |
| `packages/pipeline-core/src/index.ts` | Export `SendFollowUpOptions` |

---

## Tests

**File:** `packages/pipeline-core/test/copilot-sdk-service-keep-alive.test.ts`

All tests use a mock `ICopilotSession` and a stubbed `CopilotSDKService` (same pattern as existing SDK service tests).

### Test 1 — `keepAlive=true` preserves session after sendMessage

```
Given a sendMessage call with keepAlive: true
When the call completes successfully
Then session.destroy() is NOT called
And the session is stored in keptAliveSessions
And the returned sessionId matches the stored session
```

### Test 2 — `keepAlive=false` (default) destroys session as before

```
Given a sendMessage call without keepAlive (or keepAlive: false)
When the call completes
Then session.destroy() IS called
And keptAliveSessions is empty
```

### Test 3 — `keepAlive=true` with failed request still destroys session

```
Given a sendMessage call with keepAlive: true
When the AI returns an error (success: false)
Then session.destroy() IS called
And keptAliveSessions is empty
```

### Test 4 — `sendFollowUp` on an existing session

```
Given a kept-alive session from a previous sendMessage call
When sendFollowUp(sessionId, 'follow-up prompt') is called
Then session.sendAndWait() is called with the follow-up prompt
And the result contains the same sessionId
And lastUsedAt is updated
```

### Test 5 — `sendFollowUp` with streaming

```
Given a kept-alive session
When sendFollowUp(sessionId, prompt, { onStreamingChunk: cb }) is called
Then sendWithStreaming is used (not sendAndWait)
And the onStreamingChunk callback receives chunks
```

### Test 6 — `sendFollowUp` on non-existent session returns error

```
When sendFollowUp('non-existent-id', prompt) is called
Then it returns { success: false, error: /not found/ }
```

### Test 7 — `sendFollowUp` error destroys the session

```
Given a kept-alive session where session.sendAndWait() throws
When sendFollowUp is called
Then the session is removed from keptAliveSessions
And session.destroy() is called
```

### Test 8 — `destroyKeptAliveSession` cleans up

```
Given a kept-alive session
When destroyKeptAliveSession(sessionId) is called
Then session.destroy() is called
And keptAliveSessions no longer contains the sessionId
And it returns true
```

### Test 9 — `destroyKeptAliveSession` with unknown id returns false

```
When destroyKeptAliveSession('unknown') is called
Then it returns false
```

### Test 10 — Idle timeout cleanup

```
Given a kept-alive session with lastUsedAt 11 minutes ago
When cleanupIdleKeptAliveSessions() runs
Then the session is destroyed and removed
And the cleanup timer is stopped (no remaining sessions)
```

### Test 11 — `cleanup()` destroys all kept-alive sessions

```
Given two kept-alive sessions
When cleanup() is called
Then both sessions are destroyed
And keptAliveSessions is empty
And the cleanup timer is cleared
```

---

## Acceptance Criteria

- [ ] Sessions with `keepAlive: true` survive after `sendMessage` returns
- [ ] `sendFollowUp` works on a kept-alive session and returns the same `sessionId`
- [ ] Streaming works on follow-up messages via `onStreamingChunk`
- [ ] Failed first messages with `keepAlive: true` still destroy the session
- [ ] Sessions are cleaned up after idle timeout (default 10 minutes)
- [ ] `destroyKeptAliveSession()` explicitly frees a session
- [ ] `cleanup()` / `dispose()` destroys all kept-alive sessions
- [ ] All new symbols exported from `pipeline-core` package index
- [ ] All 11 tests pass
- [ ] Existing tests continue to pass (no regressions)
