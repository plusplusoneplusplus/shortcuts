---
status: pending
---

# 004: Validation Error Pins

## Summary

Pin red error markers directly on DAG nodes that have validation errors, so users can instantly see which pipeline phase is misconfigured. When `pipeline.validationErrors` is non-empty, each error string is mapped to a `PipelinePhase` by keyword matching, and a small red circle badge (with `!` or error count) is rendered in the top-right corner of the offending node's SVG rect. Hovering the badge shows the specific error message(s) via a native SVG `<title>` tooltip.

## Motivation

Currently, validation errors are buried in a collapsible `<details>` element above the YAML in `PipelineDetail.tsx`. Users must manually read each error message and mentally map it to the relevant pipeline phase. By rendering error pins directly on the DAG nodes, users get immediate spatial feedback — they can see at a glance that the Filter node has 2 errors without reading the error list. This is the natural complement to commits 001 (visual context) and 002 (rich hover tooltips); it extends the DAG preview from a static visualization into an actionable diagnostic surface.

## Changes

### Files to Create

- **`packages/coc/src/server/spa/client/react/processes/dag/errorMapping.ts`** — Pure utility module that maps validation error strings to pipeline phases.

  ```ts
  import type { PipelinePhase } from '@plusplusoneplusplus/pipeline-core';

  export interface PhaseErrors {
      /** Errors mapped to specific phases, keyed by PipelinePhase */
      byPhase: Partial<Record<PipelinePhase, string[]>>;
      /** Errors that could not be mapped to any specific phase */
      unmapped: string[];
  }

  const phaseKeywords: Array<{ phase: PipelinePhase; keywords: string[] }> = [
      { phase: 'input',  keywords: ['input', 'csv', 'path', 'file', 'source'] },
      { phase: 'filter', keywords: ['filter'] },
      { phase: 'map',    keywords: ['map', 'prompt', 'output', 'model', 'parallel', 'concurrency', 'batch'] },
      { phase: 'reduce', keywords: ['reduce'] },
      { phase: 'job',    keywords: ['job'] },
  ];

  /**
   * Map validation error strings to pipeline phases by keyword matching.
   * Each error is matched to the first phase whose keyword appears (case-insensitive).
   * Errors matching no phase go into `unmapped`.
   */
  export function mapErrorsToPhases(errors: string[]): PhaseErrors {
      const result: PhaseErrors = { byPhase: {}, unmapped: [] };
      for (const error of errors) {
          const lower = error.toLowerCase();
          let matched = false;
          for (const { phase, keywords } of phaseKeywords) {
              if (keywords.some(kw => lower.includes(kw))) {
                  if (!result.byPhase[phase]) result.byPhase[phase] = [];
                  result.byPhase[phase]!.push(error);
                  matched = true;
                  break;
              }
          }
          if (!matched) {
              result.unmapped.push(error);
          }
      }
      return result;
  }

  /**
   * Get the list of validation errors that should be displayed on a specific node.
   * Returns the phase-specific errors plus any unmapped errors (shown on all nodes).
   */
  export function getNodeErrors(phaseErrors: PhaseErrors, phase: PipelinePhase): string[] {
      const specific = phaseErrors.byPhase[phase] ?? [];
      return [...specific, ...phaseErrors.unmapped];
  }
  ```

- **`packages/coc/src/server/spa/client/react/processes/dag/DAGErrorPin.tsx`** — New SVG component that renders a red error badge in the top-right corner of a DAG node.

  ```tsx
  export interface DAGErrorPinProps {
      /** Absolute X of the node's top-right corner (node x + NODE_W) */
      x: number;
      /** Absolute Y of the node's top edge (node y) */
      y: number;
      /** Error messages to display */
      errors: string[];
      /** Dark mode flag */
      isDark: boolean;
  }

  export function DAGErrorPin({ x, y, errors, isDark }: DAGErrorPinProps): JSX.Element | null
  ```

  Implementation:
  - If `errors.length === 0`, return `null`.
  - Render a `<g data-testid="dag-error-pin">` positioned at the top-right corner of the node.
  - Pin position: center at `(x - 4, y - 4)` — slightly inset from the top-right corner, overlapping the node rect edge. This uses `x = nodeX + 120` (NODE_W) and `y = nodeY`, so the pin sits at the junction.
  - Render a `<circle>` with `r={8}`, `fill="#f14c4c"` (light) / `fill="#f48771"` (dark) — reuses the `failed` colors from `dag-colors.ts` (`lightBorders.failed` and `darkTexts.failed`).
  - Render a `<text>` centered in the circle:
    - If `errors.length === 1`: show `"!"`, `fontSize={10}`, `fontWeight="bold"`, `fill="#fff"`.
    - If `errors.length > 1`: show `errors.length.toString()`, `fontSize={9}`, `fontWeight="bold"`, `fill="#fff"`.
  - Add a `<title>` element inside the `<g>` with `errors.join('\n')` for the native SVG hover tooltip. This is consistent with the existing tooltip pattern in `DAGNode.tsx` (line 44: `<title>{tooltipText}</title>`).
  - The circle should have a thin white border (`stroke="#fff"`, `strokeWidth={1.5}`) to visually separate it from the node rect fill, ensuring visibility on colored backgrounds.

- **`packages/coc/test/spa/react/dag/DAGErrorPin.test.tsx`** — Unit tests for the `DAGErrorPin` component.

- **`packages/coc/test/spa/react/dag/errorMapping.test.ts`** — Unit tests for `mapErrorsToPhases` and `getNodeErrors`.

### Files to Modify

- **`packages/coc/src/server/spa/client/react/processes/dag/DAGNode.tsx`** — Add optional `validationErrors` prop and render `DAGErrorPin`.

  Add to `DAGNodeProps` interface (line 7–15):
  ```ts
  /** Validation errors mapped to this node's phase */
  validationErrors?: string[];
  ```

  Import `DAGErrorPin`:
  ```ts
  import { DAGErrorPin } from './DAGErrorPin';
  ```

  Destructure the new prop in the function signature (line 17):
  ```ts
  export function DAGNode({ node, x, y, isDark, onClick, elapsedMs, selected, validationErrors }: DAGNodeProps)
  ```

  After the closing of the elapsed text block (after line 105, before the closing `</g>`), add:
  ```tsx
  {validationErrors && validationErrors.length > 0 && (
      <DAGErrorPin
          x={x + 120}
          y={y}
          errors={validationErrors}
          isDark={isDark}
      />
  )}
  ```

  The error pin renders last in the `<g>` so it paints on top of everything else (SVG painter's order).

- **`packages/coc/src/server/spa/client/react/processes/dag/PipelineDAGChart.tsx`** — Accept and distribute validation errors to nodes.

  Add to `PipelineDAGChartProps` interface (line 11–21):
  ```ts
  /** Validation errors mapped to phases, for rendering error pins on nodes */
  validationErrors?: string[];
  ```

  Import the error mapping utility:
  ```ts
  import { mapErrorsToPhases, getNodeErrors } from './errorMapping';
  ```

  Inside the component function, after `const mapNode = ...` (line 78), compute the phase error mapping:
  ```ts
  const phaseErrors = useMemo(
      () => validationErrors?.length ? mapErrorsToPhases(validationErrors) : null,
      [validationErrors]
  );
  ```

  Add `useMemo` to the existing `useState, useEffect, useRef` import from `'react'` (line 1).

  In the node rendering loop (lines 119–135), pass `validationErrors` to each `<DAGNode>`:
  ```tsx
  <DAGNode
      key={node.phase}
      node={node}
      x={positions[i].x}
      y={positions[i].y}
      isDark={isDark}
      onClick={handleNodeClick}
      elapsedMs={elapsedMs}
      selected={node.phase === selectedPhase}
      validationErrors={phaseErrors ? getNodeErrors(phaseErrors, node.phase) : undefined}
  />
  ```

- **`packages/coc/src/server/spa/client/react/repos/PipelineDAGPreview.tsx`** — Accept and forward validation errors.

  Update the props interface (line 11–13):
  ```ts
  export interface PipelineDAGPreviewProps {
      yamlContent: string;
      /** Pipeline validation errors to display as pins on DAG nodes */
      validationErrors?: string[];
  }
  ```

  Update function signature (line 22):
  ```ts
  export function PipelineDAGPreview({ yamlContent, validationErrors }: PipelineDAGPreviewProps)
  ```

  Pass to `PipelineDAGChart` (line 42):
  ```tsx
  <PipelineDAGChart data={result.data} isDark={isDark} validationErrors={validationErrors} />
  ```

  Note: `WorkflowDAGChart` does not get validation errors in this commit — workflow DAGs use a different node structure. This can be a follow-up.

- **`packages/coc/src/server/spa/client/react/repos/PipelineDetail.tsx`** — Pass `validationErrors` to `PipelineDAGPreview`.

  Update the `PipelineDAGPreview` call (line 171):
  ```tsx
  <PipelineDAGPreview
      yamlContent={content}
      validationErrors={pipeline.validationErrors}
  />
  ```

  This is the only line that changes in this file. The existing collapsible error list (lines 141–150) remains untouched — it provides a complementary text-based view.

- **`packages/coc/src/server/spa/client/react/processes/dag/index.ts`** — Add exports for new modules.

  Append:
  ```ts
  export { DAGErrorPin } from './DAGErrorPin';
  export { mapErrorsToPhases, getNodeErrors } from './errorMapping';
  export type { PhaseErrors } from './errorMapping';
  ```

- **`packages/coc/test/spa/react/dag/DAGNode.test.tsx`** — Add tests for error pin rendering on DAGNode.

- **`packages/coc/test/spa/react/dag/PipelineDAGChart.test.tsx`** — Add tests for error distribution across nodes.

### Files to Delete

(none)

## Implementation Notes

1. **Error pin uses SVG, not HTML overlay.** Since DAG nodes are SVG `<rect>` elements (120×70, rx=6) inside an `<svg>` with `viewBox`, the error pin must also be SVG. An HTML overlay would require absolute positioning math to align with the SVG coordinate system, which breaks under `preserveAspectRatio="xMidYMid meet"` scaling. The SVG approach is simpler and pixel-perfect.

2. **Pin position within SVG viewBox bounds.** The pin is at `(nodeX + 116, nodeY - 4)` center, with `r=8`. The topmost pixel is at `nodeY - 12`. With `PADDING = 20` and `nodeY = PADDING = 20`, the pin's top is at y=8, which is well within the viewBox (starts at 0). The rightmost node's pin extends to `x = PADDING + (n-1)*(NODE_W+GAP_X) + NODE_W + 4`, also within `totalWidth = 2*PADDING + n*NODE_W + (n-1)*GAP_X`. No viewBox adjustment needed.

3. **Keyword matching is first-match.** The `phaseKeywords` array is ordered so that more specific terms are checked first per phase. An error like `"Invalid filter expression"` matches `filter` before it could match anything else. The keyword `"output"` maps to `map` because `output` is a map-phase config field (`map.output`). If a keyword like `"path"` is ambiguous, the first-match behavior is acceptable — the pin is an indicator, not a precise diagnostic.

4. **Unmapped errors show on all nodes.** If an error cannot be mapped (e.g., `"Pipeline name is required"`), `getNodeErrors` appends it to every node's error list. This ensures no error goes unnoticed. The alternative of showing a general warning banner was considered but adds UI complexity; showing on all nodes is simpler and still draws attention.

5. **`<title>` tooltip is consistent with existing pattern.** `DAGNode.tsx` already uses `<title>` for hover tooltips (line 44). The error pin adds its own `<title>` inside its `<g>`, which takes precedence when hovering the pin area. This is browser-standard SVG behavior — the innermost `<title>` wins. No custom tooltip logic is needed.

6. **White stroke on the pin circle.** The `stroke="#fff" strokeWidth={1.5}` ensures the red circle is visible even against the `failed` node fill (`#fde8e8`). Without the stroke, the red circle would blend into red-ish backgrounds.

7. **`useMemo` for error mapping in PipelineDAGChart.** The `mapErrorsToPhases` function iterates over all errors × all keywords. With typical validation errors (< 20 strings), this is trivial, but memoizing on `validationErrors` reference avoids recomputation on every render (e.g., during running-state polling with `now` prop changes).

8. **No changes to `PipelineDAGSection` (execution view).** The execution-time DAG in `PipelineDAGSection.tsx` doesn't have access to `validationErrors` — those are a property of the static pipeline definition (`PipelineInfo`), not the running process. Error pins only appear in the repos/preview context (`PipelineDetail` → `PipelineDAGPreview`). This is correct: if a pipeline is running, it already passed validation.

9. **Colors reuse `dag-colors.ts` constants.** The pin uses `#f14c4c` (light) and `#f48771` (dark), which are `lightBorders.failed` and `darkTexts.failed` respectively. No new color constants are introduced.

## Tests

### `errorMapping.test.ts`

- **Maps input-related errors:** `"Missing input path"` → `byPhase.input = ["Missing input path"]`.
- **Maps filter errors:** `"Invalid filter expression"` → `byPhase.filter`.
- **Maps map errors:** `"Missing prompt template"` → `byPhase.map`.
- **Maps reduce errors:** `"Reduce type 'invalid' is not supported"` → `byPhase.reduce`.
- **Maps job errors:** `"Job requires a prompt"` → `byPhase.job`.
- **Handles unmapped errors:** `"Pipeline name is required"` → `unmapped = ["Pipeline name is required"]`.
- **Handles multiple errors on same phase:** Two map errors → `byPhase.map.length === 2`.
- **Case-insensitive matching:** `"INPUT file not found"` → maps to `input`.
- **`getNodeErrors` combines phase + unmapped:** Given `byPhase.map = ["err1"]` and `unmapped = ["err2"]`, `getNodeErrors(result, 'map')` returns `["err1", "err2"]`.
- **`getNodeErrors` returns only unmapped for unmatched phase:** `getNodeErrors(result, 'filter')` returns `["err2"]` (just unmapped).
- **Empty errors array:** `mapErrorsToPhases([])` returns `{ byPhase: {}, unmapped: [] }`.

### `DAGErrorPin.test.tsx`

- **Renders circle and text for single error:** Pass `errors={["Bad input"]}`, verify `<circle>` with `fill="#f14c4c"` and `<text>` containing `"!"`.
- **Renders count for multiple errors:** Pass `errors={["err1", "err2"]}`, verify `<text>` containing `"2"`.
- **Returns null for empty errors:** Pass `errors={[]}`, verify nothing renders.
- **Shows tooltip on hover:** Verify `<title>` element contains the error message text.
- **Multi-error tooltip joins with newline:** Pass 2 errors, verify `<title>` contains both joined by `\n`.
- **Dark mode uses dark color:** Pass `isDark={true}`, verify `<circle>` `fill="#f48771"`.
- **Has white stroke:** Verify `<circle>` has `stroke="#fff"`.
- **Wraps in SVG for rendering:** Use `render(<svg><DAGErrorPin ... /></svg>)` pattern per existing test convention.

### `DAGNode.test.tsx` additions

- **Renders error pin when `validationErrors` provided:** `renderNode({}, { validationErrors: ["Bad input"] })`, verify `data-testid="dag-error-pin"` is present.
- **Does not render error pin when `validationErrors` is undefined:** Default render, verify `dag-error-pin` is absent.
- **Does not render error pin for empty array:** `renderNode({}, { validationErrors: [] })`, verify `dag-error-pin` is absent.

### `PipelineDAGChart.test.tsx` additions

- **Distributes errors to correct nodes:** Pass `validationErrors={["Missing input path", "Invalid filter expression"]}` to chart with input+filter+map nodes. Verify `dag-error-pin` appears on input and filter nodes, not on map node.
- **Unmapped errors appear on all nodes:** Pass `validationErrors={["Unknown error"]}`. Verify `dag-error-pin` appears on every node.
- **No error pins when `validationErrors` is undefined:** Default render, verify no `dag-error-pin` elements.

## Acceptance Criteria

- [ ] Red error pin badge appears on DAG nodes that have mapped validation errors
- [ ] Single error shows `!` icon; multiple errors show count (e.g., `2`)
- [ ] Hovering the error pin shows the error message(s) as a tooltip
- [ ] Unmapped errors show pins on all nodes
- [ ] Error pins are visible in both light and dark mode with correct colors
- [ ] Error pins do not extend outside the SVG viewBox
- [ ] `PipelineDetail` passes `validationErrors` through `PipelineDAGPreview` → `PipelineDAGChart` → `DAGNode`
- [ ] Existing collapsible error list in `PipelineDetail` still renders unchanged
- [ ] All existing tests in `DAGNode.test.tsx`, `PipelineDAGChart.test.tsx` still pass
- [ ] New tests cover error mapping logic, pin rendering, and error distribution
- [ ] No changes to execution-time DAG in `PipelineDAGSection`

## Dependencies

- Depends on: 001

## Assumed Prior State

Commit 001 modifies DAGNode with parallel indicator (shadow rects, badge). Commit 002 adds PipelineConfig piping and tooltip pattern — the error pin's `<title>` tooltip reuses the same native SVG `<title>` mechanism already in `DAGNode.tsx` (line 44). Commit 003 adds edge annotations and piping through `PipelineDAGChart`. The error pin is orthogonal to all three — it occupies a different visual position (top-right corner) and carries different data (validation errors from `PipelineInfo`, not runtime state or config).
