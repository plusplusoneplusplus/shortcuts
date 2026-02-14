# Cron Job Scheduling for Pipelines

## Description

Add support for cron-based scheduled execution of YAML pipelines. Currently, pipelines can only be triggered manually via the VS Code UI. This feature will allow users to define cron schedules in `pipeline.yaml` so pipelines run automatically at specified intervals (e.g., daily reports, periodic data processing, recurring code reviews).

## Acceptance Criteria

- [ ] Users can define a `schedule` section in `pipeline.yaml` with a cron expression
- [ ] Cron expressions support standard 5-field format (minute, hour, day-of-month, month, day-of-week)
- [ ] Scheduled pipelines execute automatically when VS Code is running
- [ ] Users can enable/disable individual schedules without removing the configuration
- [ ] Scheduled pipeline runs appear in the AI Processes tree view like manual runs
- [ ] A global setting `workspaceShortcuts.pipelinesViewer.enableScheduling` controls whether cron scheduling is active (default: `false`)
- [ ] The Pipelines tree view shows a visual indicator (icon/badge) for pipelines with active schedules
- [ ] Users can manually trigger a scheduled pipeline at any time (existing behavior preserved)
- [ ] Next scheduled run time is visible in the pipeline's tooltip or tree view detail
- [ ] Cron validation errors surface as diagnostics on `pipeline.yaml`

## Subtasks

### 1. YAML Schema Extension
- Add optional `schedule` block to the pipeline YAML schema
- Support fields: `cron`, `enabled`, `timezone`, `description`
- Validate cron expressions during pipeline validation

```yaml
schedule:
  cron: "0 9 * * 1-5"       # Run at 9 AM, Monday–Friday
  enabled: true
  timezone: "UTC"            # Optional, default: UTC
  description: "Daily morning analysis"
```

### 2. Cron Scheduler Service
- Create a scheduler service in `pipeline-core` (no VS Code dependency)
- Parse and evaluate cron expressions (use a lightweight cron parser library)
- Manage timer registration, cancellation, and rescheduling
- Expose lifecycle methods: `start()`, `stop()`, `reschedule()`

### 3. VS Code Integration Layer
- Create `SchedulerManager` in the extension that bridges the core scheduler with VS Code
- Register/unregister schedules when pipelines are added, modified, or removed
- Respond to file watcher events on `pipeline.yaml` to update schedules
- Start scheduler on extension activation, stop on deactivation
- Respect the global `enableScheduling` setting

### 4. Tree View Enhancements
- Add schedule indicator icon to pipelines with active cron jobs
- Show next run time in tooltip
- Add context menu actions: "Enable Schedule", "Disable Schedule"
- Add a "Scheduled" filter option to the Pipelines tree view

### 5. Execution & Result Tracking
- Scheduled runs use the same `PipelineExecutorService` as manual runs
- Tag scheduled runs with metadata (trigger type: `scheduled`, schedule time)
- Ensure scheduled runs respect concurrency limits (don't overlap)
- Support configurable behavior on overlap: `skip`, `queue`, or `cancel-previous`

### 6. Testing
- Unit tests for cron expression parsing and next-run calculation
- Unit tests for scheduler lifecycle (register, fire, cancel, reschedule)
- Integration tests for file-watcher-triggered schedule updates
- Tests for overlap/concurrency handling
- Cross-platform timer reliability tests

## Notes

- The scheduler should only be active while VS Code is running; this is not a system-level daemon. Document this limitation clearly.
- Consider using an existing cron parsing library (e.g., `cron-parser` or `croner`) rather than implementing custom parsing.
- Timezone support is important for teams across regions — default to UTC but allow override.
- The `pipeline-core` package should contain the scheduling logic so it can be reused outside VS Code (e.g., in a future CLI tool).
- Overlap handling (`skip` by default) prevents resource exhaustion from long-running pipelines with short intervals.
- Future enhancement: support event-based triggers (file change, git push) alongside cron — design the scheduler interface to be extensible.
