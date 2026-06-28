# Pipeline Scheduler Design

## Overview

This document describes cron-based scheduling for YAML workflows. The scheduler uses file-based configuration alongside workflow definitions and stores runtime state in a workspace-scoped data location, so schedules survive process restarts without Redis, MongoDB, or another external service.

## Goals

1. **Recurring execution** - Run workflows on cron schedules.
2. **Persistence** - Preserve schedule state across process restarts.
3. **Timezone support** - Schedule in local or specific IANA timezones.
4. **Missed execution handling** - Decide whether to run or skip executions missed during downtime.
5. **Zero external infrastructure** - Work without a database or distributed lock service.
6. **Multi-environment support** - Run from the CoC server, CLI daemon, and other Node.js hosts.
7. **Multi-repo safety** - Scope schedules, state, and execution to the selected workspace.

## Non-Goals

- Distributed scheduling across multiple machines.
- Sub-second precision.
- Complex workflow orchestration beyond a single scheduled workflow.
- Dashboard authoring UI in the first version.

## File Structure

Workflow definitions can live in a repository configuration directory:

```text
.vscode/pipelines/
  daily-report/
    pipeline.yaml
    input.csv
  weekly-sync/
    pipeline.yaml
```

Scheduler runtime state must live under the CoC data directory for the workspace:

```text
~/.coc/repos/<workspaceId>/pipeline-schedules/
  daily-report-a1b2c3.state.json
  weekly-sync-d4e5f6.state.json
  scheduler.lock
```

The `.vscode/pipelines/` path is repository configuration. The `~/.coc/repos/<workspaceId>/` path is runtime state.

## Schedule Block

```yaml
name: "Daily Bug Report"
description: "Generate daily bug triage report"

schedule:
  cron: "0 9 * * 1-5"
  timezone: "America/New_York"
  enabled: true

  retryPolicy:
    maxRetries: 3
    retryDelayMs: 60000

  missedExecution: "run"

  window:
    maxDelayMinutes: 30

input:
  from:
    type: csv
    path: "bugs.csv"

map:
  prompt: "Analyze bug: {{title}}"
  output: [severity, category]

reduce:
  type: json
```

## State File Format

```json
{
  "version": 1,
  "workspaceId": "ws-abc123",
  "scheduleId": "daily-report-a1b2c3",
  "pipelineId": "daily-report",
  "pipelinePath": ".vscode/pipelines/daily-report/pipeline.yaml",
  "status": "idle",
  "enabled": true,
  "lastRun": {
    "startedAt": "2026-01-26T14:00:00.000Z",
    "completedAt": "2026-01-26T14:02:35.000Z",
    "success": true,
    "resultFile": "results/2026-01-26T14-00-00.json",
    "itemsProcessed": 42,
    "error": null
  },
  "nextRun": "2026-01-27T14:00:00.000Z",
  "stats": {
    "totalRuns": 156,
    "successfulRuns": 152,
    "failedRuns": 4,
    "lastFailure": "2026-01-20T14:00:00.000Z"
  },
  "history": []
}
```

## Lock File Format

```json
{
  "pid": 12345,
  "hostname": "dev-machine",
  "workspaceId": "ws-abc123",
  "startedAt": "2026-01-26T08:00:00.000Z",
  "heartbeat": "2026-01-26T14:30:00.000Z"
}
```

Each workspace has its own lock. A single CoC server may manage schedules for multiple workspaces without sharing lock files between them.

## Component Architecture

```text
PipelineScheduler
  CronParser
  StateManager
  ExecutionCoordinator
  LockManager
  TimerManager
  PipelineDiscovery
  EventEmitter
    -> executeWorkflow()
    -> CoC queue/process tracker
```

| Component | Responsibility |
|-----------|----------------|
| `PipelineScheduler` | Lifecycle management, public API, and event emission. |
| `CronParser` | Parse cron expressions and calculate next run times. |
| `StateManager` | Read/write workspace-scoped schedule state and history. |
| `ExecutionCoordinator` | Execute workflows, apply retry policy, and track in-flight runs. |
| `LockManager` | Prevent concurrent scheduler instances for one workspace. |
| `TimerManager` | Own pending timers and cancellation. |
| `PipelineDiscovery` | Scan configured directories for workflows with `schedule:` blocks. |

## Core Types

```typescript
export interface ScheduleConfig {
  cron: string;
  timezone?: string;
  enabled?: boolean;
  retryPolicy?: {
    maxRetries?: number;
    retryDelayMs?: number;
  };
  missedExecution?: 'run' | 'skip';
  window?: {
    maxDelayMinutes?: number;
  };
}

export interface ScheduleState {
  version: number;
  workspaceId: string;
  scheduleId: string;
  pipelineId: string;
  pipelinePath: string;
  status: ScheduleStatus;
  enabled: boolean;
  lastRun: RunRecord | null;
  nextRun: string | null;
  stats: ScheduleStats;
  history: RunRecord[];
}

export type ScheduleStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'error'
  | 'disabled';

export interface RunRecord {
  startedAt: string;
  completedAt: string | null;
  success: boolean;
  duration?: number;
  itemsProcessed?: number;
  resultFile?: string;
  error?: string;
  retryAttempt?: number;
}
```

## Public API

```typescript
export interface SchedulerOptions {
  workspaceId: string;
  workspaceRoot: string;
  dataDir: string;
  pipelinesDirectory: string;
  aiInvoker: AIInvoker;
  processTracker?: ProcessTracker;
  maxHistoryEntries?: number;
  lockStaleThresholdMs?: number;
  heartbeatIntervalMs?: number;
}

export class PipelineScheduler extends EventEmitter {
  constructor(options: SchedulerOptions);

  start(): Promise<void>;
  stop(timeoutMs?: number): Promise<void>;
  isRunning(): boolean;

  listSchedules(): Promise<ScheduleInfo[]>;
  getSchedule(scheduleId: string): Promise<ScheduleInfo | undefined>;
  triggerNow(scheduleId: string): Promise<PipelineExecutionResult>;
  pause(scheduleId: string): Promise<void>;
  resume(scheduleId: string): Promise<void>;
  cancel(scheduleId: string): Promise<void>;

  getUpcoming(limit?: number): Promise<Array<{
    scheduleId: string;
    pipelineId: string;
    nextRun: Date;
  }>>;

  getHistory(scheduleId: string, limit?: number): Promise<RunRecord[]>;
  dispose(): void;
}
```

## Startup Sequence

```text
start()
  1. Resolve workspace-scoped state directory.
  2. Acquire the workspace scheduler lock.
  3. Start lock heartbeat.
  4. Discover workflow files with schedule blocks.
  5. Load or initialize state for each schedule.
  6. Handle missed executions.
  7. Set timers for enabled schedules.
  8. Emit running status.
```

## Execution Flow

```text
Timer fires
  1. Verify schedule is still enabled.
  2. Check execution window.
  3. Mark state as running.
  4. Compile workflow YAML.
  5. Execute through executeWorkflow().
  6. Publish progress through processTracker when provided.
  7. Persist result metadata and next run.
  8. Emit completion or retry/failure event.
```

## Shutdown Sequence

```text
stop()
  1. Emit stopping status.
  2. Cancel pending timers.
  3. Wait for in-flight executions up to timeout.
  4. Stop heartbeat.
  5. Release workspace lock.
  6. Stop file watchers.
  7. Emit stopped status.
```

## Cron Parsing

Use `croner` for cron parsing:

- Small dependency footprint.
- Native timezone support through `Intl.DateTimeFormat`.
- TypeScript-friendly API.

```typescript
import { Cron } from 'croner';

const job = new Cron('0 9 * * 1-5', {
  timezone: 'America/New_York',
}, () => {
  void scheduler.triggerNow(scheduleId);
});

const nextRun = job.nextRun();
```

Supported syntax:

| Syntax | Meaning | Example |
|--------|---------|---------|
| `*` | Any value | `* * * * *` |
| `,` | List | `1,15 * * * *` |
| `-` | Range | `1-5 * * * *` |
| `/` | Step | `*/15 * * * *` |
| `@daily` | Daily alias | `@daily` |

## Error Handling

| Category | Handling | Example |
|----------|----------|---------|
| Config error | Disable schedule and report validation details. | Invalid cron syntax. |
| Lock error | Fail startup for that workspace scheduler. | Active scheduler heartbeat. |
| Execution error | Retry according to policy. | AI timeout or network error. |
| State error | Recreate state if safe, otherwise disable schedule. | Corrupted JSON. |
| System error | Log, keep other schedules running. | Disk full for one state write. |

Retry behavior:

```typescript
async function executeWithRetry(scheduleId: string, config: ScheduleConfig, attempt = 1) {
  const maxRetries = config.retryPolicy?.maxRetries ?? 3;
  const retryDelayMs = config.retryPolicy?.retryDelayMs ?? 60000;

  try {
    return await executeWorkflowForSchedule(scheduleId);
  } catch (error) {
    if (attempt < maxRetries) {
      emitExecutionError({ scheduleId, error, willRetry: true, retryAttempt: attempt });
      await delay(retryDelayMs * attempt);
      return executeWithRetry(scheduleId, config, attempt + 1);
    }

    throw error;
  }
}
```

## CoC Server Integration

```typescript
import { PipelineScheduler } from '@plusplusoneplusplus/coc-workflow/scheduler';
import { getRepoDataPath } from '../paths';

export async function startWorkspaceScheduler(workspace: WorkspaceInfo, dataDir: string) {
  const stateDir = getRepoDataPath(dataDir, workspace.id, 'pipeline-schedules');

  const scheduler = new PipelineScheduler({
    workspaceId: workspace.id,
    workspaceRoot: workspace.root,
    dataDir: stateDir,
    pipelinesDirectory: path.join(workspace.root, '.vscode', 'pipelines'),
    aiInvoker: createServerAIInvoker(workspace),
    processTracker: createProcessTracker(workspace.id),
  });

  scheduler.on('execution:start', info => {
    publishWorkspaceEvent(workspace.id, { type: 'pipeline-schedule-start', info });
  });

  scheduler.on('execution:complete', info => {
    publishWorkspaceEvent(workspace.id, { type: 'pipeline-schedule-complete', info });
  });

  scheduler.on('execution:error', info => {
    publishWorkspaceEvent(workspace.id, { type: 'pipeline-schedule-error', info });
  });

  await scheduler.start();
  return scheduler;
}
```

## CLI Daemon Integration

```typescript
import { PipelineScheduler } from '@plusplusoneplusplus/coc-workflow/scheduler';

async function main() {
  const scheduler = new PipelineScheduler({
    workspaceId: resolveWorkspaceId(process.cwd()),
    workspaceRoot: process.cwd(),
    dataDir: resolveWorkspaceScheduleDataDir(process.cwd()),
    pipelinesDirectory: process.argv[2] || '.vscode/pipelines',
    aiInvoker: createCLIAIInvoker(),
  });

  process.on('SIGTERM', () => void scheduler.stop().then(() => process.exit(0)));
  process.on('SIGINT', () => void scheduler.stop().then(() => process.exit(0)));

  await scheduler.start();
  console.log('Scheduler running. Press Ctrl+C to stop.');
}
```

## CLI Commands

```bash
coc scheduler start --workspace <path>
coc scheduler list --workspace <path>
coc scheduler status <schedule-id> --workspace <path>
coc scheduler trigger <schedule-id> --workspace <path>
coc scheduler pause <schedule-id> --workspace <path>
coc scheduler resume <schedule-id> --workspace <path>
coc scheduler history <schedule-id> --workspace <path> --limit 10
```

## File Watching

The scheduler watches configured pipeline directories for `pipeline.yaml` changes.

| Change | Action |
|--------|--------|
| Schedule added | Load state and set timer. |
| Schedule modified | Recalculate next run and reset timer. |
| Schedule removed | Cancel timer and mark state disabled. |
| Pipeline deleted | Cancel timer and preserve history for audit. |

```typescript
function setupFileWatcher(directory: string): void {
  const watcher = fs.watch(directory, { recursive: true });

  watcher.on('change', debounce((_eventType, filename) => {
    if (filename?.endsWith('pipeline.yaml')) {
      void reloadPipelineSchedule(filename);
    }
  }, 500));
}
```

## Testing Strategy

Unit tests:

- Cron parsing and timezone calculations.
- State serialization and history trimming.
- Lock acquisition, stale-lock recovery, and release.
- Retry and missed-execution behavior.
- Workspace-scoped path resolution.

Integration tests:

- Scheduler lifecycle: start, execute, stop.
- Concurrent scheduler prevention for one workspace.
- Independent schedulers for separate workspaces.
- Dynamic file updates.
- Graceful shutdown with in-flight execution.

Mock timer helper:

```typescript
class MockTimerManager implements TimerManager {
  private timers = new Map<string, { callback: () => void; triggerAt: number }>();

  advanceTime(ms: number): void {
    const now = Date.now() + ms;
    for (const [id, timer] of this.timers) {
      if (timer.triggerAt <= now) {
        timer.callback();
        this.timers.delete(id);
      }
    }
  }
}
```

## Future Considerations

1. Pipeline chaining:

   ```yaml
   schedule:
     cron: "0 9 * * *"
     after: "data-fetch"
   ```

2. Execution conditions:

   ```yaml
   schedule:
     cron: "0 9 * * *"
     condition:
       file_exists: "input/data.csv"
   ```

3. Notifications:

   ```yaml
   schedule:
     cron: "0 9 * * *"
     notify:
       on_failure: "https://hooks.slack.com/..."
   ```

4. Dashboard schedule management.
5. Metrics export through OpenTelemetry.
6. Distributed scheduling with an external lock backend.

## Example Configurations

### Daily Report

```yaml
name: "Daily Bug Report"
schedule:
  cron: "0 9 * * *"
  timezone: "America/New_York"

input:
  from: { type: csv, path: "bugs.csv" }
map:
  prompt: "Categorize: {{title}}"
  output: [severity, category]
reduce:
  type: json
```

### Weekly Sync

```yaml
name: "Weekly Data Sync"
schedule:
  cron: "0 0 * * 0"
  retryPolicy:
    maxRetries: 5
    retryDelayMs: 300000

input:
  from: { type: csv, path: "sync-targets.csv" }
map:
  prompt: "Sync {{endpoint}}"
  output: [status, records_synced]
reduce:
  type: table
```

### Business-Hours Monitor

```yaml
name: "Queue Monitor"
schedule:
  cron: "*/15 9-17 * * 1-5"
  timezone: "America/Los_Angeles"
  missedExecution: "skip"

input:
  items:
    - queue: "high-priority"
    - queue: "standard"
map:
  prompt: "Check queue {{queue}} depth"
  output: [depth, oldest_message_age]
reduce:
  type: json
```
