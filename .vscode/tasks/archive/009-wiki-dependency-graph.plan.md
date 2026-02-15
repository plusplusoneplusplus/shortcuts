---
status: done
---

# 009: Port Dependency Graph Visualization to Wiki Tab

## Summary
Port the D3.js-based interactive dependency graph from deep-wiki into the CoC Wiki tab, with lazy-loading of D3 library.

## Motivation
The dependency graph provides a visual overview of component relationships, helping users navigate large codebases.

## Changes

### Files to Create
- `packages/coc/src/server/spa/client/wiki-graph.ts` — D3 graph visualization

### Files to Modify
- `packages/coc/src/server/spa/client/wiki.ts` — Add graph toggle button, graph container
- SPA HTML template — Add D3 CDN script (lazy-loaded)
- Wiki CSS — Graph container styles, node/edge styling

### Files to Delete
- (none)

## Implementation Notes

### D3 Features Used
The graph uses **D3 v7** loaded from CDN (`https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js`). It is declared as a global (`declare const d3: any`) — not imported as an ES module. The following D3 APIs are exercised:

1. **Force Simulation** (`d3.forceSimulation`) — the core layout engine with four forces:
   - `d3.forceLink(links).id(d => d.id).distance(100)` — link force with 100px target distance
   - `d3.forceManyBody().strength(-300)` — repulsion between nodes
   - `d3.forceCenter(width/2, height/2)` — centering gravity
   - `d3.forceCollide().radius(d => radius + 8)` — collision avoidance sized per node complexity
2. **Zoom** (`d3.zoom`) — pan/zoom on the SVG with `scaleExtent([0.1, 4])`; toolbar buttons call `zoom.scaleBy` and `zoom.transform(d3.zoomIdentity)` for reset
3. **Drag** (`d3.drag`) — three-handler pattern: `dragstarted` pins node (`d.fx/fy`), `dragged` moves it, `dragended` unpins and cools simulation
4. **Selections** — `d3.select`, `.selectAll`, `.data().join()`, `.append`, `.attr`, `.style`, `.on`, `.call`, `.transition`
5. **SVG Markers** — `<defs><marker id="arrowhead">` for directed edge arrows

### How Nodes and Edges Are Derived from ComponentGraph
- **Nodes**: Mapped 1:1 from `componentGraph.components[]`, extracting `{ id, name, category, complexity, path, purpose }`.
- **Edges**: Built by iterating each component's `dependencies[]` array; only links where both source and target exist in the node set are included (`nodeIds` guard).
- **Node radius** varies by complexity: `{ low: 8, medium: 12, high: 18 }` (constant `COMPLEXITY_RADIUS`).
- **Node color** is determined by category index into a 10-color palette (`CATEGORY_COLORS`).

### Graph Layout Algorithm
D3's force-directed simulation runs iteratively. On each `tick`, link endpoints (`x1,y1,x2,y2`) and node positions (`translate(x,y)`) are updated. The simulation cools automatically (`alphaTarget(0)`) but is reheated on drag (`alphaTarget(0.3).restart()`).

### Interactive Behaviors
- **Click node** → calls `window.loadComponent(d.id)` to navigate to that component's article, resetting `article` element's `maxWidth`/`padding` overrides.
- **Hover** → tooltip div positioned at cursor showing component name, purpose, and complexity.
- **Legend click** → toggles category visibility via `disabledCategories` Set; `updateGraphVisibility()` sets `display: none` on filtered nodes and any links where either endpoint belongs to a disabled category.
- **Zoom toolbar** — +/−/Reset buttons wired to `svg.transition().call(zoom.scaleBy, ...)` and `zoom.transform(d3.zoomIdentity)`.

### Lazy-Loading D3
In deep-wiki, D3 is conditionally included as a `<script>` tag in the HTML template when `enableGraph` is true, and `renderGraph()` guards with `if (typeof d3 === 'undefined') return`. For the CoC Wiki tab:

1. Do **not** include D3 in the initial HTML payload.
2. When the user first clicks the "Dependency Graph" button, dynamically inject a `<script>` element for the D3 CDN URL.
3. Listen for the script's `onload` event, then call `renderGraph()`.
4. On subsequent toggles, skip loading (D3 is already present) and re-render directly.
5. Guard `renderGraph()` with `if (typeof d3 === 'undefined') return` as a safety fallback.

### Container Sizing and Responsiveness
- The graph container is absolutely positioned inside the article area, with `width: 100%; height: 100%`.
- Height is computed dynamically: `article.parentElement.parentElement.clientHeight - 48` pixels.
- The SVG fills the container (`width`/`height` attributes set from `container.clientWidth`/`clientHeight`).
- Zoom/pan makes the graph explorable regardless of viewport size.
- The toolbar (top-right) and legend (bottom-left) are absolutely positioned with `z-index: 10`.
- The tooltip follows the mouse (`position: absolute`, repositioned on `mousemove` via `event.pageX/Y`).

### CSS to Port
All graph styles (`.graph-container` through `.graph-tooltip-purpose`, ~60 lines from deep-wiki `styles.css` lines 710–768) should be added to the CoC Wiki CSS. They rely on CSS custom properties (`--card-bg`, `--content-border`, `--content-text`, `--content-muted`, `--code-bg`) which must be mapped to the CoC theme variable equivalents.

## Tests
- Test graph renders with sample component graph
- Test node click navigates to component
- Test zoom/pan controls
- Test D3 lazy-loading (script injection on first show, no duplicate loads)
- Test graph updates when wiki changes
- Test category legend toggle hides/shows nodes and their edges
- Test tooltip displays component name, purpose, and complexity on hover

## Acceptance Criteria
- [x] Interactive dependency graph renders in Wiki tab
- [x] Nodes represent components, edges represent dependencies
- [x] Node size reflects complexity (low=8, medium=12, high=18 radius)
- [x] Node color reflects category (10-color palette)
- [x] Click node navigates to component detail
- [x] Hover shows tooltip with name, purpose, complexity
- [x] Category legend toggles node/edge visibility
- [x] D3 lazy-loaded only when graph first shown (CDN script injected on demand)
- [x] Zoom (+/−/Reset toolbar) and pan work correctly
- [x] Drag repositions nodes with force simulation reheat
- [x] Graph works in both dark and light themes (uses CSS custom properties)
- [x] CoC build succeeds

## Dependencies
- Depends on: 006 (Wiki tab scaffold with graph container)
