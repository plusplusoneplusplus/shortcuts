---
status: pending
---

# 004: Wire "Edit with AI" into PipelineDetail

## Summary

Extend `PipelineDetail.tsx` to support a third editing mode — `'ai-edit'` — that renders
`PipelineAIRefinePanel` in place of the YAML textarea. Add an **"Edit with AI ✨"** button
to the view-mode toolbar (next to the existing "Edit" button). When the user applies AI
suggestions, save the new YAML via the existing `savePipelineContent` API call, update
`content`, and return to `'view'` mode — the same happy path as the manual Save flow.

---

## Motivation

Commits 1–3 added the backend `/refine` endpoint, the `refinePipeline()` API helper, and
the self-contained `PipelineAIRefinePanel` component. None of that is reachable from the
UI yet. This commit connects the last mile: the entry point in `PipelineDetail` that lets
users invoke AI-assisted editing from the existing pipeline dashboard.

---

## Changes

### Files to Create

_None._

### Files to Modify

#### `packages/coc/src/server/spa/client/react/repos/PipelineDetail.tsx`

1. **Extend the `mode` union type** (line 26):

   ```ts
   // Before
   const [mode, setMode] = useState<'view' | 'edit'>('view');

   // After
   const [mode, setMode] = useState<'view' | 'edit' | 'ai-edit'>('view');
   ```

2. **Import `PipelineAIRefinePanel`** — add to the existing import block near the top of
   the file, alongside the other local component imports:

   ```ts
   import { PipelineAIRefinePanel } from './PipelineAIRefinePanel';
   ```

3. **Add "Edit with AI ✨" button to the view-mode toolbar** — insert immediately after the
   existing `Edit` button (line 140):

   ```tsx
   // Existing — keep as-is
   <Button variant="secondary" size="sm" onClick={() => setMode('edit')}>Edit</Button>

   // New — insert after the line above, before Delete
   <Button variant="secondary" size="sm" onClick={() => setMode('ai-edit')}>Edit with AI ✨</Button>
   ```

   Full updated toolbar `view` branch (lines 128–142) for reference:

   ```tsx
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
       <Button variant="secondary" size="sm" onClick={() => setMode('ai-edit')}>Edit with AI ✨</Button>
       <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>Delete</Button>
   </>
   ```

4. **Add `handleAIApply` handler** — insert after `handleSave` (after line 94):

   ```ts
   async function handleAIApply(newYaml: string) {
       setSaving(true);
       setError(null);
       try {
           await savePipelineContent(workspaceId, pipeline.name, newYaml);
           setContent(newYaml);
           setEditContent(newYaml);
           setMode('view');
           addToast('Pipeline saved', 'success');
       } catch (err: any) {
           setError(err.message || 'Failed to save');
       } finally {
           setSaving(false);
       }
   }
   ```

   - Mirrors `handleSave` exactly except it receives `newYaml` as a parameter instead of
     reading `editContent`.
   - Also updates `editContent` so that if the user switches to manual Edit afterwards the
     textarea is pre-seeded with the AI-refined content.

5. **Extend the content area's `else` branch** to handle `'ai-edit'` mode (lines 213–222).
   Replace the current single `else` with an explicit `else if / else` pair:

   ```tsx
   {/* Content area */}
   <div className="flex-1 overflow-auto px-4">
       {mode === 'view' ? (
           <>
               {activeTab === 'pipeline' && (
                   <>
                       <pre className="font-mono text-xs overflow-auto whitespace-pre-wrap bg-[#f5f5f5] dark:bg-[#1e1e1e] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded p-3">
                           {content}
                       </pre>
                       {content && (
                           <PipelineDAGPreview yamlContent={content} validationErrors={pipeline.validationErrors} />
                       )}
                   </>
               )}
               {activeTab === 'history' && (
                   <PipelineRunHistory
                       workspaceId={workspaceId}
                       pipelineName={pipeline.name}
                       refreshKey={refreshKey}
                   />
               )}
           </>
       ) : mode === 'ai-edit' ? (
           <PipelineAIRefinePanel
               workspaceId={workspaceId}
               pipelineName={pipeline.name}
               currentYaml={content}
               onApply={handleAIApply}
               onCancel={() => setMode('view')}
           />
       ) : (
           <div className="flex flex-col gap-2 h-full">
               <textarea
                   className="flex-1 w-full font-mono text-xs p-3 border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] rounded resize-none min-h-[200px]"
                   value={editContent}
                   onChange={e => setEditContent(e.target.value)}
               />
               {error && <p className="text-xs text-red-500">{error}</p>}
           </div>
       )}
   </div>
   ```

   Key design points:
   - `ai-edit` occupies the same scrollable content area as the textarea — same real estate,
     no layout changes needed.
   - The tab bar (`Pipeline` / `Run History`) is only rendered when `mode === 'view'`
     (existing guard at line 165), so it correctly disappears during both `'edit'` and
     `'ai-edit'`.
   - The edit-mode toolbar (Cancel | Save) at lines 143–148 is inside the `mode === 'view'`
     ternary's `else` arm. After this change that arm becomes the final `else` (manual edit
     only), so Cancel/Save buttons remain correct for `'edit'` mode and are absent for
     `'ai-edit'` (which renders its own Cancel/Apply buttons inside `PipelineAIRefinePanel`).

6. **Cancel for `'ai-edit'` from the toolbar** — the existing edit-mode toolbar Cancel
   button (line 145) is rendered only when `mode !== 'view'`:

   ```tsx
   // Current (covers only 'edit')
   } : (
       <>
           <Button variant="secondary" size="sm" onClick={() => { setMode('view'); setError(null); }}>Cancel</Button>
           <Button size="sm" loading={saving} onClick={handleSave}>Save</Button>
       </>
   )}
   ```

   This branch must be split into two so that `'ai-edit'` has no top-level Save/Cancel
   (those live inside the panel itself):

   ```tsx
   } : mode === 'ai-edit' ? (
       null   // PipelineAIRefinePanel renders its own Cancel / Apply buttons
   ) : (
       <>
           <Button variant="secondary" size="sm" onClick={() => { setMode('view'); setError(null); }}>Cancel</Button>
           <Button size="sm" loading={saving} onClick={handleSave}>Save</Button>
       </>
   )}
   ```

### Files to Delete

_None._

---

## Implementation Notes

- **No new state** is needed. `saving` / `error` are reused by `handleAIApply`, consistent
  with how `handleSave` works.
- `PipelineAIRefinePanel` is fully self-contained (its own instruction input, spinner, diff
  view, Apply/Cancel). `PipelineDetail` only wires `onApply` and `onCancel`.
- The `onCancel` prop simply calls `setMode('view')` — no content state is mutated, so the
  original `content` and `editContent` remain unchanged if the user cancels mid-flow.
- `editContent` is also updated in `handleAIApply` (alongside `content`) so that
  switching to manual Edit after an AI apply pre-fills the textarea with the latest saved
  content rather than the stale pre-AI version.
- The tab bar guard (`mode === 'view'`) already covers `'ai-edit'` with no changes needed.

---

## Tests

File: `packages/coc/src/server/spa/client/react/repos/PipelineDetail.test.tsx`

Add the following test cases (alongside existing tests):

1. **"Edit with AI ✨" button is present in view mode**
   - Render `<PipelineDetail>` with a valid pipeline mock.
   - Assert a button with text `"Edit with AI ✨"` is in the document.

2. **Clicking "Edit with AI ✨" switches to ai-edit mode**
   - Click the button.
   - Assert `PipelineAIRefinePanel` is rendered (e.g. by `data-testid` or component presence).
   - Assert the textarea (manual edit) is NOT rendered.
   - Assert the tab bar is NOT rendered.

3. **`onApply` saves and returns to view mode**
   - Mock `savePipelineContent` to resolve successfully.
   - Click "Edit with AI ✨", then call the `onApply` prop of `PipelineAIRefinePanel` with
     a new YAML string.
   - Assert `savePipelineContent` was called with `(workspaceId, pipeline.name, newYaml)`.
   - Assert mode returns to `'view'` (tab bar is visible again, panel is gone).
   - Assert a success toast was shown.

4. **`onApply` shows error toast on save failure**
   - Mock `savePipelineContent` to reject.
   - Call `onApply`.
   - Assert error is displayed and mode stays `'ai-edit'`.

5. **`onCancel` returns to view mode without saving**
   - Click "Edit with AI ✨", then call the `onCancel` prop.
   - Assert `savePipelineContent` was NOT called.
   - Assert view mode is restored.

---

## Acceptance Criteria

- [ ] "Edit with AI ✨" button appears in the toolbar when `mode === 'view'`, between "Edit"
      and "Delete".
- [ ] Clicking it renders `PipelineAIRefinePanel` in the content area; the YAML `<pre>`,
      DAG preview, and tab bar are hidden.
- [ ] The top-level toolbar shows no Cancel/Save buttons while in `'ai-edit'` mode
      (panel provides its own).
- [ ] When `onApply(newYaml)` fires: `savePipelineContent` is called, `content` and
      `editContent` are updated to `newYaml`, mode resets to `'view'`, success toast shown.
- [ ] When `onCancel` fires: mode resets to `'view'`, no save is triggered, original content
      unchanged.
- [ ] Existing "Edit" → textarea flow is unaffected.
- [ ] Existing Run / Delete flows are unaffected.
- [ ] All pre-existing `PipelineDetail` tests continue to pass.

---

## Dependencies

| Commit | Provides |
|--------|----------|
| 001    | `POST /api/workspaces/:id/pipelines/:name/refine` backend endpoint |
| 002    | `refinePipeline(workspaceId, name, instruction)` in `pipeline-api.ts` |
| 003    | `PipelineAIRefinePanel` component with `{ workspaceId, pipelineName, currentYaml, onApply, onCancel }` props |

---

## Assumed Prior State

- `PipelineDetail.tsx` has `mode: 'view' | 'edit'` at line 26.
- View-mode toolbar order: ▶ Run | Close | Edit | Delete (lines 129–141).
- Edit-mode toolbar: Cancel | Save (lines 144–147).
- Content area: `mode === 'view'` → `<pre>` + `PipelineDAGPreview`; else → `<textarea>` (lines 193–222).
- `savePipelineContent` is already imported from `./pipeline-api` (line 9).
- `addToast` is available via `useGlobalToast()` (line 24).
