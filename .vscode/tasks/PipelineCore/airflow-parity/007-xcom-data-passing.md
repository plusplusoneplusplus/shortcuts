---
status: pending
---

# 007: Implement Full XCom Data Passing System

## Summary
Build a complete cross-communication (XCom) system that enables tasks to push and pull structured data to/from each other, with persistence, size limits, and serialization support.

## Motivation
The basic XCom plumbing from 001/004 stores values in-memory on TaskInstance. This commit elevates XCom to a first-class feature with persistence (via the store from 002), size limits (to prevent memory/disk exhaustion), serialization for complex types, and a clean API for task handlers to push/pull values.

## Changes

### Files to Create
- `packages/pipeline-core/src/dag/xcom/xcom-manager.ts` — `XComManager` class:
  - `push(runId, taskId, key, value, options?)` → stores value
  - `pull(runId, taskId, key, defaultValue?)` → retrieves value
  - `pullFromUpstream(runId, taskId, dagConfig)` → Map of all upstream XCom values
  - `delete(runId, taskId, key?)` → remove specific or all keys for task
  - `list(runId, taskId?)` → list available XCom keys
  - Size validation: reject values > `maxXComSizeBytes` (default 1MB)
  - Serialization: JSON by default, with pluggable serializer interface
- `packages/pipeline-core/src/dag/xcom/xcom-template-resolver.ts` — Template resolution:
  - `resolveXComTemplates(template, runId, xcomManager)` → resolved string
  - Resolves `{{ xcom.<taskId>.<key> }}` patterns in prompts
  - Handles missing values gracefully (configurable: error vs empty string)
  - Supports nested key access: `{{ xcom.extract.result.count }}`
- `packages/pipeline-core/src/dag/xcom/types.ts` — Types:
  - `XComValue`: serializable value (string, number, boolean, object, array)
  - `XComOptions`: serialize, maxSize, description
  - `XComEntry`: taskId, key, value, timestamp, sizeBytes
- `packages/pipeline-core/src/dag/xcom/index.ts` — Barrel export

### Files to Modify
- `packages/pipeline-core/src/dag/executor.ts` — Integrate XComManager:
  - After task success: auto-push task output as XCom
  - Before task execution: resolve XCom templates in task config
  - Pass XComManager to task handlers via context
- `packages/pipeline-core/src/dag/task-handlers/types.ts` — Add `xcom: XComManager` to `TaskHandlerContext`
- `packages/pipeline-core/src/dag/store/types.ts` — Ensure `XComStore` interface is compatible
- `packages/pipeline-core/src/dag/index.ts` — Re-export xcom module

## Implementation Notes
- XCom values are persisted via `XComStore` from 002 — survives process restart
- Default `return_value` key: task output is automatically pushed as `xcom.<taskId>.return_value` (mirrors Airflow convention)
- Tasks can push multiple keys: `context.xcom.push(key, value)` within handler
- Size limit prevents accidental large data (full datasets should use file paths, not XCom)
- Template resolution happens just before task execution — lazy evaluation
- Nested key access (`result.count`) uses lodash-style `_.get` semantics (implemented inline, no new dep)

## Tests
- `packages/pipeline-core/test/dag/xcom/xcom-manager.test.ts`:
  - Push and pull basic types (string, number, object, array)
  - Size limit enforcement (>1MB rejected)
  - Delete specific key and all keys for task
  - List available keys
  - Pull from upstream collects correct values
  - Missing value returns default or throws
- `packages/pipeline-core/test/dag/xcom/xcom-template-resolver.test.ts`:
  - Simple variable resolution `{{ xcom.task1.output }}`
  - Nested key access `{{ xcom.task1.result.items[0].name }}`
  - Missing variable → configurable behavior
  - Multiple variables in one template
  - No XCom reference → template unchanged
- Integration test: DAG with 3 tasks passing data via XCom

## Acceptance Criteria
- [ ] Tasks can push and pull arbitrary serializable values
- [ ] XCom values persist across process restarts (via store)
- [ ] Template syntax `{{ xcom.taskId.key }}` resolves in prompts
- [ ] Size limits prevent memory exhaustion
- [ ] Nested key access works
- [ ] Auto-push of task return value on success
- [ ] Existing tests pass

## Dependencies
- Depends on: 002, 004
