---
status: pending
---

# 020: Integrate DAG Support into VS Code Extension

## Summary
Extend the VS Code extension's pipeline viewer to support DAG YAML files — displaying DAG graphs, run status, and providing commands to trigger, cancel, retry, and monitor DAG executions directly from the editor.

## Motivation
The VS Code extension is the primary UI for many users. DAG support in pipeline-core and CLI is useless without VS Code integration. This commit brings the full DAG lifecycle into the editor, completing the user experience.

## Changes

### Files to Create
- `src/shortcuts/yaml-pipeline/ui/dag-tree-items.ts` — Tree items for DAGs:
  - `DAGItem` — Represents a DAG with name, schedule, status icon
  - `DAGTaskItem` — Represents a task within a DAG
  - `DAGRunItem` — Represents a historical run
- `src/shortcuts/yaml-pipeline/ui/dag-graph-webview.ts` — Webview panel:
  - Renders DAG task dependency graph as interactive SVG
  - Color-coded nodes by status (running/success/failed/skipped)
  - Clickable nodes to view task details
  - Auto-refreshes during execution
- `src/shortcuts/yaml-pipeline/ui/dag-commands.ts` — DAG-specific commands:
  - `pipelinesViewer.triggerDAG` — Trigger DAG execution with optional config
  - `pipelinesViewer.cancelDAGRun` — Cancel running DAG
  - `pipelinesViewer.retryDAGTask` — Retry failed task
  - `pipelinesViewer.viewDAGGraph` — Open graph visualization
  - `pipelinesViewer.viewRunHistory` — Show run history panel
  - `pipelinesViewer.backfillDAG` — Backfill wizard with date pickers
- `src/shortcuts/yaml-pipeline/ui/dag-executor-service.ts` — VS Code execution wrapper:
  - Bridges pipeline-core DAGExecutor with VS Code progress notifications
  - Maps task state changes to VS Code notification updates
  - Integrates with AI process manager for tracking

### Files to Modify
- `src/shortcuts/yaml-pipeline/ui/pipeline-manager.ts` — Detect DAG files (dag.yaml) alongside pipeline.yaml
- `src/shortcuts/yaml-pipeline/ui/tree-data-provider.ts` — Add DAG items to tree (separate category)
- `src/shortcuts/yaml-pipeline/ui/commands.ts` — Register DAG commands
- `package.json` — Add DAG commands, menus, and view contributions

## Implementation Notes
- DAG files use `dag.yaml` filename (vs `pipeline.yaml`) for clear distinction
- Tree view shows DAGs in a separate "DAG Workflows" category above single pipelines
- Graph webview reuses the SVG approach from the web dashboard (018) but styled for VS Code themes
- VS Code progress API (`withProgress`) shows DAG execution progress
- Task state changes update the tree view in real-time (via event emitter → tree refresh)
- Backfill wizard uses VS Code's `showInputBox` for dates and `showQuickPick` for options
- Run history opens in a webview panel with table of recent runs

## Tests
- Extension tests in `src/test/suite/`:
  - `dag-tree-items.test.ts`:
    - DAG item renders with correct name and icon
    - Task items show status
    - Run items show date and duration
  - `dag-commands.test.ts`:
    - Trigger DAG command creates execution
    - Cancel command stops running DAG
    - Retry re-queues failed task

## Acceptance Criteria
- [ ] DAG files discovered and displayed in pipeline tree view
- [ ] DAG graph visualization renders in webview
- [ ] Trigger/cancel/retry commands work from tree view and command palette
- [ ] Execution progress shown via VS Code notifications
- [ ] Run history viewable in webview panel
- [ ] Backfill wizard collects date range and triggers backfill
- [ ] Existing pipeline features continue to work unchanged
- [ ] Extension tests pass

## Dependencies
- Depends on: 004, 005, 013, 015, 018
