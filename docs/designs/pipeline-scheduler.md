# Pipeline Scheduler Design

## Overview

This document describes the design for adding cron-based scheduling support to the `pipeline-core` package. The scheduler uses a file-based persistence model that stores schedule state alongside pipeline definitions, enabling schedules to survive process restarts without external database dependencies.

## Goals

1. **Recurring Execution** - Run pipelines on cron schedules (daily, weekly, etc.)
2. **Persistence** - Schedules survive process restarts
3. **Timezone Support** - Schedule in local or specific timezones
4. **Missed Execution Handling** - Gracefully handle executions missed during downtime
5. **Zero External Dependencies** - No Redis, MongoDB, or other infrastructure required
6. **Multi-Environment** - Work in VS Code extension, CLI daemon, and Node.js backends

## Non-Goals (v1)

- Distributed scheduling across multiple machines
- Sub-second precision scheduling
- Complex workflow orchestration (pipeline chaining)
- Web UI for schedule management

---

## File Structure

### Pipeline Package Layout

```
.vscode/pipelines/
├── daily-report/
│   ├── pipeline.yaml           # Pipeline definition with schedule block
│   ├── .schedule-state.json    # Runtime state (managed by scheduler)
│   └── input.csv
├── weekly-sync/
│   ├── pipeline.yaml
│   └── .schedule-state.json
└── .scheduler.lock             # Lock file preventing concurrent instances
```

### Schedule Block in pipeline.yaml

```yaml
name: "Daily Bug Report"
description: "Generate daily bug triage report"

# New: Schedule configuration
schedule:
  cron: "0 9 * * 1-5"           # 9 AM on weekdays
  timezone: "America/New_York"   # IANA timezone (optional, defaults to system)
  enabled: true                  # Can disable without removing config

  # Error handling
  retryPolicy:
    maxRetries: 3                # Retry failed executions (default: 3)
    retryDelayMs: 60000          # Delay between retries (default: 1 min)

  # Missed execution handling
  missedExecution: "run"         # "run" | "skip" (default: "run")

  # Execution window (optional)
  window:
    maxDelayMinutes: 30          # Skip if more than 30 min late

# Existing pipeline config
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

### State File Format (.schedule-state.json)

```json
{
  "version": 1,
  "scheduleId": "daily-report-a1b2c3",
  "pipelineId": "daily-report",

  "status": "idle",
  "enabled": true,

  "lastRun": {
    "startedAt": "2026-01-26T14:00:00.000Z",
    "completedAt": "2026-01-26T14:02:35.000Z",
    "success": true,
    "resultFile": ".results/2026-01-26T14-00-00.json",
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

  "history": [
    {
      "startedAt": "2026-01-26T14:00:00.000Z",
      "completedAt": "2026-01-26T14:02:35.000Z",
      "success": true,
      "duration": 155000
    }
  ]
}
```

### Lock File Format (.scheduler.lock)

```json
{
  "pid": 12345,
  "hostname": "dev-machine",
  "startedAt": "2026-01-26T08:00:00.000Z",
  "heartbeat": "2026-01-26T14:30:00.000Z"
}
```

---

## Component Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      PipelineScheduler                          │
│  (Main orchestrator - manages lifecycle and coordinates)        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │ CronParser   │  │ StateManager │  │ ExecutionCoordinator  │ │
│  │              │  │              │  │                       │ │
│  │ - parse()    │  │ - load()     │  │ - execute()           │ │
│  │ - nextRun()  │  │ - save()     │  │ - retry()             │ │
│  │ - validate() │  │ - history()  │  │ - cancel()            │ │
│  └──────────────┘  └──────────────┘  └───────────────────────┘ │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │ LockManager  │  │ TimerManager │  │ PipelineDiscovery     │ │
│  │              │  │              │  │                       │ │
│  │ - acquire()  │  │ - schedule() │  │ - scan()              │ │
│  │ - release()  │  │ - cancel()   │  │ - watch()             │ │
│  │ - heartbeat()│  │ - list()     │  │ - getScheduled()      │ │
│  └──────────────┘  └──────────────┘  └───────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ uses
                              ▼
                 ┌─────────────────────────┐
                 │   Existing Executor     │
                 │   (executePipeline)     │
                 └─────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| `PipelineScheduler` | Main entry point. Lifecycle management, event emission, public API |
| `CronParser` | Parse cron expressions, calculate next execution times with timezone |
| `StateManager` | Read/write `.schedule-state.json`, manage execution history |
| `ExecutionCoordinator` | Run pipelines, handle retries, track in-flight executions |
| `LockManager` | Prevent concurrent scheduler instances, heartbeat monitoring |
| `TimerManager` | Manage Node.js timers for scheduled executions |
| `PipelineDiscovery` | Scan for pipelines with schedules, watch for changes |

---

## Core Types

```typescript
// packages/pipeline-core/src/scheduler/types.ts

/**
 * Schedule configuration in pipeline.yaml
 */
export interface ScheduleConfig {
    /** Cron expression (5 or 6 fields) */
    cron: string;

    /** IANA timezone (e.g., "America/New_York"). Defaults to system timezone */
    timezone?: string;

    /** Whether schedule is active. Defaults to true */
    enabled?: boolean;

    /** Retry policy for failed executions */
    retryPolicy?: {
        maxRetries?: number;      // Default: 3
        retryDelayMs?: number;    // Default: 60000
    };

    /** How to handle missed executions: "run" or "skip". Default: "run" */
    missedExecution?: 'run' | 'skip';

    /** Execution window constraints */
    window?: {
        maxDelayMinutes?: number; // Skip if execution is delayed beyond this
    };
}

/**
 * Runtime state for a scheduled pipeline
 */
export interface ScheduleState {
    version: number;
    scheduleId: string;
    pipelineId: string;

    status: ScheduleStatus;
    enabled: boolean;

    lastRun: RunRecord | null;
    nextRun: string | null;  // ISO timestamp

    stats: ScheduleStats;
    history: RunRecord[];    // Last N runs (configurable)
}

export type ScheduleStatus =
    | 'idle'        // Waiting for next execution
    | 'running'     // Currently executing
    | 'paused'      // Manually paused
    | 'error'       // Last run failed, waiting for retry/next
    | 'disabled';   // Schedule disabled in config

/**
 * Record of a single execution
 */
export interface RunRecord {
    startedAt: string;
    completedAt: string | null;
    success: boolean;
    duration?: number;        // ms
    itemsProcessed?: number;
    resultFile?: string;
    error?: string;
    retryAttempt?: number;
}

/**
 * Aggregate statistics
 */
export interface ScheduleStats {
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    lastFailure: string | null;
    averageDuration?: number;  // ms
}

/**
 * Information about a scheduled pipeline
 */
export interface ScheduleInfo {
    scheduleId: string;
    pipelineId: string;
    pipelineName: string;
    pipelineDirectory: string;

    config: ScheduleConfig;
    state: ScheduleState;

    nextRunIn?: number;  // ms until next run
}
```

---

## Public API

```typescript
// packages/pipeline-core/src/scheduler/scheduler.ts

export interface SchedulerOptions {
    /** Root directory containing pipeline packages */
    pipelinesDirectory: string;

    /** Workspace root for resolving skills */
    workspaceRoot?: string;

    /** AI invoker for pipeline execution */
    aiInvoker: AIInvoker;

    /** Optional process tracker for UI integration */
    processTracker?: ProcessTracker;

    /** Maximum history entries to keep per pipeline. Default: 50 */
    maxHistoryEntries?: number;

    /** Lock file stale threshold in ms. Default: 60000 (1 min) */
    lockStaleThresholdMs?: number;

    /** Heartbeat interval in ms. Default: 10000 (10 sec) */
    heartbeatIntervalMs?: number;
}

export interface SchedulerEvents {
    /** Emitted when a scheduled execution starts */
    'execution:start': (info: { scheduleId: string; pipelineId: string }) => void;

    /** Emitted when execution completes successfully */
    'execution:complete': (info: {
        scheduleId: string;
        pipelineId: string;
        result: PipelineExecutionResult;
        duration: number;
    }) => void;

    /** Emitted when execution fails */
    'execution:error': (info: {
        scheduleId: string;
        pipelineId: string;
        error: Error;
        willRetry: boolean;
        retryAttempt?: number;
    }) => void;

    /** Emitted when a schedule is added/updated/removed */
    'schedule:changed': (info: {
        scheduleId: string;
        pipelineId: string;
        change: 'added' | 'updated' | 'removed';
    }) => void;

    /** Emitted when scheduler starts/stops */
    'scheduler:status': (status: 'starting' | 'running' | 'stopping' | 'stopped') => void;
}

export class PipelineScheduler extends EventEmitter {
    constructor(options: SchedulerOptions);

    // Lifecycle

    /**
     * Start the scheduler. Acquires lock, loads state, sets up timers.
     * @throws {SchedulerLockError} if another instance is running
     */
    start(): Promise<void>;

    /**
     * Stop the scheduler gracefully. Waits for in-flight executions.
     * @param timeoutMs - Max time to wait for executions. Default: 30000
     */
    stop(timeoutMs?: number): Promise<void>;

    /**
     * Check if scheduler is running
     */
    isRunning(): boolean;

    // Schedule Management

    /**
     * Get all scheduled pipelines
     */
    listSchedules(): Promise<ScheduleInfo[]>;

    /**
     * Get info for a specific schedule
     */
    getSchedule(scheduleId: string): Promise<ScheduleInfo | undefined>;

    /**
     * Manually trigger a scheduled pipeline (outside normal schedule)
     */
    triggerNow(scheduleId: string): Promise<PipelineExecutionResult>;

    /**
     * Pause a schedule (skip upcoming executions until resumed)
     */
    pause(scheduleId: string): Promise<void>;

    /**
     * Resume a paused schedule
     */
    resume(scheduleId: string): Promise<void>;

    /**
     * Cancel a currently running execution
     */
    cancel(scheduleId: string): Promise<void>;

    // Queries

    /**
     * Get upcoming executions across all schedules
     */
    getUpcoming(limit?: number): Promise<Array<{
        scheduleId: string;
        pipelineId: string;
        nextRun: Date;
    }>>;

    /**
     * Get execution history for a schedule
     */
    getHistory(scheduleId: string, limit?: number): Promise<RunRecord[]>;

    // Resource cleanup
    dispose(): void;
}
```

---

## Scheduler Lifecycle

### Startup Sequence

```
┌──────────────────────────────────────────────────────────────────┐
│                         start()                                   │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│ 1. Acquire Lock                                                   │
│    - Check .scheduler.lock exists                                 │
│    - If exists, check if stale (heartbeat too old)               │
│    - If stale or not exists, write new lock                      │
│    - If active, throw SchedulerLockError                         │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│ 2. Start Heartbeat                                                │
│    - Update .scheduler.lock every heartbeatIntervalMs            │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│ 3. Discover Pipelines                                             │
│    - Scan pipelinesDirectory for pipeline.yaml files             │
│    - Filter to those with schedule: block                        │
│    - Watch for file changes                                       │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│ 4. Load State                                                     │
│    - For each scheduled pipeline:                                 │
│      - Load .schedule-state.json (or create default)             │
│      - Parse schedule config                                      │
│      - Calculate next run time                                    │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│ 5. Handle Missed Executions                                       │
│    - For each schedule where nextRun < now:                       │
│      - If missedExecution == "run": queue for immediate execution│
│      - If missedExecution == "skip": calculate next future run   │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│ 6. Set Timers                                                     │
│    - For each enabled schedule:                                   │
│      - Set timer for nextRun                                      │
│    - Emit 'scheduler:status' = 'running'                         │
└──────────────────────────────────────────────────────────────────┘
```

### Execution Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                      Timer Fires                                  │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│ 1. Pre-Execution Check                                            │
│    - Verify schedule still enabled                                │
│    - Check window.maxDelayMinutes (skip if too late)             │
│    - Update state: status = 'running'                            │
│    - Emit 'execution:start'                                       │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│ 2. Execute Pipeline                                               │
│    - Load pipeline.yaml                                           │
│    - Call executePipeline() with aiInvoker                       │
│    - Track progress via processTracker                           │
└───────────────────────────┬──────────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
              ▼                           ▼
┌─────────────────────────┐   ┌─────────────────────────┐
│ 3a. Success             │   │ 3b. Failure             │
│                         │   │                         │
│ - Save result to file   │   │ - Check retry policy    │
│ - Update state:         │   │ - If retries remain:    │
│   - lastRun = success   │   │   - Schedule retry      │
│   - Calculate nextRun   │   │   - Emit with willRetry │
│   - Increment stats     │   │ - Else:                 │
│ - Emit 'complete'       │   │   - Update state: error │
│ - Set timer for nextRun │   │   - Calculate nextRun   │
│                         │   │   - Emit 'error'        │
└─────────────────────────┘   └─────────────────────────┘
```

### Shutdown Sequence

```
┌──────────────────────────────────────────────────────────────────┐
│                         stop()                                    │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│ 1. Emit 'scheduler:status' = 'stopping'                          │
│ 2. Cancel all pending timers                                      │
│ 3. Wait for in-flight executions (up to timeoutMs)               │
│ 4. Stop heartbeat                                                 │
│ 5. Release lock (delete .scheduler.lock)                         │
│ 6. Stop file watchers                                             │
│ 7. Emit 'scheduler:status' = 'stopped'                           │
└──────────────────────────────────────────────────────────────────┘
```

---

## Cron Parsing

### Supported Format

Standard 5-field cron with optional 6th field for seconds:

```
┌────────────── second (0-59) [optional]
│ ┌──────────── minute (0-59)
│ │ ┌────────── hour (0-23)
│ │ │ ┌──────── day of month (1-31)
│ │ │ │ ┌────── month (1-12)
│ │ │ │ │ ┌──── day of week (0-7, 0 and 7 = Sunday)
│ │ │ │ │ │
* * * * * *
```

### Special Characters

| Character | Meaning | Example |
|-----------|---------|---------|
| `*` | Any value | `* * * * *` = every minute |
| `,` | List | `1,15 * * * *` = minute 1 and 15 |
| `-` | Range | `1-5 * * * *` = minutes 1 through 5 |
| `/` | Step | `*/15 * * * *` = every 15 minutes |

### Predefined Schedules

| Alias | Equivalent |
|-------|------------|
| `@yearly` | `0 0 1 1 *` |
| `@monthly` | `0 0 1 * *` |
| `@weekly` | `0 0 * * 0` |
| `@daily` | `0 0 * * *` |
| `@hourly` | `0 * * * *` |

### Library Choice: croner

Use [croner](https://github.com/hexagon/croner) for cron parsing:

- Lightweight (~5KB)
- Native timezone support via `Intl.DateTimeFormat`
- No external dependencies
- TypeScript-first
- Actively maintained

```typescript
import { Cron } from 'croner';

const job = new Cron("0 9 * * 1-5", {
    timezone: "America/New_York"
}, () => {
    // Execute pipeline
});

// Get next run time
const nextRun = job.nextRun();
```

---

## Error Handling

### Error Categories

| Category | Handling | Example |
|----------|----------|---------|
| **Config Error** | Skip schedule, log warning | Invalid cron syntax |
| **Lock Error** | Fail startup, inform user | Another scheduler running |
| **Execution Error** | Retry per policy | AI timeout, network error |
| **State Error** | Recreate state file | Corrupted JSON |
| **System Error** | Log, continue others | Disk full on one save |

### Retry Logic

```typescript
async function executeWithRetry(
    scheduleId: string,
    config: ScheduleConfig,
    attempt: number = 1
): Promise<PipelineExecutionResult> {
    const maxRetries = config.retryPolicy?.maxRetries ?? 3;
    const retryDelayMs = config.retryPolicy?.retryDelayMs ?? 60000;

    try {
        return await executePipeline(/* ... */);
    } catch (error) {
        if (attempt < maxRetries) {
            this.emit('execution:error', {
                scheduleId,
                error,
                willRetry: true,
                retryAttempt: attempt
            });

            await delay(retryDelayMs * attempt); // Exponential backoff
            return executeWithRetry(scheduleId, config, attempt + 1);
        }

        throw error; // Max retries exceeded
    }
}
```

---

## Integration Points

### VS Code Extension

```typescript
// src/extension.ts
import { PipelineScheduler } from 'pipeline-core';

let scheduler: PipelineScheduler | undefined;

export async function activate(context: ExtensionContext) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return;

    const pipelinesDir = path.join(workspaceRoot, '.vscode', 'pipelines');

    scheduler = new PipelineScheduler({
        pipelinesDirectory: pipelinesDir,
        workspaceRoot,
        aiInvoker: createAIInvoker(),
        processTracker: aiProcessManager
    });

    // UI updates
    scheduler.on('execution:start', (info) => {
        vscode.window.setStatusBarMessage(`Running: ${info.pipelineId}...`);
    });

    scheduler.on('execution:complete', (info) => {
        vscode.window.showInformationMessage(
            `Pipeline "${info.pipelineId}" completed in ${info.duration}ms`
        );
    });

    scheduler.on('execution:error', (info) => {
        if (!info.willRetry) {
            vscode.window.showErrorMessage(
                `Pipeline "${info.pipelineId}" failed: ${info.error.message}`
            );
        }
    });

    await scheduler.start();

    context.subscriptions.push({
        dispose: () => scheduler?.stop()
    });
}
```

### CLI Daemon

```typescript
// cli/daemon.ts
import { PipelineScheduler } from 'pipeline-core';

async function main() {
    const scheduler = new PipelineScheduler({
        pipelinesDirectory: process.argv[2] || '.vscode/pipelines',
        aiInvoker: createCLIAIInvoker()
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
        console.log('Shutting down...');
        await scheduler.stop();
        process.exit(0);
    });

    process.on('SIGINT', async () => {
        console.log('Interrupted, shutting down...');
        await scheduler.stop();
        process.exit(0);
    });

    await scheduler.start();
    console.log('Scheduler running. Press Ctrl+C to stop.');

    // Keep process alive
    setInterval(() => {}, 1000);
}
```

### CLI Commands

```bash
# Start daemon
pipeline-core scheduler start

# List schedules
pipeline-core scheduler list

# Get schedule status
pipeline-core scheduler status <schedule-id>

# Trigger immediate execution
pipeline-core scheduler trigger <schedule-id>

# Pause/resume
pipeline-core scheduler pause <schedule-id>
pipeline-core scheduler resume <schedule-id>

# View history
pipeline-core scheduler history <schedule-id> --limit 10
```

---

## File Watching

The scheduler watches for changes to pipeline.yaml files:

| Change | Action |
|--------|--------|
| Schedule added | Load state, set timer |
| Schedule modified | Recalculate next run, reset timer |
| Schedule removed | Cancel timer, archive state |
| Pipeline deleted | Cancel timer, cleanup state |

```typescript
// Debounce file changes (500ms)
private setupFileWatcher(): void {
    const watcher = fs.watch(this.pipelinesDirectory, { recursive: true });

    watcher.on('change', debounce((eventType, filename) => {
        if (filename?.endsWith('pipeline.yaml')) {
            this.handlePipelineChange(filename);
        }
    }, 500));
}
```

---

## Testing Strategy

### Unit Tests

- Cron parsing with various expressions
- Timezone calculations
- State serialization/deserialization
- Retry logic
- Lock acquisition/release

### Integration Tests

- Full scheduler lifecycle (start → execute → stop)
- Missed execution handling
- File watching and dynamic updates
- Concurrent scheduler prevention
- Graceful shutdown with in-flight execution

### Mock Utilities

```typescript
// Test helper: advance time without waiting
class MockTimerManager implements TimerManager {
    private timers: Map<string, { callback: () => void; triggerAt: number }>;

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

---

## Future Considerations

### Phase 2 Enhancements

1. **Pipeline Chaining** - Run pipeline B after pipeline A completes
   ```yaml
   schedule:
     cron: "0 9 * * *"
     after: "data-fetch"  # Wait for data-fetch to complete first
   ```

2. **Execution Conditions** - Skip based on runtime conditions
   ```yaml
   schedule:
     cron: "0 9 * * *"
     condition:
       file_exists: "input/data.csv"
   ```

3. **Notifications** - Webhook/email on completion/failure
   ```yaml
   schedule:
     cron: "0 9 * * *"
     notify:
       on_failure: "https://hooks.slack.com/..."
   ```

### Phase 3 Enhancements

1. **Distributed Scheduling** - Redis backend for multi-machine coordination
2. **Web Dashboard** - View/manage schedules via browser
3. **Metrics Export** - Prometheus/OpenTelemetry integration

---

## Appendix: Example Configurations

### Daily Report at 9 AM EST

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

### Weekly Sync on Sunday Midnight

```yaml
name: "Weekly Data Sync"
schedule:
  cron: "0 0 * * 0"
  retryPolicy:
    maxRetries: 5
    retryDelayMs: 300000  # 5 minutes

input:
  from: { type: csv, path: "sync-targets.csv" }
map:
  prompt: "Sync {{endpoint}}"
  output: [status, records_synced]
reduce:
  type: table
```

### Every 15 Minutes During Business Hours

```yaml
name: "Queue Monitor"
schedule:
  cron: "*/15 9-17 * * 1-5"  # Every 15 min, 9-5, Mon-Fri
  timezone: "America/Los_Angeles"
  missedExecution: "skip"  # Don't catch up on missed checks

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
