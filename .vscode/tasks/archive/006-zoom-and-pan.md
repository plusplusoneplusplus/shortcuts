---
status: pending
---

# 006: Zoom and Pan

## Summary

Add zoom and pan controls to `PipelineDAGChart` and `WorkflowDAGChart` SVG diagrams so users can navigate complex pipeline visualizations. Implemented via a reusable `useZoomPan` React hook that manages scale/translate state, cursor-centered wheel zoom, click-drag panning, and a floating control bar (＋, −, Reset).

## Motivation

Pipeline DAGs can grow large — a 20-step linear pipeline or a 30-node workflow DAG overflows the viewport. Without zoom/pan, users cannot inspect dense graphs. The existing Mermaid preview in the VS Code extension already has zoom/pan (via `useMermaid.ts` `setupZoomPan()`), but it's imperative DOM code. The SPA needs a React-idiomatic equivalent.

## Changes

### Files to Create

#### `packages/coc/src/server/spa/client/react/hooks/useZoomPan.ts`

Reusable hook encapsulating all zoom/pan state and event wiring.

**Constants:**
```ts
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.15;       // finer than Mermaid's 0.25 for smoother scroll
const ZOOM_BTN_STEP = 0.25;   // coarser for button clicks
```

**Interface — hook options:**
```ts
export interface UseZoomPanOptions {
    /** Minimum allowed scale. Default: 0.25 */
    minZoom?: number;
    /** Maximum allowed scale. Default: 3 */
    maxZoom?: number;
    /** Whether wheel zoom requires Ctrl/Cmd held. Default: false (bare wheel zooms). */
    requireModifierKey?: boolean;
    /** Intrinsic content width (for fit-to-view calculation). */
    contentWidth: number;
    /** Intrinsic content height (for fit-to-view calculation). */
    contentHeight: number;
}
```

**Interface — hook return value:**
```ts
export interface ZoomPanState {
    /** Current zoom scale (1 = 100%). */
    scale: number;
    /** Current horizontal pan offset in px. */
    translateX: number;
    /** Current vertical pan offset in px. */
    translateY: number;
    /** Whether the user is currently dragging. */
    isDragging: boolean;
}

export interface UseZoomPanReturn {
    /** Ref to attach to the outer container `<div>` that receives pointer events. */
    containerRef: React.RefObject<HTMLDivElement>;
    /** Current transform state. */
    state: ZoomPanState;
    /** SVG transform string: `"translate(tx, ty) scale(s)"`. */
    svgTransform: string;
    /** Zoom in by one button step. */
    zoomIn: () => void;
    /** Zoom out by one button step. */
    zoomOut: () => void;
    /** Reset to scale=1, translate=(0,0). */
    reset: () => void;
    /** Auto-fit: calculate scale so all content fits the container. */
    fitToView: () => void;
    /** Formatted zoom percentage string, e.g. `"125%"`. */
    zoomLabel: string;
}
```

**Core implementation logic:**

```ts
export function useZoomPan(options: UseZoomPanOptions): UseZoomPanReturn {
    const {
        minZoom = MIN_ZOOM,
        maxZoom = MAX_ZOOM,
        requireModifierKey = false,
        contentWidth,
        contentHeight,
    } = options;

    const containerRef = useRef<HTMLDivElement>(null);
    const [state, setState] = useState<ZoomPanState>({
        scale: 1, translateX: 0, translateY: 0, isDragging: false,
    });
    // Use refs for drag tracking (avoid re-renders during drag)
    const dragRef = useRef({
        isDragging: false,
        startX: 0, startY: 0,
        lastTX: 0, lastTY: 0,
    });

    const clampScale = useCallback((s: number) =>
        Math.max(minZoom, Math.min(maxZoom, s)), [minZoom, maxZoom]);

    // ---- Wheel zoom (cursor-centered) ----
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const onWheel = (e: WheelEvent) => {
            if (requireModifierKey && !e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            e.stopPropagation();

            setState(prev => {
                const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
                const newScale = clampScale(prev.scale + delta);
                if (newScale === prev.scale) return prev;

                // Zoom toward cursor position
                const rect = el.getBoundingClientRect();
                const mx = e.clientX - rect.left;
                const my = e.clientY - rect.top;
                const px = (mx - prev.translateX) / prev.scale;
                const py = (my - prev.translateY) / prev.scale;

                return {
                    ...prev,
                    scale: newScale,
                    translateX: mx - px * newScale,
                    translateY: my - py * newScale,
                };
            });
        };

        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [clampScale, requireModifierKey]);

    // ---- Mouse drag pan ----
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const onMouseDown = (e: MouseEvent) => {
            if (e.button !== 0) return;
            // Don't start drag if clicking on interactive child (node, button)
            const target = e.target as HTMLElement;
            if (target.closest('button, [data-no-drag]')) return;

            dragRef.current = {
                isDragging: true,
                startX: e.clientX,
                startY: e.clientY,
                lastTX: /* read from state via ref */ 0,
                lastTY: 0,
            };
            // Snapshot current translate at drag start
            setState(prev => {
                dragRef.current.lastTX = prev.translateX;
                dragRef.current.lastTY = prev.translateY;
                return { ...prev, isDragging: true };
            });
            el.style.cursor = 'grabbing';
            e.preventDefault();
        };

        const onMouseMove = (e: MouseEvent) => {
            if (!dragRef.current.isDragging) return;
            const dx = e.clientX - dragRef.current.startX;
            const dy = e.clientY - dragRef.current.startY;
            setState(prev => ({
                ...prev,
                translateX: dragRef.current.lastTX + dx,
                translateY: dragRef.current.lastTY + dy,
            }));
        };

        const onMouseUp = () => {
            if (!dragRef.current.isDragging) return;
            dragRef.current.isDragging = false;
            setState(prev => ({ ...prev, isDragging: false }));
            el.style.cursor = '';
        };

        el.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        return () => {
            el.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
    }, []);

    // ---- Derived values ----
    const svgTransform = `translate(${state.translateX}, ${state.translateY}) scale(${state.scale})`;
    const zoomLabel = `${Math.round(state.scale * 100)}%`;

    // ---- Button handlers ----
    const zoomIn = useCallback(() => {
        setState(prev => ({ ...prev, scale: clampScale(prev.scale + ZOOM_BTN_STEP) }));
    }, [clampScale]);

    const zoomOut = useCallback(() => {
        setState(prev => ({ ...prev, scale: clampScale(prev.scale - ZOOM_BTN_STEP) }));
    }, [clampScale]);

    const reset = useCallback(() => {
        setState({ scale: 1, translateX: 0, translateY: 0, isDragging: false });
    }, []);

    const fitToView = useCallback(() => {
        const el = containerRef.current;
        if (!el || contentWidth <= 0 || contentHeight <= 0) return;
        const rect = el.getBoundingClientRect();
        const scaleX = rect.width / contentWidth;
        const scaleY = rect.height / contentHeight;
        const fitScale = clampScale(Math.min(scaleX, scaleY) * 0.95); // 5% margin
        // Center the content
        const tx = (rect.width - contentWidth * fitScale) / 2;
        const ty = (rect.height - contentHeight * fitScale) / 2;
        setState({ scale: fitScale, translateX: tx, translateY: ty, isDragging: false });
    }, [contentWidth, contentHeight, clampScale]);

    return { containerRef, state, svgTransform, zoomIn, zoomOut, reset, fitToView, zoomLabel };
}
```

**Key design decisions:**
- `requireModifierKey: false` by default (differs from Mermaid which needs Ctrl). Bare wheel is more natural for embedded SVG where the chart is the primary content.
- Drag state tracked in a `useRef` to avoid re-renders on every `mousemove` — only `setState` triggers renders for the actual translate values.
- `fitToView` uses 95% of available space for visual breathing room.
- The hook returns a `containerRef` that the consumer attaches to a wrapper `<div>`, not the `<svg>` itself. This ensures pointer events work even outside the SVG's viewBox.

---

#### `packages/coc/src/server/spa/client/react/processes/dag/ZoomControls.tsx`

Small presentational component for the zoom control buttons.

```tsx
export interface ZoomControlsProps {
    zoomLabel: string;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onReset: () => void;
    onFitToView: () => void;
}

export function ZoomControls({ zoomLabel, onZoomIn, onZoomOut, onReset, onFitToView }: ZoomControlsProps) {
    return (
        <div
            data-no-drag
            data-testid="zoom-controls"
            style={{
                position: 'absolute',
                bottom: 8,
                right: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                background: 'var(--bg-secondary, rgba(0,0,0,0.6))',
                borderRadius: 4,
                padding: '2px 4px',
                fontSize: 11,
                userSelect: 'none',
                zIndex: 10,
            }}
        >
            <button onClick={onZoomOut} title="Zoom out" style={btnStyle}>−</button>
            <span style={{ minWidth: 36, textAlign: 'center', color: 'var(--text-secondary, #aaa)' }}>
                {zoomLabel}
            </span>
            <button onClick={onZoomIn} title="Zoom in" style={btnStyle}>+</button>
            <button onClick={onReset} title="Reset zoom" style={btnStyle}>⟲</button>
            <button onClick={onFitToView} title="Fit to view" style={btnStyle}>⊞</button>
        </div>
    );
}

const btnStyle: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-primary, #ccc)',
    cursor: 'pointer',
    padding: '2px 6px',
    fontSize: 14,
    lineHeight: 1,
};
```

**Why a separate component:** Keeps the chart files clean. Both `PipelineDAGChart` and `WorkflowDAGChart` render `<ZoomControls>` identically. The `data-no-drag` attribute prevents the hook from starting a drag when the user clicks a zoom button.

---

### Files to Modify

#### `packages/coc/src/server/spa/client/react/processes/dag/PipelineDAGChart.tsx`

**Change 1 — Import hook and controls:**
```ts
import { useZoomPan } from '../../hooks/useZoomPan';
import { ZoomControls } from './ZoomControls';
```

**Change 2 — Invoke the hook** (inside the component function, after computing `totalWidth`/`totalHeight`):
```ts
const {
    containerRef: zoomContainerRef,
    svgTransform,
    zoomIn, zoomOut, reset, fitToView,
    zoomLabel,
    state: zoomState,
} = useZoomPan({ contentWidth: totalWidth, contentHeight: totalHeight });
```

**Change 3 — Merge refs.** The component already has `containerRef` for click-outside detection. Merge with `zoomContainerRef` using a callback ref or a small `useMergedRef` helper:
```ts
const mergedRef = useCallback((node: HTMLDivElement | null) => {
    (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    (zoomContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
}, [zoomContainerRef]);
```
Replace `ref={containerRef}` on the outer `<div>` with `ref={mergedRef}`.

**Change 4 — Wrap SVG container with `position: relative`** for the absolutely positioned zoom controls, and add `overflow: hidden` to clip zoomed content:
```tsx
<div ref={mergedRef} data-testid="dag-chart-container"
     style={{ position: 'relative', overflow: 'hidden' }}>
```

**Change 5 — Remove `maxHeight` from `<svg>` style** and instead set it on the container div:
```tsx
// On the container div:
style={{ position: 'relative', overflow: 'hidden', maxHeight: 200 }}
// On the <svg>:
style={{}} // or remove style prop entirely
```
This allows the SVG to render at natural size within the overflow-hidden container, and the transform applies cleanly.

**Change 6 — Add a `<g>` wrapper with the zoom transform inside the `<svg>`:**
```tsx
<svg
    data-testid="dag-chart"
    className="w-full"
    viewBox={`0 0 ${totalWidth} ${totalHeight}`}
    preserveAspectRatio="xMidYMid meet"
>
    <defs>...</defs>
    <g transform={svgTransform}>
        {/* Existing edges */}
        {/* Existing nodes */}
        {/* Existing progress bar */}
    </g>
</svg>
```

**Change 7 — Render `ZoomControls` inside the container div** (after `<svg>`, before the popover):
```tsx
<ZoomControls
    zoomLabel={zoomLabel}
    onZoomIn={zoomIn}
    onZoomOut={zoomOut}
    onReset={reset}
    onFitToView={fitToView}
/>
```

**Change 8 — Set `cursor: grab` on container** when not dragging:
```tsx
style={{
    position: 'relative',
    overflow: 'hidden',
    maxHeight: 200,
    cursor: zoomState.isDragging ? 'grabbing' : 'grab',
}}
```

---

#### `packages/coc/src/server/spa/client/react/repos/WorkflowDAGChart.tsx`

**Change 1 — Import hook and controls:**
```ts
import { useRef, useCallback } from 'react';
import { useZoomPan } from '../hooks/useZoomPan';
import { ZoomControls } from '../processes/dag/ZoomControls';
```

**Change 2 — Invoke the hook:**
```ts
const {
    containerRef,
    svgTransform,
    zoomIn, zoomOut, reset, fitToView,
    zoomLabel,
    state: zoomState,
} = useZoomPan({ contentWidth: totalWidth, contentHeight: totalHeight });
```

**Change 3 — Wrap `<svg>` in a `<div>` container** (currently it renders a bare `<svg>`):
```tsx
<div
    ref={containerRef}
    data-testid="workflow-dag-container"
    style={{
        position: 'relative',
        overflow: 'hidden',
        maxHeight: 300,
        cursor: zoomState.isDragging ? 'grabbing' : 'grab',
    }}
>
    <svg
        data-testid="workflow-dag-chart"
        className="w-full"
        viewBox={`0 0 ${totalWidth} ${totalHeight}`}
        preserveAspectRatio="xMidYMid meet"
    >
        <g transform={svgTransform}>
            {/* edges and nodes */}
        </g>
    </svg>
    <ZoomControls
        zoomLabel={zoomLabel}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onReset={reset}
        onFitToView={fitToView}
    />
</div>
```

**Change 4 — Remove `style={{ maxHeight: 300 }}` from `<svg>`.** The container div now owns the height constraint.

---

#### `packages/coc/src/server/spa/client/react/processes/dag/index.ts`

Add re-export of `ZoomControls`:
```ts
export { ZoomControls } from './ZoomControls';
```

### Files to Delete

None.

## Implementation Notes

### Transform approach: SVG `<g>` transform vs CSS transform

The Mermaid zoom uses CSS `style.transform` on a `<div>` wrapping the rendered SVG. For our React components, applying `transform` on an SVG `<g>` element is cleaner because:
1. The SVG's `viewBox` already defines the coordinate system. A `<g transform>` inside it composes naturally.
2. No need to fight with CSS transform-origin or layout shifts.
3. React's declarative rendering: `<g transform={svgTransform}>` re-renders cleanly.

### Cursor-centered zoom math

Same algorithm as `useMermaid.ts` lines 147-163:
```
mouseX, mouseY = cursor position relative to container
pointX = (mouseX - translateX) / oldScale    // diagram-space coordinate under cursor
pointY = (mouseY - translateY) / oldScale
newTranslateX = mouseX - pointX * newScale   // solve for translate so same point stays under cursor
newTranslateY = mouseY - pointY * newScale
```

### Drag-state performance

The `isDragging` flag and `dragStart*` coordinates live in a `useRef` to avoid triggering React re-renders on every `mousemove`. Only the final `translateX`/`translateY` values flow through `useState` → re-render. This keeps drag smooth even at 60fps mouse events.

However, `setState` is still called on each `mousemove` for the translate values. If this causes jank:
- Option A: Batch updates with `requestAnimationFrame` (only apply the last position per frame).
- Option B: Use imperative DOM writes during drag (like Mermaid does with `svgWrapper.style.transform`) and sync state on `mouseup`.

Start with the direct `setState` approach — React 18 batches state updates automatically so it should be fine for the typical DAG sizes. Add rAF if profiling shows issues.

### Preventing scroll interference

The wheel handler calls `e.preventDefault()` and `e.stopPropagation()`. It's registered with `{ passive: false }` (same as Mermaid). Without `passive: false`, `preventDefault()` is ignored in modern browsers.

### Interaction with existing click handlers

`PipelineDAGChart` has click-to-select-node behavior. The drag handler must not interfere:
- `mousedown` on a node → `DAGNode.onClick` fires, but the drag handler also fires. Solution: add a small dead zone (e.g., 3px threshold) before treating as a drag. Alternatively, check if the target is inside a `<DAGNode>` group and skip drag initiation.
- Better approach: Only treat as drag if `mousemove` exceeds a 3px threshold from `dragStart`. If the user lifts before 3px, it's a click (no drag occurred, no translate change). This avoids conflict with `DAGNode` click selection.

**Dead zone implementation (add to hook):**
```ts
const DRAG_THRESHOLD = 3;

// In onMouseMove:
if (!dragRef.current.active) {
    const dx = Math.abs(e.clientX - dragRef.current.startX);
    const dy = Math.abs(e.clientY - dragRef.current.startY);
    if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
    dragRef.current.active = true;
}
```

### Fit-to-view calculation

```ts
fitToView():
    containerRect = containerRef.current.getBoundingClientRect()
    scaleX = containerRect.width / contentWidth
    scaleY = containerRect.height / contentHeight
    fitScale = clamp(min(scaleX, scaleY) * 0.95)   // 95% for margin
    tx = (containerRect.width - contentWidth * fitScale) / 2
    ty = (containerRect.height - contentHeight * fitScale) / 2
```

`contentWidth` and `contentHeight` are the computed SVG dimensions (the `totalWidth`/`totalHeight` variables already calculated in each chart). They're passed to the hook as options.

### Style considerations

- `overflow: hidden` on the container clips the SVG when panned/zoomed.
- `cursor: grab` / `cursor: grabbing` provides visual feedback.
- The `ZoomControls` are absolutely positioned bottom-right with semi-transparent background so they float over the chart without obscuring it.
- Use `user-select: none` on the container during drag to prevent text selection.

## Tests

### Unit tests: `packages/coc/src/server/spa/client/react/hooks/__tests__/useZoomPan.test.ts`

Test the hook in isolation using `@testing-library/react` `renderHook`:

1. **Initial state** — scale=1, translateX=0, translateY=0, isDragging=false.
2. **zoomIn()** — scale increases by ZOOM_BTN_STEP, capped at maxZoom.
3. **zoomOut()** — scale decreases by ZOOM_BTN_STEP, capped at minZoom.
4. **reset()** — returns to scale=1, translate=0,0.
5. **fitToView()** — given known contentWidth/contentHeight and mocked container rect, verify scale and translate center the content.
6. **svgTransform** — string matches `"translate(tx, ty) scale(s)"` format.
7. **zoomLabel** — correct percentage string (e.g., `"100%"`, `"125%"`).
8. **Clamp bounds** — repeated zoomIn never exceeds maxZoom; repeated zoomOut never goes below minZoom.

### Component tests: `packages/coc/src/server/spa/client/react/processes/dag/__tests__/ZoomControls.test.tsx`

1. **Renders all buttons** — +, −, ⟲, ⊞ buttons present.
2. **Displays zoom label** — shows the passed `zoomLabel` text.
3. **Button click callbacks** — each button fires the correct callback.
4. **data-no-drag attribute** — container has `data-no-drag` to prevent drag initiation.

### Integration tests: update existing chart tests

#### `PipelineDAGChart` tests

5. **Renders zoom controls** — `ZoomControls` appears within the chart container.
6. **SVG has transform group** — the `<g>` with `transform` attribute exists wrapping all content.
7. **Initial transform** — `transform="translate(0, 0) scale(1)"`.
8. **Zoom in button updates transform** — click + and verify scale increased in the transform string.

#### `WorkflowDAGChart` tests

9. **Renders zoom controls** — `ZoomControls` appears within the new container div.
10. **SVG has transform group** — the `<g>` with `transform` attribute exists.
11. **Container has overflow hidden** — style check on wrapper div.

### Tests NOT needed

- Actual wheel event simulation (JSDOM lacks `getBoundingClientRect` fidelity; test the math in the hook unit tests instead).
- Touch events (not in scope for v1).

## Acceptance Criteria

- [ ] Mouse wheel over either chart zooms in/out centered on cursor position
- [ ] Click-and-drag pans the diagram in both charts
- [ ] Zoom control buttons (+, −, Reset, Fit) are visible in the bottom-right corner
- [ ] Zoom level display shows current percentage (e.g., "150%")
- [ ] Zoom is clamped between 0.25x (25%) and 3x (300%)
- [ ] Reset button returns to scale=1, translate=0,0
- [ ] Fit-to-view auto-calculates scale to fit all nodes in viewport with margin
- [ ] Clicking nodes in `PipelineDAGChart` still works (drag dead zone prevents click interference)
- [ ] The popover in `PipelineDAGChart` still renders correctly over the zoomed content
- [ ] `WorkflowDAGChart` (previously had no interactivity) now supports zoom/pan
- [ ] No scroll hijacking: wheel zoom only activates over the chart container
- [ ] `useZoomPan` hook is generic and reusable for future SVG views
- [ ] All new and existing DAG-related tests pass

## Dependencies

- Depends on: None (can be developed independently of commits 001-005)

## Assumed Prior State

All prior commits (001-005) have modified `PipelineDAGChart.tsx` and `WorkflowDAGChart.tsx` with additional visual elements (legend, breadcrumbs, tooltips, edge labels, error pins, execution overlays). The zoom/pan `<g transform>` wraps **all** existing SVG content, so it applies universally to whatever elements prior commits added. Integration is straightforward — just ensure the `<g transform={svgTransform}>` wraps the outermost content group.

The `PipelineDAGChart` already has a `containerRef` on its wrapper `<div>`, which must be merged with the hook's `containerRef`. The `WorkflowDAGChart` currently renders a bare `<svg>` with no wrapper `<div>` — this commit adds one.
