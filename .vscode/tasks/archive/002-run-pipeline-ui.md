---
status: pending
---

# 002: Add ▶ Run Button to Dashboard Pipelines Tab

## Summary

Add a ▶ Run button to the `PipelineDetail` footer that calls `POST /api/workspaces/:id/pipelines/:name/run`, shows loading/disabled states, and auto-navigates to the Queue tab on success.

## Motivation

With the backend endpoint from commit 1 in place, the UI needs a one-click way to trigger pipeline execution from the Pipelines tab. This is the primary user-facing entry point for ad-hoc pipeline runs.

## Changes

### Files to Create
- (none)

### Files to Modify

1. **`packages/coc/src/server/spa/client/react/repos/pipeline-api.ts`** — Add `runPipeline()` function
2. **`packages/coc/src/server/spa/client/react/repos/PipelineDetail.tsx`** — Add ▶ Run button with loading state, disabled when invalid, toast on success/failure, call `onRun` callback
3. **`packages/coc/src/server/spa/client/react/repos/PipelinesTab.tsx`** — Accept and forward `onRunSuccess` callback to `PipelineDetail`, plumb through from parent

### Files to Delete
- (none)

## Implementation Notes

### 1. `pipeline-api.ts` — New `runPipeline` function

Add a new export following the existing pattern (raw `fetch()` + `getApiBase()`):

```typescript
export async function runPipeline(
    workspaceId: string,
    pipelineName: string
): Promise<{ task: any }> {
    const res = await fetch(`${pipelineUrl(workspaceId, pipelineName)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
}
```

Key details:
- Uses existing `pipelineUrl()` helper (line 13-15) which builds `/api/workspaces/:id/pipelines/:name`
- Appends `/run` to match the backend route `POST /api/workspaces/:id/pipelines/:name/run`
- Returns `{ task }` per commit 1's API contract (201 response)
- Error response parsed from JSON body's `error` field (matches other pipeline-api error handling, e.g., `generatePipeline` at lines 73-76)

### 2. `PipelineDetail.tsx` — ▶ Run Button

**New props:**
```typescript
export interface PipelineDetailProps {
    workspaceId: string;
    pipeline: PipelineInfo;
    onClose: () => void;
    onDeleted: () => void;
    onRunSuccess?: () => void;  // NEW: called after successful enqueue
}
```

**New state:**
```typescript
const [running, setRunning] = useState(false);
```

**New handler:**
```typescript
async function handleRun() {
    setRunning(true);
    try {
        const data = await runPipeline(workspaceId, pipeline.name);
        const taskIdShort = data.task?.id ? data.task.id.slice(0, 8) : '';
        addToast(`Pipeline queued${taskIdShort ? ` (${taskIdShort})` : ''}`, 'success');
        onRunSuccess?.();
    } catch (err: any) {
        addToast(`Failed to run pipeline: ${err.message}`, 'error');
    } finally {
        setRunning(false);
    }
}
```

Toast pattern matches `GenerateTaskDialog.tsx` line 101: `addToast(\`Task queued\${taskId ? \` (\${taskId.slice(0, 8)})\` : ''}\`, 'success')`.

**Footer modification (view mode only):**

Current footer (lines 128-141):
```tsx
<div className="flex justify-end gap-2 px-4 py-3 border-t ...">
    {mode === 'view' ? (
        <>
            <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
            <Button variant="secondary" size="sm" onClick={() => setMode('edit')}>Edit</Button>
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>Delete</Button>
        </>
    ) : ( ... )}
</div>
```

New footer — **▶ Run** is the leftmost primary button in view mode:
```tsx
{mode === 'view' ? (
    <>
        <Button
            size="sm"
            loading={running}
            disabled={pipeline.isValid === false}
            title={pipeline.isValid === false ? 'Fix validation errors before running' : 'Run pipeline'}
            data-testid="pipeline-run-btn"
            onClick={handleRun}
        >
            ▶ Run
        </Button>
        <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        <Button variant="secondary" size="sm" onClick={() => setMode('edit')}>Edit</Button>
        <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>Delete</Button>
    </>
) : ( ... )}
```

Key design decisions:
- **Primary variant** (default for `Button`, `variant='primary'` when omitted) — `bg-[#0078d4]` blue, stands out as the main action
- **Leftmost** position — first in the flex row (visual scan: action → close → edit → delete)
- **`disabled` when `pipeline.isValid === false`** — checks the `PipelineInfo.isValid` field; `undefined` (not yet validated) is NOT disabled, only explicit `false`
- **`loading` prop** — `Button` already renders `<Spinner size="sm" />` and sets `disabled` when `loading={true}` (Button.tsx line 52-53, 60)
- **`title` tooltip** — provides disabled-state explanation

**Import addition:**
```typescript
import { fetchPipelineContent, savePipelineContent, deletePipeline, runPipeline } from './pipeline-api';
```

### 3. `PipelinesTab.tsx` — Plumb `onRunSuccess` Callback

**New prop on `PipelinesTabProps`:**
```typescript
interface PipelinesTabProps {
    repo: RepoData;
    onRunSuccess?: () => void;  // NEW
}
```

**Forward to `PipelineDetail`:**
```tsx
<PipelineDetail
    workspaceId={repo.workspace.id}
    pipeline={selectedPipeline}
    onClose={handleClose}
    onDeleted={handleDeleted}
    onRunSuccess={onRunSuccess}
/>
```

**Alternative approach (self-contained, preferred):** Instead of a new prop, `PipelinesTab` can directly dispatch the tab switch using the already-imported `useApp()` context:

```tsx
const handleRunSuccess = () => {
    dispatch({ type: 'SET_REPO_SUB_TAB', tab: 'queue' });
    location.hash = '#repos/' + encodeURIComponent(repo.workspace.id) + '/queue';
};
```

Then pass `onRunSuccess={handleRunSuccess}` to `PipelineDetail`. This is **preferred** because:
- `PipelinesTab` already imports `useApp` and `dispatch` (line 7, 17)
- It follows the same pattern as `GenerateTaskDialog.tsx` line 102: `appDispatch({ type: 'SET_REPO_SUB_TAB', tab: 'queue' })`
- No changes needed to `RepoDetail.tsx` or any parent component
- Hash update uses the same pattern as `handleSelect` (line 26)

### Patterns Referenced

| Pattern | Source | Details |
|---------|--------|---------|
| Toast on success/failure | `PipelineDetail.tsx:58,69` | `addToast(msg, 'success'\|'error')` |
| Tab switch after enqueue | `GenerateTaskDialog.tsx:102` | `appDispatch({ type: 'SET_REPO_SUB_TAB', tab: 'queue' })` |
| Button loading state | `PipelineDetail.tsx:138` | `<Button loading={saving} ...>` |
| API client pattern | `pipeline-api.ts:41-54` | raw `fetch()` + `getApiBase()`, throw on `!res.ok` |
| Error body parsing | `pipeline-api.ts:73-76` | `res.json().catch(() => ({}))` for error body |
| Task ID truncation | `GenerateTaskDialog.tsx:101` | `taskId.slice(0, 8)` |

### State Flow

1. User clicks ▶ Run → `handleRun()` called
2. `running` set to `true` → Button shows spinner, becomes disabled
3. `POST /api/workspaces/:id/pipelines/:name/run` called via `runPipeline()`
4. **On success (201):** toast "Pipeline queued (abcd1234)", call `onRunSuccess()` → tab switches to Queue, hash updates
5. **On failure:** toast "Failed to run pipeline: {error message}", button re-enabled
6. `running` set to `false` in `finally` block

### Not in Scope

- **Play icon on hover in sidebar pipeline list** (`PipelinesTab.tsx` sidebar) — deferred as optional/low-priority; the detail panel button is the primary UX
- **`RepoDetail.tsx` changes** — not needed since tab switching is handled via `useApp` dispatch in `PipelinesTab`

## Tests

No component test infrastructure exists for the React SPA (no `.test.tsx` files for these components). The existing test files are backend handler tests using Vitest + HTTP.

**Manual testing checklist:**
1. Open dashboard → select a repo → Pipelines tab → select a valid pipeline → verify ▶ Run button is visible, blue (primary), leftmost in footer
2. Click ▶ Run → verify button shows spinner, becomes disabled
3. On success → verify toast "Pipeline queued (…)" appears, tab auto-switches to Queue
4. Select an invalid pipeline (with validation errors) → verify ▶ Run button is disabled with tooltip "Fix validation errors before running"
5. Simulate backend failure (e.g., stop server) → verify error toast appears, button re-enables
6. In edit mode → verify ▶ Run button is NOT shown (only Save/Cancel visible)
7. Verify Close, Edit, Delete buttons still work correctly

**Future test opportunity:** If component tests are added later, test:
- `runPipeline()` API function (mock fetch, verify URL/method/body)
- `PipelineDetail` renders run button with correct disabled state based on `pipeline.isValid`
- `PipelineDetail` shows loading state during run
- `PipelineDetail` calls `onRunSuccess` on 201 response

## Acceptance Criteria

- [ ] ▶ Run button visible in pipeline detail footer (primary variant, leftmost position) in view mode only
- [ ] Button disabled with tooltip "Fix validation errors before running" when `pipeline.isValid === false`
- [ ] Button NOT disabled when `pipeline.isValid` is `true` or `undefined`
- [ ] Clicking ▶ Run calls `POST /api/workspaces/:id/pipelines/:name/run` with empty JSON body
- [ ] During request, button shows loading spinner and is disabled
- [ ] On success (201), shows toast "Pipeline queued (taskId)" and switches to Queue tab
- [ ] On failure, shows error toast with message from response body
- [ ] Button not shown in edit mode
- [ ] No regressions to existing Close/Edit/Delete functionality

## Dependencies

- Depends on: 001 (backend `POST /api/workspaces/:id/pipelines/:name/run` endpoint)

## Assumed Prior State

From commit 1:
- **Endpoint:** `POST /api/workspaces/:id/pipelines/:name/run` exists in `pipelines-handler.ts`
- **Response:** Returns `{ task }` with HTTP 201 on success, where `task` has at least an `id` field
- **Error response:** Returns `{ error: string }` with appropriate HTTP status on failure
- **Type:** `RunPipelinePayload` type and `isRunPipelinePayload` guard in `pipeline-core/src/queue/types.ts`
- **Task type:** `'run-pipeline'` is a valid task type in `VALID_TASK_TYPES` (queue-handler.ts)
- **Execution:** `CLITaskExecutor.executeByType()` handles `run-pipeline` tasks (queue-executor-bridge.ts)
