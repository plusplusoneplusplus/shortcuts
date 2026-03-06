---
status: pending
---

# 002: Frontend — Natural Language Pipeline Creation Dialog

## Summary

Replace the static "AI Generated" template stub with a three-state dialog (input → generating → preview) that calls the new `/generate` endpoint, previews the resulting YAML with a validation badge, and saves via the existing create endpoint's new `content` field — auto-selecting the pipeline in the list after creation.

## Motivation

All changes in this commit are purely frontend (React SPA + API client). They depend on the backend `/generate` endpoint and the extended `POST /pipelines` `content` field delivered in commit 1. Separating frontend from backend keeps the diff reviewable and allows each commit to be tested independently.

## Changes

### Files to Create

- (none — all changes are modifications to existing files)

### Files to Modify

- `packages/coc/src/server/spa/client/react/repos/pipeline-api.ts` — Add `generatePipeline()` function and extend `createPipeline()` signature to accept optional `content` parameter.

- `packages/coc/src/server/spa/client/react/repos/AddPipelineDialog.tsx` — Major rework: implement three-state dialog (input/generating/preview) with textarea, character counter, tip block, YAML preview, validation badge, and AbortController-based cancellation. Remove the "AI Generated" entry from the `TEMPLATES` array (replaced by the inline generation flow). Rename the template label per UX spec.

- `packages/coc/src/server/spa/client/react/repos/PipelinesTab.tsx` — (1) Change the `onCreated` callback signature to accept an optional pipeline name so the dialog can tell PipelinesTab which pipeline was just created. (2) After creation, auto-select the new pipeline via `dispatch({ type: 'SET_SELECTED_PIPELINE', name })` and update `location.hash`. (3) Update the empty-state text to include the discoverability line from the UX spec.

- `packages/coc/test/spa/react/PipelineUI.test.tsx` — Add new test cases covering the generation flow, preview state, cancel behavior, error handling, and auto-selection after save. Update existing AddPipelineDialog tests that reference the old template list.

- `packages/coc/test/spa/react/pipeline-api.test.ts` — Add tests for the new `generatePipeline()` function and the extended `createPipeline()` with `content`.

### Files to Delete

- (none)

## Implementation Notes

### 1. API Client Changes (`pipeline-api.ts`)

**New function — `generatePipeline`:**

```ts
export interface GenerateResult {
    yaml: string;
    valid: boolean;
    errors?: string[];
}

export async function generatePipeline(
    workspaceId: string,
    name: string,
    description: string,
    signal?: AbortSignal
): Promise<GenerateResult> {
    const res = await fetch(`${pipelinesUrl(workspaceId)}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
        signal,
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
}
```

Key details:
- Accepts an optional `AbortSignal` for cancellation support (the dialog holds an `AbortController`).
- Follows the same `pipelinesUrl()` helper + error pattern as `fetchPipelines`.
- Returns the parsed `{ yaml, valid, errors? }` response.

**Extended `createPipeline` signature:**

```ts
export async function createPipeline(
    workspaceId: string,
    name: string,
    template?: string,
    content?: string       // ← new optional parameter
): Promise<void> {
    const body: Record<string, string> = { name };
    if (template !== undefined) body.template = template;
    if (content !== undefined) body.content = content;
    // ... rest unchanged
}
```

This is backward-compatible — existing callers that pass `(wsId, name, template)` continue to work.

### 2. Dialog State Machine (`AddPipelineDialog.tsx`)

**State type and transitions:**

```ts
type DialogPhase = 'input' | 'generating' | 'preview';

const [phase, setPhase] = useState<DialogPhase>('input');
const [description, setDescription] = useState('');
const [generatedYaml, setGeneratedYaml] = useState('');
const [generatedValid, setGeneratedValid] = useState(false);
const [generationErrors, setGenerationErrors] = useState<string[]>([]);
const abortRef = useRef<AbortController | null>(null);
```

**Transition graph:**

```
input ──[Generate Pipeline]──→ generating ──[AI success]──→ preview
  ↑                                │                          │  │
  │                     [Cancel / AbortError]                 │  │
  │←────────────────────────────────┘                         │  │
  │←─────────────[← Back]────────────────────────────────────┘  │
  │                                                              │
  │              generating ←──[Regenerate 🔄]───────────────────┘
  │                   │
  │        [AI error] │
  │←──────────────────┘  (return to input with error banner, description preserved)
```

**Remove "AI Generated" from TEMPLATES; add visual switch:**

The `TEMPLATES` array drops the `ai-generated` entry. Instead, when the user selects any template from the dropdown, the dialog shows the normal Name + Template → Create flow. A separate "or generate with AI" section below the template selector reveals the description textarea. This keeps the two paths visually clear.

Actually, per the UX spec (section 3.1), the cleaner approach is: keep `ai-generated` in the template list but **rename** its label to `"AI Generated (describe in natural language)"`. When `template === 'ai-generated'` is selected, conditionally render the textarea block and change the footer buttons. When any other template is selected, the dialog works exactly as before.

```ts
const TEMPLATES = [
    { value: 'custom', label: 'Custom (blank)' },
    { value: 'data-fanout', label: 'Data Fan-out' },
    { value: 'model-fanout', label: 'Model Fan-out' },
    { value: 'ai-generated', label: 'AI Generated (describe in natural language)' },
] as const;

const isAiMode = template === 'ai-generated';
```

**Conditional rendering per phase:**

```
phase === 'input' && isAiMode:
  - Textarea with placeholder, character counter, tip block
  - Footer: [Cancel] [Generate Pipeline ✨] (disabled if description.trim().length < 10)

phase === 'input' && !isAiMode:
  - Current behavior: just Name + Template selector
  - Footer: [Cancel] [Create]

phase === 'generating':
  - Spinner + "Generating pipeline YAML..." message
  - "⏱ This usually takes 10–30 seconds."
  - Footer: [Cancel] (calls abortRef.current?.abort())

phase === 'preview':
  - YAML in <pre> block (same styling as PipelineDetail view mode)
  - Validation badge: ✅ Valid or ⚠️ Invalid with collapsible error list
  - Footer: [← Back] [Regenerate 🔄] [Save Pipeline ✓]
```

**Dialog title changes per phase:**

```ts
const dialogTitle =
    phase === 'preview' ? 'Review Generated Pipeline' :
    phase === 'generating' ? 'Generating...' :
    'New Pipeline';
```

**Dialog width for preview — use `className` override:**

The `Dialog` component supports `className` with `max-w-` override detection (line 28 of Dialog.tsx). For the preview phase, pass `className="max-w-[640px]"` to give extra room for the YAML preview. During input/generating phases, use the default `max-w-lg`.

```ts
<Dialog
    open
    onClose={handleCancel}
    title={dialogTitle}
    className={phase === 'preview' ? 'max-w-[640px]' : undefined}
    footer={...}
>
```

### 3. Textarea & Character Counter (Input Phase)

When `isAiMode && phase === 'input'`:

```tsx
<div>
    <label className="block text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc] mb-1">
        Describe what your pipeline should do
    </label>
    <textarea
        value={description}
        onChange={e => { setDescription(e.target.value.slice(0, 2000)); setError(null); }}
        placeholder="e.g., Read a CSV of customer tickets, classify each by urgency and department, then summarize counts by category"
        rows={5}
        className="w-full px-2 py-1.5 text-sm border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] rounded resize-none"
    />
    <div className={`text-xs mt-1 ${description.length > 1900 ? 'text-red-500' : 'text-[#848484]'}`}>
        {description.length} / 2000 characters
    </div>
</div>

{/* Tip block */}
<div className="flex items-start gap-2 px-3 py-2 text-xs bg-[#e8f4fd] dark:bg-[#0078d4]/10 border border-[#b8daff] dark:border-[#0078d4]/30 rounded">
    <span>💡</span>
    <span className="text-[#1e1e1e] dark:text-[#cccccc]">
        Tip: Mention your data source, what to do with each item, and what the final output should look like.
    </span>
</div>
```

The input class pattern (`w-full px-2 py-1.5 text-sm border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] rounded`) matches the existing `<input>` on line 76 of the current `AddPipelineDialog.tsx`.

### 4. Generate Handler

```ts
async function handleGenerate() {
    const trimmed = name.trim();
    if (!trimmed) { setError('Name is required'); return; }
    if (!NAME_PATTERN.test(trimmed)) { setError('Name must start with...'); return; }
    if (description.trim().length < 10) { setError('Please provide more detail'); return; }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase('generating');
    setError(null);

    try {
        const result = await generatePipeline(workspaceId, trimmed, description.trim(), controller.signal);
        setGeneratedYaml(result.yaml);
        setGeneratedValid(result.valid);
        setGenerationErrors(result.errors || []);
        setPhase('preview');
    } catch (err: any) {
        if (err.name === 'AbortError') {
            setPhase('input'); // cancelled — go back to input, description preserved
        } else {
            setError(err.message || 'Generation failed. Please try again.');
            setPhase('input'); // error — go back to input, description preserved
        }
    }
}
```

### 5. YAML Preview (Preview Phase)

```tsx
{phase === 'preview' && (
    <div className="flex flex-col gap-3">
        <pre className="font-mono text-xs overflow-auto whitespace-pre-wrap bg-[#f5f5f5] dark:bg-[#1e1e1e] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded p-3 max-h-[300px]">
            {generatedYaml}
        </pre>

        {/* Validation badge */}
        <div className="flex items-center gap-2">
            {generatedValid ? (
                <Badge status="completed">✅ Valid pipeline</Badge>
            ) : (
                <Badge status="warning">⚠️ Invalid pipeline</Badge>
            )}
        </div>

        {/* Validation errors (collapsible) */}
        {!generatedValid && generationErrors.length > 0 && (
            <details className="text-xs text-[#848484]">
                <summary className="cursor-pointer">Validation errors ({generationErrors.length})</summary>
                <ul className="mt-1 ml-4 list-disc">
                    {generationErrors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
            </details>
        )}
    </div>
)}
```

The `<pre>` styling and validation error `<details>` pattern are directly copied from `PipelineDetail.tsx` (lines 112 and 98–107).

### 6. Footer Buttons per Phase

```tsx
const footer = (() => {
    if (phase === 'generating') {
        return <Button variant="secondary" onClick={handleCancel}>Cancel</Button>;
    }
    if (phase === 'preview') {
        return (
            <>
                <Button variant="secondary" onClick={() => setPhase('input')}>← Back</Button>
                <Button variant="secondary" onClick={handleGenerate}>Regenerate 🔄</Button>
                <Button loading={submitting} onClick={handleSave}>Save Pipeline ✓</Button>
            </>
        );
    }
    // phase === 'input'
    if (isAiMode) {
        return (
            <>
                <Button variant="secondary" onClick={onClose}>Cancel</Button>
                <Button
                    disabled={description.trim().length < 10}
                    onClick={handleGenerate}
                >
                    Generate Pipeline ✨
                </Button>
            </>
        );
    }
    // Non-AI template — existing behavior
    return (
        <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button loading={submitting} onClick={handleSubmit}>Create</Button>
        </>
    );
})();
```

### 7. Save Handler (Preview → Create)

```ts
async function handleSave() {
    const trimmed = name.trim();
    setSubmitting(true);
    setError(null);
    try {
        await createPipeline(workspaceId, trimmed, undefined, generatedYaml);
        addToast('Pipeline created', 'success');
        onCreated(trimmed);  // pass name for auto-selection
        onClose();
    } catch (err: any) {
        setError(err.message || 'Failed to create pipeline');
    } finally {
        setSubmitting(false);
    }
}
```

Note: `template` is passed as `undefined` when saving AI-generated content — the backend uses `content` directly instead of expanding a template.

### 8. Cancel Handler

```ts
function handleCancel() {
    abortRef.current?.abort();
    if (phase === 'generating') {
        setPhase('input');
    } else {
        onClose();
    }
}
```

### 9. Props Change — `onCreated` Callback

The `onCreated` callback type changes from `() => void` to `(name?: string) => void`:

```ts
export interface AddPipelineDialogProps {
    workspaceId: string;
    onCreated: (name?: string) => void;  // name for auto-selection
    onClose: () => void;
}
```

The existing `handleSubmit` (non-AI path) also passes the name:

```ts
// in handleSubmit:
onCreated(trimmed);
```

### 10. PipelinesTab Auto-Selection & Empty State

**In `PipelinesTab.tsx`**, the `onCreated` handler currently just closes the dialog:

```ts
// Current:
onCreated={() => setShowAddDialog(false)}

// New:
onCreated={(createdName?: string) => {
    setShowAddDialog(false);
    if (createdName) {
        dispatch({ type: 'SET_SELECTED_PIPELINE', name: createdName });
        location.hash = '#repos/' + encodeURIComponent(repo.workspace.id) + '/pipelines/' + encodeURIComponent(createdName);
    }
}}
```

This auto-selects the newly created pipeline, which causes `PipelineDetail` to render in the right panel and fetches its content.

**Empty state text update:**

```tsx
// Current (line 53):
<div className="text-xs text-[#848484] mt-1">
    Add pipeline YAML files to .vscode/pipelines/ in this repository.
</div>

// New:
<div className="text-xs text-[#848484] mt-1">
    Create your first pipeline by describing what it should do, or add YAML files to .vscode/pipelines/.
</div>
```

### 11. Generating Phase UI

```tsx
{phase === 'generating' && (
    <div className="flex flex-col items-center gap-3 py-4">
        <Spinner size="lg" />
        <div className="text-sm text-[#1e1e1e] dark:text-[#cccccc]">Generating pipeline YAML...</div>
        <div className="text-xs text-[#848484]">⏱ This usually takes 10–30 seconds.</div>
    </div>
)}
```

### 12. Import Updates

`AddPipelineDialog.tsx` needs additional imports:

```ts
import { useState, useRef } from 'react';
import { Button, Dialog, Badge, Spinner } from '../shared';
import { createPipeline, generatePipeline } from './pipeline-api';
import type { GenerateResult } from './pipeline-api';
```

## Tests

### `pipeline-api.test.ts` — New test cases

- **`generatePipeline` sends POST to correct URL with name and description** — Verify `fetch` called with `POST /api/workspaces/{wsId}/pipelines/generate`, correct JSON body `{ name, description }`, and `Content-Type` header.
- **`generatePipeline` returns parsed { yaml, valid, errors } response** — Mock a successful response, verify the return shape.
- **`generatePipeline` passes AbortSignal to fetch** — Verify `signal` is included in the fetch options when provided.
- **`generatePipeline` throws on non-ok response with error body** — Mock a 500 response with `{ error: 'AI unavailable' }`, verify the thrown message.
- **`generatePipeline` throws generic message when error body is unparseable** — Mock a 500 response where `.json()` rejects.
- **`createPipeline` includes content in body when provided** — Call `createPipeline('ws1', 'name', undefined, 'yaml: content')`, verify body contains `{ name, content }` and does NOT contain `template`.
- **`createPipeline` includes both template and content when both provided** — Verify body contains all three fields.
- **`createPipeline` remains backward-compatible without content** — Existing tests still pass (body has only `name` and optionally `template`).

### `PipelineUI.test.tsx` — New test cases

**AddPipelineDialog generation flow:**

- **Selecting "AI Generated" template shows textarea and tip block** — Change template selector to `ai-generated`, verify textarea and "💡" tip are rendered.
- **Non-AI templates do NOT show textarea** — Verify textarea absent when `custom` is selected.
- **"Generate Pipeline ✨" button disabled when description < 10 chars** — Type 5 chars, verify button is disabled.
- **"Generate Pipeline ✨" button enabled when description ≥ 10 chars** — Type 15 chars, verify button is not disabled.
- **Character counter displays current length and turns red near limit** — Type text, verify counter text; type 1950+ chars, verify red class.
- **Clicking "Generate Pipeline ✨" calls generatePipeline API** — Mock `generatePipeline`, fill name + description, click Generate, verify API called with correct args.
- **Generating phase shows spinner and cancel button** — Mock `generatePipeline` to return a pending promise, verify Spinner visible and "Cancel" button rendered.
- **Cancel during generation aborts the request and returns to input** — Spy on `AbortController.prototype.abort`, click Cancel during generating phase, verify phase returns to input and description is preserved.
- **Successful generation transitions to preview with YAML** — Mock `generatePipeline` returning `{ yaml: '...', valid: true }`, verify `<pre>` with YAML and "✅ Valid pipeline" badge.
- **Invalid generation shows warning badge and collapsible errors** — Mock returning `{ yaml: '...', valid: false, errors: ['Missing input'] }`, verify "⚠️ Invalid pipeline" badge and error summary.
- **"← Back" returns to input with description preserved** — Navigate to preview, click "← Back", verify textarea has the original description.
- **"Regenerate 🔄" re-calls generatePipeline** — In preview phase, click Regenerate, verify API called again.
- **"Save Pipeline ✓" calls createPipeline with content and triggers onCreated with name** — Mock `createPipeline`, click Save, verify called with `(wsId, name, undefined, yaml)` and `onCreated` called with the name.
- **API error during generation returns to input with error message** — Mock `generatePipeline` rejecting, verify error banner shown and phase is input.
- **API error during save shows inline error in preview phase** — Mock `createPipeline` rejecting, verify error text in preview.

**PipelinesTab auto-selection:**

- **`onCreated` with name auto-selects the pipeline and updates hash** — Render PipelinesTab with a pipeline, open AddPipelineDialog, mock successful create, verify `dispatch SET_SELECTED_PIPELINE` fires and `location.hash` contains the pipeline name.

**PipelinesTab empty state:**

- **Empty state includes natural language discoverability text** — Render with 0 pipelines, verify text "Create your first pipeline by describing what it should do".

**Existing test updates:**

- **`has all four template options`** — Update expected label from `'AI Generated'` to `'AI Generated (describe in natural language)'`.

## Acceptance Criteria

- [ ] Selecting "AI Generated (describe in natural language)" in the template dropdown reveals a description textarea with placeholder, character counter (X / 2000), and a 💡 tip block.
- [ ] "Generate Pipeline ✨" button is disabled when description is < 10 characters.
- [ ] Clicking "Generate Pipeline ✨" transitions to a generating state with spinner, time estimate, and Cancel button.
- [ ] Cancel during generation aborts the in-flight request and returns to input with the description preserved.
- [ ] Successful generation transitions to a preview state showing the YAML in a monospace `<pre>` block with ✅/⚠️ validation badge.
- [ ] Invalid YAML shows collapsible validation errors (same pattern as PipelineDetail).
- [ ] "← Back" returns to input with description preserved; "Regenerate 🔄" re-runs generation.
- [ ] "Save Pipeline ✓" calls `createPipeline(wsId, name, undefined, yamlContent)` and auto-selects the pipeline in the list (dispatches `SET_SELECTED_PIPELINE` and updates `location.hash`).
- [ ] Non-AI templates (Custom, Data Fan-out, Model Fan-out) continue to work exactly as before — no textarea, normal Create button.
- [ ] Empty state in PipelinesTab mentions natural language pipeline creation.
- [ ] All existing `PipelineUI.test.tsx` and `pipeline-api.test.ts` tests pass (with the template label update).
- [ ] New tests cover: generate API client, input validation, all three dialog phases, cancel/abort, error handling, auto-selection, and backward compatibility.
- [ ] Dark and light themes render correctly (uses existing Tailwind classes and CSS variables).

## Dependencies

- Depends on: 001 (backend `/generate` endpoint and extended `POST /pipelines` with `content` field)

## Assumed Prior State

Commit 1 provides:
1. **`POST /api/workspaces/:id/pipelines/generate`** — Accepts `{ description, name }`, returns `{ yaml, valid, errors? }`. The endpoint calls the AI with a system prompt containing pipeline schema knowledge, extracts YAML from the AI response (markdown code block parsing), and validates via YAML parse + structural checks.
2. **Extended `POST /api/workspaces/:id/pipelines`** — Accepts an optional `content` field in the body alongside `name` and `template`. When `content` is provided, it writes the given YAML content directly instead of expanding a template.
3. The backend `pipelines-handler.ts` file has been updated with both endpoints.
4. Backend tests in `pipelines-handler.test.ts` cover the new endpoints.
