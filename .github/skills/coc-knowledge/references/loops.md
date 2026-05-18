# Loop Subsystem

Recurring follow-up messages within a conversation. Inspired by Claude Code's loop mode — where the AI can schedule itself to revisit a task on a cadence without human intervention.

**Feature flag:** `loops.enabled` in `~/.coc/config.yaml` (default `false`). When disabled, infrastructure is not constructed, REST routes are not registered, LLM tools (`scheduleWakeup`, `createLoop`, `cancelLoop`, `listLoops`) are filtered out, the bundled `/loop` skill is not auto-installed, and dashboard UI elements (badge, panel, slash-command) are hidden.

## Concepts

| Concept | Description |
|---------|-------------|
| **Loop** | A recurring timer that sends follow-up messages into the same conversation (`processId`) at a fixed interval until cancelled, expired, or auto-paused. |
| **Wakeup** | A one-shot delayed follow-up. Lighter than a loop — fires once after a delay. |
| **Tick** | A single firing of a loop. Each tick enqueues a follow-up task via `TaskQueueManager`. |

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  LLM Tool Layer                                                      │
│  (llm-tools/loop-tools.ts)                                           │
│  createLoop · cancelLoop · listLoops · scheduleWakeup                │
└──────────────┬───────────────────────────────────────────────────────┘
               │ creates/cancels LoopEntry
┌──────────────▼───────────────────────────────────────────────────────┐
│  LoopStore (loops/loop-store.ts)                                     │
│  SQLite CRUD — `loops` table in processes.db                         │
│  Prepared statements, MAX_ACTIVE_LOOPS=50 limit enforced on insert   │
└──────────────┬───────────────────────────────────────────────────────┘
               │ read/write
┌──────────────▼───────────────────────────────────────────────────────┐
│  LoopExecutor (loops/loop-executor.ts)                               │
│  Arms timers via ScheduleTimerRegistry                               │
│  On tick: checks TTL, circuit breakers, process status, inflight     │
│  guard → enqueues follow-up via TaskQueueManager                     │
└──────────────┬───────────────────────────────────────────────────────┘
               │ timer events
┌──────────────▼───────────────────────────────────────────────────────┐
│  ScheduleTimerRegistry (schedule/schedule-timer-registry.ts)         │
│  Low-level setTimeout wrapper with cancel/set API                    │
└──────────────────────────────────────────────────────────────────────┘
```

## Source Files

| File | Description |
|------|-------------|
| `packages/coc/src/server/loops/loop-types.ts` | `LoopEntry`, `LoopStatus`, `LoopChangeEvent`, constants |
| `packages/coc/src/server/loops/loop-store.ts` | SQLite persistence (CRUD, `ensureTable`, prepared statements) |
| `packages/coc/src/server/loops/loop-executor.ts` | Timer lifecycle, tick handler, circuit breakers, shutdown |
| `packages/coc/src/server/loops/loop-handler.ts` | REST API routes (workspace-scoped and server-wide) |
| `packages/coc/src/server/llm-tools/loop-tools.ts` | LLM tool factories (`createLoop`, `cancelLoop`, `listLoops`, `scheduleWakeup`) |
| `packages/forge/resources/bundled-skills/loop/SKILL.md` | Bundled `/loop` skill — teaches the AI interval parsing, mode selection, user confirmation |
| `packages/coc/src/server/spa/client/react/features/chat/LoopBadge.tsx` | Dashboard header badge showing non-cancelled loop count |
| `packages/coc/src/server/spa/client/react/features/chat/LoopManagementPanel.tsx` | Dashboard panel for listing/pausing/resuming/cancelling loops |

## Data Model

### LoopEntry

```typescript
interface LoopEntry {
    id: string;                  // e.g. "loop_a1b2c3d4e5f6"
    processId: string;           // conversation this loop fires into
    description: string;         // human-readable purpose
    intervalMs: number;          // fixed interval between ticks
    status: LoopStatus;          // 'active' | 'paused' | 'cancelled' | 'expired'
    createdAt: string;           // ISO timestamp
    lastTickAt: string | null;   // last successful tick
    nextTickAt: string | null;   // next scheduled tick (null if not active)
    tickCount: number;           // ticks executed so far
    consecutiveFailures: number; // resets on success
    expiresAt: string;           // TTL expiry (default 3 days)
    pausedReason: string | null; // why the loop was paused
    prompt: string;              // follow-up message sent each tick
    model: string | null;        // optional model override
}
```

### SQLite Schema (`loops` table in `processes.db`)

```sql
CREATE TABLE IF NOT EXISTS loops (
    id                    TEXT PRIMARY KEY,
    process_id            TEXT NOT NULL,
    description           TEXT NOT NULL DEFAULT '',
    interval_ms           INTEGER NOT NULL,
    status                TEXT NOT NULL DEFAULT 'active',
    created_at            TEXT NOT NULL,
    last_tick_at          TEXT,
    next_tick_at          TEXT,
    tick_count            INTEGER NOT NULL DEFAULT 0,
    consecutive_failures  INTEGER NOT NULL DEFAULT 0,
    expires_at            TEXT NOT NULL,
    paused_reason         TEXT,
    prompt                TEXT NOT NULL DEFAULT '',
    model                 TEXT
);
CREATE INDEX idx_loops_process_id ON loops(process_id);
CREATE INDEX idx_loops_status ON loops(status);
```

## LLM Tools

### `scheduleWakeup` (always available when `loops.enabled`)

One-shot delayed follow-up. Registered in `LLM_TOOL_REGISTRY`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | `string` | ✅ | Follow-up prompt to send after delay |
| `delay` | `string \| number` | ✅ | Delay (e.g. `"5s"`, `"30s"`, `"5m"`, `"1h"`, or ms). Min 1s |
| `model` | `string` | ❌ | Model override for the follow-up |

### `createLoop` (skill-gated — requires `/loop` skill)

Creates a recurring loop. First tick fires after one full interval.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `description` | `string` | ✅ | Human-readable purpose |
| `interval` | `string \| number` | ✅ | Interval between ticks. Min 10s |
| `prompt` | `string` | ✅ | Follow-up prompt sent each tick |
| `model` | `string` | ❌ | Model override for ticks |
| `ttl` | `string` | ❌ | Time-to-live (e.g. `"3d"`, `"12h"`). Default 3 days |

### `cancelLoop` (skill-gated)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `loopId` | `string` | ✅ | Loop ID to cancel |

### `listLoops` (skill-gated)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `status` | `string` | ❌ | Filter: `"active"`, `"paused"`, `"cancelled"`, `"expired"` |

## Duration Parsing

`parseDuration()` in `loop-tools.ts` handles human-friendly strings:

- `"30s"`, `"5sec"`, `"2seconds"` → milliseconds
- `"5m"`, `"5min"`, `"5minutes"` → milliseconds
- `"2h"`, `"2hr"`, `"2hours"` → milliseconds
- `"1d"`, `"1day"` → milliseconds
- `"500"` (raw number) → 500 ms
- Supports decimals: `"1.5h"` → 5,400,000 ms

## Circuit Breakers & Safety Limits

| Limit | Value | Behavior |
|-------|-------|----------|
| Max consecutive failures | 3 | Loop auto-pauses with reason |
| Default TTL | 3 days | Loop expires |
| Max consecutive wakeups/process | 100 | Loop auto-pauses (resets on manual user message) |
| Max active loops/server | 50 | Insert rejected with error |
| Min loop interval | 10 seconds | Create rejected |
| Min wakeup delay | 1 second | Create rejected |

## Tick Execution Flow

1. `ScheduleTimerRegistry` fires the callback for a loop ID.
2. `LoopExecutor.onTick(loopId)` is called.
3. Guard checks: status must be `active`.
4. TTL check → expire if past `expiresAt`.
5. Per-process wakeup limit check (100 max).
6. Concurrency guard: skip if process already has an in-flight tick.
7. Process status check: auto-pause if process is `cancelled`/`failed`; skip if `running`.
8. Enqueue follow-up via `TaskQueueManager` with `turnSource: { source: 'loop', loopId }`.
9. On completion callback (`onTickComplete`): increment `tickCount`, reset failures, schedule next tick. On failure: increment `consecutiveFailures`, auto-pause at threshold.

## Tick Completion Wiring

`ProcessLifecycleRunner` invokes the `onLoopTickComplete(loopId, success)`
lifecycle option after a loop-originated follow-up (`context.source === 'loop'`
with string `context.loopId`) finishes. The queue-executor-bridge routes this
call to `LoopExecutor.onTickComplete()`, which advances `tickCount` /
`lastTickAt`, clears the in-flight guard, and re-arms the next timer.

Bookkeeping errors are logged but never mask the follow-up's actual
success/failure result.

## Follow-Up Mode Resolution

`resolveFollowUpMode(store, processId, explicit?)` in
`executors/follow-up-mode.ts` is the single source of truth for "what mode
does this follow-up run in?".

- Every programmatic follow-up enqueue site (loop ticks, wakeup timer,
  requeue) must call it and set `payload.mode`.
- `validateAndParseTask` only defaults `payload.mode` to `autopilot` for new
  chats (no `processId`); REST follow-ups must supply mode.
- `FollowUpExecutor.executeFollowUp` requires `mode` and logs a fail-loud
  warning + defaults to `'ask'` if missing.

## REST API

### Workspace-scoped

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/workspaces/:id/loops` | List loops for workspace |
| `GET` | `/api/workspaces/:id/loops/:loopId` | Get single loop |
| `PATCH` | `/api/workspaces/:id/loops/:loopId` | Update loop fields (description, prompt, intervalMs, model) |
| `DELETE` | `/api/workspaces/:id/loops/:loopId` | Cancel & soft-delete loop |
| `POST` | `/api/workspaces/:id/loops/:loopId/pause` | Pause loop (body: `{ reason? }`) |
| `POST` | `/api/workspaces/:id/loops/:loopId/resume` | Resume paused loop |

### Server-wide

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/loops` | List all loops server-wide |
| `GET` | `/api/loops/:loopId` | Get a loop by ID |

## Dashboard Integration

- **`LoopBadge`** — Header badge showing non-cancelled loop count. Visible only when `loopsEnabled`.
- **`LoopManagementPanel`** — Panel listing all loops with pause/resume/cancel actions.
- **Turn source badge** — `ConversationTurnBubble` shows a visual indicator when a turn was generated by a loop tick or wakeup (via `turnSource` field on `ConversationTurn`).
- **`/loop` slash command** — Auto-installs the `/loop` skill and activates loop tools for the session.

## Server Lifecycle

- **Startup:** If `loops.enabled`, `LoopStore` and `LoopExecutor` are constructed. `executor.armAll()` restores timers for all active loops from the database.
- **Shutdown:** `executor.shutdownAll()` disarms in-memory timers without changing persisted loop state. Active loops remain `active` and are re-armed on the next startup from their persisted `nextTickAt`; overdue ticks fire immediately.
- **Config toggle:** `loops.enabled` is editable at runtime via the admin API (`PUT /api/admin/config`). A server restart is required for the change to take effect (infrastructure is only constructed at startup).

## Feature Gating Summary

When `loops.enabled = false`:
- `LoopStore` and `LoopExecutor` are not constructed.
- Loop REST routes are not registered.
- `scheduleWakeup` is filtered from `LLM_TOOL_REGISTRY` by `getEffectiveLlmToolRegistry()`.
- `/loop` skill is not in the default auto-install list.
- Dashboard `LoopBadge` and `LoopManagementPanel` are hidden.
- `/loop` slash command is not shown in autocomplete.

## Relationship to Schedules

Loops are **separate** from the schedule subsystem. They share `ScheduleTimerRegistry` for timing, but have their own:
- Type (`LoopEntry` vs schedule run entries)
- Persistence (`loops` table vs schedule tables)
- Executor (`LoopExecutor` vs schedule executor)
- REST routes (workspace-scoped at `/loops` vs `/schedules`)

Schedules are cron-based recurring tasks that create new processes. Loops are interval-based recurring follow-ups within an existing conversation.
