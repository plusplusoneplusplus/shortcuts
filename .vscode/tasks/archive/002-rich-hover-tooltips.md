---
status: pending
---

# 002: Rich Hover Tooltips

## Summary

Replace the native SVG `<title>` tooltip on DAG nodes with a styled HTML popover that appears on hover, showing phase-specific static config details (from YAML) such as prompt snippets, model names, filter types, and input paths.

## Motivation

The native `<title>` tooltip only shows `"label — state (duration) • items"` — no insight into what the pipeline phase actually does. Surfacing YAML config details on hover gives users immediate context without clicking. This is a separate commit because it introduces a new component, a new data-piping path (`PipelineConfig` through the preview layer), and coexists with the existing click-triggered `PipelinePhasePopover` (which shows live execution data).

## Changes

### Files to Create

- `packages/coc/src/server/spa/client/react/processes/dag/DAGHoverTooltip.tsx` — New React component rendering a positioned HTML tooltip with phase-specific config details. Rendered as a sibling `<div>` below the `<svg>` (same pattern as `PipelinePhasePopover`), positioned absolutely relative to the chart container using the hovered node's bounding rect. Contains sub-components per phase (`InputTooltip`, `FilterTooltip`, `MapTooltip`, `ReduceTooltip`, `JobTooltip`).

- `packages/coc/test/spa/react/dag/DAGHoverTooltip.test.tsx` — Vitest + @testing-library tests for the new component covering per-phase content rendering, show-on-hover, hide-on-leave, and graceful handling of missing config fields.

### Files to Modify

- `packages/coc/src/server/spa/client/react/repos/buildPreviewDAG.ts` — Extend `buildLinearPreview` to also extract and return the parsed `PipelineConfig` alongside the DAG chart data. Change the `PreviewDAGResult` linear variant from `{ type: 'linear'; data: DAGChartData }` to `{ type: 'linear'; data: DAGChartData; config: PipelineConfig }`. The YAML is already parsed via `yaml.load(yamlContent)` as `config`; just pass it through after asserting the shape. Import `PipelineConfig` from `@plusplusoneplusplus/pipeline-core`.

- `packages/coc/src/server/spa/client/react/repos/PipelineDAGPreview.tsx` — Extract `config` from the `buildPreviewDAG` result when `result.type === 'linear'`. Pass it as a new `pipelineConfig` prop to `<PipelineDAGChart>`.

- `packages/coc/src/server/spa/client/react/processes/dag/PipelineDAGChart.tsx` — Add optional `pipelineConfig?: PipelineConfig` prop to `PipelineDAGChartProps`. Track `hoveredPhase: PipelinePhase | null` and `hoverAnchor: { x: number; y: number } | null` state. Pass `onMouseEnter` / `onMouseLeave` callbacks to `<DAGNode>`. When `hoveredPhase` is set and `pipelineConfig` is provided, render `<DAGHoverTooltip>` positioned absolutely using `hoverAnchor`. Compute anchor by converting the SVG node position (`positions[i].x + NODE_W/2`, `positions[i].y`) to container-relative coordinates using the SVG `viewBox`-to-client ratio. Add a 150ms leave delay (via `setTimeout` + ref) so the user can move the cursor to the tooltip itself without it disappearing.

- `packages/coc/src/server/spa/client/react/processes/dag/DAGNode.tsx` — Add optional `onMouseEnter?: (phase: PipelinePhase) => void` and `onMouseLeave?: (phase: PipelinePhase) => void` props to `DAGNodeProps`. Attach `onMouseEnter={() => onMouseEnter?.(node.phase)}` and `onMouseLeave={() => onMouseLeave?.(node.phase)}` to the `<g>` wrapper element. Keep the existing `<title>` element as a fallback for accessibility/screenreaders.

- `packages/coc/src/server/spa/client/react/processes/dag/index.ts` — Add export for `DAGHoverTooltip` component.

### Files to Delete

(none)

## Implementation Notes

### Tooltip Component Structure (`DAGHoverTooltip.tsx`)

```tsx
export interface DAGHoverTooltipProps {
    phase: PipelinePhase;
    config: PipelineConfig;
    anchor: { x: number; y: number }; // container-relative px
    onMouseEnter: () => void;   // keep tooltip alive when cursor moves to it
    onMouseLeave: () => void;   // dismiss tooltip
}
```

The component renders an absolutely-positioned `<div>` inside the chart container's `relative` wrapper. Position: `left: anchor.x`, `top: anchor.y`, transformed with `translate(-50%, -100%)` to sit above the node, with a small `mb-2` gap. If it would overflow the top, flip to below the node.

### Phase-specific content

Each sub-component extracts from `PipelineConfig`:

| Phase | Fields shown | Source |
|-------|-------------|--------|
| **Input** | Source type (`config.input.from?.type` or "inline"), file path (`config.input.from?.path`), item count (`config.input.items?.length` or `config.input.from?.length`), limit (`config.input.limit`), **mini data preview** (first 3 rows from inline items as a compact table/grid) | `config.input: InputConfig` |
| **Filter** | Filter type (`config.filter.type`), rule summary (first rule as `"{field} {operator} {value}"`), AI prompt snippet (first 80 chars of `config.filter.ai?.prompt`) | `config.filter: FilterConfig` |
| **Map** | Prompt snippet (first 100 chars of `config.map.prompt` or `"File: {promptFile}"`), model, parallel count, output field names (joined), batch size | `config.map: MapConfig` |
| **Reduce** | Reduce type (`config.reduce.type`), prompt snippet (first 100 chars), model | `config.reduce: ReduceConfig` |
| **Job** | Prompt snippet (first 100 chars of `config.job.prompt` or `"File: {promptFile}"`), model, output fields | `config.job: JobConfig` |

If the config section for a phase is missing (e.g., no `config.filter`), show a minimal fallback: just the phase name.

### Styling — match existing `PipelinePhasePopover` patterns

```
bg-[#f8f8f8] dark:bg-[#1e1e1e]
border border-[#e0e0e0] dark:border-[#3c3c3c]
rounded-md p-2 shadow-lg
text-[11px]
```

Labels: `text-[10px] uppercase text-[#848484]` (reuse `labelClass` pattern).
Values: `text-[11px] text-[#1e1e1e] dark:text-[#cccccc]` (reuse `valueClass` pattern).
Max width: `max-w-[280px]` to keep it compact.
Use `pointer-events-auto` on the tooltip div so `onMouseEnter`/`onMouseLeave` fire.

### Hover delay logic in `PipelineDAGChart.tsx`

```tsx
const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const handleNodeMouseEnter = (phase: PipelinePhase) => {
    if (leaveTimerRef.current) { clearTimeout(leaveTimerRef.current); leaveTimerRef.current = null; }
    setHoveredPhase(phase);
    // compute hoverAnchor from node index + SVG layout constants
};

const handleNodeMouseLeave = () => {
    leaveTimerRef.current = setTimeout(() => { setHoveredPhase(null); setHoverAnchor(null); }, 150);
};

// Also pass onMouseEnter/onMouseLeave to the tooltip itself so hovering the tooltip cancels the dismiss timer
```

Cleanup the timer in a `useEffect` return.

### Anchor computation

Node positions are in SVG viewBox coordinates. The SVG uses `preserveAspectRatio="xMidYMid meet"`, so the rendered size may differ from viewBox. Use `svgRef.getBoundingClientRect()` and `containerRef.getBoundingClientRect()` to compute the scale factor:

```tsx
const svgRect = svgRef.current.getBoundingClientRect();
const containerRect = containerRef.current.getBoundingClientRect();
const scaleX = svgRect.width / totalWidth;
const scaleY = svgRect.height / totalHeight;
const offsetX = svgRect.left - containerRect.left;
const offsetY = svgRect.top - containerRect.top;

const anchorX = offsetX + (nodeX + NODE_W / 2) * scaleX;
const anchorY = offsetY + nodeY * scaleY;
```

Add a `svgRef = useRef<SVGSVGElement>(null)` and attach it to the `<svg>` element in `PipelineDAGChart`.

### Coexistence with `PipelinePhasePopover`

- `PipelinePhasePopover` is click-triggered, shows live execution data (`PhaseDetail`), rendered below SVG.
- `DAGHoverTooltip` is hover-triggered, shows static YAML config data (`PipelineConfig`), rendered as an overlay above/below the node.
- When a node is clicked (popover opens), hide the hover tooltip by clearing `hoveredPhase` in `handleNodeClick`.
- Both components can exist in the DOM simultaneously but won't visually overlap because the popover is below the SVG and the tooltip is an overlay near the node.

### `buildPreviewDAG.ts` changes

The `config` object from `yaml.load()` is already available. Cast it minimally:

```typescript
import type { PipelineConfig } from '@plusplusoneplusplus/pipeline-core';

// In buildLinearPreview:
return { type: 'linear' as const, data: { nodes }, config: config as PipelineConfig };
```

For the workflow variant, `config` is not a standard `PipelineConfig` (it has `nodes`), so only pass `config` for the `'linear'` type. Update the `PreviewDAGResult` type accordingly:

```typescript
export type PreviewDAGResult =
    | { type: 'linear'; data: DAGChartData; config: PipelineConfig }
    | { type: 'workflow'; data: WorkflowPreviewData }
    | null;
```

## Tests

- **`DAGHoverTooltip.test.tsx`**: Renders input phase tooltip with source type and file path from config. Renders map phase tooltip with prompt snippet (truncated at 100 chars + "…"), model, parallel count, output fields. Renders filter phase tooltip with filter type and rule summary. Renders reduce phase tooltip with reduce type and prompt snippet. Renders job phase tooltip with prompt snippet and model. Returns null / renders nothing when config section for the phase is missing. Shows on mouseEnter, hides on mouseLeave of the `<g>` element.
- **Update `PipelineDAGChart.test.tsx`**: Add tests verifying hover tooltip appears when `pipelineConfig` is provided and a node is hovered, does not appear when `pipelineConfig` is absent, and disappears when selectedPhase is set (click takes precedence).
- **Update `DAGNode.test.tsx`**: Add test verifying `onMouseEnter` and `onMouseLeave` callbacks fire with the correct phase.

## Acceptance Criteria

- [ ] Hovering a DAG node shows a styled HTML tooltip near the node with phase-specific config details
- [ ] Tooltip dismisses on mouse leave with ~150ms delay (allows moving cursor to tooltip)
- [ ] Hovering the tooltip itself keeps it visible
- [ ] Input tooltip shows source type, file path, item count/limit when available
- [ ] Input tooltip shows a mini data preview (first 3 rows as compact key-value grid) when inline items are present
- [ ] Filter tooltip shows filter type, rule summary or AI prompt snippet
- [ ] Map tooltip shows prompt snippet (≤100 chars), model, parallel, output fields, batch size
- [ ] Reduce tooltip shows reduce type, prompt snippet, model
- [ ] Job tooltip shows prompt snippet, model, output fields
- [ ] Missing config sections gracefully handled (minimal fallback or no tooltip)
- [ ] Click-triggered `PipelinePhasePopover` still works; clicking a node dismisses hover tooltip
- [ ] Dark mode supported (matches existing Tailwind color tokens)
- [ ] `DAGHoverTooltip.test.tsx` passes with per-phase content assertions
- [ ] Updated `PipelineDAGChart.test.tsx` passes with hover interaction tests
- [ ] Updated `DAGNode.test.tsx` passes with mouse event callback tests
- [ ] `npm run build` succeeds
- [ ] Existing tests (`npm run test:run` in packages/coc) continue to pass

## Dependencies

- Depends on: None (parallel with commit 001)

## Assumed Prior State

Commit 001 adds visual context layer (legend, breadcrumb, parallel indicator) but doesn't affect tooltip system, data piping, or `DAGNode` mouse events. The two commits can be developed and merged independently.
