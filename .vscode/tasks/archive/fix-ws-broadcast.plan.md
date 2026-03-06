# Fix: Queue Pause/Unpause Not Working in SPA Dashboard

## Problem

The Queue pause/unpause button in the SPA dashboard appears to do nothing — the UI briefly shows "Paused" then immediately reverts, or never shows the correct state.

## Root Cause

In `packages/coc/src/server/index.ts` (lines 350–381), the **WebSocket global aggregate broadcast** hardcodes `isPaused: false` (and omits `isDraining`):

```typescript
const combinedStats = { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0, total: 0, isPaused: false };
```

This means every `queue-updated` WebSocket message sent to the SPA always reports `isPaused: false`, regardless of actual pause state.

### What happens step-by-step:

1. User clicks ⏸ → SPA calls `POST /api/queue/pause`
2. Server pauses all managers → each emits a `change` event
3. The `queueChange` bridge listener fires → broadcasts `queue-updated` via WebSocket with **`isPaused: false`** (bug!)
4. SPA receives WS message → dispatches `QUEUE_UPDATED` → UI shows "not paused"
5. Meanwhile, `handlePauseResume()` fetches `GET /api/queue` (which returns correct `isPaused: true`)
6. SPA dispatches `QUEUE_UPDATED` again → UI briefly shows "Paused"
7. But any subsequent queue event (task enqueue/start/complete) triggers another WS broadcast with `isPaused: false` → UI reverts again

The REST API's `aggregateStats()` in `queue-handler.ts` correctly computes `isPaused: any && allPaused`, but the WS broadcast code duplicates the aggregation logic and gets it wrong.

## Fix Plan

### 1. Fix WebSocket broadcast global stats computation

**File:** `packages/coc/src/server/index.ts` (lines 350–381)

Replace the hardcoded `isPaused: false` with proper aggregation logic matching `aggregateStats()` in `queue-handler.ts`:

```typescript
let allPaused = true;
let anyManager = false;
let anyDraining = false;

for (const [, manager] of registry.getAllQueues()) {
    // ... existing aggregation ...
    const s = manager.getStats();
    // ... existing count additions ...
    if (!s.isPaused) { allPaused = false; }
    if (s.isDraining) { anyDraining = true; }
    anyManager = true;
}

combinedStats.isPaused = anyManager && allPaused;
combinedStats.isDraining = anyDraining;
```

### 2. Update existing tests

**File:** `packages/coc/test/server/per-repo-pause-integration.test.ts` (or similar)

Verify the existing tests cover the WebSocket broadcast scenario with pause state. Add test if not covered:
- Pause a queue via API
- Verify the next WS `queue-updated` message has `stats.isPaused === true`

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/index.ts` (~line 354) | Fix `combinedStats.isPaused` computation in WS broadcast |
