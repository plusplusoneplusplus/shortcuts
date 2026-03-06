# Fix Pipeline DAG Preview Display Issues

## Problem

The Pipeline Flow Preview on the pipeline detail page (`/repos/.../pipelines/simple-map-reduce`) has several display issues visible in the screenshot:

1. **Content overflows container** — The SVG auto-scales nodes to fill full container width, making them very large (~230px wide on screen). Combined with `maxHeight: 200px` and `overflow: hidden`, the Reduce node is clipped on the right and content is cut off at the bottom.
2. **No initial fit-to-view** — The `useZoomPan` hook initializes at `scale: 1, translate: (0,0)`. In preview mode there's no auto-fit on mount, so the user must manually click "Fit to View" (⊞).
3. **Validation errors shown on ALL nodes** — The 1 validation error is unmapped (doesn't match any phase keyword), so `getNodeErrors()` returns it for every node. All 3 nodes show red "!" badges, which is misleading.
4. **Edge annotation text clipped** — The `[category, summary]` badge on the Map→Reduce edge is truncated as "category, summa..." because it falls in the clipped region.
5. **DAGLegend hidden** — The legend rendered after the SVG is completely clipped by `maxHeight: 200`.

## Root Cause Analysis

### Container sizing (`PipelineDAGChart.tsx`)
```tsx
<div style={{ overflow: 'hidden', maxHeight: 200, cursor: ... }}>
    <DAGBreadcrumb />     // ~24px
    <svg className="w-full" viewBox="0 0 520 144" preserveAspectRatio="xMidYMid meet">
        <g transform={svgTransform}>...</g>   // zoom/pan transform
    </svg>
    <ZoomControls />      // absolutely positioned
    <DAGLegend />         // ~20px, clipped
</div>
```

The SVG has no explicit height, so it takes its natural height from `width * (viewBoxH / viewBoxW)`. At ~1000px container width: `1000 * (144/520) ≈ 277px`. Total = ~24 + ~277 + ~20 = ~321px, far exceeding the 200px maxHeight.

### Error mapping (`errorMapping.ts`)
```ts
export function getNodeErrors(phaseErrors: PhaseErrors, phase: PipelinePhase): string[] {
    const specific = phaseErrors.byPhase[phase] ?? [];
    return [...specific, ...phaseErrors.unmapped];  // unmapped → all nodes
}
```

Unmapped errors (those not matching any phase keyword) are intentionally shown on ALL nodes. This is useful for general errors in a running pipeline but misleading in a preview with only 1 generic validation error.

## Proposed Fixes

### 1. Auto-fit on initial render for preview mode
**File:** `PipelineDAGChart.tsx`

Add a `previewMode` prop (or detect from node states being all `waiting`). When true, call `fitToView()` after initial mount via `useEffect`. This scales the content to fit within the 200px container.

### 2. Increase or remove maxHeight for preview
**File:** `PipelineDAGChart.tsx`

Option A: Increase `maxHeight` to `300` to accommodate content + legend.
Option B: Set the SVG to a fixed `height` (e.g., `160px`) and let `preserveAspectRatio` handle scaling, keeping `maxHeight: 200`.
Option C (recommended): Keep `maxHeight: 200` but add explicit SVG `height` style as `100%` of remaining space (after breadcrumb), ensuring the viewBox scales to fit without overflow.

### 3. Don't spread unmapped errors to all nodes in preview
**File:** `errorMapping.ts` or `PipelineDAGChart.tsx`

Option A: In preview/validation mode, show unmapped errors only on the FIRST node.
Option B: Add a separate "general error" indicator outside the DAG (e.g., a banner above the chart).
Option C (recommended): Only spread unmapped errors to all nodes when the pipeline is running. In preview mode (all states = `waiting`), show unmapped errors on the first node only.

### 4. Move DAGLegend outside the overflow container
**File:** `PipelineDAGChart.tsx`

Return the legend as a sibling element outside the overflow-hidden container, or move it into `PipelineDAGPreview.tsx`.

## Implementation Todos

- [x] **auto-fit-preview** — Add `useEffect` to call `fitToView()` on mount when all nodes are in `waiting` state
- [x] **fix-container-height** — Set explicit SVG height to avoid the viewBox aspect-ratio expansion exceeding maxHeight; adjust maxHeight if needed
- [x] **fix-unmapped-errors** — In preview mode, show unmapped validation errors on the first node only (not all nodes)
- [x] **legend-outside-overflow** — Move `<DAGLegend>` outside the `overflow: hidden` container so it's always visible
- [x] **add-tests** — Add/update tests for auto-fit behavior, error mapping in preview mode, and legend visibility

## Key Files

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/processes/dag/PipelineDAGChart.tsx` | Auto-fit on mount, fix SVG height, move legend |
| `packages/coc/src/server/spa/client/react/processes/dag/errorMapping.ts` | Add preview-mode option to `getNodeErrors` |
| `packages/coc/src/server/spa/client/react/repos/PipelineDAGPreview.tsx` | Pass preview flag, render legend outside overflow |
| `packages/coc/src/server/spa/client/react/hooks/useZoomPan.ts` | Possibly add `autoFit` option |
| Tests in `packages/coc/` | Update/add test coverage |
