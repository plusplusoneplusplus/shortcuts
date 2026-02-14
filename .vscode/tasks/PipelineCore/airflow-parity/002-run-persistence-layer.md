---
status: pending
---

# 002: Implement Run Persistence Layer

## Summary
Create a pluggable persistence layer for storing DAG runs, task instances, and execution history — enabling crash recovery, run history browsing, and future backfill support.

## Motivation
The current pipeline framework is fully ephemeral — once a pipeline finishes, all state is lost. Airflow's persistent metadata DB (run history, task states, XCom values) is critical for operational reliability. This commit introduces an abstract store interface with a file-based JSON implementation (no external DB required), keeping the system lightweight while enabling future backends (SQLite, PostgreSQL, etc.).

## Changes

### Files to Create
- `packages/pipeline-core/src/dag/store/types.ts` — Storage interfaces:
  - `DAGStore`: CRUD interface for DAG definitions (register, get, list, deregister)
  - `RunStore`: CRUD for DAGRuns (create, get, list, update state, delete)
  - `TaskInstanceStore`: CRUD for TaskInstances (create, get, update state/xcom, list by run)
  - `XComStore`: get/set/delete/list XCom values (dagId, taskId, runId, key → value)
  - `PersistenceProvider`: factory that provides all stores (DAGStore + RunStore + TaskInstanceStore + XComStore)
  - `RunQuery`: filter runs by dagId, state, date range, limit, offset
  - `TaskInstanceQuery`: filter by runId, taskId, state
- `packages/pipeline-core/src/dag/store/json-store.ts` — File-based JSON implementation:
  - Stores data in `<baseDir>/dags.json`, `<baseDir>/runs/<runId>.json`, `<baseDir>/xcom/<runId>.json`
  - Uses file locking (atomic write via temp file + rename) for crash safety
  - Supports `RunQuery` filtering in-memory (sufficient for single-machine use)
  - Auto-creates directory structure on first write
  - Configurable `maxRunsPerDag` for automatic cleanup of old runs
- `packages/pipeline-core/src/dag/store/memory-store.ts` — In-memory implementation for testing
- `packages/pipeline-core/src/dag/store/index.ts` — Barrel export

### Files to Modify
- `packages/pipeline-core/src/dag/index.ts` — Re-export store types and implementations
- `packages/pipeline-core/src/dag/types.ts` — Add `id` field to `TaskInstance` if not present; add `XComEntry` type

## Implementation Notes
- JSON store writes atomically: write to `.tmp` then rename (prevents corruption on crash)
- Run files are stored individually (`runs/<runId>.json`) to avoid a single large file
- XCom values are stored per-run to keep them scoped and cleanable
- Memory store is the default for tests — no file I/O in unit tests
- `maxRunsPerDag` defaults to 100 — oldest runs are pruned on new run creation
- All store methods are async to support future database backends
- Use `safeReadFile` / `writeYAML` from existing `utils/file-utils.ts` where possible

## Tests
- `packages/pipeline-core/test/dag/store/json-store.test.ts`:
  - Register and retrieve DAG definitions
  - Create run, update state, list runs with filtering
  - Create task instances, update state and XCom
  - XCom set/get/delete operations
  - Atomic writes survive simulated crash (write half file)
  - Run pruning when exceeding maxRunsPerDag
  - Concurrent read/write safety (two simultaneous updates)
- `packages/pipeline-core/test/dag/store/memory-store.test.ts`:
  - Same test suite as json-store (shared test factory pattern)

## Acceptance Criteria
- [ ] `PersistenceProvider` interface supports DAG, Run, TaskInstance, and XCom stores
- [ ] JSON store persists to disk and survives process restart
- [ ] Atomic writes prevent data corruption
- [ ] Run history is queryable by dagId, state, and date range
- [ ] Old runs are automatically pruned per `maxRunsPerDag`
- [ ] Memory store passes all the same functional tests
- [ ] Existing pipeline-core tests pass unchanged

## Dependencies
- Depends on: 001
