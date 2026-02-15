---
status: pending
---

# 006: Add State Validation Guards to Session Pool Operations

## Summary

Add defensive state validation guards to `SessionPool` to prevent race conditions between concurrent `acquire()`, `release()`, `cleanupIdleSessions()`, and `dispose()` calls. Introduces a `destroying` flag on pooled session entries, a `disposed` check on all public methods, and a reusable `isSessionUsable()` helper — without changing the pool's overall architecture.

## Motivation

The current `SessionPool` has several gaps that can cause undefined behavior under concurrent use:

1. **acquire() during cleanup**: `cleanupIdleSessions()` deletes sessions from the map and then awaits `destroy()`. Between deletion and destruction, `acquire()` could still reference a session being torn down if timing is unlucky, or a released session could be handed to a waiter after the pool entry was already removed.
2. **release() after destroy**: If a caller holds a session reference and the pool destroys that session (via cleanup or dispose), the subsequent `release()` call finds the entry gone and silently destroys again — a double-destroy that may throw or leak.
3. **No `disposed` guard on non-acquire methods**: Only `acquire()` checks `this.disposed`. Calling `release()`, `destroy()`, `getStats()`, or `cleanupIdleSessions()` on a disposed pool works but can re-add state or trigger confusing side effects.
4. **No logging on guard triggers**: When defensive paths fire, there is no visibility into why — making production debugging harder.

This commit adds targeted guards to close these gaps. It is intentionally minimal: no new concurrency primitives, no architecture changes, just boolean flags and early-return checks with logging.

## Changes

### Files to Create

- **`packages/pipeline-core/test/ai/session-pool-guards.test.ts`**
  New dedicated test file for race condition and guard scenarios. Keeps the existing `copilot-sdk-wrapper.test.ts` (barrel export tests) untouched.

### Files to Modify

- **`packages/pipeline-core/src/copilot-sdk-wrapper/session-pool.ts`**

  1. **Add `destroying` flag to `PooledSession` interface** (line ~56–65):
     ```typescript
     interface PooledSession {
         session: IPoolableSession;
         inUse: boolean;
         lastUsedAt: number;
         createdAt: number;
         destroying: boolean; // NEW — true once async destroy begins
     }
     ```

  2. **Add `isSessionUsable()` private helper** (new method in private section):
     ```typescript
     private isSessionUsable(entry: PooledSession): boolean {
         return !entry.inUse && !entry.destroying;
     }
     ```

  3. **Guard `findIdleSession()`** — use `isSessionUsable()` instead of `!pooledSession.inUse` so sessions mid-destroy are skipped.

  4. **Guard `acquire()`** — after finding an idle session, verify it is still usable (not destroyed concurrently). If found unusable, skip and continue searching. Also set `destroying: false` in `createAndAddSession()`.

  5. **Guard `release()`** — add `disposed` check at entry. When the pool entry exists but has `destroying === true`, do not mark it idle; instead log and return without error.

  6. **Guard `destroy()`** — add `disposed` check at entry (log + proceed with destruction anyway for safety).

  7. **Guard `getStats()`** — add `disposed` check (return zeroed stats if disposed).

  8. **Guard `cleanupIdleSessions()`** — before awaiting `destroySession()`, set `entry.destroying = true` on the entry so concurrent `acquire`/`release` skip it. Skip entries already marked `destroying`.

  9. **Add defensive logging** — each guard branch logs at `debug` level with `LogCategory.AI` prefix `SessionPool:` to match existing convention.

### Files to Delete

None.

## Implementation Notes

- **No async mutex needed.** JavaScript is single-threaded; the race windows exist only across `await` boundaries (e.g., `await destroySession()`). The `destroying` boolean is set synchronously before the await, which is sufficient.
- **`destroying` flag is one-way.** Once set to `true`, the entry is never reused — it will be deleted from the map after the destroy completes. There is no "un-destroy" path.
- **Backward compatibility.** All existing public API signatures remain unchanged. The new `destroying` field is internal to `PooledSession` (not exported). `isSessionUsable()` is private.
- **`createAndAddSession()`** must initialize `destroying: false` in the new `PooledSession` literal to satisfy the updated interface.
- **Double-destroy safety.** `destroySession()` already wraps `session.destroy()` in try/catch, so a redundant call is harmless. The guards reduce — but don't need to eliminate — double destroys.
- **Waiter handoff in `release()`**: When handing a session to a waiter, verify the entry is not `destroying` before resolving. If it is, reject or skip to next waiter and destroy the session instead.

## Tests

All tests go in `packages/pipeline-core/test/ai/session-pool-guards.test.ts` using Vitest.

**Test helper:** Create a `MockSession` implementing `IPoolableSession` with configurable latency on `destroy()` to simulate async timing windows.

| # | Test | What it verifies |
|---|------|------------------|
| 1 | `acquire() skips session being destroyed` | Mark a session as idle, start cleanup, then acquire — should get a new session, not the one being cleaned up |
| 2 | `release() after session removed from pool` | Acquire session, externally delete its pool entry, then release — should destroy session without throwing |
| 3 | `release() on disposed pool destroys session` | Dispose pool, then release a held session — should call destroy, not throw |
| 4 | `release() on destroying session does not mark idle` | Start cleanup on an idle session, then release it before cleanup finishes — should not resurrect it |
| 5 | `cleanupIdleSessions() marks destroying before await` | Verify the `destroying` flag is set synchronously before the async `destroy()` call completes |
| 6 | `cleanupIdleSessions() skips already-destroying sessions` | Manually set `destroying = true` on a session, run cleanup — should not double-destroy |
| 7 | `acquire() on disposed pool throws` | Call acquire after dispose — should throw "SessionPool has been disposed" |
| 8 | `destroy() on disposed pool still destroys session` | Dispose pool, then call destroy with a session — should still call session.destroy() |
| 9 | `getStats() on disposed pool returns zeroed stats` | Dispose pool, call getStats — should return zero for all counts |
| 10 | `isSessionUsable() returns false for in-use sessions` | Internal validation via observable behavior: all in-use sessions are skipped by acquire |
| 11 | `concurrent acquire during cleanup resolves correctly` | Start cleanup (with slow destroy), acquire concurrently — acquire should create a new session rather than waiting |
| 12 | `release() hands session to waiter only if not destroying` | Pool at capacity, one waiter queued, session being released has destroying=true — waiter should not receive it |

Run: `cd packages/pipeline-core && npx vitest run test/ai/session-pool-guards.test.ts`

## Acceptance Criteria

- [ ] `PooledSession` interface includes `destroying: boolean` field
- [ ] `isSessionUsable()` private helper exists and is used in `findIdleSession()`
- [ ] All public methods (`acquire`, `release`, `destroy`, `getStats`, `cleanupIdleSessions`) check `this.disposed` at entry
- [ ] `cleanupIdleSessions()` sets `destroying = true` synchronously before awaiting `destroySession()`
- [ ] `release()` handles the case where the session's pool entry has `destroying === true`
- [ ] `createAndAddSession()` initializes `destroying: false`
- [ ] Guard triggers produce debug-level log messages with `SessionPool:` prefix
- [ ] All 12 new tests pass: `cd packages/pipeline-core && npx vitest run test/ai/session-pool-guards.test.ts`
- [ ] Existing tests unaffected: `cd packages/pipeline-core && npx vitest run`
- [ ] No changes to public API signatures or exported types

## Dependencies

- Depends on: None
