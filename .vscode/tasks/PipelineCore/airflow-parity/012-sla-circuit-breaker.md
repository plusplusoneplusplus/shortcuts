---
status: pending
---

# 012: Implement SLA Monitoring and Circuit Breaker

## Summary
Add SLA (Service Level Agreement) monitoring per task and per DAG run, plus a circuit breaker pattern that halts execution after configurable failure thresholds — providing operational safety nets.

## Motivation
Production pipelines need guardrails. Airflow's SLA system alerts when tasks exceed expected durations. A circuit breaker prevents cascading failures by stopping a DAG when too many tasks fail. Together, they provide the operational safety needed for production use.

## Changes

### Files to Create
- `packages/pipeline-core/src/dag/sla/sla-monitor.ts` — `SLAMonitor`:
  - `registerSLA(dagId, taskId, maxDuration)` — set expected max duration
  - `registerDAGSLA(dagId, maxDuration)` — set expected max DAG run duration
  - `checkSLAs(dagRun)` → `SLAViolation[]` — check all running/completed tasks
  - `onViolation(handler)` — callback for SLA breaches
  - Checks run periodically (on scheduler tick or executor event)
  - SLA violations are warnings by default — they don't stop execution (configurable `sla_fail=true` to fail)
- `packages/pipeline-core/src/dag/sla/types.ts` — SLA types:
  - `SLAConfig`: max_duration (seconds), sla_fail (boolean), notification_handler
  - `SLAViolation`: dagId, taskId, runId, expected_duration, actual_duration, timestamp
- `packages/pipeline-core/src/dag/circuit-breaker.ts` — `CircuitBreaker`:
  - `CircuitBreaker(options)`:
    - `failureThreshold` — max failures before tripping (default 5)
    - `failurePercentage` — alternative: trip when X% of tasks fail
    - `resetAfter` — auto-reset after duration (optional)
    - `scope` — per-dag-run or per-dag (across runs)
  - `recordSuccess(taskId)` / `recordFailure(taskId)`
  - `isOpen()` → boolean (tripped = open = stop executing)
  - `reset()` → manual reset
  - States: `closed` (normal), `open` (tripped), `half-open` (testing recovery)
- `packages/pipeline-core/src/dag/sla/index.ts` — Barrel export

### Files to Modify
- `packages/pipeline-core/src/dag/types.ts` — Add `sla` field to `DAGNode` and `DAGConfig`
- `packages/pipeline-core/src/dag/executor.ts`:
  - Integrate SLA monitor: check after each task completion
  - Integrate circuit breaker: check before scheduling each task
  - On circuit breaker open: cancel remaining tasks, mark DAG run as failed
- `packages/pipeline-core/src/dag/parser.ts` — Support `sla` and `circuit_breaker` in YAML
- `packages/pipeline-core/src/dag/index.ts` — Re-export SLA and circuit breaker

## Implementation Notes
- **YAML usage:**
```yaml
name: "critical-etl"
sla:
  max_duration: 3600  # Entire DAG must complete within 1 hour

circuit_breaker:
  failure_threshold: 3     # Stop after 3 task failures
  # OR: failure_percentage: 50  # Stop when 50% of tasks fail

tasks:
  extract:
    type: pipeline
    pipeline: "./extract/pipeline.yaml"
    sla:
      max_duration: 600   # This task must complete within 10 minutes
      sla_fail: false     # Warn only, don't fail
      
  transform:
    type: pipeline
    pipeline: "./transform/pipeline.yaml"
    depends_on: [extract]
    sla:
      max_duration: 1200
      sla_fail: true      # Actually fail if SLA breached
```

- SLA checks are lightweight (timestamp comparison) — run on every task state change
- Circuit breaker is per-DAGRun by default — one run's failures don't affect another
- Circuit breaker `half-open` state: after `resetAfter` period, allow one task through to test recovery
- SLA violations are stored in the run metadata for history/reporting
- `onViolation` callback enables integration with alerting (commit 014)

## Tests
- `packages/pipeline-core/test/dag/sla/sla-monitor.test.ts`:
  - Task completing within SLA → no violation
  - Task exceeding SLA → violation detected
  - DAG-level SLA → violation when overall duration exceeded
  - `sla_fail=true` → task marked as failed
  - `sla_fail=false` → warning only, task continues
  - Violation callback fires with correct data
- `packages/pipeline-core/test/dag/circuit-breaker.test.ts`:
  - Stays closed with few failures
  - Opens after `failureThreshold` reached
  - Opens at `failurePercentage`
  - Auto-reset after `resetAfter` period
  - Manual reset works
  - Half-open → success → closed
  - Half-open → failure → open again

## Acceptance Criteria
- [ ] SLA violations detected for task and DAG-level duration limits
- [ ] `sla_fail` controls whether violation fails the task
- [ ] Circuit breaker trips after configurable failure threshold
- [ ] Tripped circuit breaker stops scheduling new tasks
- [ ] Auto-reset and half-open states work correctly
- [ ] Both integrate with DAG executor seamlessly
- [ ] YAML supports `sla` and `circuit_breaker` configs
- [ ] Existing tests pass

## Dependencies
- Depends on: 004, 008
