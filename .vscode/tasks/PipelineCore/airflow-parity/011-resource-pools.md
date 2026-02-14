---
status: pending
---

# 011: Implement Resource Pools and Priority Queues

## Summary
Add named resource pools with configurable slot counts and priority-based task scheduling — enabling fine-grained control over resource utilization across concurrent DAG runs.

## Motivation
Airflow pools limit how many tasks can run concurrently for a shared resource (e.g., "only 3 tasks can hit the database at once"). Combined with priority weights, this prevents resource exhaustion and ensures critical tasks get slots first. The current `ConcurrencyLimiter` is a single global limit — this commit adds named, scoped resource management.

## Changes

### Files to Create
- `packages/pipeline-core/src/pools/pool-manager.ts` — `PoolManager`:
  - `createPool(name, slots, description?)` → create named pool
  - `deletePool(name)` / `updatePool(name, slots)`
  - `acquire(poolName, priority?, taskId?)` → Promise (waits for slot, priority-ordered)
  - `release(poolName, taskId)` → frees slot
  - `getPoolStatus(name)` → { total, used, available, queued }
  - `listPools()` → all pools with status
  - Default pool: `default_pool` with configurable slots (default 16)
  - Priority ordering: higher weight = runs first (same as Airflow)
- `packages/pipeline-core/src/pools/types.ts` — Pool types:
  - `Pool`: name, slots, description, openSlots, queuedSlots, runningSlots
  - `PoolSlotRequest`: taskId, poolName, priority, timestamp
  - `PoolManagerOptions`: pools (initial pool configs), persistenceProvider?
- `packages/pipeline-core/src/pools/index.ts` — Barrel export

### Files to Modify
- `packages/pipeline-core/src/dag/types.ts` — Add `pool` and `priority_weight` to `DAGNode`
- `packages/pipeline-core/src/dag/executor.ts` — Before running a task:
  1. Acquire slot from task's pool (default: `default_pool`)
  2. On completion/failure: release slot
  3. Priority ordering when multiple tasks compete for same pool
- `packages/pipeline-core/src/dag/parser.ts` — Support `pool` and `priority_weight` in YAML task config
- `packages/pipeline-core/src/index.ts` — Export pools module

## Implementation Notes
- **YAML usage:**
```yaml
tasks:
  heavy_query_1:
    type: shell
    command: "python run_query.py --table users"
    pool: database_pool      # Max 3 concurrent DB queries
    priority_weight: 10      # Higher = runs first
    
  heavy_query_2:
    type: shell
    command: "python run_query.py --table orders"
    pool: database_pool
    priority_weight: 5
    
  light_task:
    type: ai_prompt
    prompt: "Analyze results"
    pool: default_pool       # Default pool (16 slots)
```

- Pool slots use a priority queue (max-heap by weight, then FIFO for ties)
- Pool state persists via optional persistence provider (for crash recovery)
- The default pool applies to all tasks without explicit pool assignment
- Pool slots are released in the `finally` block — even on crash, slot is freed
- `acquire()` returns a Promise that resolves when a slot is available — works with existing async executor loop
- Pool creation can be declarative (in YAML DAG config) or imperative (via API)

## Tests
- `packages/pipeline-core/test/pools/pool-manager.test.ts`:
  - Create pool with N slots, acquire N, next acquire waits
  - Release slot → waiting acquire resolves
  - Priority ordering: higher weight acquires first
  - FIFO for same priority
  - Default pool exists with correct slot count
  - Delete pool with active slots → error
  - Pool status reports correct counts
- Integration test:
  - DAG with 4 tasks sharing a 2-slot pool → only 2 run at a time
  - Higher priority task preempts in queue (not running)

## Acceptance Criteria
- [ ] Named pools limit concurrent tasks per resource type
- [ ] Priority weights control scheduling order within a pool
- [ ] Default pool applies to unassigned tasks
- [ ] Pool status is queryable (used/available/queued)
- [ ] YAML supports `pool` and `priority_weight` on tasks
- [ ] Works with DAG executor concurrency management
- [ ] Existing tests pass

## Dependencies
- Depends on: 004
