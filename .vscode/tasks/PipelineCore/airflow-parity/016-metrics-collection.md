---
status: pending
---

# 016: Implement Metrics Collection and Export

## Summary
Add a metrics collection system that records operational metrics (task durations, failure rates, queue depths, pool utilization) and supports pluggable export to monitoring systems.

## Motivation
Airflow exposes StatsD/Prometheus metrics for dashboards and alerting. Without metrics, operators rely on log reading for operational visibility. This commit provides structured metrics collection with a pluggable export architecture.

## Changes

### Files to Create
- `packages/pipeline-core/src/metrics/metrics-collector.ts` — `MetricsCollector`:
  - `counter(name, value?, labels?)` — increment counter (e.g., tasks_started)
  - `gauge(name, value, labels?)` — set gauge (e.g., active_tasks)
  - `histogram(name, value, labels?)` — record distribution (e.g., task_duration_ms)
  - `timer(name, labels?)` → returns stopwatch with `stop()` method
  - Built-in metrics:
    - `dag_run.started`, `dag_run.completed`, `dag_run.failed`
    - `task.started`, `task.completed`, `task.failed`, `task.retried`
    - `task.duration_ms` (histogram)
    - `scheduler.tick_duration_ms`
    - `pool.slots_used`, `pool.slots_available`, `pool.queued`
    - `xcom.size_bytes`
    - `sla.violations`
- `packages/pipeline-core/src/metrics/exporters/` — Export implementations:
  - `json-exporter.ts` — Exports metrics as JSON file (periodic flush)
  - `callback-exporter.ts` — Invokes function with metrics batch (for VS Code integration)
  - `console-exporter.ts` — Logs metrics summary to logger (default)
  - `types.ts` — `MetricsExporter` interface: `export(metrics: MetricsBatch)`
- `packages/pipeline-core/src/metrics/types.ts` — Metric types:
  - `MetricType`: counter, gauge, histogram
  - `MetricPoint`: name, type, value, labels, timestamp
  - `MetricsBatch`: points[], periodStart, periodEnd
  - `MetricsCollectorOptions`: exporters[], flushIntervalMs (default 60s), prefix?
- `packages/pipeline-core/src/metrics/index.ts` — Barrel export

### Files to Modify
- `packages/pipeline-core/src/dag/executor.ts` — Record task/run metrics
- `packages/pipeline-core/src/scheduler/scheduler.ts` — Record scheduler tick metrics
- `packages/pipeline-core/src/pools/pool-manager.ts` — Record pool utilization metrics
- `packages/pipeline-core/src/dag/sla/sla-monitor.ts` — Record SLA violation metrics
- `packages/pipeline-core/src/index.ts` — Export metrics module

## Implementation Notes
- Metrics are collected in-memory and flushed to exporters periodically (default 60s)
- Histogram uses a simple reservoir sampling approach (keeps last 1000 values per metric)
- Labels enable dimensional slicing: `task.duration_ms{dag_id="etl", task_id="extract"}`
- JSON exporter writes to `<baseDir>/metrics/` directory, one file per flush period
- Console exporter logs a summary table (useful for CLI mode)
- Callback exporter is the VS Code integration point — extension can show metrics in status bar or webview
- All metrics recording is non-blocking — if collector is not configured, metrics calls are no-ops
- No external dependencies (no StatsD/Prometheus client) — keep it lightweight; users can build custom exporters

## Tests
- `packages/pipeline-core/test/metrics/metrics-collector.test.ts`:
  - Counter increments correctly
  - Gauge sets and overwrites
  - Histogram records values
  - Timer measures duration
  - Labels attached correctly
  - Flush exports to registered exporter
  - No-op when no exporters configured
- `packages/pipeline-core/test/metrics/json-exporter.test.ts`:
  - Writes metrics file with correct format
  - Periodic flush creates multiple files
- `packages/pipeline-core/test/metrics/callback-exporter.test.ts`:
  - Callback receives correct MetricsBatch

## Acceptance Criteria
- [ ] Counters, gauges, and histograms work correctly
- [ ] Timer accurately measures duration
- [ ] Labels enable dimensional metrics
- [ ] JSON exporter persists metrics to disk
- [ ] Callback exporter works for VS Code integration
- [ ] DAG executor records all standard metrics
- [ ] Metrics are non-blocking (no performance impact)
- [ ] Existing tests pass

## Dependencies
- Depends on: 004, 008, 011
