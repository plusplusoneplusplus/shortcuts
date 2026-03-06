---
status: done
---

# 006: SPA Workflow Detail View with Expandable DAG

## Summary
Create a new `WorkflowDetailView` component with a dedicated hash route (`#repos/:id/workflow/:processId`) that shows the pipeline DAG with an expandable map node. Clicking the map node reveals a grid of individual item cards, each showing status, duration, and a preview.

## Motivation
This is the primary new UI surface. Currently, pipeline runs show only aggregate phase progress in the DAG. The `PipelineResultCard` (`processes/PipelineResultCard.tsx`) renders a header with pipeline name + status badge + duration, a stats grid (Total Items, Successful, Failed, etc.), and a markdown result — but **no per-item drill-down**. Users need to see individual items, especially to identify failures and drill into specific AI conversations. The workflow detail view replaces the inline `PipelineResultCard` for pipeline-type processes by providing a DAG-first layout with an expandable map phase.

## Changes

### Files to Create

#### `packages/coc/src/server/spa/client/react/processes/dag/WorkflowDetailView.tsx`
Main view component for the `#repos/:id/workflow/:processId` route.

- Fetches parent process via `GET /api/processes/:processId` (pattern: `fetch(\`${getApiBase()}/processes/${encodeURIComponent(id)}\`)` — see `useApi.ts` `fetchApi()` helper at `hooks/useApi.ts:8-14`).
- Fetches children via `GET /api/processes/:processId/children` (same fetch pattern).
- Renders `PipelineDAGChart` (imported from `./PipelineDAGChart`, same as `PipelineDAGSection.tsx:2`) with an additional `onMapNodeExpand` callback.
- For live (running) processes: creates an `EventSource` at `/api/processes/${encodeURIComponent(processId)}/stream` (exact pattern from `ProcessDetail.tsx:138`), stores ref in `eventSourceRef`, passes to `usePipelinePhase` hook for live DAG data, and passes to `useItemProcessEvents` for per-item SSE updates.
- Data source selection follows `PipelineDAGSection.tsx:42-44`:
  ```ts
  const dagData = isRunning && liveDagData ? liveDagData : buildDAGData(process);
  ```
- Dark mode: call `detectDarkMode()` inline (check `document.documentElement.classList.contains('dark')` — pattern from `PipelineDAGSection.tsx:14-19`).
- Manages `expandedPhase: PipelinePhase | null` state — when set to `'map'`, renders `MapItemGrid` below the DAG chart.
- Builds `phaseDetails` record following `PipelineDAGSection.tsx:49-105` exactly (input sourceType, filter rulesSummary, map concurrency/model, reduce type/outputPreview).
- Renders caption bar below DAG matching the status icon pattern at `PipelineDAGSection.tsx:121-131` (✅/🔄/❌/🚫).
- Cleanup: close `EventSource` on unmount (pattern from `ProcessDetail.tsx:193-196`).

#### `packages/coc/src/server/spa/client/react/processes/dag/MapItemGrid.tsx`
Grid of item cards shown when the map node is expanded.

- Props: `{ items: ChildProcess[], onItemClick: (processId: string) => void, isLive: boolean }`
- Renders a responsive CSS grid using inline `style` (not Tailwind utilities for grid template — complex grid values aren't available via the utility classes):
  ```ts
  style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}
  ```
- Supports status filtering via a row of filter pills (all / completed / failed / running) styled with the same `className` pattern as the SPA: `"flex items-center gap-2 px-3 py-1 text-sm"` with conditional `cn()` for active state (see `shared/cn.ts:1-3`).
- Shows aggregate stats bar: "28 completed, 2 failed, 0 running" — uses `text-xs text-[#848484]` (pattern from `PipelineDAGSection.tsx:170`).
- Each item rendered as `<MapItemCard>`.

#### `packages/coc/src/server/spa/client/react/processes/dag/MapItemCard.tsx`
Individual item card within the grid.

- Props: `{ process: ChildProcess, onClick: () => void }`
- Renders as a `<div>` (not SVG — this is HTML unlike `DAGNode` which is SVG `<g>`).
- Shows: item index, status icon (reuse `statusIcon()` from `utils/format.ts` — same import as `PipelineDAGSection.tsx:5`), prompt preview (truncated to ~80 chars), duration (via `formatDuration()` from `utils/format.ts` — same import as `PipelineDAGSection.tsx:5`), error badge.
- Running state: uses `className={cn(isRunning && 'animate-pulse')}` — same pulse pattern as `DAGNode.tsx:100`.
- Border and fill colors: follow `getNodeColors()` from `dag-colors.ts` mapped to item status, using inline `style={{ borderColor, backgroundColor }}`.
- Click handler: `onClick={() => onClick()` — triggers parent's `onItemClick` to navigate to process detail.
- Styling uses the SPA's standard pattern: Tailwind-like utility classes for layout (`"flex flex-col gap-1 p-3 rounded-md border cursor-pointer"`) with hardcoded hex colors for theme (`#e0e0e0` light border / `#3c3c3c` dark border — pattern from `PipelineDAGSection.tsx:138-139`).

#### `packages/coc/src/server/spa/client/react/hooks/useItemProcessEvents.ts`
SSE hook for `item-process` events, following the exact pattern of `usePipelinePhase.ts`.

- Signature: `useItemProcessEvents(eventSource: EventSource | null): { items: Map<string, ItemProcessState>, isConnected: boolean }`
- Subscribes to `item-process` named events via `eventSource.addEventListener('item-process', handler)` (same pattern as `usePipelinePhase.ts:116`).
- Maintains `Map<string, ItemProcessState>` via `useState` + ref-callback pattern (same as `usePipelinePhase.ts:50-55` where `setPhasesRef.current = setPhases`).
- Throttles updates at 250ms (same `THROTTLE_MS` as `usePipelinePhase.ts:35`).
- Tracks `disconnected` boolean via `eventSource.addEventListener('error', handleError)` (pattern from `usePipelinePhase.ts:112-114`).
- Merges SSE item updates with REST-fetched children array (caller merges — hook returns the SSE-derived map).
- Cleanup: removes event listeners in `useEffect` return (pattern from `usePipelinePhase.ts:120-128`).
- `ItemProcessState` type: `{ processId: string, itemIndex: number, status: string, promptPreview?: string, durationMs?: number, error?: string, startedAt?: number }`.

### Files to Modify

#### `packages/coc/src/server/spa/client/react/layout/Router.tsx`

**Add hash parser function** (after `parseGitCommitDeepLink` at line 112):
```ts
export function parseWorkflowDeepLink(hash: string): { repoId: string; processId: string } | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] === 'repos' && parts[1] && parts[2] === 'workflow' && parts[3]) {
        return {
            repoId: decodeURIComponent(parts[1]),
            processId: decodeURIComponent(parts[3]),
        };
    }
    return null;
}
```
This follows the exact same pattern as `parsePipelineDeepLink` (lines 78-85), `parseQueueDeepLink` (lines 87-94), `parseChatDeepLink` (lines 96-103), and `parseGitCommitDeepLink` (lines 105-112) — all use `parts[0] === 'repos' && parts[1] && parts[2] === '<subRoute>' && parts[3]`.

**Add deep-link handling** inside the `if (tab === 'repos')` block (after the wiki deep-link block ending at line 217). Insert alongside the other `parts[2] === '...'` handlers:
```ts
// Workflow detail deep-link: #repos/{id}/workflow/{processId}
if (parts[2] === 'workflow' && parts[3]) {
    dispatch({ type: 'SET_WORKFLOW_PROCESS', processId: decodeURIComponent(parts[3]) });
} else if (parts[2] === 'workflow') {
    dispatch({ type: 'SET_WORKFLOW_PROCESS', processId: null });
}
```
Pattern matches the existing chat (lines 184-188), git (lines 190-194), and queue (lines 178-182) deep-link blocks exactly.

**Add `'workflow'` to `VALID_REPO_SUB_TABS`** at line 114:
```ts
export const VALID_REPO_SUB_TABS: Set<string> = new Set([
    'info', 'git', 'pipelines', 'tasks', 'queue', 'schedules', 'chat', 'wiki', 'copilot', 'workflow'
]);
```

**Add import** for `WorkflowDetailView` at top of file (after line 13 imports).

**Note:** The `Router` component (line 116) uses a `switch (state.activeTab)` at line 272. The workflow view is rendered within the `'repos'` case since the route is `#repos/:id/workflow/:processId` — the `ReposView` component will need to conditionally render `WorkflowDetailView` when `state.workflowProcessId` is set.

#### `packages/coc/src/server/spa/client/react/processes/dag/types.ts`

**Add `expandable` field** to `DAGNodeData` (after line 14, before the closing `}`):
```ts
/** When true, this node can be clicked to expand a detail sub-view (e.g., item grid). */
expandable?: boolean;
```

**Add `ChildProcessSummary` type** (after line 20):
```ts
export interface ChildProcessSummary {
    processId: string;
    itemIndex: number;
    status: string;
    promptPreview?: string;
    durationMs?: number;
    error?: string;
    startedAt?: number;
}
```

**Add `MapItemGridData` type** for the grid component:
```ts
export interface MapItemGridData {
    children: ChildProcessSummary[];
    totalCount: number;
    completedCount: number;
    failedCount: number;
    runningCount: number;
}
```

#### `packages/coc/src/server/spa/client/react/processes/dag/PipelineDAGChart.tsx`

**Add `onMapNodeExpand` callback to `PipelineDAGChartProps`** (after `previewMode` at line 35):
```ts
/** Callback when the map node expand/collapse is toggled. */
onMapNodeExpand?: (expanded: boolean) => void;
/** Whether the map node is currently expanded (controlled from parent). */
mapExpanded?: boolean;
```

**Add expand/collapse state handling** in the `handleNodeClick` function (around line 61). When the clicked node has `expandable: true`, call `onMapNodeExpand`:
```ts
const handleNodeClick = (phase: PipelinePhase) => {
    setSelectedPhase(prev => prev === phase ? null : phase);
    setHoveredPhase(null);
    setHoverAnchor(null);
    if (leaveTimerRef.current) { clearTimeout(leaveTimerRef.current); leaveTimerRef.current = null; }
    // Toggle map node expansion
    const clickedNode = data.nodes.find(n => n.phase === phase);
    if (clickedNode?.expandable && onMapNodeExpand) {
        onMapNodeExpand(!mapExpanded);
    }
    onNodeClick?.(phase);
};
```

**Add expand indicator to map node** in the SVG node rendering section (around line 207). Pass `expandable` info through to `DAGNode` — no additional rendering needed here since `DAGNode` handles the visual indicator (see below).

#### `packages/coc/src/server/spa/client/react/processes/dag/DAGNode.tsx`

**Add `expandable` and `expanded` props** to `DAGNodeProps` (after `totalDurationMs` at line 23):
```ts
/** Whether this node supports expand/collapse (shows chevron indicator). */
expandable?: boolean;
/** Whether this node is currently expanded. */
expanded?: boolean;
```

**Add expand/collapse chevron SVG** inside the `<g>` element (after the validation errors pin at line 182, before the duration overlay at line 183). This renders a small chevron icon in the bottom-right corner of the node:
```tsx
{expandable && (
    <text
        data-testid={`dag-node-expand-${node.phase}`}
        x={x + 110}
        y={y + 64}
        textAnchor="middle"
        fill={colors.text}
        fontSize={10}
        fontFamily="system-ui, sans-serif"
        style={{ cursor: 'pointer' }}
    >
        {expanded ? '▴' : '▾'}
    </text>
)}
```

**Visual distinction for expandable nodes**: Add a subtle dashed bottom border by rendering an additional `<line>` element below the main rect when `expandable` is true:
```tsx
{expandable && (
    <line
        x1={x + 20} y1={y + 70}
        x2={x + 100} y2={y + 70}
        stroke={colors.border}
        strokeWidth={1}
        strokeDasharray="3 2"
        opacity={0.5}
    />
)}
```

#### `packages/coc/src/server/spa/client/react/processes/dag/buildDAGData.ts`

**Mark the map node as expandable** in `buildDAGData` (around line 121, inside the `if (phase === 'map' && stats)` block):
```ts
if (phase === 'map' && stats) {
    node.expandable = true; // <-- add this line
    // ... existing totalItems, itemCount, failedItems, durationMs assignments
}
```

**Mark the map node as expandable in `buildDAGDataFromLive`** (around line 213, inside the map/job progress block):
```ts
if (progress && (phase === 'map' || phase === 'job') && state === 'running') {
    node.expandable = phase === 'map'; // <-- add this line
    // ... existing assignments
}
```

### Files to Update (barrel exports)

#### `packages/coc/src/server/spa/client/react/processes/dag/index.ts`
Add exports for the new components:
```ts
export { WorkflowDetailView } from './WorkflowDetailView';
export { MapItemGrid } from './MapItemGrid';
export { MapItemCard } from './MapItemCard';
```

## Implementation Notes

### Routing Architecture
The SPA uses hash-based routing parsed in `Router.tsx`. The `Router` function (line 116) reads `state.activeTab` from `AppContext` and renders the top-level view via a `switch` statement (lines 272-290). The hash is parsed on `hashchange` events (line 236) and initial load (line 235). Deep-links within the repos tab are handled by parsing `parts[2]` of the hash (e.g., `pipelines` at line 170, `queue` at line 178, `chat` at line 184, `git` at line 190, `wiki` at line 196). The workflow route follows this same pattern.

The `WorkflowDetailView` should be rendered by the `ReposView` component when `state.workflowProcessId` is non-null. This requires adding a `SET_WORKFLOW_PROCESS` action to the `AppContext` reducer (alongside the existing `SET_SELECTED_CHAT_SESSION`, `SET_GIT_COMMIT_HASH` pattern).

### Component Conventions
- **Functional components** with named exports (all files follow this — no default exports).
- **Styling**: Tailwind-like utility classes for layout (`flex`, `items-center`, `gap-2`, `px-4`, `py-3`) combined with hardcoded hex color values via bracket notation (`text-[#848484]`, `border-[#e0e0e0]`, `dark:border-[#3c3c3c]`). Complex styles use inline `style` objects. The `cn()` utility from `shared/cn.ts` is used for conditional classes.
- **Dark mode**: Inline `dark:` prefixed classes (Tailwind convention). Components check `isDark` boolean prop for dynamic SVG coloring. `detectDarkMode()` reads `document.documentElement.classList.contains('dark')`.
- **SVG for DAG nodes** (`DAGNode.tsx` renders `<g>` with `<rect>`, `<text>`), **HTML divs for non-graph UI**.
- **Data attributes**: `data-testid` on key elements (e.g., `dag-chart-container`, `dag-node-${phase}`, `dag-section-header`).

### Fetch Conventions
- API calls use `fetch()` with the `getApiBase()` helper from `hooks/useApi.ts`.
- Process endpoints: `GET /api/processes/:id` returns `{ process }`, `GET /api/processes/:id/children` returns children array.
- SSE: `new EventSource(\`/api/processes/${encodeURIComponent(id)}/stream\`)` — no credentials header needed (same-origin).
- Error handling: check `response.ok`, parse error body on failure.

### SSE Integration
- Live DAG: reuse `usePipelinePhase` hook (subscribes to `pipeline-phase` and `pipeline-progress` events on the EventSource) — returns `{ dagData, phases, progress, disconnected }`.
- Live items: new `useItemProcessEvents` hook subscribes to `item-process` events on the **same** EventSource instance. Both hooks share the EventSource ref.
- Data merging: On mount, fetch children via REST. As SSE `item-process` events arrive, merge into the items map (SSE updates override REST snapshot for matching processIds).

### Map Node Expansion
- The `PipelineDAGChart` already renders in a `<div>` container (`ref={mergedRef}` at line 158) with `overflow: hidden` and `maxHeight: 300` (line 159).
- When map is expanded, the parent `WorkflowDetailView` renders the `MapItemGrid` **below** the `PipelineDAGChart` — not inside the SVG. This avoids SVG complexity and allows normal HTML grid layout.
- CSS transition on grid container: `style={{ transition: 'max-height 300ms ease', maxHeight: expanded ? '2000px' : '0', overflow: 'hidden' }}`.

### Mobile Responsiveness
- Grid uses `auto-fill, minmax(200px, 1fr)` — naturally collapses to single column on narrow viewports.
- No separate mobile detection needed — CSS Grid handles the responsive layout.

### Node Dimensions
- `NODE_W = 120`, `NODE_H = 70`, `GAP_X = 60`, `PADDING = 20` (from `PipelineDAGChart.tsx:38-41`).
- DAG chart `viewBox` is computed as `2 * PADDING + nodeCount * NODE_W + (nodeCount - 1) * GAP_X` wide (line 127).
- The expand chevron is placed at `(x + 110, y + 64)` to sit inside the node's bottom-right area.

## Tests
- **Component test: WorkflowDetailView renders DAG with correct phases** — mock fetch for parent process + children, assert `dag-chart-container` testid present, verify node count matches pipeline phases.
- **Component test: clicking map node toggles MapItemGrid visibility** — render `WorkflowDetailView`, find `dag-node-map` testid, simulate click, assert grid container appears/disappears.
- **Component test: MapItemGrid renders correct number of cards from children API** — pass mock children array, assert `.map-item-card` count matches.
- **Component test: MapItemCard shows status, preview, duration correctly** — pass mock process, assert status icon, truncated text, formatted duration present.
- **Component test: useItemProcessEvents hook updates items from SSE events** — create mock EventSource, emit `item-process` events, assert returned map updates.
- **Integration test: hash navigation to `#repos/:id/workflow/:processId` renders the view** — set `location.hash`, trigger hashchange, assert `WorkflowDetailView` renders.

All tests should use the existing Vitest setup (`npm run test:run` in `packages/coc/`) and follow existing test patterns in the `packages/coc/src/server/spa/` test files.

## Acceptance Criteria
- [ ] New route `#repos/:id/workflow/:processId` renders WorkflowDetailView
- [ ] DAG chart shows pipeline phases with expandable map node (chevron indicator)
- [ ] Clicking map node reveals item grid with individual cards
- [ ] Item cards show status icon, prompt preview, duration, error badge
- [ ] Live runs update via SSE (`item-process` events — items appear as they start/complete)
- [ ] Completed runs load children from REST API (`GET /api/processes/:id/children`)
- [ ] Responsive layout (desktop multi-column grid → mobile single column via CSS Grid auto-fill)
- [ ] Tests pass on Linux, macOS, Windows (`npm run test:run` in `packages/coc/`)

## Dependencies
- Depends on: 004 (child processes API), 005 (item-process SSE events)

## Assumed Prior State
- REST API: `GET /api/processes/:id/children` returns child processes (Commit 4)
- SSE: `item-process` events stream per-item status (Commit 5)
- Types: `DAGNodeData`, `DAGChartData` exist at `processes/dag/types.ts` with current shapes (lines 5-20)
- `PipelineDAGChart` accepts `DAGChartData` and renders SVG nodes/edges (lines 50-280)
- `usePipelinePhase` hook subscribes to SSE and returns `{ dagData, phases, progress, disconnected }` (lines 37-137)
- `buildDAGData` constructs `DAGChartData` from process metadata (lines 77-147)
- `AppContext` reducer handles `SELECT_PROCESS`, `SET_REPO_SUB_TAB`, and similar dispatch actions
