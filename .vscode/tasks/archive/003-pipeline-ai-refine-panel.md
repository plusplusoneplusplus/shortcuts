---
status: done
---

# 003: Add `PipelineAIRefinePanel` Component

## Summary

Create `PipelineAIRefinePanel.tsx` — a standalone React component that lets users submit a natural-language instruction to refine an existing pipeline YAML, tracks progress through three phases (`input → refining → preview`), and renders the result as a unified diff via the existing `UnifiedDiffViewer`. Also add a small `generateUnifiedDiff` helper used by the preview phase.

## Motivation

Commits 1 and 2 wired up the backend endpoint and the `refinePipeline` API call. This commit provides the UI that ties them together. Following the same phase-based state machine as `AddPipelineDialog` gives a consistent UX and keeps the implementation straightforward. Rendering a diff in the preview phase (instead of raw YAML) makes it immediately obvious what the AI changed.

## Changes

### Files to Create

#### `packages/coc/src/server/spa/client/react/repos/PipelineAIRefinePanel.tsx`

The primary deliverable. Full details in **Implementation Notes**.

#### `packages/coc/src/server/spa/client/react/repos/unifiedDiffUtils.ts`

A single exported function:

```ts
/**
 * Generates a minimal unified diff string compatible with UnifiedDiffViewer.
 * Produces standard unified-diff format with a single hunk covering all changes.
 */
export function generateUnifiedDiff(
    oldText: string,
    newText: string,
    fileName: string = 'pipeline.yaml',
): string
```

Algorithm:
1. Split both strings on `\n`.
2. Walk line-by-line with a simple LCS (or greedy diff): emit context lines (` `-prefixed), removed lines (`-`-prefixed), added lines (`+`-prefixed).
3. Prepend the standard header:
   ```
   --- a/pipeline.yaml
   +++ b/pipeline.yaml
   @@ -1,<oldLen> +1,<newLen> @@
   ```
   where `<oldLen>` / `<newLen>` are the total line counts (single-hunk diff — acceptable for pipeline YAML sizes).

`UnifiedDiffViewer` classifies lines by prefix (`@@`, `--- `, `+++ `, `+`, `-`, else context), so this format is directly consumable.

### Files to Modify

_(None in this commit — wiring the panel into the pipeline detail page is Commit 4.)_

### Files to Delete

_(None.)_

## Implementation Notes

### Props Interface

```ts
export interface PipelineAIRefinePanelProps {
    workspaceId: string;
    pipelineName: string;
    currentYaml: string;
    onApply: (newYaml: string) => void;
    onCancel: () => void;
}
```

### Phase Type

```ts
type RefinePhase = 'input' | 'refining' | 'preview';
```

### State

| Variable | Type | Purpose |
|---|---|---|
| `phase` | `RefinePhase` | Current UI phase |
| `instruction` | `string` | Textarea value — the user's natural-language edit request |
| `refinedYaml` | `string` | The YAML returned by `refinePipeline` |
| `diff` | `string` | Unified diff computed from `currentYaml` vs `refinedYaml` |
| `error` | `string \| null` | Inline error message |
| `submitting` | `boolean` | `true` while applying (`onApply` handler is async-safe, but gate the button) |
| `abortRef` | `RefObject<AbortController \| null>` | Cancellation — same pattern as `AddPipelineDialog` |

### Phase Renders

#### `input` phase

```
┌──────────────────────────────────────────────────────┐
│  [textarea]  "Describe your change..."               │
│  char count  N / 2000                                │
│  [error banner if error]                             │
│  Footer: [Cancel]  [Refine with AI ✨]               │
└──────────────────────────────────────────────────────┘
```

- `<textarea>` bound to `instruction`, capped at 2000 chars (same as `AddPipelineDialog`).
- Character counter: red when `instruction.length > 1900`.
- "Refine with AI ✨" button disabled when `instruction.trim().length < 10`.
- Cancel calls `onCancel()`.
- Clicking "Refine with AI" calls `handleRefine()`.

#### `refining` phase

```
┌──────────────────────────────────────────────────────┐
│  [Spinner lg]                                        │
│  "Refining pipeline..."                              │
│  "⏱ This usually takes 10–30 seconds."              │
│  Footer: [Cancel]                                    │
└──────────────────────────────────────────────────────┘
```

Exact markup mirrors the `generating` phase in `AddPipelineDialog`:
```tsx
<div className="flex flex-col items-center gap-3 py-4">
    <Spinner size="lg" />
    <div className="text-sm text-[#1e1e1e] dark:text-[#cccccc]">Refining pipeline...</div>
    <div className="text-xs text-[#848484]">⏱ This usually takes 10–30 seconds.</div>
</div>
```
Cancel button aborts the in-flight request and returns to `input` phase (same `handleCancel` logic as `AddPipelineDialog`).

#### `preview` phase

```
┌──────────────────────────────────────────────────────┐
│  <UnifiedDiffViewer diff={diff} fileName="pipeline.yaml" /> │
│  [error banner if error]                             │
│  Footer: [← Back]  [Re-refine 🔄]  [Apply Changes ✓] │
└──────────────────────────────────────────────────────┘
```

- `diff` is computed immediately after `refinePipeline` resolves:
  ```ts
  const diffStr = generateUnifiedDiff(currentYaml, result.yaml, 'pipeline.yaml');
  setDiff(diffStr);
  setRefinedYaml(result.yaml);
  setPhase('preview');
  ```
- `fileName="pipeline.yaml"` — passed to `UnifiedDiffViewer` so `getLanguageFromFileName` returns `'yaml'`, enabling YAML syntax highlighting on context/added/removed lines.
- "← Back" sets `phase` back to `'input'`.
- "Re-refine 🔄" calls `handleRefine()` again (re-uses the current `instruction`).
- "Apply Changes ✓" calls `onApply(refinedYaml)`.

### `handleRefine` Logic

```ts
async function handleRefine() {
    if (instruction.trim().length < 10) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase('refining');
    setError(null);

    try {
        const result = await refinePipeline(
            workspaceId,
            pipelineName,
            instruction.trim(),
            currentYaml,
            controller.signal,
        );
        const diffStr = generateUnifiedDiff(currentYaml, result.yaml, 'pipeline.yaml');
        setDiff(diffStr);
        setRefinedYaml(result.yaml);
        setPhase('preview');
    } catch (err: any) {
        if (err.name === 'AbortError') {
            setPhase('input');
        } else {
            setError(err.message || 'Refinement failed. Please try again.');
            setPhase('input');
        }
    }
}
```

### `handleCancel` Logic

```ts
function handleCancel() {
    abortRef.current?.abort();
    if (phase === 'refining') {
        setPhase('input');
    } else {
        onCancel();
    }
}
```

### Panel Title

```ts
const panelTitle =
    phase === 'preview'   ? 'Review Changes' :
    phase === 'refining'  ? 'Refining...'    :
    'Edit with AI';
```

The panel is not wrapped in a `<Dialog>` here — it is a plain `<div>` with a heading so Commit 4 can embed it wherever needed (e.g., a side-panel or modal).

### Imports

```ts
import { useState, useRef } from 'react';
import { Button, Spinner } from '../shared';
import { refinePipeline } from './pipeline-api';
import { UnifiedDiffViewer } from './UnifiedDiffViewer';
import { generateUnifiedDiff } from './unifiedDiffUtils';
```

## Tests

File: `packages/coc/src/server/spa/client/react/repos/__tests__/unifiedDiffUtils.test.ts`

| Test | Description |
|---|---|
| identical input | diff string contains no `+` or `-` content lines |
| added lines | new lines appear with `+` prefix, header counts correct |
| removed lines | removed lines appear with `-` prefix |
| mixed edits | added and removed lines both present in same diff |
| empty old text | all lines added |
| empty new text | all lines removed |
| `fileName` in header | `--- a/my.yaml` / `+++ b/my.yaml` present |
| `UnifiedDiffViewer` round-trip | `classifyLine` correctly identifies each prefix type from the generated diff (import the private function via a re-export test, or test through the component snapshot) |

File: `packages/coc/src/server/spa/client/react/repos/__tests__/PipelineAIRefinePanel.test.tsx`

| Test | Description |
|---|---|
| renders input phase by default | textarea visible, "Edit with AI" title shown |
| "Refine with AI" disabled when instruction < 10 chars | button `disabled` attribute present |
| successful refine flow | mock `refinePipeline`, assert spinner appears then diff viewer appears |
| cancel during refining | `AbortController.abort` called, returns to input phase |
| cancel in input phase | `onCancel` called |
| "← Back" in preview | returns to input phase |
| "Apply Changes" in preview | calls `onApply` with refined YAML |
| error from `refinePipeline` | error banner shown, stays in input phase |

## Acceptance Criteria

- [ ] `PipelineAIRefinePanel` renders a textarea in the `input` phase with a "Refine with AI ✨" button disabled below 10 characters.
- [ ] While awaiting the API, the `refining` phase shows a centered `<Spinner size="lg" />` and a Cancel button that aborts the request.
- [ ] After a successful response, the `preview` phase shows a `<UnifiedDiffViewer>` with `fileName="pipeline.yaml"` and the computed unified diff; YAML lines receive syntax highlighting.
- [ ] "← Back" in preview returns to `input` phase without clearing `instruction`.
- [ ] "Re-refine 🔄" in preview re-submits the same instruction.
- [ ] "Apply Changes ✓" in preview calls `onApply(refinedYaml)`.
- [ ] A rejected `refinePipeline` call (non-abort) shows an inline error and returns to `input`.
- [ ] `generateUnifiedDiff` produces a string with correct `--- a/`, `+++ b/`, and `@@` header lines, and passes all unit tests.
- [ ] All new Vitest tests pass (`npm run test:run` in `packages/coc`).

## Dependencies

- **Commit 1** — `POST /api/workspaces/:id/pipelines/:name/refine` must exist.
- **Commit 2** — `refinePipeline()` in `pipeline-api.ts` must be exported and typed correctly.
- `UnifiedDiffViewer` (`packages/coc/src/server/spa/client/react/repos/UnifiedDiffViewer.tsx`) — already present.
- `Button`, `Spinner` from `../shared` — already present.

## Assumed Prior State

- `refinePipeline(workspaceId, pipelineName, instruction, currentYaml, signal?)` is exported from `pipeline-api.ts` and returns `Promise<RefineResult>` where `RefineResult = { yaml: string }`.
- `UnifiedDiffViewer` accepts `{ diff: string; fileName?: string; 'data-testid'?: string }` and classifies lines by their leading character (`+`, `-`, `@@`, `--- `, `+++ `).
- No client-side diff utility exists yet in the codebase — `unifiedDiffUtils.ts` is new.
- The panel is not yet wired into any page; that is Commit 4's responsibility.
