# Fix: Pipeline Preview Tooltip Appears on Left Side

## Problem

When hovering over a node (e.g., the Input node) in the Pipeline Flow Preview, the tooltip card
appears on the far-left of the container rather than above the hovered node.

**Screenshot evidence:** The "Input Phase" tooltip floats to the top-left while the Input node is
visually centered-right in the panel.

---

## Root Cause

`handleNodeMouseEnter` in `PipelineDAGChart.tsx` computes the tooltip anchor as:

```js
const scaleX = svgRect.width / totalWidth;
const scaleY = svgRect.height / totalHeight;
x: offsetX + (nodeX + NODE_W / 2) * scaleX,
y: offsetY + nodeY * scaleY,
```

This calculation has two compounding errors:

### Error 1 — Ignored `preserveAspectRatio="xMidYMid meet"` centering offset
The SVG uses `xMidYMid meet`, which applies a *uniform* scale equal to
`min(svgRect.width/totalWidth, svgRect.height/totalHeight)` and then **centers** the content.
In preview mode the SVG element height is capped at `140px` via `maxHeight`, while
`totalHeight = 2*PADDING + NODE_H + 34 = 144px`, so the height constrains the scale to ≈ 0.972×.
The resulting horizontal centering offset can be **100+ px** on a wide panel — and the current
code ignores it entirely, shifting the calculated anchor far to the left of the actual node.

`scaleX = svgRect.width / totalWidth` overshoots the real scale because it divides by the full
viewBox width instead of using the height-constrained uniform scale.

### Error 2 — Ignored zoom/pan transform (`zoomState`)
`fitToView()` is automatically called in preview mode (see the `useEffect` in the chart). It
sets `zoomState.translateX`, `zoomState.translateY`, and `zoomState.scale` and applies them as
`<g transform="translate(tx, ty) scale(s)">` inside the SVG. The anchor calculation never reads
`zoomState`, so it acts as if no zoom/pan transform is in effect.

---

## Proposed Fix

### Approach — use mouse coordinates directly

Change `DAGNode.onMouseEnter` to forward the native `MouseEvent`, then compute the anchor from
`event.clientX / clientY` relative to the container. This is immune to all transform stacking
issues because the browser has already resolved all CSS and SVG transforms.

**Files to change:**

1. **`DAGNode.tsx`**
   - Change `onMouseEnter?: (phase: PipelinePhase) => void` to
     `onMouseEnter?: (phase: PipelinePhase, e: React.MouseEvent) => void`
   - Forward the native event from the `<g>` element's `onMouseEnter` handler.

2. **`PipelineDAGChart.tsx`**
   - Update `handleNodeMouseEnter(phase: PipelinePhase, e: React.MouseEvent)` signature.
   - Replace the `svgRect / totalWidth` math with:
     ```ts
     const containerRect = containerRef.current.getBoundingClientRect();
     setHoverAnchor({
         x: e.clientX - containerRect.left,
         y: e.clientY - containerRect.top,
     });
     ```
   - Remove the now-unused `svgRef` reads inside this handler (the `svgRef` can stay for other
     uses, but the position math block is removed).

3. **`DAGHoverTooltip.tsx`** *(no position logic change needed)*
   - The existing `transform: 'translate(-50%, -100%)'` with `marginTop: -8` already places the
     tooltip centered above the cursor. No change required.

---

## Affected Files

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/processes/dag/DAGNode.tsx` | Extend `onMouseEnter` callback signature to include `React.MouseEvent` |
| `packages/coc/src/server/spa/client/react/processes/dag/PipelineDAGChart.tsx` | Replace SVG-math anchor calc with mouse-relative coordinates |
| `packages/coc/src/server/spa/client/react/processes/dag/DAGHoverTooltip.tsx` | No change needed |

---

## Tests to Update

- `packages/coc/test/spa/react/dag/DAGNode.test.tsx` — update `onMouseEnter` mock signature if
  tested explicitly.
- `packages/coc/test/spa/react/dag/PipelineDAGChart.test.tsx` — update any test that simulates
  `mouseEnter` on a node and asserts the resulting anchor coordinates.

---

## Out of Scope

- The `useZoomPan.fitToView` mixes screen-pixel coordinates with SVG-unit transforms; this is a
  separate potential issue and should not be addressed here.
- No changes to tooltip content or styling.
