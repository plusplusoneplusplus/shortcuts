---
status: pending
---

# 019: Add DAG Commands to Pipeline CLI

## Summary
Extend the `pipeline-cli` package with DAG-specific commands — trigger, list, status, backfill, pause/unpause — providing a complete command-line interface for DAG orchestration.

## Motivation
The pipeline-cli currently only handles single pipeline execution. With DAG support in pipeline-core, the CLI needs commands for managing DAGs, viewing run status, triggering backfills, and controlling the scheduler — making the framework usable without VS Code or a web dashboard.

## Changes

### Files to Create
- `packages/pipeline-cli/src/commands/dag-trigger.ts` — `dag trigger <dag-path>`:
  - Parse DAG YAML from path
  - Execute immediately (or via API if scheduler running)
  - Options: `--conf key=value`, `--run-id`, `--no-wait` (fire and forget)
  - Shows real-time progress (task completions) if `--wait` (default)
- `packages/pipeline-cli/src/commands/dag-list.ts` — `dag list [directory]`:
  - Discover DAG YAML files in directory
  - Show table: name, schedule, paused, last run status, last run date
  - Options: `--output json|table|csv`
- `packages/pipeline-cli/src/commands/dag-status.ts` — `dag status <dag-id>`:
  - Show current/recent run details
  - Task instance states, durations, XCom keys
  - Options: `--run-id` (specific run), `--task-id` (specific task), `--output`
- `packages/pipeline-cli/src/commands/dag-backfill.ts` — `dag backfill <dag-path>`:
  - Options: `--start-date`, `--end-date`, `--parallel`, `--dry-run`, `--rerun-failed`
  - Shows progress: completed/total dates
- `packages/pipeline-cli/src/commands/dag-pause.ts` — `dag pause/unpause <dag-id>`:
  - Toggles scheduling state
- `packages/pipeline-cli/src/commands/scheduler-start.ts` — `scheduler start`:
  - Starts scheduler + API server as foreground process
  - Options: `--port`, `--dags-folder`, `--tick-interval`
  - Handles SIGINT/SIGTERM gracefully

### Files to Modify
- `packages/pipeline-cli/src/cli.ts` — Add `dag` command group and `scheduler` command
- `packages/pipeline-cli/src/index.ts` — Wire new commands

## Implementation Notes
- `dag` is a command group: `pipeline-cli dag trigger ./my-dag.yaml`
- When scheduler is running, commands communicate via REST API (017)
- When scheduler is not running, commands work directly with pipeline-core library
- `dag trigger --wait` shows a live-updating task status table (like `kubectl get pods -w`)
- `scheduler start` is a long-running process — logs to stdout/stderr, handles signals
- DAG file discovery uses glob for `**/dag.yaml` and `**/dag.yml` patterns
- Backfill progress uses a simple progress bar (spinner + completed/total)

## Tests
- `packages/pipeline-cli/test/commands/dag-trigger.test.ts`:
  - Parse and trigger DAG execution
  - `--conf` parameters passed to run
  - `--no-wait` returns immediately
- `packages/pipeline-cli/test/commands/dag-list.test.ts`:
  - Discovers DAG files in directory
  - Output formats (table, json, csv)
- `packages/pipeline-cli/test/commands/dag-backfill.test.ts`:
  - Correct date range → correct number of runs
  - `--dry-run` shows preview without executing
- `packages/pipeline-cli/test/commands/dag-status.test.ts`:
  - Shows run details with task states

## Acceptance Criteria
- [ ] `dag trigger` executes a DAG from YAML file
- [ ] `dag list` discovers and displays DAGs
- [ ] `dag status` shows run/task details
- [ ] `dag backfill` processes historical date range
- [ ] `dag pause/unpause` controls scheduling
- [ ] `scheduler start` runs scheduler as foreground process
- [ ] All output formats work (table, json, csv)
- [ ] Existing pipeline CLI commands still work
- [ ] Existing tests pass

## Dependencies
- Depends on: 005, 008, 013, 015, 017
