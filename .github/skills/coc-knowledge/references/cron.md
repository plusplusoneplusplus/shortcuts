# Cron Subsystem

Recurring follow-up messages within a conversation: the AI schedules itself to revisit a task on a cadence without human intervention.

**Feature flag:** `cron.enabled` in `~/.coc/config.yaml` (default `false`). See [Feature gating](#feature-gating).

## Concepts

| Concept | Description |
|---------|-------------|
| **Cron** | A recurring timer that sends follow-up messages into the same conversation (`processId`) at a fixed interval until cancelled, expired, or auto-paused. |
| **Wakeup** | A one-shot delayed follow-up — fires once after a delay, then terminal. |
| **Tick** | One firing of a cron; enqueues a follow-up task via `TaskQueueManager`. |

## Architecture

```
llm-tools/cron-tools.ts — cron (create · cancel · list) · scheduleWakeup
   │ creates/cancels entries
CronStore (cron/cron-store.ts) — `crons` table in processes.db
   prepared statements; MAX_ACTIVE_CRONS=50 enforced on insert
   │
CronExecutor (cron/cron-executor.ts) — arms timers, and on tick checks TTL,
   circuit breakers, process status, inflight guard → TaskQueueManager
   │
ScheduleTimerRegistry (schedule/schedule-timer-registry.ts)
   setTimeout wrapper with cancel/set API; shared with wakeups and triggers
```

## Source Files

| File | Description |
|------|-------------|
| `packages/coc/src/server/cron/cron-types.ts` | `CronEntry`, `CronStatus`, `CronChangeEvent`, constants |
| `packages/coc/src/server/cron/cron-store.ts` | SQLite persistence (CRUD, `ensureTable`, prepared statements) |
| `packages/coc/src/server/cron/cron-executor.ts` | Timer lifecycle, tick handler, circuit breakers, shutdown |
| `packages/coc/src/server/cron/cron-handler.ts` | REST routes (workspace-scoped and server-wide) |
| `packages/coc/src/server/cron/wakeup-types.ts` | `WakeupEntry`, `WakeupStatus`, `WakeupChangeEvent`, retention constant |
| `packages/coc/src/server/cron/wakeup-store.ts` | Wakeup persistence (CRUD, `markFired`/`markFailed`/`cancel`, prune) |
| `packages/coc/src/server/cron/wakeup-executor.ts` | Wakeup arm/fire lifecycle, startup re-arm, overdue immediate fire, terminal marking |
| `packages/coc/src/server/cron/enqueue-wakeup.ts` | `createEnqueueWakeup` command — persists a pending record, then arms it |
| `packages/coc/src/server/llm-tools/cron-tools.ts` | LLM tool factories (`cron`, `scheduleWakeup`), `parseDuration()` |
| `packages/forge/resources/bundled-skills/cron/SKILL.md` | Bundled `/cron` skill — interval parsing, mode selection, user confirmation |
| `.../spa/client/react/features/chat/CronBadge.tsx` | Header badge: non-cancelled cron count |
| `.../spa/client/react/features/chat/CronManagementPanel.tsx` | List/pause/resume/cancel panel |

## Data Model

### CronEntry

```typescript
interface CronEntry {
    id: string;                  // e.g. "cron_a1b2c3d4e5f6"
    processId: string;           // conversation this cron fires into
    description: string;
    intervalMs: number;
    status: CronStatus;          // 'active' | 'paused' | 'cancelled' | 'expired'
    createdAt: string;           // ISO
    lastTickAt: string | null;
    nextTickAt: string | null;   // null if not active
    tickCount: number;
    consecutiveFailures: number; // resets on success
    expiresAt: string;           // TTL expiry (default 3 days)
    pausedReason: string | null;
    prompt: string;              // follow-up message sent each tick
    model: string | null;        // optional model override
}
```

`crons` table in `processes.db`, created by forge's `initializeDatabase`: columns `id` PK, `process_id`, `description`, `interval_ms`, `status`, `created_at`, `last_tick_at`, `next_tick_at`, `tick_count`, `consecutive_failures`, `expires_at`, `paused_reason`, `prompt`, `model`; indexes `idx_crons_process_id`, `idx_crons_status`. Schema migration **V26** renames a `loops` table to `crons` and re-creates the indexes under `idx_crons_*`.

### WakeupEntry (durable one-shot)

Wakeups are the one-shot, durable counterpart to crons. They share the `ScheduleTimerRegistry` and `processes.db` handle with crons but keep their own table, store, and executor, so no recurrence or failure-count policy leaks between the two.

```typescript
interface WakeupEntry {
    id: string;                  // e.g. "wakeup_a1b2c3d4e5f6"
    processId: string;
    prompt: string;
    model: string | null;
    status: WakeupStatus;        // 'pending' | 'fired' | 'failed' | 'cancelled'
    createdAt: string;           // ISO
    firesAt: string;             // absolute ISO fire time
    firedAt: string | null;      // terminal transition time (fired/failed)
    failureReason: string | null;// message when status === 'failed'
    workspaceId?: string;        // persisted at creation
}
```

`wakeups` table: `id` PK, `process_id`, `prompt`, `model`, `status`, `created_at`, `fires_at`, `fired_at`, `failure_reason`, `workspace_id`; indexes `idx_wakeups_process_id`, `idx_wakeups_status`, `idx_wakeups_workspace_id`.

## LLM Tools

### `scheduleWakeup` (available whenever `cron.enabled`)

One-shot delayed follow-up, registered in `LLM_TOOL_REGISTRY`. **Durable:** `createEnqueueWakeup` inserts a pending `WakeupEntry` (absolute `firesAt`) **before** arming the timer, so a restart re-arms it from the store. The returned `wakeupId`/`firesAt` are the persisted values.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | `string` | ✅ | Follow-up prompt |
| `delay` | `string \| number` | ✅ | `"5s"`, `"30s"`, `"5m"`, `"1h"`, or ms. Min 1s |
| `model` | `string` | ❌ | Model override |

### `cron` (skill-gated — requires the `/cron` skill)

A single merged tool from `createCronTool()`, dispatched by a required `action`. Missing per-action fields return an error naming the required parameters.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | `string` | ✅ | `"create"`, `"cancel"`, or `"list"` |
| `description` | `string` | create | Human-readable purpose |
| `interval` | `string \| number` | create | Min 10s. First tick fires after one full interval |
| `prompt` | `string` | create | Follow-up sent each tick |
| `model` | `string` | ❌ | create: model override |
| `ttl` | `string` | ❌ | create: e.g. `"3d"`, `"12h"`. Default 3 days |
| `cronId` | `string` | cancel | Cron to cancel |
| `status` | `string` | ❌ | list: filter by `CronStatus` |

`parseDuration()` accepts `"30s"`/`"5sec"`/`"2seconds"`, `"5m"`/`"5min"`/`"5minutes"`, `"2h"`/`"2hr"`/`"2hours"`, `"1d"`/`"1day"`, decimals (`"1.5h"`), and raw numbers as milliseconds.

## Circuit Breakers & Safety Limits

| Limit | Value | Behavior |
|-------|-------|----------|
| Max consecutive failures | 3 | Cron auto-pauses with reason |
| Default TTL | 3 days | Cron expires |
| Max consecutive wakeups/process | 100 | Cron auto-pauses (resets on a manual user message) |
| Max active crons/server | 50 | Insert rejected |
| Min cron interval | 10 seconds | Create rejected |
| Min wakeup delay | 1 second | Create rejected |

## Tick Execution Flow

1. `ScheduleTimerRegistry` fires the callback for a cron ID; `CronExecutor.onTick(cronId)` runs.
2. Guards, in order: status must be `active`; TTL check (expire if past `expiresAt`); per-process wakeup limit (100); concurrency guard (skip if the process has an in-flight tick); process status (auto-pause if `cancelled`/`failed`, skip if `running`).
3. Enqueue the follow-up via `TaskQueueManager` with `turnSource: { source: 'cron', cronId }`.
4. `ProcessLifecycleRunner` invokes the `onCronTickComplete(cronId, success)` lifecycle option once a cron-originated follow-up (`context.source === 'cron'` with a string `context.cronId`) finishes. The queue-executor-bridge routes it to `CronExecutor.onTickComplete()`, which advances `tickCount`/`lastTickAt`, resets `consecutiveFailures` on success (auto-pausing at the threshold on failure), clears the in-flight guard, and re-arms the next timer. Bookkeeping errors are logged but never mask the follow-up's own result.

## Wakeup Execution Flow

Wakeups bypass the queue/tick-completion path; `WakeupExecutor` owns them end to end.

1. `createEnqueueWakeup` inserts a `pending` entry, then calls `WakeupExecutor.arm()`.
2. `arm()` registers a one-shot timer keyed `wakeup:<id>` in the shared `ScheduleTimerRegistry`, with delay `firesAt - now` clamped to `0` for overdue values. The key is not owned by the per-turn executor session, so a wakeup scheduled mid-turn survives turn-end teardown.
3. On fire, `resolveFollowUpMode` runs and `executeFollowUp` is invoked directly (bridge) with `turnSource: { source: 'wakeup', wakeupId }`.
4. Terminal marking: success → `markFired`; a thrown error → `markFailed` with the message persisted in `failure_reason`, plus a structured `logger.error`. Wakeups never recur.

**Restart recovery.** `createCronInfrastructure` constructs the `WakeupStore` + `WakeupExecutor`, prunes terminal rows older than `WAKEUP_RETENTION_MS` (7 days), then calls `wakeupExecutor.armAll()`, re-arming every pending wakeup from its persisted `firesAt`; overdue ones fire immediately. State changes broadcast via optional `wakeup-scheduled|fired|failed|cancelled` WebSocket events.

## Follow-Up Mode Resolution

`resolveFollowUpMode(store, processId, explicit?)` in `executors/follow-up-mode.ts` is the single source of truth for the mode a follow-up runs in. Every programmatic enqueue site (cron ticks, wakeup timer, requeue) must call it and set `payload.mode`. `validateAndParseTask` defaults `payload.mode` to `autopilot` only for new chats (no `processId`); REST follow-ups must supply mode. `FollowUpExecutor.executeFollowUp` requires `mode` and logs a fail-loud warning plus defaults to `'ask'` if it is missing.

## REST API

Workspace-scoped:

- `GET /api/workspaces/:id/crons` — list for workspace
- `GET /api/workspaces/:id/crons/:cronId` — single cron
- `PATCH /api/workspaces/:id/crons/:cronId` — update `description`, `prompt`, `intervalMs`, `model`
- `DELETE /api/workspaces/:id/crons/:cronId` — cancel & soft-delete
- `POST /api/workspaces/:id/crons/:cronId/pause` — body `{ reason? }`
- `POST /api/workspaces/:id/crons/:cronId/resume`

Server-wide (unscoped by design): `GET /api/crons`, `GET /api/crons/:cronId`.

**Workspace ownership boundary:** every item-level route resolves the cron via `resolveCronForWorkspace` (in `cron-handler.ts`, shared logging in `shared/automation-scope.ts`), which returns the record only when its `workspaceId` matches the route workspace — a cron from another workspace is a non-enumerating `404` with a structured server-side warning. Rows without a persisted `workspaceId` derive ownership from their process via the context `resolveWorkspaceId(processId)` resolver and are backfilled on first match.

## Dashboard Integration

`CronBadge` (header count of non-cancelled crons) and `CronManagementPanel` (list with pause/resume/cancel; each active cron shows its next tick relative to `nextTickAt`, plus tick count and last-tick time) render only when `cronEnabled`. `ConversationTurnBubble` shows a turn-source indicator for turns generated by a cron tick or wakeup, read from `turnSource` on `ConversationTurn`. The `/cron` slash command auto-installs the `/cron` skill and activates cron tools for the session.

## Server Lifecycle

- **Startup:** if `cron.enabled`, `CronStore` and `CronExecutor` are constructed and `executor.armAll()` restores timers for all active crons.
- **Shutdown:** `executor.shutdownAll()` disarms in-memory timers without changing persisted state. Active crons stay `active` and re-arm on next startup from `nextTickAt`; overdue ticks fire immediately.
- **Config toggle:** `cron.enabled` is editable at runtime via `PUT /api/admin/config`, but infrastructure is constructed only at startup, so a restart is required for the change to take effect.

## Feature Gating

When `cron.enabled = false`: `CronStore`/`CronExecutor` are not constructed, cron REST routes are not registered, `scheduleWakeup` is filtered out of `LLM_TOOL_REGISTRY` by `getEffectiveLlmToolRegistry()`, the `/cron` skill is not in the default auto-install list and its slash command is hidden from autocomplete, and `CronBadge`/`CronManagementPanel` are hidden.

## Relationship to Schedules

Crons are separate from the schedule subsystem. They share only `ScheduleTimerRegistry`, which is generic over its key type: crons, wakeups, and triggers key by their own globally unique `string` IDs, while `ScheduleManager` keys by a branded `(repoId, scheduleId)` runtime key. Crons have their own type (`CronEntry`), persistence (`crons` table), executor, and routes (`/crons` vs `/schedules`). Schedules are cron-expression recurring tasks that create new processes; crons are interval-based recurring follow-ups inside an existing conversation.
