---
status: pending
---

# 005: Execution Feedback Enhancements

## Summary

Two visual enhancements to the Pipeline Flow DAG chart: (1) prominent phase duration overlay on completed nodes with proportional border thickness, and (2) animated SVG dot particles travelling along edges during live execution. Both features improve at-a-glance understanding of pipeline performance and activity.

## Motivation

Currently, phase duration is displayed as small gray text inside the node body alongside item counts — easy to miss. There is no visual indicator of *relative* cost across phases. During execution, active edges use `strokeDasharray` with a CSS `dag-edge-dash` animation, which communicates directionality but not throughput or data flow volume. These enhancements make the DAG chart a richer real-time and post-mortem feedback tool.

## Changes

### Files to Create

#### `packages/coc/src/server/spa/client/react/processes/dag/DAGEdgeParticles.tsx`

New component rendering animated dot particles along an edge path during active execution.

```tsx
export interface DAGEdgeParticlesProps {
    pathD: string;           // SVG path d-attribute (same path as the edge line)
    color: string;           // particle fill color (matches edge active color)
    particleCount: number;   // number of simultaneous particles (1–5, derived from throughput)
    durationMs: number;      // time for one particle to traverse the full path (speed)
}
```

**Implementation details:**

- Render a `<g>` containing `particleCount` `<circle>` elements, each with radius 3.
- Each `<circle>` contains an `<animateMotion>` child:
  - `path` attribute = the edge's `d` attribute (straight line `M x1 y1 L x2 y2`).
  - `dur` = `${durationMs}ms` (e.g., `"1200ms"` for moderate throughput).
  - `repeatCount` = `"indefinite"`.
  - `begin` = staggered: `${(i / particleCount) * durationMs}ms` so particles are evenly spaced.
- Particles have `opacity="0.85"` and a subtle `r` oscillation is optional (keep simple for v1).
- Export the component for use in `DAGEdge.tsx`.

#### `packages/coc/src/server/spa/client/react/processes/dag/duration-utils.ts`

Utility functions for duration overlay logic.

```ts
/**
 * Compute the relative weight of a node's duration (0–1) against total pipeline duration.
 * Returns 0 if either value is missing or zero.
 */
export function durationRatio(nodeDurationMs: number | undefined, totalDurationMs: number | undefined): number;

/**
 * Map a ratio (0–1) to a stroke width in the range [1.5, 4.5].
 * 1.5 is the existing default; 4.5 is max for the heaviest phase.
 */
export function ratioToStrokeWidth(ratio: number): number;

/**
 * Map a ratio (0–1) to an interpolated border color that shifts
 * from the base completed green toward a warm amber for heavy phases.
 * Returns a hex color string.
 * Uses linear interpolation between the base color and an accent:
 *   light mode: #16825d → #e8912d
 *   dark mode: #89d185 → #cca700
 */
export function ratioToBorderColor(ratio: number, isDark: boolean): string;

/**
 * Format duration in a compact form suitable for below-node overlay.
 * e.g., "2.3s", "45.1s", "1m 12s", "< 1s"
 * More precise than formatDuration() from utils/format.ts —
 * shows one decimal for sub-60s values.
 */
export function formatPreciseDuration(ms: number): string;

/**
 * Derive particle count (1–5) and animation duration from throughput.
 * throughput = completedItems / elapsedSec. Higher throughput → more particles, faster speed.
 */
export function deriveParticleParams(
    completedItems: number | undefined,
    elapsedMs: number | undefined,
): { particleCount: number; durationMs: number };
```

**`deriveParticleParams` logic:**
- If `completedItems` or `elapsedMs` is missing/zero: return `{ particleCount: 1, durationMs: 1500 }` (slow single dot as a heartbeat).
- Compute `throughput = completedItems / (elapsedMs / 1000)` (items/sec).
- `particleCount = clamp(Math.ceil(throughput / 2), 1, 5)`.
- `durationMs = clamp(2000 / Math.max(throughput, 0.1), 400, 2000)` — faster throughput → shorter traversal time.

### Files to Modify

#### `packages/coc/src/server/spa/client/react/processes/dag/DAGNode.tsx`

**Change 1 — Accept new props for duration overlay:**

Add to `DAGNodeProps`:
```ts
totalDurationMs?: number;  // pipeline total, for computing ratio
```

**Change 2 — Compute proportional stroke width and border color:**

After `const strokeColor = selected ? ...` block (~line 34), add:
```ts
import { durationRatio, ratioToStrokeWidth, ratioToBorderColor, formatPreciseDuration } from './duration-utils';

const ratio = node.state === 'completed' && node.durationMs != null
    ? durationRatio(node.durationMs, totalDurationMs)
    : 0;
const baseStrokeWidth = selected ? 2.5 : 1.5;
const effectiveStrokeWidth = ratio > 0 ? ratioToStrokeWidth(ratio) : baseStrokeWidth;
const effectiveBorderColor = ratio > 0 ? ratioToBorderColor(ratio, isDark) : strokeColor;
```

Apply to the `<rect>`:
- `strokeWidth={effectiveStrokeWidth}` (replacing `selected ? 2.5 : 1.5`).
- `stroke={effectiveBorderColor}` (replacing `strokeColor`).
- When `selected` is true AND ratio > 0, use `Math.max(effectiveStrokeWidth, 2.5)` so selection is still visible.

**Change 3 — Prominent duration text below the node:**

After the existing `durationText` / `elapsedText` rendering (lines 81–105), add a new text element *below* the node rect for completed nodes with duration. This is the "overlay" — rendered outside the node box at `y + NODE_H + 14`:

```tsx
{node.state === 'completed' && node.durationMs != null && (
    <text
        data-testid={`dag-node-duration-overlay-${node.phase}`}
        x={x + 60}
        y={y + 70 + 14}
        textAnchor="middle"
        fill={effectiveBorderColor}
        fontSize={11}
        fontWeight={600}
        fontFamily="system-ui, sans-serif"
    >
        {formatPreciseDuration(node.durationMs)}
    </text>
)}
```

Keep the existing in-node duration text (lines 81–91) as-is for the tooltip baseline; the overlay adds a more prominent external label.

#### `packages/coc/src/server/spa/client/react/processes/dag/DAGEdge.tsx`

**Change 1 — Accept particle-related props:**

Expand `DAGEdgeProps`:
```ts
/** Number of completed items on the source node (for throughput calc). */
completedItems?: number;
/** Elapsed ms since the source node started (for throughput calc). */
elapsedMs?: number;
```

**Change 2 — Render particles for active edges:**

Import `DAGEdgeParticles` and `deriveParticleParams`.

After the existing `<path>` (line 33–41), conditionally render particles:
```tsx
{animated && (() => {
    const { particleCount, durationMs } = deriveParticleParams(completedItems, elapsedMs);
    const pathD = `M ${fromX} ${fromY} L ${toX} ${toY}`;
    return (
        <DAGEdgeParticles
            pathD={pathD}
            color={color}
            particleCount={particleCount}
            durationMs={durationMs}
        />
    );
})()}
```

The existing `dag-edge-dash` CSS animation on the dashed stroke remains (it provides the dashed-line movement). The particles layer on top for a richer effect.

**Change 3 — Assign an `id` to the `<path>` for potential `<mpath>` usage (optional):**

Add a unique `id` prop to the path: `id={pathId}` where `pathId` is derived from `fromX/toX` or passed as a prop. This is only needed if `<animateMotion>` uses `<mpath>` referencing; with inline `path` attribute on `<animateMotion>`, this is not required. Skip for v1.

#### `packages/coc/src/server/spa/client/react/processes/dag/PipelineDAGChart.tsx`

**Change 1 — Pass `totalDurationMs` to each `DAGNode`:**

In the nodes rendering loop (line 119–135), add:
```tsx
totalDurationMs={data.totalDurationMs}
```

**Change 2 — Pass throughput data to `DAGEdge` for particle animation:**

In the edges rendering loop (line 100–116), compute and pass throughput props:
```tsx
const prevElapsedMs = now != null && prev.state === 'running' && prev.startedAt != null
    ? now - prev.startedAt
    : prev.durationMs;
// ...
<DAGEdge
    key={...}
    fromX={...} fromY={...} toX={...} toY={...}
    state={deriveEdgeState(prev.state, node.state)}
    isDark={isDark}
    completedItems={prev.itemCount ?? prev.totalItems}
    elapsedMs={prevElapsedMs}
/>
```

**Change 3 — Increase SVG height to accommodate below-node duration overlay:**

Update `totalHeight` (line 71):
```ts
const totalHeight = 2 * PADDING + NODE_H + 34; // was +20, extra 14 for duration overlay text
```

#### `packages/coc/src/server/spa/client/react/processes/dag/dag-colors.ts`

No changes required. The new `ratioToBorderColor` in `duration-utils.ts` uses its own interpolation, referencing the same color constants for consistency. The existing `lightBorders.completed` (#16825d) and `edgeColors.active` values are used as source-of-truth endpoints.

#### `packages/coc/src/server/spa/client/react/processes/dag/types.ts`

No changes required. `DAGNodeData.durationMs`, `startedAt`, `itemCount`, `totalItems` already exist. `DAGChartData.totalDurationMs` already exists.

### Files to Delete

None.

## Implementation Notes

### Duration Overlay Rendering
- The overlay text is rendered *below* the `<rect>` (at `y + 70 + 14 = y + 84`). This sits in the gap before the progress bar (progress bar is at `y + NODE_H + 4`). Adjust to `y + NODE_H + 16` if it collides with the progress bar on the map node. For the map node specifically, if both a progress bar and duration overlay exist, offset the duration text further: `y + NODE_H + 22`.
- `formatPreciseDuration` differs from `formatDuration`: it shows "2.3s" instead of "2s", and "45.1s" instead of "45s". For ≥60s it falls back to the same "1m 12s" format.

### Particle Animation
- Using `<animateMotion>` with inline `path` attribute (not `<mpath>`) because each edge path is a simple straight line `M x1 y1 L x2 y2`. This avoids needing path element `id` references.
- Staggered `begin` values ensure particles are evenly distributed along the edge. For 3 particles with `dur="1200ms"`, begins are `"0ms"`, `"400ms"`, `"800ms"`.
- Particle `<circle>` elements are only mounted when `animated` is true (edge state is `active`). React unmounts them when the edge transitions to `completed`, stopping animation cleanly.
- The `deriveParticleParams` function is intentionally simple — clamp-based. No easing curves needed for v1.

### SVG Height Adjustment
- `totalHeight` in `PipelineDAGChart` increases by 14px to prevent the duration overlay text from being clipped. The `viewBox` is computed dynamically from this, so no layout breakage.

### Color Interpolation
- `ratioToBorderColor` uses linear RGB interpolation between green (#16825d) and amber (#e8912d) in light mode. This provides a heatmap-like visual: phases that consumed more of the total time get a warmer border.
- The interpolation operates on R, G, B channels independently: `Math.round(r1 + ratio * (r2 - r1))` etc.

## Tests

### New Test File: `packages/coc/test/spa/react/dag/duration-utils.test.ts`

Unit tests for all utility functions:

1. **`durationRatio`**
   - Returns 0 when nodeDuration is undefined
   - Returns 0 when totalDuration is 0
   - Returns correct ratio (e.g., 2000/10000 = 0.2)
   - Clamps to 1 when node > total (shouldn't happen but defensive)

2. **`ratioToStrokeWidth`**
   - Returns 1.5 for ratio 0
   - Returns 4.5 for ratio 1
   - Returns 3.0 for ratio 0.5
   - Returns 1.5 for negative ratios (clamp)

3. **`ratioToBorderColor`**
   - Returns base green (#16825d) for ratio 0 in light mode
   - Returns amber (#e8912d) for ratio 1 in light mode
   - Returns an intermediate hex color for ratio 0.5
   - Returns dark mode equivalents (#89d185 → #cca700)

4. **`formatPreciseDuration`**
   - Returns "< 1s" for ms < 1000
   - Returns "2.3s" for 2300ms
   - Returns "45.1s" for 45100ms
   - Returns "1m 12s" for 72000ms
   - Returns "1h 5m" for 3900000ms

5. **`deriveParticleParams`**
   - Returns `{ particleCount: 1, durationMs: 1500 }` when completedItems is undefined
   - Returns `{ particleCount: 1, durationMs: 1500 }` when elapsedMs is 0
   - Returns higher particleCount for high throughput (e.g., 10 items/sec → 5 particles)
   - Returns lower durationMs for high throughput
   - Clamps particleCount to max 5
   - Clamps durationMs to range [400, 2000]

### New Test File: `packages/coc/test/spa/react/dag/DAGEdgeParticles.test.ts`

1. **Renders correct number of circle elements** — mount with particleCount=3, assert 3 `<circle>` elements.
2. **Each circle has `<animateMotion>` child** — assert animateMotion element with correct `dur` and `path`.
3. **Staggered begin values** — assert begin attributes are evenly spaced: `0ms`, `${dur/3}ms`, `${2*dur/3}ms`.
4. **Uses correct color** — assert fill attribute matches provided color prop.

### Existing Test Updates

#### `packages/coc/test/spa/react/dag/dag-colors.test.ts`
No changes needed — color utility tests are unaffected.

## Acceptance Criteria
- [ ] Completed nodes display a prominent duration label below the node rect (e.g., "2.3s")
- [ ] Node border thickness scales proportionally to phase duration relative to total pipeline time
- [ ] Node border color shifts from green to amber as relative duration increases (heatmap effect)
- [ ] Active edges show animated dot particles moving from source to target node
- [ ] Particle count (1–5) and speed vary with throughput (items/sec) for map/job nodes
- [ ] Particles are only rendered on edges in `active` state and unmount cleanly on transition to `completed`
- [ ] Existing `dag-edge-dash` dashed line animation is preserved alongside particles
- [ ] SVG viewBox height is adjusted so duration overlay text is not clipped
- [ ] Duration overlay does not overlap with the map node's progress bar
- [ ] `duration-utils.ts` has full unit test coverage (ratio, stroke width, color, format, particle params)
- [ ] `DAGEdgeParticles` has unit tests for circle count, animateMotion attributes, and staggered timing
- [ ] All existing DAG tests continue to pass (`npm run test:run` in packages/coc)

## Dependencies
- Depends on: 001 (establishes extended node/edge base components and overall DAG visual structure)

## Assumed Prior State
Commit 001 adds visual context layer. Commits 002-004 add tooltips, edge labels, and error pins. The node/edge base components have been extended with additional visual elements. The current DAGNode already renders `durationMs` as small gray `<text>` inside the node body. The current DAGEdge already uses `strokeDasharray` + `dag-edge-dash` CSS animation for active edges. `DAGChartData.totalDurationMs` and `DAGNodeData.startedAt`/`itemCount` are already populated by `buildDAGData` and `buildDAGDataFromLive`.
