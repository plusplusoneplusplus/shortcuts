# Plan: Migrate "pipelines" → "workflows" (Extension + Dashboard)

## Problem

The pipeline viewer stores user pipelines in `.vscode/pipelines`. The folder name "pipelines" is being replaced by "workflows" to better reflect the product direction. This rename spans two surfaces: the VS Code extension and the CoC dashboard SPA. Existing users need a seamless, one-time upgrade path so their pipelines aren't lost.

## Approach

**VS Code extension:** On activation, detect if `.vscode/pipelines` exists and `.vscode/workflows` does not, then automatically rename the folder. Change all defaults and UI copy from `pipelines` to `workflows`. No user action required.

**CoC dashboard:** Rename REST API endpoints, SPA routes, WebSocket/SSE event names, React component names/files, state fields, CSS classes, and user-facing strings from "pipeline(s)" to "workflow(s)". The server-side `DEFAULT_PIPELINES_FOLDER` constant also moves to `.vscode/workflows`.

## Scope

- **In:** VS Code extension (`src/shortcuts/yaml-pipeline/`), `package.json` schema/defaults, activation logic, CoC dashboard SPA (`packages/coc/src/server/spa/`), CoC server pipeline routes (`packages/coc-server/src/`)
- **Out:** `pipeline-core` internals, YAML pipeline format/schema, CoC CLI command names (`coc run` etc.)

---

## Todos

### 1. Add one-time folder migration on activation
- **File:** `src/shortcuts/yaml-pipeline/ui/pipeline-manager.ts` (or `src/extension.ts`)
- Logic: at startup, if `.vscode/pipelines` exists AND `.vscode/workflows` does not exist → `fs.rename` the folder
- Show a VS Code info notification: _"Pipelines folder renamed to `.vscode/workflows`."_
- Guard: skip if user has a custom `folderPath` setting that is neither the old nor new default

### 2. Update default folder path
- **File:** `src/shortcuts/yaml-pipeline/ui/pipeline-manager.ts`
  - `getSettings()`: change fallback `'.vscode/pipelines'` → `'.vscode/workflows'`
  - `getPipelinesFolder()`: change fallback `'.vscode/pipelines'` → `'.vscode/workflows'`
- **File:** `package.json`
  - `workspaceShortcuts.pipelinesViewer.folderPath` default: `".vscode/pipelines"` → `".vscode/workflows"`
  - `description`: update to reference `.vscode/workflows`
  - Welcome view `contents`: update inline mention of `.vscode/pipelines/`

### 3. Update UI copy (string literals)
- Scan `src/shortcuts/yaml-pipeline/` for remaining user-visible strings referencing "pipelines folder" or `.vscode/pipelines` and update them to "workflows"

### 4. Add/update extension tests
- Unit test for the migration guard: old folder exists + new doesn't → rename called
- Unit test: old folder doesn't exist → no rename
- Unit test: both folders exist → no rename (don't clobber)
- Unit test: custom `folderPath` set by user → no rename

---

## Part 2 — CoC Dashboard SPA & Server

### 5. Rename REST API endpoints
- **File:** `packages/coc-server/src/server/pipelines-handler.ts`
- Change all route patterns from `/api/workspaces/:id/pipelines` → `/api/workspaces/:id/workflows`:
  - `GET /api/workspaces/:id/workflows` (list)
  - `GET /api/workspaces/:id/workflows/:name/content` (read)
  - `POST /api/workspaces/:id/workflows` (create)
  - `POST /api/workspaces/:id/workflows/generate` (AI generate)
  - `POST /api/workspaces/:id/workflows/refine` (AI refine)
  - `PATCH /api/workspaces/:id/workflows/:name/content` (update)
  - `DELETE /api/workspaces/:id/workflows/:name` (delete)
  - `POST /api/workspaces/:id/workflows/:name/run` (execute)
- Update `DEFAULT_PIPELINES_FOLDER` → `DEFAULT_WORKFLOWS_FOLDER` = `'.vscode/workflows'`
- Update YAML template `name:` fields: `"My Pipeline"` → `"My Workflow"`, `"Data Fanout Pipeline"` → `"Data Fanout Workflow"`, etc.
- Update display name: `'Run Pipeline: ${name}'` → `'Run Workflow: ${name}'`
- Rename exports: `registerPipelineRoutes` → `registerWorkflowRoutes`, `registerPipelineWriteRoutes` → `registerWorkflowWriteRoutes`, `EnrichedPipeline` → `EnrichedWorkflow`, `discoverAndEnrichPipelines` → `discoverAndEnrichWorkflows`

### 6. Rename SPA hash routes
- **File:** `packages/coc/src/server/spa/client/react/Router.tsx`
- Change route segments: `#repos/:id/pipelines` → `#repos/:id/workflows` (and nested `:name` and `:name/run/:processId`)
- `VALID_REPO_SUB_TABS`: `'pipelines'` → `'workflows'`
- Rename `parsePipelineDeepLink()` → `parseWorkflowDeepLink()`
- Rename `parsePipelineRunDeepLink()` → `parseWorkflowRunDeepLink()`
- Update all `location.hash = ...` assignments that reference `pipelines`

### 7. Rename React component files & component names
- **Directory:** `packages/coc/src/server/spa/client/react/repos/`
  - `PipelinesTab.tsx` → `WorkflowsTab.tsx` (`PipelinesTab` → `WorkflowsTab`)
  - `PipelineDetail.tsx` → `WorkflowDetail.tsx` (`PipelineDetail` → `WorkflowDetail`)
  - `AddPipelineDialog.tsx` → `AddWorkflowDialog.tsx` (`AddPipelineDialog` → `AddWorkflowDialog`)
  - `PipelineRunHistory.tsx` → `WorkflowRunHistory.tsx` (`PipelineRunHistory` → `WorkflowRunHistory`)
  - `PipelineAIRefinePanel.tsx` → `WorkflowAIRefinePanel.tsx` (`PipelineAIRefinePanel` → `WorkflowAIRefinePanel`)
  - `PipelineDAGPreview.tsx` → `WorkflowDAGPreview.tsx` (`PipelineDAGPreview` → `WorkflowDAGPreview`)
  - `pipeline-api.ts` → `workflow-api.ts`
- **Directory:** `packages/coc/src/server/spa/client/react/processes/`
  - `PipelineResultCard.tsx` → `WorkflowResultCard.tsx`
- **Directory:** `packages/coc/src/server/spa/client/react/processes/dag/`
  - `PipelineDAGChart.tsx` → `WorkflowDAGChart.tsx`
  - `PipelineDAGSection.tsx` → `WorkflowDAGSection.tsx`
  - `PipelinePhasePopover.tsx` → `WorkflowPhasePopover.tsx`
  - Update `index.ts` exports
- **Server files:** `packages/coc-server/src/server/`
  - `pipelines-handler.ts` → `workflows-handler.ts`
  - `pipeline-watcher.ts` → `workflow-watcher.ts` (`PipelineWatcher` → `WorkflowWatcher`, `PipelinesChangedCallback` → `WorkflowsChangedCallback`)

### 8. Update WebSocket & SSE event names
- **File:** `packages/coc-server/src/websocket.ts`
  - `'pipelines-changed'` → `'workflows-changed'`
- **File:** `packages/coc-server/src/server/index.ts`
  - All broadcasts of `type: 'pipelines-changed'` → `'workflows-changed'`
- **File:** `packages/coc-server/src/sse-handler.ts`
  - `'pipeline-phase'` → `'workflow-phase'`
  - `'pipeline-progress'` → `'workflow-progress'`
- **SPA hooks:**
  - `hooks/usePipelinePhase.ts` → `hooks/useWorkflowPhase.ts` — subscribe to new event names
  - `hooks/usePipelineProgress.ts` → `hooks/useWorkflowProgress.ts`
- **File:** `processes/ProcessDetail.tsx` — update event listener names

### 9. Update app state & types
- **File:** `AppContext.tsx`
  - `selectedPipelineName` → `selectedWorkflowName`
  - `selectedPipelineRunProcessId` → `selectedWorkflowRunProcessId`
  - `'SET_SELECTED_PIPELINE'` → `'SET_SELECTED_WORKFLOW'`
  - `'SET_PIPELINE_RUN_PROCESS'` → `'SET_WORKFLOW_RUN_PROCESS'`
- **File:** `types/dashboard.ts`
  - `RepoSubTab` union: `'pipelines'` → `'workflows'`
- **File:** `repos/repoGrouping.ts`
  - `PipelineInfo` → `WorkflowInfo`
  - `pipelines` field → `workflows`
- **File:** `repos/RepoDetail.tsx`
  - Tab config key: `'pipelines'` → `'workflows'` (label already says "Workflows")

### 10. Update remaining user-facing strings
- `PipelineRunHistory.tsx`: `"…execute this pipeline."` → `"…execute this workflow."`
- `PipelineAIRefinePanel.tsx`: `"Refining pipeline..."` → `"Refining workflow..."`, `fileName="pipeline.yaml"` → `fileName="workflow.yaml"`
- `WorkflowDetailView.tsx`: `"No pipeline data available."` → `"No workflow data available."`
- `PipelinesTab.tsx`: `"…add YAML files to .vscode/pipelines/."` → `"…add YAML files to .vscode/workflows/."`

### 11. Update CSS classes and data-testid attributes
- CSS classes: `repo-pipeline-list` → `repo-workflow-list`, `repo-pipeline-item` → `repo-workflow-item`, `pipeline-name` → `workflow-name`, `repo-pipeline-actions` → `repo-workflow-actions`
- `data-testid` attributes: `pipeline-run-btn` → `workflow-run-btn`, `pipeline-tab-bar` → `workflow-tab-bar`, etc. — update all across affected components

### 12. Update server-side task types & API handler
- **File:** `packages/coc-server/src/task-types.ts`
  - Task kind `'run-pipeline'` → `'run-workflow'`
  - `RunPipelinePayload` → `RunWorkflowPayload`
  - `pipelinePath` field → `workflowPath`
- **File:** `packages/coc-server/src/api-handler.ts`
  - `discoverPipelines()` → `discoverWorkflows()`
  - Update reference to `pipeline.yaml` file name (if renaming the file) — **Decision needed: does `pipeline.yaml` inside each workflow folder also rename to `workflow.yaml`?**

### 13. Update all import paths
- After renaming files (todos 7, 8), update all `import` statements throughout the SPA and server to reference new file names

### 14. Add/update dashboard tests
- Update test files in `packages/coc-server/` and `packages/coc/` that reference old pipeline routes, event names, component names, or API endpoints
- Verify dashboard builds (`npm run build` in `packages/coc`)
- Verify server tests pass (`npm run test:run` in `packages/coc-server`)

---

## Notes

- Use `vscode.workspace.fs.rename` (VS Code API) or Node `fs.promises.rename` — prefer VS Code API for consistency with the rest of the codebase.
- The migration should be **idempotent**: running it twice must be a no-op.
- Do not change the VS Code _command IDs_ (`pipelinesViewer.*`) in this pass — that is a larger breaking change. Rename only the folder and UI labels.
- The `workspaceShortcuts.pipelinesViewer.folderPath` setting key itself is **not** renamed (avoids resetting user overrides).
- **API backward compat is NOT required** — this is an internal dashboard, no external consumers.
- **File naming convention:** The YAML file inside each workflow folder stays `pipeline.yaml` for now — renaming it is a separate concern that touches the pipeline executor and is out of scope.
- **Execution order:** Do Part 1 (extension, todos 1–4) and Part 2 (dashboard, todos 5–14) independently. Within Part 2, do server-side renames (5, 8, 12) first, then SPA renames (6, 7, 9, 10, 11), then imports (13), then tests (14).
