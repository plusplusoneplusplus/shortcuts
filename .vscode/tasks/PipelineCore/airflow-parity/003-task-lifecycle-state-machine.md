---
status: pending
---

# 003: Implement Task Lifecycle State Machine

## Summary
Create a formal state machine governing task instance lifecycle transitions (queued → running → success/failed/skipped/upstream_failed) with validation, event emission, and trigger rule evaluation.

## Motivation
Airflow's reliability comes from rigorous state management — every task transition is validated and auditable. The current pipeline-core has ad-hoc status tracking. A formal state machine prevents invalid transitions, enables trigger rules (e.g., "run if all upstream succeeded"), and provides hooks for persistence and monitoring integration.

## Changes

### Files to Create
- `packages/pipeline-core/src/dag/state-machine.ts` — Task state machine:
  - `TaskStateMachine` class:
    - `transition(instance, newState)` → validates and applies transition
    - `canTransition(currentState, newState)` → boolean
    - `getValidTransitions(currentState)` → DAGRunState[]
  - Valid transitions map (static):
    - `queued` → running, skipped, upstream_failed, removed
    - `running` → success, failed, cancelled, up_for_retry
    - `up_for_retry` → queued, failed, cancelled
    - `success` → (terminal, no transitions out — except manual clear)
    - `failed` → queued (for retry/clear), up_for_retry
    - `skipped` → queued (for manual re-run)
    - `upstream_failed` → queued (if upstream is cleared)
    - `cancelled` → queued (for re-run)
  - `InvalidTransitionError` for illegal state changes
- `packages/pipeline-core/src/dag/trigger-rules.ts` — Trigger rule evaluator:
  - `evaluateTriggerRule(rule, upstreamStates)` → 'ready' | 'skip' | 'wait' | 'upstream_failed'
  - Rules supported:
    - `all_success` (default): all upstream must be 'success'
    - `all_failed`: all upstream must be 'failed'
    - `all_done`: all upstream must be terminal (success, failed, skipped)
    - `one_success`: at least one upstream 'success'
    - `one_failed`: at least one upstream 'failed'
    - `none_failed`: no upstream 'failed' (success or skipped OK)
    - `none_skipped`: no upstream 'skipped'
    - `always`: always ready regardless of upstream
  - Root nodes (no upstream) are always 'ready'
- `packages/pipeline-core/src/dag/events.ts` — Event types:
  - `DAGEvent`: type union of all events
  - `TaskStateChanged`: { dagId, runId, taskId, previousState, newState, timestamp }
  - `DAGRunStateChanged`: { dagId, runId, previousState, newState, timestamp }
  - `EventEmitter` interface (simple typed pub/sub)
  - `SimpleEventEmitter` implementation

### Files to Modify
- `packages/pipeline-core/src/dag/types.ts` — Add `up_for_retry` and `removed` to `DAGRunState` enum
- `packages/pipeline-core/src/dag/index.ts` — Re-export new modules

## Implementation Notes
- State machine is stateless — it validates transitions, not manages state. State lives in `TaskInstance` (persisted via store from 002)
- Trigger rules mirror Airflow exactly (same names, same semantics) for familiarity
- `SimpleEventEmitter` uses synchronous callbacks — async event handling comes with the scheduler
- `evaluateTriggerRule` returns 'wait' if upstream still running/queued — the DAG executor (004) will re-evaluate on state changes
- Keep state machine pure (no side effects) — persistence integration happens in the executor

## Tests
- `packages/pipeline-core/test/dag/state-machine.test.ts`:
  - All valid transitions succeed
  - All invalid transitions throw `InvalidTransitionError`
  - `canTransition` returns correct booleans
  - `getValidTransitions` lists correct targets for each state
- `packages/pipeline-core/test/dag/trigger-rules.test.ts`:
  - `all_success`: passes when all success, fails when one failed
  - `one_success`: passes when any one succeeds
  - `all_done`: passes regardless of outcome, fails when any still running
  - `none_failed`: passes with mix of success/skipped, fails with any failed
  - `always`: always returns 'ready'
  - Root node (empty upstream) always returns 'ready'
  - Returns 'upstream_failed' when appropriate
- `packages/pipeline-core/test/dag/events.test.ts`:
  - Subscribe, emit, receive events
  - Multiple subscribers
  - Unsubscribe works

## Acceptance Criteria
- [ ] All Airflow trigger rules are implemented and tested
- [ ] State machine prevents invalid transitions with clear error messages
- [ ] Event emitter supports subscribe/unsubscribe/emit
- [ ] `evaluateTriggerRule` correctly evaluates all 8 trigger rule types
- [ ] No changes to existing pipeline execution paths
- [ ] Existing tests pass

## Dependencies
- Depends on: 001
