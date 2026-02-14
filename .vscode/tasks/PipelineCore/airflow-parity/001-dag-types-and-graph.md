---
status: pending
---

# 001: Define DAG Types and Graph Data Structures

## Summary
Introduce core TypeScript interfaces and a lightweight DAG (Directed Acyclic Graph) data structure to represent multi-step pipeline workflows with task dependencies — the foundational building block for all subsequent orchestration work.

## Motivation
The current pipeline framework only supports a linear Input → Filter → Map → Reduce flow. Airflow's power comes from expressing arbitrary DAGs of tasks. This commit introduces the type system and graph primitives without changing any existing execution paths, providing a safe foundation for incremental adoption.

## Changes

### Files to Create
- `packages/pipeline-core/src/dag/types.ts` — Core DAG interfaces:
  - `DAGNode`: id, type (task | sensor | branch | join), upstream/downstream deps, config, retries, timeout, trigger_rule ('all_success' | 'one_success' | 'all_done' | 'none_failed')
  - `DAGEdge`: source, target, condition (optional), data_key (for XCom-like passing)
  - `DAGConfig`: id, name, description, schedule?, default_args, nodes[], edges[], concurrency?, max_active_runs?, catchup?, tags[]
  - `DAGRunState`: enum (queued, running, success, failed, cancelled, upstream_failed, skipped)
  - `TaskInstance`: dagId, taskId, runId, state, startDate, endDate, tryNumber, maxTries, xcom (Map<string, unknown>)
  - `DAGRun`: id, dagId, executionDate, state, startDate, endDate, conf, taskInstances[]
- `packages/pipeline-core/src/dag/graph.ts` — DAG graph utilities:
  - `buildAdjacencyList(nodes, edges)` → adjacency map
  - `topologicalSort(nodes, edges)` → ordered node IDs (Kahn's algorithm)
  - `detectCycles(nodes, edges)` → boolean + cycle path
  - `getUpstream(nodeId)` / `getDownstream(nodeId)` → node IDs
  - `getLeafNodes()` / `getRootNodes()` → node IDs
  - `validateDAG(config)` → ValidationResult (checks cycles, dangling edges, missing refs)
- `packages/pipeline-core/src/dag/index.ts` — Barrel export

### Files to Modify
- `packages/pipeline-core/src/index.ts` — Add `export * from './dag'`

## Implementation Notes
- Use Kahn's algorithm for topological sort (linear time, detects cycles naturally)
- `trigger_rule` on each node determines when it fires relative to upstream states — this mirrors Airflow exactly
- `DAGConfig.schedule` is a string (cron expression or preset like `@daily`) but is NOT parsed in this commit — scheduling comes later
- XCom is modeled as a simple `Map<string, unknown>` on `TaskInstance` — no persistence yet
- Keep all types serializable (no functions) so they can be persisted to JSON/YAML later
- `DAGNode.config` is `Record<string, unknown>` — node-type-specific configs will be refined in later commits

## Tests
- `packages/pipeline-core/test/dag/graph.test.ts`:
  - Topological sort on simple linear chain (A → B → C)
  - Topological sort on diamond DAG (A → B, A → C, B → D, C → D)
  - Cycle detection positive case (A → B → C → A)
  - Cycle detection negative case (valid DAG)
  - Validate catches dangling edges referencing non-existent nodes
  - Validate catches duplicate node IDs
  - getRootNodes/getLeafNodes on various topologies
  - Empty DAG is valid

## Acceptance Criteria
- [ ] All DAG types are exported from pipeline-core
- [ ] `topologicalSort` returns correct order for 5+ test topologies
- [ ] `detectCycles` correctly identifies and reports cycle paths
- [ ] `validateDAG` catches dangling edges, duplicates, and cycles
- [ ] Existing pipeline-core tests pass unchanged
- [ ] No new dependencies added (pure TypeScript)

## Dependencies
- Depends on: None
