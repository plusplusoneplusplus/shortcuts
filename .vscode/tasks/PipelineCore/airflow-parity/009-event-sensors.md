---
status: pending
---

# 009: Implement Event Sensors and Triggers

## Summary
Add sensor task types that wait for external conditions (file existence, HTTP endpoint, time delta, custom predicate) before allowing downstream tasks to proceed — enabling event-driven DAG execution.

## Motivation
Airflow sensors (FileSensor, HttpSensor, TimeDeltaSensor) enable DAGs to react to external events rather than only time-based schedules. This is essential for workflows like "process file when it arrives" or "run after API reports success".

## Changes

### Files to Create
- `packages/pipeline-core/src/dag/task-handlers/sensors/` — Sensor handlers:
  - `base-sensor.ts` — `BaseSensor` abstract class:
    - Polling loop: check condition → wait `poke_interval` → retry up to `timeout`
    - Modes: `poke` (holds worker slot) vs `reschedule` (releases slot between checks)
    - `isMet(context)` → abstract method subclasses implement
  - `file-sensor.ts` — `FileSensor`: waits for file/glob pattern to exist
  - `http-sensor.ts` — `HttpSensor`: polls URL, succeeds on expected status code / response content
  - `time-delta-sensor.ts` — `TimeDeltaSensor`: waits for duration since DAG run start
  - `custom-sensor.ts` — `ExpressionSensor`: evaluates condition expression (reuses condition-evaluator from 006)
  - `types.ts` — Sensor configuration types:
    - `SensorConfig`: poke_interval (default 30s), timeout (default 3600s), mode ('poke' | 'reschedule'), soft_fail (skip instead of fail on timeout)
    - `FileSensorConfig`: filepath, glob pattern
    - `HttpSensorConfig`: url, method, headers, expected_status, response_check
    - `TimeDeltaSensorConfig`: delta_seconds
- `packages/pipeline-core/src/dag/task-handlers/sensors/index.ts` — Barrel export

### Files to Modify
- `packages/pipeline-core/src/dag/types.ts` — Add `sensor` to `DAGNode.type`, add `SensorNodeConfig`
- `packages/pipeline-core/src/dag/task-handlers/handler-registry.ts` — Register sensor handlers (file_sensor, http_sensor, time_sensor, expression_sensor)
- `packages/pipeline-core/src/dag/parser.ts` — Support sensor task types in YAML
- `packages/pipeline-core/src/dag/executor.ts` — Handle `reschedule` mode: release concurrency slot during poke waits

## Implementation Notes
- **YAML example:**
```yaml
tasks:
  wait_for_data:
    type: file_sensor
    filepath: "/data/incoming/report_{{ ds }}.csv"
    poke_interval: 60    # Check every 60 seconds
    timeout: 7200        # Give up after 2 hours
    mode: reschedule     # Don't hold worker slot
    soft_fail: true      # Skip (don't fail) on timeout
    
  wait_for_api:
    type: http_sensor
    url: "https://api.example.com/status"
    method: GET
    expected_status: 200
    response_check: "$.status == 'ready'"
    poke_interval: 30
    timeout: 1800
    
  process:
    type: pipeline
    pipeline: "./process/pipeline.yaml"
    depends_on: [wait_for_data, wait_for_api]
```

- `reschedule` mode is important for long waits — it frees the concurrency slot so other tasks can run
- In `reschedule` mode, sensor state goes to `up_for_reschedule` between pokes — executor re-queues it after `poke_interval`
- `soft_fail=true` → sensor timeout results in 'skipped' not 'failed' (downstream uses trigger rules)
- File sensor uses `fs.access` / glob matching — no file watcher (polling is simpler and more reliable for DAG semantics)
- HTTP sensor uses existing `httpGet` from `utils/http-utils.ts`
- `{{ ds }}` (execution date) template variable resolved at runtime

## Tests
- `packages/pipeline-core/test/dag/sensors/file-sensor.test.ts`:
  - File exists → succeeds immediately
  - File appears after 2 pokes → succeeds on third check
  - File never appears → times out (soft_fail: skip vs fail)
  - Glob pattern matching works
- `packages/pipeline-core/test/dag/sensors/http-sensor.test.ts`:
  - Expected status code → success
  - Unexpected status → keeps poking
  - Response content check works
  - Timeout behavior
- `packages/pipeline-core/test/dag/sensors/time-delta-sensor.test.ts`:
  - Succeeds after specified duration
  - Respects poke interval
- `packages/pipeline-core/test/dag/sensors/base-sensor.test.ts`:
  - Poke mode holds slot
  - Reschedule mode releases slot
  - Cancellation interrupts polling

## Acceptance Criteria
- [ ] File sensor detects file existence (path and glob)
- [ ] HTTP sensor polls endpoint with configurable success criteria
- [ ] Time delta sensor waits for specified duration
- [ ] `reschedule` mode releases concurrency slot between pokes
- [ ] `soft_fail` causes skip instead of failure on timeout
- [ ] Sensors integrate with DAG executor and respect cancellation
- [ ] YAML schema supports all sensor types
- [ ] Existing tests pass

## Dependencies
- Depends on: 004, 006
