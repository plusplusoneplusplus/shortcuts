---
status: pending
---

# 008: Implement Cron Scheduler

## Summary
Build a scheduler service that triggers DAG executions based on cron expressions, respecting `max_active_runs`, `catchup` settings, and providing start/stop/pause lifecycle management.

## Motivation
Without scheduling, DAGs must be triggered manually. Airflow's scheduler is its heartbeat — continuously evaluating which DAGs need new runs. This commit adds time-based automation, making the pipeline framework suitable for recurring workflows.

## Changes

### Files to Create
- `packages/pipeline-core/src/scheduler/scheduler.ts` — `DAGScheduler` class:
  - `constructor(options: SchedulerOptions)`:
    - `persistenceProvider` for DAG/Run stores
    - `dagExecutorFactory` to create executors per run
    - `tickIntervalMs` (default 60s) — how often to check schedules
    - `logger`
  - `start()` → begins scheduler loop
  - `stop()` → graceful shutdown (waits for running tasks)
  - `pause(dagId)` / `unpause(dagId)` → per-DAG pause
  - `trigger(dagId, conf?)` → manual trigger outside schedule
  - Scheduler loop (each tick):
    1. Load all registered DAGs
    2. For each DAG with `schedule`:
       a. Parse cron expression → next execution date
       b. Check if run already exists for that execution date
       c. Check `max_active_runs` — skip if at limit
       d. Check if DAG is paused — skip if so
       e. Create DAGRun and delegate to DAGExecutor
    3. `catchup`: if true, create runs for all missed intervals; if false, only latest
  - Active run tracking: Map<dagId, Set<runId>>
- `packages/pipeline-core/src/scheduler/cron-parser.ts` — Cron expression utilities:
  - `parseCron(expression)` → validated CronExpression
  - `getNextRunDate(cron, after)` → Date
  - `getPreviousRunDate(cron, before)` → Date
  - Supports standard cron (5-field) + presets: `@daily`, `@hourly`, `@weekly`, `@monthly`, `@yearly`, `@once`
  - Uses lightweight implementation (no heavy cron library dependency)
- `packages/pipeline-core/src/scheduler/types.ts` — Scheduler types:
  - `SchedulerOptions`: tickInterval, persistenceProvider, dagExecutorFactory, maxDAGs, logger
  - `SchedulerState`: running | stopped | paused
  - `ScheduledDAGInfo`: dagId, schedule, nextRunDate, isPaused, activeRuns
- `packages/pipeline-core/src/scheduler/index.ts` — Barrel export

### Files to Modify
- `packages/pipeline-core/src/dag/types.ts` — Ensure `DAGConfig.schedule` is typed as `string | null`
- `packages/pipeline-core/src/index.ts` — Export scheduler module

## Implementation Notes
- Scheduler uses `setInterval` for the tick loop — simple and Node.js native
- Cron parsing: implement a lightweight 5-field parser (minute, hour, day-of-month, month, day-of-week) rather than pulling in a large library like `node-cron` — keeps pipeline-core dependency-free
- Support standard cron ranges (`1-5`), lists (`1,3,5`), steps (`*/5`), and wildcards (`*`)
- `catchup=true` generates backfill runs sequentially (not all at once) to avoid overwhelming the system
- `max_active_runs` defaults to 1 — prevents overlapping runs of the same DAG
- Manual `trigger()` bypasses schedule but still respects `max_active_runs`
- Scheduler is optional — DAGs can still be executed directly via `DAGExecutor.execute()` without a scheduler
- Paused state persists via the DAG store

## Tests
- `packages/pipeline-core/test/scheduler/cron-parser.test.ts`:
  - Parse `0 6 * * *` (daily at 6 AM) → correct next run
  - Parse `*/15 * * * *` (every 15 min) → correct intervals
  - Parse `@daily`, `@hourly`, `@weekly` presets
  - Invalid expression rejected with clear error
  - `getNextRunDate` advances correctly from given date
  - Edge cases: end of month, leap year, timezone considerations
- `packages/pipeline-core/test/scheduler/scheduler.test.ts`:
  - Scheduler creates run at correct cron time
  - `max_active_runs` prevents overlapping runs
  - `catchup=false` skips past intervals
  - `catchup=true` creates backfill runs
  - Pause/unpause stops/resumes scheduling
  - Manual trigger creates immediate run
  - Graceful stop waits for running tasks
  - Multiple DAGs scheduled independently

## Acceptance Criteria
- [ ] Cron parser handles standard 5-field expressions + presets
- [ ] Scheduler triggers DAG runs at correct intervals
- [ ] `max_active_runs` prevents run overlap
- [ ] `catchup` setting controls backfill behavior
- [ ] Pause/unpause works per-DAG
- [ ] Manual trigger works alongside scheduling
- [ ] Graceful shutdown completes running tasks
- [ ] No new external dependencies (cron parser is built-in)

## Dependencies
- Depends on: 004, 002
