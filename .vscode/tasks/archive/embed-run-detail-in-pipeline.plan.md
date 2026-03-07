# Embed Workflow Run Detail Inside Pipeline Detail Page

## Problem

Navigating to a workflow run (e.g. `#repos/ws-kss6a7/workflow/queue_1772768203538-1x3deqx`) opens `WorkflowDetailView` in a top-level **"workflow" sub-tab** at the repo level, completely separate from the pipeline it belongs to. The user wants run detail to appear **inside** the `#repos/:repoId/pipelines/:pipelineName` page instead.

## Root Cause

`PipelineRunHistory.handleSelectTask` navigates to `#repos/:repoId/workflow/:processId`, which the Router maps to the `workflow` sub-tab (a peer of `pipelines`), losing pipeline context entirely.

## Proposed Approach

Introduce a new URL scheme `#repos/:repoId/pipelines/:pipelineName/run/:processId` that keeps the user inside the pipeline detail page while showing `WorkflowDetailView` inline. The existing `#repos/:repoId/workflow/:processId` route is left unchanged for backward compatibility (e.g. direct links from the queue or other surfaces).

### New route

```
#repos/:repoId/pipelines/:pipelineName/run/:processId
```

### UI behaviour

- `PipelineDetail` gains a third tab **"Run Detail"** (or replaces History content) that renders `<WorkflowDetailView processId={selectedRunProcessId} />`.
- Clicking any item in `PipelineRunHistory` sets this tab active.
- The tab is hidden when no run is selected.
- Pressing **Back** / closing the tab returns to **Run History**.

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/context/AppContext.tsx` | Add `selectedPipelineRunProcessId: string \| null` to state + `SET_PIPELINE_RUN_PROCESS` action |
| `packages/coc/src/server/spa/client/react/layout/Router.tsx` | Parse `#repos/:repoId/pipelines/:pipelineName/run/:processId` and dispatch `SET_PIPELINE_RUN_PROCESS` |
| `packages/coc/src/server/spa/client/react/repos/PipelineRunHistory.tsx` | Change `handleSelectTask` to navigate to new URL instead of `/workflow/` URL |
| `packages/coc/src/server/spa/client/react/repos/PipelineDetail.tsx` | Add `'run'` tab; render `WorkflowDetailView` when `selectedPipelineRunProcessId` is set; accept (or read from context) `selectedRunProcessId` prop |
| `packages/coc/src/server/spa/client/react/repos/PipelinesTab.tsx` | Pass `selectedRunProcessId` down (or let PipelineDetail read from context directly) |

## Implementation Tasks

1. **AppContext** — add `selectedPipelineRunProcessId` state field + reducer case `SET_PIPELINE_RUN_PROCESS`
2. **Router** — extend pipeline deep-link parsing to handle `/run/:processId` segment; dispatch new action on match; clear it when navigating away
3. **PipelineRunHistory** — update `handleSelectTask` to build `#repos/:repoId/pipelines/:pipelineName/run/:processId` URL
4. **PipelineDetail** — add `'run'` tab conditional on `selectedPipelineRunProcessId`; render `WorkflowDetailView` in that tab; add back-navigation (clicking History tab clears run selection)
5. **Tests** — update / add Vitest tests for new router parsing and PipelineRunHistory navigation

## Notes

- `WorkflowDetailView` already accepts `processId` as a prop and is designed to be embedded — no changes needed to that component.
- The old `#repos/:repoId/workflow/:processId` route still works and renders in the top-level workflow sub-tab (backward compat for links generated outside of pipeline context).
- If `processId` starts with `queue_`, `WorkflowDetailView` should already handle it (queue task wrapper process).
