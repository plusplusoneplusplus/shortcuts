---
status: pending
---

# 013: Implement Run History API and Query Engine

## Summary
Build a comprehensive run history API that supports querying, filtering, sorting, and paginating past DAG runs and task instances — enabling debugging, auditing, and operational visibility.

## Motivation
Airflow's web UI is powered by a rich query API for run history. The persistence layer (002) stores raw data; this commit provides the query engine and API surface needed by dashboards, CLIs, and programmatic consumers to answer questions like "show me all failed runs in the last 24 hours" or "what was the average duration of task X".

## Changes

### Files to Create
- `packages/pipeline-core/src/dag/history/run-history-service.ts` — `RunHistoryService`:
  - `getDAGRuns(query: RunHistoryQuery)` → paginated DAGRun results
  - `getTaskInstances(runId, query?)` → task instances for a run
  - `getTaskHistory(dagId, taskId, query?)` → history of a specific task across runs
  - `getRunTimeline(runId)` → chronological events (state changes, XCom pushes)
  - `getDAGStats(dagId, dateRange?)` → aggregate stats:
    - Total runs, success/fail counts, avg/min/max duration
    - Task-level stats: avg duration, failure rate, retry rate
  - `getRecentRuns(limit?)` → latest N runs across all DAGs
  - `deleteOldRuns(dagId, olderThan)` → cleanup
- `packages/pipeline-core/src/dag/history/types.ts` — Query types:
  - `RunHistoryQuery`: dagId?, state?, dateRange?, limit, offset, sortBy, sortOrder
  - `PaginatedResult<T>`: items[], total, offset, limit, hasMore
  - `DAGStats`: totalRuns, successCount, failCount, avgDurationMs, p50/p90/p99 durations
  - `TaskStats`: avgDurationMs, failureRate, retryRate, lastSuccess, lastFailure
  - `RunTimelineEvent`: timestamp, type, taskId?, details
- `packages/pipeline-core/src/dag/history/index.ts` — Barrel export

### Files to Modify
- `packages/pipeline-core/src/dag/executor.ts` — Record timeline events (state changes) for history
- `packages/pipeline-core/src/dag/store/json-store.ts` — Add index support for faster queries (in-memory index on dagId + state + date)
- `packages/pipeline-core/src/dag/index.ts` — Re-export history module
- `packages/pipeline-core/src/index.ts` — Export history types

## Implementation Notes
- Stats computation (percentiles, averages) is done in-memory over the JSON store — acceptable for single-machine use with max 100 runs per DAG
- Timeline events are stored as an array on each DAGRun (appended during execution)
- Index is rebuilt on service initialization by scanning all runs — fast for <10K runs
- Pagination uses offset/limit (simple, sufficient for file-based store)
- `sortBy` supports: startDate, endDate, duration, state
- For future database backends, the query interface stays the same — only the store implementation changes
- Percentile calculation: simple sorted-array approach (no streaming stats library needed)

## Tests
- `packages/pipeline-core/test/dag/history/run-history-service.test.ts`:
  - Query runs by dagId, state, date range
  - Pagination (limit/offset) works correctly
  - Task instance history across runs
  - DAG stats calculation (avg, p50, p90 durations)
  - Task stats (failure rate, retry rate)
  - Run timeline contains correct events in order
  - Delete old runs removes correct entries
  - Empty history returns sensible defaults (0 stats)
  - Sort by duration ascending/descending

## Acceptance Criteria
- [ ] DAG runs queryable by dagId, state, and date range
- [ ] Pagination works with offset/limit
- [ ] DAG stats include duration percentiles and success/failure rates
- [ ] Task-level stats track individual task performance
- [ ] Run timeline shows chronological state changes
- [ ] Old run cleanup works
- [ ] Existing tests pass

## Dependencies
- Depends on: 002, 004
