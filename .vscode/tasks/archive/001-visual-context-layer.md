---
status: pending
---

# 001: Visual Context Layer

## Summary

Add three small visual enhancements to the Pipeline Flow Preview DAG: a color-coded node state legend below the chart, a breadcrumb/phase indicator above the chart, and a parallel-execution visual cue on the Map node. All three are rendered as new React components composed into the existing `PipelineDAGChart` and `DAGNode` components.

## Motivation

These are purely additive UI affordances that help users understand pipeline state at a glance without clicking nodes. They share no cross-dependencies and are small enough to ship as a single atomic commit. Splitting them further would create excessive churn in the same files.

## Changes

### Files to Create

- `packages/coc/src/server/spa/client/react/processes/dag/DAGLegend.tsx` — New component: horizontal flex row of colored dots + labels for each `DAGNodeState`. Renders below the SVG chart as an HTML `<div>`, not inside `<svg>`. Uses `getNodeColors` from `dag-colors.ts` for dot fill colors and `lightBorders` for border colors. Displays states: `waiting` ("Waiting"), `running` ("Running"), `completed` ("Completed"), `failed` ("Failed"), `cancelled` ("Cancelled"). Skips `skipped` since it's rarely user-facing.

  ```tsx
  export interface DAGLegendProps { isDark: boolean; }
  export function DAGLegend({ isDark }: DAGLegendProps): JSX.Element
  ```

  Implementation:
  - Define `const legendStates: Array<{ state: DAGNodeState; label: string }>` with the 5 entries.
  - Render `<div data-testid="dag-legend" className="flex items-center justify-center gap-4 text-[10px] text-[#848484] mt-1">`.
  - Each entry: `<span className="flex items-center gap-1"><span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: colors.border, display: 'inline-block' }} /> {label}</span>`.
  - Call `getNodeColors(state, isDark)` per entry to get `colors.border` for the dot.

- `packages/coc/src/server/spa/client/react/processes/dag/DAGBreadcrumb.tsx` — New component: horizontal wizard-style step indicator rendered as HTML `<div>` above the SVG chart. Shows circled step numbers (`①`, `②`, `③` etc.) connected by horizontal lines, with the active step highlighted.

  ```tsx
  export interface DAGBreadcrumbProps {
    nodes: DAGNodeData[];
    isDark: boolean;
  }
  export function DAGBreadcrumb({ nodes, isDark }: DAGBreadcrumbProps): JSX.Element | null
  ```

  Implementation:
  - If `nodes.length === 0`, return `null`.
  - Render `<div data-testid="dag-breadcrumb" className="flex items-center justify-center gap-0 mb-2 text-xs">`.
  - For each node, render a step badge `<span data-testid="breadcrumb-step-{phase}">`:
    - Completed: checkmark icon `✓` in a green circle (`bg-[#e6f4ea] text-[#16825d]` light / `bg-[#16825d]/20 text-[#89d185]` dark).
    - Running: step number in a blue circle (`bg-[#e8f3ff] text-[#0078d4]` light / `bg-[#0078d4]/20 text-[#3794ff]` dark) with `animate-pulse`.
    - Waiting/other: step number in a gray circle (`bg-[#f3f3f3] text-[#848484]` light / `bg-[#3c3c3c] text-[#848484]` dark).
  - Badge style: `inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold`.
  - Between badges (not after the last), render a connecting line: `<span className="w-6 h-[1px] bg-[#848484]/40" />`.
  - After each badge, show the phase label in `text-[10px] text-[#848484] ml-0.5 mr-1`.
  - Use colors from `getNodeColors(node.state, isDark)` for consistency.

- `packages/coc/test/spa/react/dag/DAGLegend.test.tsx` — Tests for DAGLegend component.
- `packages/coc/test/spa/react/dag/DAGBreadcrumb.test.tsx` — Tests for DAGBreadcrumb component.

### Files to Modify

- **`packages/coc/src/server/spa/client/react/processes/dag/DAGNode.tsx`** — Add parallel indicator rendering.

  Add a new optional prop `parallelCount?: number` to `DAGNodeProps`.

  When `parallelCount != null && parallelCount > 1`:
  1. Render 2 slightly offset "shadow" rectangles **before** the main `<rect>`, using the same fill/stroke but offset by `(+3, -3)` and `(+6, -6)` from `(x, y)` with reduced opacity (`opacity={0.4}` and `opacity={0.2}`). Same `width={120}`, `height={70}`, `rx={6}`. This gives the "stacked copies" effect.
  2. Render a `×N` badge in the top-right corner: a small `<rect>` at `(x + 120 - 24, y - 6)`, `width={24}`, `height={14}`, `rx={7}`, filled with `colors.border`, plus `<text>` `×{parallelCount}` centered in it, `fontSize={9}`, `fill="#fff"`. Add `data-testid="dag-parallel-badge-{phase}"`.

  Minimal change: insert the shadow rects and badge group conditionally inside the existing `<g>`, before and after the main rect respectively.

- **`packages/coc/src/server/spa/client/react/processes/dag/PipelineDAGChart.tsx`** — Integrate legend, breadcrumb, and pass `parallelCount` to map node.

  1. Import `DAGLegend` and `DAGBreadcrumb`.
  2. Add a new optional prop `parallelCount?: number` to `PipelineDAGChartProps`.
  3. Before the `<svg>` tag (inside the container `<div>`), render `<DAGBreadcrumb nodes={data.nodes} isDark={isDark} />`.
  4. After the closing `</svg>` and the popover, render `<DAGLegend isDark={isDark} />`.
  5. When rendering the map `<DAGNode>`, pass `parallelCount={parallelCount}` if `node.phase === 'map'`.

  Layout order inside the container div:
  ```
  <DAGBreadcrumb />
  <svg>...</svg>
  {popover}
  <DAGLegend />
  ```

- **`packages/coc/src/server/spa/client/react/processes/dag/PipelineDAGSection.tsx`** — Extract `parallel` from pipeline config and pass to `PipelineDAGChart`.

  After line 52 (`const config = meta?.pipelineConfig;`), extract:
  ```ts
  const parallelCount: number | undefined = config?.map?.parallel ?? config?.map?.concurrency;
  ```
  Pass `parallelCount={parallelCount}` to `<PipelineDAGChart>`.

- **`packages/coc/src/server/spa/client/react/processes/dag/index.ts`** — Add exports for `DAGLegend` and `DAGBreadcrumb`.

  Append:
  ```ts
  export { DAGLegend } from './DAGLegend';
  export { DAGBreadcrumb } from './DAGBreadcrumb';
  ```

- **`packages/coc/test/spa/react/dag/PipelineDAGChart.test.tsx`** — Add tests for legend, breadcrumb, and parallel indicator integration.

- **`packages/coc/test/spa/react/dag/DAGNode.test.tsx`** — Add tests for parallel indicator on DAGNode.

### Files to Delete

(none)

## Implementation Notes

1. **Legend uses HTML, not SVG.** Rendering the legend as a `<div>` below the `<svg>` is simpler and more accessible than cramming it into the SVG viewBox (which would require increasing `totalHeight` and breaking existing layout math). The breadcrumb is also HTML above the SVG.

2. **Breadcrumb derives state from `DAGNodeData[].state`.** No new data plumbing needed — the existing `nodes` array already has `state` for each phase. The breadcrumb simply maps over this.

3. **Parallel indicator uses SVG shadow rects.** The stacked-cards effect is achieved with 2 additional `<rect>` elements at slight offsets with reduced opacity. This is purely visual — no new data types. The `×N` badge is a small rounded rect + text overlay.

4. **`parallelCount` data flow:** `PipelineDAGSection` reads `config.map.parallel` (the YAML field name per `PipelineMapConfig` in `pipeline-core/src/pipeline/types.ts` line 251) and falls back to `config.map.concurrency` (used in `PhaseDetail`). It passes this as a prop through `PipelineDAGChart` → `DAGNode`.

5. **`PipelineDAGPreview` (repos view) does not get parallelCount.** The preview renders from static YAML and all nodes are in `waiting` state, so the breadcrumb will show all steps as waiting (correct) and the legend is informational. For the preview path, `parallelCount` can be extracted from the parsed config in `buildPreviewDAG` in a follow-up if desired, but it is not required in this commit.

6. **SVG viewBox unchanged.** The shadow rects extend slightly above and to the right of the node, but the existing `PADDING = 20` provides sufficient headroom. The `×N` badge extends 6px above the node, well within the 20px padding.

7. **Colors reuse `dag-colors.ts` exclusively.** No new color constants. Legend dots use `getNodeColors(state, isDark).border`. Breadcrumb step colors use the same `lightFills` and `lightBorders` values via `getNodeColors`. The parallel badge uses `colors.border` as its fill.

8. **`cn()` utility** from `../../shared/cn` (simple class joiner) is used for conditional classes in the breadcrumb.

## Tests

- **`DAGLegend.test.tsx`**: Renders legend with `data-testid="dag-legend"`; contains 5 colored dot+label pairs; dot background colors match `getNodeColors(state, isDark).border` for each state; works in both light and dark mode.
- **`DAGBreadcrumb.test.tsx`**: Renders breadcrumb with `data-testid="dag-breadcrumb"`; shows correct number of steps matching `nodes.length`; completed step shows `✓`; running step has `animate-pulse`; waiting step shows step number; returns null for empty nodes array.
- **`DAGNode.test.tsx` additions**: When `parallelCount={4}` is passed, renders 2 shadow rects before the main rect (3 rects total); renders `×4` badge with `data-testid="dag-parallel-badge-map"`; when `parallelCount` is undefined, renders only 1 rect and no badge.
- **`PipelineDAGChart.test.tsx` additions**: Chart renders `dag-legend` and `dag-breadcrumb` test IDs; `parallelCount` prop is forwarded to the map node (verify badge appears); breadcrumb step count matches node count.

## Acceptance Criteria

- [ ] Legend renders below the chart showing 5 states with colored dots matching `dag-colors.ts`
- [ ] Legend is visible in both light and dark mode with correct colors
- [ ] Breadcrumb renders above the chart with one step per pipeline phase
- [ ] Completed breadcrumb steps show `✓`, running steps pulse, waiting steps show number
- [ ] When `parallelCount > 1`, map node shows stacked shadow rects and `×N` badge
- [ ] When `parallelCount` is undefined or 1, no parallel indicator is shown
- [ ] All existing tests in `PipelineDAGChart.test.tsx`, `DAGNode.test.tsx`, `dag-colors.test.ts` still pass
- [ ] New tests cover legend rendering, breadcrumb state display, and parallel indicator
- [ ] No changes to SVG viewBox dimensions or existing layout constants

## Dependencies

- Depends on: None

## Assumed Prior State

None — first commit.
