---
status: pending
---

# 014: Implement Alerting and Notification System

## Summary
Add a pluggable notification system that sends alerts for DAG events — failures, SLA violations, run completions, and custom conditions — via configurable channels (webhook, log, callback).

## Motivation
Airflow integrates with email, Slack, PagerDuty, etc. for alerting on failures and SLA misses. Without alerting, operators must manually check run status. This commit provides a pluggable channel architecture so alerts can be routed to any destination.

## Changes

### Files to Create
- `packages/pipeline-core/src/notifications/notification-manager.ts` — `NotificationManager`:
  - `registerChannel(channel: NotificationChannel)` — add output channel
  - `notify(event: NotificationEvent)` — dispatch to all matching channels
  - `addRule(rule: NotificationRule)` — conditional routing (e.g., "send failures to webhook A, SLA misses to webhook B")
  - Deduplication: suppress duplicate alerts within configurable window
  - Built-in events: `dag_run_failed`, `dag_run_success`, `task_failed`, `task_retrying`, `sla_violation`, `circuit_breaker_tripped`
- `packages/pipeline-core/src/notifications/channels/` — Channel implementations:
  - `webhook-channel.ts` — `WebhookChannel`: POST JSON payload to URL (with retry)
  - `callback-channel.ts` — `CallbackChannel`: invokes provided function (for VS Code integration)
  - `log-channel.ts` — `LogChannel`: writes to logger (default fallback)
  - `types.ts` — `NotificationChannel` interface: `name`, `send(event)`, `matches(rule)`
- `packages/pipeline-core/src/notifications/types.ts`:
  - `NotificationEvent`: type, dagId, runId, taskId?, message, severity (info|warning|critical), timestamp, metadata
  - `NotificationRule`: events (which event types), channels (which channel names), filter? (condition)
  - `NotificationConfig`: channels[], rules[], deduplicationWindowMs?
- `packages/pipeline-core/src/notifications/index.ts` — Barrel export

### Files to Modify
- `packages/pipeline-core/src/dag/executor.ts` — Emit notification events on task failure, run completion, retry
- `packages/pipeline-core/src/dag/sla/sla-monitor.ts` — Emit `sla_violation` notification
- `packages/pipeline-core/src/dag/circuit-breaker.ts` — Emit `circuit_breaker_tripped` notification
- `packages/pipeline-core/src/dag/parser.ts` — Support `notifications` config in YAML
- `packages/pipeline-core/src/index.ts` — Export notifications module

## Implementation Notes
- **YAML usage:**
```yaml
name: "production-etl"
notifications:
  channels:
    - name: ops-webhook
      type: webhook
      url: "https://hooks.slack.com/services/xxx"
      headers:
        Content-Type: "application/json"
    - name: critical-webhook
      type: webhook
      url: "https://pagerduty.com/integration/xxx"
      
  rules:
    - events: [dag_run_failed, circuit_breaker_tripped]
      channels: [critical-webhook]
    - events: [sla_violation, task_retrying]
      channels: [ops-webhook]
    - events: [dag_run_success]
      channels: [ops-webhook]
      filter:
        min_severity: info
```

- Webhook channel uses existing `httpGet`/`httpPost` from utils (may need to add `httpPost`)
- Deduplication prevents alert storms (e.g., 10 tasks fail simultaneously → 1 alert)
- `CallbackChannel` is the VS Code integration point — extension registers a callback that shows VS Code notifications
- Notification dispatch is fire-and-forget (async, errors logged but don't fail the DAG)
- Channels are initialized lazily — no network calls until first notification

## Tests
- `packages/pipeline-core/test/notifications/notification-manager.test.ts`:
  - Register channel and receive events
  - Rules route events to correct channels
  - Deduplication suppresses repeated alerts
  - Multiple channels receive same event
  - Channel send failure doesn't crash manager
- `packages/pipeline-core/test/notifications/webhook-channel.test.ts`:
  - Sends POST with correct payload
  - Retries on failure (up to 3 times)
  - Timeout on unresponsive endpoint
- `packages/pipeline-core/test/notifications/callback-channel.test.ts`:
  - Callback invoked with correct event data

## Acceptance Criteria
- [ ] Notification events emitted for failures, SLA violations, completions
- [ ] Webhook channel sends HTTP POST with JSON payload
- [ ] Callback channel works for VS Code integration
- [ ] Rules route events to correct channels
- [ ] Deduplication prevents alert storms
- [ ] Channel failures don't affect DAG execution
- [ ] YAML supports notification configuration
- [ ] Existing tests pass

## Dependencies
- Depends on: 004, 012
