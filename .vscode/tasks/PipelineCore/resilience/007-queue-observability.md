---
status: pending
---

# 007: Add drop logging and metrics to server-client queue

## Summary

Add observability to the `ServerClient` bounded queue so that dropped items, backoff transitions, and queue depth are visible through logging, events, and a stats API. No queue behavior changes — purely additive instrumentation.

## Motivation

When the bounded queue in `ServerClient` overflows (default cap: 500), oldest items are silently discarded in `enqueue()` via `this.queue.shift()` with no logging, no event, and no counter. Operators and extension consumers have no way to detect data loss. Similarly, backoff escalation/reset in `flushQueue()` happens without any log trail. This commit closes those observability gaps so that downstream code (dashboards, diagnostics commands, tests) can react to queue pressure.

## Changes

### Files to Create

_None._

### Files to Modify

1. **`src/shortcuts/ai-service/server-client.ts`**

   - Add private field `private droppedCount: number = 0`.
   - Add `EventEmitter` for drop events:
     ```ts
     private readonly _onDidDropItem = new vscode.EventEmitter<{ method: string; path: string; queueSize: number }>();
     readonly onDidDropItem = this._onDidDropItem.event;
     ```
   - In `enqueue()`, when `this.queue.shift()` executes:
     - Increment `this.droppedCount`.
     - Fire `this._onDidDropItem.fire(...)` with the dropped item's method, path, and current queue size.
     - Log a warning: `console.warn(\`[ServerClient] Dropped \${dropped.method} \${dropped.path} (queue full: \${this.queue.length}/\${this.maxQueueSize}, total dropped: \${this.droppedCount})\`)`.
   - Add public method:
     ```ts
     getQueueStats(): { queueSize: number; droppedCount: number; connected: boolean; backoffMs: number } {
         return { queueSize: this.queue.length, droppedCount: this.droppedCount, connected: this._connected, backoffMs: this.backoffMs };
     }
     ```
   - In `flushQueue()` — log when backoff increases (`console.warn`) and when it resets to 1 000 ms (`console.log` or `console.debug`).
   - Add periodic stats logging: start an `setInterval` (60 s) that logs queue depth when `this.queue.length > 0`. Store the interval handle and clear it in `dispose()`.
   - Dispose `_onDidDropItem` in `dispose()`.

2. **`src/test/suite/server-client.test.ts`**

   - **New test – "emits onDidDropItem when queue overflows"**: create client with `maxQueueSize = 3`, enqueue 5 items, assert the event fired twice with correct payload shape.
   - **New test – "droppedCount increments on overflow"**: create client with `maxQueueSize = 2`, enqueue 4 items, call `getQueueStats()`, assert `droppedCount === 2` and `queueSize === 2`.
   - **New test – "getQueueStats returns current state"**: create client, enqueue a few items without overflow, assert `{ queueSize: N, droppedCount: 0, connected: false, backoffMs: 1000 }`.
   - **New test – "getQueueStats reflects connected state after healthCheck"**: optional, if feasible with mock server.

### Files to Delete

_None._

## Implementation Notes

- Follow the existing `onDidChangeConnection` / `_onDidChangeConnection` pattern exactly for the new `onDidDropItem` emitter (private `EventEmitter`, public `Event` property).
- The periodic stats interval must be guarded: only log when `queue.length > 0` to avoid noise, and clear the interval in `dispose()`.
- Use `console.warn` for drops and backoff increases; use `console.log` for backoff reset — keep severity proportional.
- `getQueueStats()` exposes `backoffMs` which is currently private; this is intentional for diagnostics but the field stays private (only exposed through the method).
- No changes to `QueueItem` interface or public API method signatures — fully backward compatible.

## Tests

| # | Test | Assertion |
|---|------|-----------|
| 1 | `onDidDropItem` fires on overflow | Event payload contains `method`, `path`, `queueSize`; fires exactly `enqueued - maxQueueSize` times |
| 2 | `droppedCount` increments correctly | `getQueueStats().droppedCount` equals number of items that overflowed |
| 3 | `getQueueStats` shape and defaults | Returns `{ queueSize, droppedCount: 0, connected: false, backoffMs: 1000 }` for fresh client with items |
| 4 | No event when queue is not full | Enqueue below capacity, verify listener never called |
| 5 | Stats timer is cleared on dispose | Dispose client, verify no lingering intervals (no unhandled timer warnings) |

## Acceptance Criteria

- [ ] Enqueueing beyond `maxQueueSize` logs a warning containing the dropped item type and queue depth.
- [ ] `onDidDropItem` event fires for every dropped item with `{ method, path, queueSize }`.
- [ ] `getQueueStats()` returns accurate `queueSize`, `droppedCount`, `connected`, and `backoffMs`.
- [ ] Backoff increase and reset are logged in `flushQueue()`.
- [ ] Periodic stats log fires every 60 s when queue is non-empty; does not fire when empty.
- [ ] `dispose()` cleans up the new event emitter and periodic interval.
- [ ] All existing `server-client.test.ts` tests continue to pass.
- [ ] At least 4 new tests cover drop detection, stats accuracy, and event emission.

## Dependencies

- Depends on: None
