---
status: pending
---

# 004: Static DAG Visualization Components

## Summary

Create the static Pipeline DAG visualization components: an SVG-based directed acyclic graph showing pipeline phases (input → filter → map → reduce) with status-colored nodes, animated edges, and a collapsible section in ProcessDetail. The DAG derives its data from `process.metadata.executionStats` and the `PipelinePhase`/`PipelineProcessMetadata` types introduced in commit 001.

## Motivation

This commit is isolated from the SSE real-time wiring (commit 003) and the animation/live-update logic (commit 005) so it can be reviewed and tested as a purely presentational layer. All components are static — they render a snapshot of pipeline state from process metadata. This separation enables thorough unit testing of layout, colors, and data transformation without event-source mocking.

## Changes

### Files to Create

All under `packages/coc/src/server/spa/client/react/processes/dag/`:

- **`types.ts`** — DAG-specific view types:
  - `DAGNodeState`: union `'waiting' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled'`
  - `DAGNodeData`: `{ phase: PipelinePhase, state: DAGNodeState, label: string, itemCount?: number, totalItems?: number, failedItems?: number, durationMs?: number }`
  - `DAGChartData`: `{ nodes: DAGNodeData[], totalDurationMs?: number }`
  - Import `PipelinePhase` from the types established in commit 001.

- **`dag-colors.ts`** — Status color lookup, aligned with the Badge color palette in `shared/Badge.tsx`:
  - `getNodeColors(state: DAGNodeState, isDark: boolean): { fill: string, border: string, text: string }`
    - Light mode fills: waiting=`#f3f3f3`, running=`#e8f3ff`, completed=`#e6f4ea`, failed=`#fde8e8`, skipped=`#f3f3f3`, cancelled=`#fef3e2`
    - Light mode borders: waiting=`#848484`, running=`#0078d4`, completed=`#16825d`, failed=`#f14c4c`, skipped=`#545454`, cancelled=`#e8912d`
    - Light mode text: reuses border colors (matches Badge's `text-[#0078d4]` etc.)
    - Dark mode: running text=`#3794ff`, completed=`#89d185`, failed=`#f48771`, cancelled=`#cca700` (matching Badge `statusMap` dark variants)
  - `getEdgeColor(state: 'waiting' | 'active' | 'completed' | 'error', isDark: boolean): string`
    - waiting=`#848484`, active=`#0078d4` (dark: `#3794ff`), completed=`#16825d` (dark: `#89d185`), error=`#f14c4c` (dark: `#f48771`)
  - `getNodeIcon(state: DAGNodeState): string` — ⏳ waiting, 🔄 running, ✅ completed, ❌ failed, ⛔ skipped, 🚫 cancelled
  - Pure functions, no React dependency. Fully unit-testable.

- **`DAGNode.tsx`** — Individual phase node rendered as SVG `<g>`:
  - Props: `{ node: DAGNodeData, x: number, y: number, isDark: boolean, onClick?: (phase: PipelinePhase) => void }`
  - 120×70px `<rect>` with `rx="6"` rounded corners, fill/stroke from `getNodeColors`
  - Icon + label `<text>` centered, 12px font, fill from `getNodeColors().text`
  - Optional item count line: `"3/10 items"` or `"10 items"` below label, 10px font, `#848484`
  - Optional duration line: `formatDuration(durationMs)` from `../utils/format`, 10px font, `#848484`
  - `className="animate-pulse"` on the `<rect>` when state is `'running'` (reuses the Tailwind `animate-pulse` already used in Badge.tsx line 12)
  - `<title>` element for native SVG tooltip with phase name + state + duration
  - Click handler calls `onClick?.(node.phase)` — `cursor-pointer` via SVG style when onClick provided
  - `data-testid="dag-node-{phase}"` on the outer `<g>` for test targeting

- **`DAGEdge.tsx`** — Arrow between two nodes rendered as SVG `<g>`:
  - Props: `{ fromX: number, fromY: number, toX: number, toY: number, state: 'waiting' | 'active' | 'completed' | 'error', isDark: boolean }`
  - `<path>` with stroke from `getEdgeColor`, stroke-width 2
  - Style variants:
    - waiting: `stroke-dasharray="6 4"`, grey
    - active: `stroke-dasharray="6 4"` + CSS animation `@keyframes dash { to { stroke-dashoffset: -20; } }` (1s linear infinite), blue
    - completed: solid stroke, green
    - error: `stroke-dasharray="6 4"`, red
  - Arrowhead via SVG `<marker>` with `id="arrowhead-{state}"` and matching fill color
  - `data-testid="dag-edge"` for test targeting

- **`DAGProgressBar.tsx`** — Micro progress bar for map phase node:
  - Props: `{ successCount: number, failedCount: number, totalCount: number, width: number }`
  - SVG `<rect>` elements: 4px height, success portion in `#0078d4`, failed portion in `#f14c4c`, background in `#e0e0e0`
  - Width proportional to `successCount/totalCount` and `failedCount/totalCount`
  - CSS `transition: width 0.3s ease` for smooth updates (prep for commit 005 live updates)
  - Renders nothing if `totalCount === 0`
  - `data-testid="dag-progress-bar"` on wrapper

- **`PipelineDAGChart.tsx`** — SVG container rendering the full DAG:
  - Props: `{ data: DAGChartData, isDark: boolean, onNodeClick?: (phase: PipelinePhase) => void }`
  - Layout constants: `NODE_W = 120`, `NODE_H = 70`, `GAP_X = 60`, `GAP_Y = 20`, `PADDING = 20`
  - Calculates which phases exist from `data.nodes` and their positions:
    - Horizontal layout (default): nodes placed left-to-right, edges connect right-edge to left-edge
    - Omits filter node position gap if no filter phase in data
  - Computes SVG `viewBox` dynamically from node count: `0 0 {totalWidth} {totalHeight}`
  - Renders `<svg>` with `<defs>` for arrowhead markers, then DAGEdge components, then DAGNode components (nodes on top of edges)
  - Integrates `DAGProgressBar` inside the map node position (offset below the node rect)
  - `className="w-full"` + `max-height: 200px` inline style, `preserveAspectRatio="xMidYMid meet"`
  - `data-testid="dag-chart"` on `<svg>`

- **`PipelineDAGSection.tsx`** — Collapsible wrapper section:
  - Props: `{ process: any }` (mirrors PipelineResultCard pattern of `process: any`)
  - Guard: only renders if `process.metadata?.pipelinePhases` or `process.metadata?.executionStats` exists — returns `null` otherwise
  - Uses `useState<boolean>(true)` for collapsed state (starts expanded)
  - Header: clickable `<div>` with `"▾ Pipeline Flow"` / `"▸ Pipeline Flow"` toggle, styled like the existing border-b header pattern:
    ```
    className="flex items-center justify-between px-4 py-2 cursor-pointer
               border-b border-[#e0e0e0] dark:border-[#3c3c3c]
               text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]"
    ```
    (Matches PipelineResultCard header at line 41-42: `px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c]`)
  - Total duration in header right side: `<span className="text-xs text-[#848484]">{formatDuration(totalDurationMs)}</span>` (same pattern as PipelineResultCard line 48)
  - Body: `<PipelineDAGChart>` wrapped in `<div className="px-4 py-3">` (matches PipelineResultCard content padding at line 88)
  - Status caption below DAG: contextual message like `"✅ Pipeline completed in 2m 34s"` or `"🔄 Running..."` — `text-xs text-[#848484]` centered
  - Detects dark mode via `window.matchMedia('(prefers-color-scheme: dark)').matches` or a `useDarkMode` hook if one exists
  - Calls `buildDAGData(process)` to derive `DAGChartData`
  - `data-testid="pipeline-dag-section"` on wrapper

- **`buildDAGData.ts`** — Pure function transforming process metadata to `DAGChartData`:
  - Signature: `buildDAGData(process: any): DAGChartData | null`
  - Returns `null` if no pipeline metadata found
  - Phase detection logic:
    - `input` phase: always present
    - `filter` phase: present only if `executionStats.filterPhaseTimeMs != null` or `pipelinePhases` includes a filter entry
    - `map` phase: present if `executionStats.totalItems != null`
    - `reduce` phase: present if `executionStats.reducePhaseTimeMs != null`
  - Node state derivation from process status + executionStats:
    - If process.status is `'completed'` → all nodes `'completed'`
    - If process.status is `'failed'` → completed phases are `'completed'`, last active is `'failed'`, rest are `'cancelled'`
    - If process.status is `'running'` → derive from phaseTimings/pipelinePhases if available, otherwise heuristic from executionStats presence
    - If process.status is `'cancelled'` → completed phases stay, rest `'cancelled'`
  - Item counts: `totalItems`, `successfulMaps`, `failedMaps` from executionStats mapped to map node
  - Duration: `mapPhaseTimeMs`, `reducePhaseTimeMs`, `filterPhaseTimeMs` mapped to respective nodes; `process.duration` or `process.durationMs` for total
  - Edge cases handled: missing metadata returns null, single-phase pipelines (job without map/reduce), zero items

- **`index.ts`** — Barrel export:
  - `export { PipelineDAGSection } from './PipelineDAGSection'`
  - `export { PipelineDAGChart } from './PipelineDAGChart'`
  - `export { buildDAGData } from './buildDAGData'`
  - `export type { DAGNodeState, DAGNodeData, DAGChartData } from './types'`

### Files to Modify

- **`packages/coc/src/server/spa/client/react/processes/ProcessDetail.tsx`** — Insert `<PipelineDAGSection>` between the header `</div>` (line 266) and the conversation turns comment (line 268):
  ```tsx
  import { PipelineDAGSection } from './dag';
  ```
  Insert after the header's closing `</div>` at line 266:
  ```tsx
  {/* Pipeline DAG visualization */}
  <PipelineDAGSection process={process} />
  ```
  This mirrors how PipelineResultCard is a self-contained component that receives `process` and internally guards on metadata presence. The section renders nothing for non-pipeline processes.

### Files to Delete

(none)

## Implementation Notes

### Pattern Alignment

- **Component style**: Follow `PipelineResultCard` pattern — functional component, `process: any` prop, internal metadata guards, `data-testid` attributes, `Card`/`Badge` imports from `../shared`. Use `cn()` from `shared/cn.ts` for conditional class joining.
- **Color palette**: All hex values sourced from `Badge.tsx` statusMap (lines 11-18): `#0078d4` running, `#16825d` completed, `#f14c4c` failed, `#e8912d` cancelled, `#848484` queued/waiting. Dark variants: `#3794ff`, `#89d185`, `#f48771`, `#cca700`.
- **Border/background**: Match Card.tsx border colors exactly: `border-[#e0e0e0] dark:border-[#3c3c3c]`, `bg-[#f3f3f3] dark:bg-[#252526]`.
- **Text colors**: Primary `text-[#1e1e1e] dark:text-[#cccccc]`, muted `text-[#848484]` — consistent with ProcessDetail and PipelineResultCard.
- **Duration formatting**: Reuse `formatDuration` from `../utils/format` (same function used in PipelineResultCard line 48 and ProcessDetail line 171).
- **SVG approach**: Inline SVG rather than canvas — simpler testing (DOM queries), accessible, no extra dependencies. All components are SVG `<g>` groups composed inside a single `<svg>`.
- **No external dependencies**: Uses only React, existing shared utilities, and Tailwind classes already in the project.

### CSS Animations

- **Running node pulse**: Reuse Tailwind `animate-pulse` already used by Badge for running status (line 12).
- **Active edge dash**: Define a `@keyframes dag-edge-dash` animation. Since the SPA uses Tailwind, add via inline `<style>` in the SVG `<defs>` or use `style` prop on the path element:
  ```css
  @keyframes dag-edge-dash {
    to { stroke-dashoffset: -20; }
  }
  ```
  Applied via `style={{ animation: 'dag-edge-dash 1s linear infinite' }}`.

### Dark Mode Detection

- Use `window.matchMedia('(prefers-color-scheme: dark)').matches` with a `useEffect` listener for changes. Check if the codebase already has a dark mode hook; if not, a simple local `useDarkMode()` hook in the dag folder suffices.

### Layout Calculation

- Horizontal layout: `x = PADDING + index * (NODE_W + GAP_X)`, `y = PADDING`
- Edge paths: straight horizontal lines from `(fromX + NODE_W, fromY + NODE_H/2)` to `(toX, toY + NODE_H/2)`
- SVG viewBox auto-sizes: width = `2*PADDING + nodeCount * NODE_W + (nodeCount-1) * GAP_X`, height = `2*PADDING + NODE_H + 20` (extra for progress bar)

## Tests

Create under `packages/coc/test/spa/react/dag/`:

- **`buildDAGData.test.ts`** — Pure function unit tests:
  - Returns `null` for processes without pipeline metadata
  - Builds correct nodes for completed pipeline with all phases (input→filter→map→reduce)
  - Omits filter node when no filter stats present
  - Sets all nodes to `'completed'` when process.status is `'completed'`
  - Sets last active node to `'failed'` and remaining to `'cancelled'` for failed processes
  - Maps item counts from executionStats to map node (totalItems, successfulMaps, failedMaps)
  - Maps phase durations to respective nodes
  - Handles zero totalItems gracefully
  - Handles cancelled process status

- **`dag-colors.test.ts`** — Color lookup tests:
  - `getNodeColors('running', false)` returns `{ fill: '#e8f3ff', border: '#0078d4', text: '#0078d4' }`
  - `getNodeColors('completed', true)` returns dark mode variants
  - `getEdgeColor('active', false)` returns `#0078d4`
  - `getNodeIcon('running')` returns `'🔄'`
  - All states produce valid color strings

- **`DAGNode.test.tsx`** — Component render tests (pattern from PipelineResultCard.test.tsx):
  - Renders rect with correct fill/stroke for each state
  - Displays phase label text
  - Shows item count when provided
  - Shows duration when provided
  - Applies `animate-pulse` class for running state
  - Fires onClick with correct phase

- **`PipelineDAGSection.test.tsx`** — Integration tests:
  - Returns null for non-pipeline processes (no metadata)
  - Renders `[data-testid="pipeline-dag-section"]` for pipeline processes with executionStats
  - Displays "Pipeline Flow" header text
  - Toggles collapsed state on header click (body hidden/shown)
  - Shows total duration in header
  - Shows status caption with correct icon

Test setup: Use `vitest`, `@testing-library/react`, `render`, `screen`, `fireEvent` — matching the exact import pattern from `PipelineResultCard.test.tsx` (lines 5-6). Use `vi.mock` for any hook dependencies. Use `makeProcess()` factory function pattern (PipelineResultCard.test.tsx line 24).

## Acceptance Criteria

- [ ] `buildDAGData` correctly transforms executionStats into DAGChartData for all process statuses (completed, failed, running, cancelled)
- [ ] `buildDAGData` returns null for non-pipeline processes
- [ ] DAG nodes render with correct colors matching Badge.tsx palette for each state
- [ ] Running nodes have pulse animation
- [ ] Active edges have dash animation
- [ ] PipelineDAGSection renders only for pipeline processes with metadata
- [ ] PipelineDAGSection collapse/expand toggle works
- [ ] ProcessDetail shows DAG section between header and conversation turns
- [ ] Non-pipeline processes show no DAG section (no visual change)
- [ ] All new tests pass: `cd packages/coc && npm run test:run`
- [ ] `npm run build` succeeds with no type errors
- [ ] Dark mode colors are correct variants of the Badge palette

## Dependencies

- Depends on: 001 (PipelinePhase type, PipelineProcessMetadata with phaseTimings/pipelinePhases/executionStats)
- Depends on: 003 (ProcessDetail.tsx has SSE event handling for pipeline-phase/pipeline-progress — though this commit only uses static metadata, the component must coexist with the SSE state added in 003)

## Assumed Prior State

- `PipelinePhase` type exists (from commit 001): a string union or enum for pipeline phases (e.g., `'input' | 'filter' | 'map' | 'reduce'`).
- `PipelineProcessMetadata` type exists (from commit 001) with `phaseTimings`, `pipelinePhases`, and `executionStats` fields.
- `ProcessDetail.tsx` has `pipelinePhases` and `pipelineProgress` state variables from SSE handling (commit 003), but this commit does not wire into them — it reads from `process.metadata.executionStats` which is the persisted/fetched data.
- The `executionStats` shape already used by `PipelineResultCard` (totalItems, successfulMaps, failedMaps, mapPhaseTimeMs, reducePhaseTimeMs, maxConcurrency) is the baseline; commit 001 may have extended it with `filterPhaseTimeMs` and phase-level timing data.
