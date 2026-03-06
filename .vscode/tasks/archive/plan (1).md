# Plan: Pipeline Dropdown Selector in Schedule Form

## Problem

In the **Schedules tab → New Schedule → Run Pipeline** template, the `pipeline` parameter is a free-text `<input>` where users must type the full pipeline path manually (e.g., `pipelines/my-pipeline/pipeline.yaml`). This is error-prone since the workspace already has discovered pipelines available via `GET /api/workspaces/:id/pipelines`.

## Proposed Approach

Replace the free-text input for the `pipeline` param with a `<select>` dropdown populated from the existing pipelines API. Keep a manual-entry fallback for edge cases.

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/RepoSchedulesTab.tsx` | Add pipeline fetching, render `<select>` for pipeline param, update `ScheduleTemplateParam` type |

## Todos

### 1. Extend `ScheduleTemplateParam` with an optional `type` field
- Add `type?: 'text' | 'pipeline-select'` to `ScheduleTemplateParam` interface
- Mark the `run-pipeline` template's pipeline param with `type: 'pipeline-select'`

### 2. Fetch pipelines inside `CreateScheduleForm`
- Import `fetchPipelines` from `./pipeline-api`
- Add `useState<PipelineInfo[]>` for the pipeline list
- Fetch pipelines on mount (or when `run-pipeline` template is selected) using `useEffect`
- Handle loading/error states

### 3. Render `<select>` instead of `<input>` for pipeline param
- In the dynamic params rendering block (lines 523-533), check `p.type === 'pipeline-select'`
- Render a `<select>` with:
  - A disabled placeholder option: `"Select a pipeline..."`
  - An `<option>` for each discovered pipeline: `value={p.path}`, label=`p.name`
  - A manual entry option at the bottom: `"Other (manual path)..."` that toggles back to a text input
- Auto-populate the `target` field when a pipeline is selected

### 4. Update template target auto-fill
- When user selects a pipeline from dropdown, also update `target` state to match
- When form submits, ensure `params.pipeline` and `target` are consistent

### 5. Add tests
- Test that the dropdown renders with pipeline options when `run-pipeline` template is selected
- Test fallback to text input when no pipelines are found or "Other" is selected
- Test that selecting a pipeline updates both the param value and target

## Considerations

- **No pipelines found**: Show a message like "No pipelines discovered" and fall back to manual text input
- **Loading state**: Show a brief loading indicator while fetching
- **Internal fetch**: `fetchPipelines` from `pipeline-api.ts` already exists — call it inside `CreateScheduleForm` to avoid prop threading
- **Backward compat**: Not required per project principles. Change is purely additive UI.
