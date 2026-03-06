# Context: Run Pipeline Once from Dashboard

## Goal
Add a one-click ▶ Run button to the CoC dashboard's Pipelines tab so users can execute a pipeline immediately, with the result tracked in the Queue tab.

## Commit Sequence
1. Add `run-pipeline` task type and server endpoint (backend types, executor, REST API)
2. Add ▶ Run button to dashboard Pipelines tab (React UI, loading states, tab navigation)

## Key Decisions
- New `run-pipeline` task type (not reusing `follow-prompt`) because pipeline execution requires multi-step orchestration via `executePipeline()`, not a single AI call
- `RunPipelinePayload` uses `readonly kind: 'run-pipeline'` discriminant, matching the `TaskGenerationPayload` pattern
- Pipeline execution reuses `createCLIAIInvoker()` to bridge `CopilotSDKService` → `AIInvoker` interface
- `POST /api/workspaces/:id/pipelines/:name/run` endpoint enqueues via the existing queue system (not direct execution)
- ▶ Run button is primary (accent blue), leftmost in footer — the main action
- Button disabled when `pipeline.isValid === false`; auto-navigates to Queue tab on success
- Tab switch uses existing `dispatch({ type: 'SET_REPO_SUB_TAB', tab: 'queue' })` pattern

## Conventions
- Payload type guards use `(payload as any).kind` pattern (see `isTaskGenerationPayload`)
- REST routes use regex patterns in `pipelines-handler.ts`
- SPA API clients use raw `fetch()` + `getApiBase()` (no axios/wrapper)
- Toast notifications via `addToast(msg, 'success'|'error')`

## UX Spec

### User Story
As a developer viewing a pipeline in the CoC dashboard (Pipelines tab), I want to run it immediately with a single click, so I can test or execute a pipeline without using the CLI.

### Current State
Pipeline detail shows name, path, ✅ Valid badge, YAML content, and footer buttons: Close, Edit, Delete. No run capability exists in the dashboard.

### User Flow (Happy Path)
1. Dashboard → Pipelines tab → View a pipeline
2. Click ▶ Run → button shows loading spinner
3. System validates pipeline, enqueues a `run-pipeline` task, starts execution
4. Dashboard auto-switches to Queue tab with the task highlighted
5. Real-time progress → completed/failed result in Queue detail panel

### Visual Design
Footer: `[▶ Run] [✏ Edit] [🗑 Delete]  ...  [Close]`
- ▶ Run: primary (accent), disabled when invalid (tooltip: "Fix validation errors first")
- Loading state: spinner + disabled

### Edge Cases
- Invalid pipeline → button disabled with tooltip
- Already running → allow re-run (no dedup)
- Unsaved edits → prompt to save first
- Network error → error toast
- Disconnect mid-run → task continues server-side

### Out of Scope (v1)
Parameterized runs, per-pipeline history, scheduling, batch runs, model/concurrency overrides modal
