# Schedule Pipeline Selector — Replace Manual Input with Dropdown

## Problem

In the "Run Pipeline" schedule creation form (`RepoSchedulesTab.tsx`), the **target field** (pipeline path) is a plain text input where users must manually type the path (e.g., `pipelines/my-pipeline/pipeline.yaml`). There is already a pipeline `<select>` dropdown in the PARAMETERS section below that syncs to the target, but this creates a confusing UX with two redundant fields.

The user wants the circled target field to be a dropdown selection populated from discovered pipelines.

## Proposed Approach

**Convert the `target` text input into a pipeline selector dropdown** when the `run-pipeline` template is selected. Remove the redundant `pipeline` param from the PARAMETERS section.

### Changes

**File: `packages/coc/src/server/spa/client/react/repos/RepoSchedulesTab.tsx`**

1. **Replace the `target` `<input>` (lines 479–484)** with conditional rendering:
   - When `selectedTemplate === 'run-pipeline'` and `!manualPipeline`:
     - If `pipelinesLoading`: show "Loading pipelines…" placeholder
     - If `pipelines.length > 0`: render a `<select>` dropdown with discovered pipelines + "Other (manual path)…" escape hatch
     - If `pipelines.length === 0`: fallback to text `<input>`
   - For all other templates (or `manualPipeline === true`): keep the existing plain `<input>`

2. **When a pipeline is selected from the dropdown**, set both:
   - `setTarget(value)` — for the schedule target
   - `setParams(prev => ({ ...prev, pipeline: value }))` — to keep params.pipeline in sync

3. **Remove `pipeline` param from the `run-pipeline` template's `params` array** (line 296–298) since the target field now handles pipeline selection. This eliminates the redundant PARAMETERS section for this template.

4. **Update `applyTemplate`** (line 389): When `run-pipeline` is selected, set target to `''` (empty) instead of the placeholder path, so the dropdown starts on "Select a pipeline…" rather than a dummy path.

5. **Keep `manualPipeline` state** — still needed for the "Other (manual path)…" escape hatch in the target dropdown.

### Test Updates

**File: `packages/coc/test/spa/react/RepoSchedulesTab.test.tsx`**

1. Update pipeline dropdown tests to verify the `<select>` is now in the **target** position (not the params section)
2. Update template pre-fill tests — target should start empty when run-pipeline is selected (prompting selection)
3. Verify "Other (manual path)…" option still works and shows a text input for target
4. Verify `params.pipeline` is still set in the submitted form data
5. Remove or update tests that check for the pipeline param in the PARAMETERS section

### UX Flow (After Change)

```
[Run pipeline] template selected
  → Name: "Run Pipeline" (pre-filled)
  → Target: [ Select a pipeline… ▾ ]    ← dropdown with discovered pipelines
              - my-pipeline
              - daily-report
              - Other (manual path)…
  → Cron / Interval picker
  → On failure: [Notify ▾]
  → [Cancel] [Create]
```

## Files to Modify

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/RepoSchedulesTab.tsx` | Replace target input with conditional pipeline selector; remove pipeline param |
| `packages/coc/test/spa/react/RepoSchedulesTab.test.tsx` | Update tests for new dropdown location |

## Notes

- The `fetchPipelines()` call and `pipelines`/`pipelinesLoading`/`manualPipeline` state already exist — we reuse them
- `pipeline-api.ts` and backend endpoints (`GET /api/workspaces/:id/pipelines`) remain unchanged
- The `params.pipeline` key is still sent in the POST body for backward compatibility
- The hint "Ensure the pipeline YAML file exists at the specified target path" can be kept or simplified
