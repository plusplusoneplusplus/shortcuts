---
status: pending
---

# 006: Node Interaction — Phase Popovers, Tooltips & Scroll-to-Error

## Summary

Add interactive capabilities to the DAG visualization: clickable nodes that open an inline detail panel (PipelinePhasePopover) below the chart, hover tooltips showing phase summary info, visual selection state on nodes, and a "View in Conversation ↓" link that scrolls to the relevant conversation turn for failed phases.

## Motivation

The static DAG chart (commit 004) and live updates (commit 005) show pipeline progress at a glance, but users need to drill into individual phases to understand what happened — input counts, filter rules, map concurrency, errors. This commit turns the DAG from a read-only visualization into an interactive debugging tool. It is isolated as the final commit because it layers interaction on top of the complete static + live rendering without modifying any data flow.

## Changes

### Files to Create

- **`packages/coc/src/server/spa/client/react/processes/dag/PipelinePhasePopover.tsx`**
  - Inline expandable panel rendered _below_ the SVG chart (not a floating portal like `ConversationMetadataPopover`). This avoids z-index/overflow issues with the SVG and keeps the UX grounded.
  - Props: `phase: PipelinePhaseEvent | null`, `onClose: () => void`, `onScrollToConversation?: () => void`
  - Uses `cn()` from `../shared/cn` for class composition (same as all other SPA components).
  - Conditionally renders a section based on `phase.phaseName`:
    - **input**: Source type (CSV/inline/generate), item count, parameter list as key-value grid.
    - **filter**: Filter type (rule/ai/hybrid), rules summary string, included/excluded counts, filter duration.
    - **map**: Concurrency level, batch size, model used, per-item status breakdown — a mini `<table>` with columns: Item (index or label), Status (badge), Duration. Capped at 20 rows with "and N more…" overflow.
    - **reduce**: Reduce type (ai/list/table/json/csv), model used, output preview (first 200 chars, truncated with `…`).
    - **job**: Model, prompt preview (first 150 chars), duration.
  - For failed phases (`phase.status === 'failed'`): render error message in `text-[#f14c4c]` (same pattern as `ToolCallView.tsx` line 462–466).
  - "View in Conversation ↓" link rendered when `onScrollToConversation` is provided and phase is failed. Uses link style `text-[#0078d4] dark:text-[#3794ff] hover:underline` (same as `ProcessDetail.tsx` line 245).
  - Close triggers: internal close button (×), propagated from parent on Escape/outside-click/same-node-click.
  - Animation: CSS `transition-all duration-200` on a wrapper with `max-height` toggle (0 → measured height) + `overflow-hidden`. No JS animation libraries.
  - Layout follows the metadata grid pattern from `ConversationMetadataPopover.tsx`: `grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-xs` for key-value rows.
  - Outer container: `bg-[#f8f8f8] dark:bg-[#1e1e1e] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded-md p-3 mt-2` — matches `ToolCallView` card styling (line 355).
  - `max-h-[300px] overflow-y-auto` for long content.
  - Labels use `text-[10px] uppercase text-[#848484]` (same as ToolCallView section labels, e.g., line 402).
  - Values use `text-[11px] text-[#1e1e1e] dark:text-[#cccccc]` (ToolCallView pattern).

### Files to Modify

- **`packages/coc/src/server/spa/client/react/processes/dag/DAGNode.tsx`**
  - Add `selected?: boolean` prop. When true, apply `stroke-width="2.5"` (up from default 1.5) and use a highlighted stroke color — `stroke={selected ? '#0078d4' : statusColor}` in light mode. This provides visual feedback that the node's popover is open.
  - Add `cursor: pointer` via `style={{ cursor: 'pointer' }}` on the outer `<g>` element.
  - Add native SVG `<title>` element inside the `<g>` for hover tooltip. Content: `${phaseName} — ${status}${duration ? ' (' + duration + ')' : ''}${itemCount ? ' • ' + itemCount + ' items' : ''}`. This uses the browser's built-in tooltip — no custom tooltip component needed, keeping the SVG clean.
  - The existing `onClick` handler prop (from commit 004) is sufficient; no new click handling needed here.

- **`packages/coc/src/server/spa/client/react/processes/dag/PipelineDAGChart.tsx`**
  - Add `selectedPhase: string | null` state (stores `phaseName` or `null`).
  - On DAGNode click: toggle selection — if clicking the already-selected node, set to `null` (close popover); otherwise set to the clicked node's phaseName.
  - Pass `selected={node.phaseName === selectedPhase}` to each `<DAGNode>`.
  - Add Escape key listener (via `useEffect`) that clears `selectedPhase`. Pattern: `document.addEventListener('keydown', handler)` with cleanup, identical to `Dialog.tsx` lines 18–24.
  - Add click-outside listener that clears `selectedPhase` when clicking outside the chart + popover area. Pattern: `document.addEventListener('mousedown', handler)` with ref check, identical to `ConversationMetadataPopover.tsx` lines 136–150.
  - Render `<PipelinePhasePopover>` below the `<svg>` element (sibling, not child) when `selectedPhase` is not null. Pass the matching phase data from the phases array.
  - Accept new optional prop `phaseDetails?: Record<string, any>` — a map of phaseName → detail metadata extracted from process data.
  - Accept new optional prop `onScrollToConversation?: (phaseName: string) => void` — forwarded to the popover.

- **`packages/coc/src/server/spa/client/react/processes/dag/PipelineDAGSection.tsx`**
  - Extract phase detail metadata from `process.metadata` (executionStats, pipeline config, per-phase timing) and pass as `phaseDetails` to `PipelineDAGChart`.
  - Implement `handleScrollToConversation(phaseName: string)` callback:
    - Calls the `scrollToTurnRef` callback (received via prop) with a search hint — the phase name string.
    - The parent (`ProcessDetail`) will search conversation turns for the first turn mentioning the phase or containing an error, and scroll to it.
  - Pass `onScrollToConversation={handleScrollToConversation}` to `PipelineDAGChart`.

- **`packages/coc/src/server/spa/client/react/processes/ProcessDetail.tsx`**
  - Add a `turnsContainerRef = useRef<HTMLDivElement>(null)` on the conversation turns `<div className="space-y-3">` wrapper (line 276).
  - Implement `scrollToTurn(hint: string)` function:
    - Searches `turns` array for the first turn whose content contains the hint string (case-insensitive) or whose tool calls include an error.
    - Gets the corresponding DOM element via `turnsContainerRef.current?.children[index]`.
    - Calls `element.scrollIntoView({ behavior: 'smooth', block: 'start' })`.
  - Pass `scrollToTurnRef={scrollToTurn}` as a prop to `PipelineDAGSection` (which is rendered inside the detail content — note: PipelineDAGSection is rendered conditionally for pipeline-type processes, likely above the conversation turns).

### Files to Delete

(none)

## Implementation Notes

### Inline Panel vs. Floating Popover

The existing `ConversationMetadataPopover` uses `ReactDOM.createPortal` with absolute positioning — it's a floating popover anchored to a trigger button. That pattern works for small metadata badges but is wrong for the DAG detail panel because:
1. The DAG is inside an SVG — positioning relative to SVG elements requires `getBoundingClientRect()` math that breaks on scroll/resize.
2. The detail panel is content-heavy (tables, error messages) and benefits from being in the document flow.
3. Inline expansion is more predictable and accessible.

Instead, follow the `ToolCallView` expand/collapse pattern: a sibling `<div>` that appears below the chart with `hidden`/visible toggle. The `ToolCallView` uses `expanded` state + `hidden` class (line 399–401). The popover will use a similar approach but with a smooth `max-height` transition instead of an instant toggle.

### Tooltip Strategy

Use native SVG `<title>` instead of a custom tooltip component. Reasons:
- Zero JS overhead for hover state tracking.
- Works in all browsers.
- Accessible by default (screen readers announce `<title>` content).
- Consistent with SVG best practices.

The tradeoff is that native tooltips have browser-controlled appearance and a delay. This is acceptable because the popover (on click) provides the detailed view.

### Selection Visual

The selected node uses `#0078d4` (VS Code's focus blue, matches link colors used across the SPA — `ProcessDetail.tsx` line 245, `ToolCallView.tsx` line 383) as its stroke color with increased stroke-width. In dark mode this becomes `#3794ff` (same pair used throughout). This provides clear visual indication of which node's detail panel is open.

### Scroll-to-Conversation Architecture

The scroll-to feature crosses component boundaries: `PipelinePhasePopover` → `PipelineDAGChart` → `PipelineDAGSection` → `ProcessDetail`. Rather than introducing a context or event bus, use callback prop drilling — the chain is short (3 hops) and the feature is narrowly scoped. The `ProcessDetail` component owns the conversation turns DOM and is the natural place to implement the scroll logic.

### Phase Detail Data Extraction

Phase metadata comes from `process.metadata.executionStats` (already used by `PipelineResultCard.tsx` — lines 21, 27–29) and `process.metadata.pipelineConfig`. The `phaseDetails` map is constructed in `PipelineDAGSection` by merging:
- `executionStats.totalItems`, `executionStats.successfulMaps`, `executionStats.failedMaps` → map phase
- `executionStats.mapPhaseTimeMs`, `executionStats.maxConcurrency` → map phase
- Pipeline config `input`, `filter`, `map`, `reduce` sections → respective phases
- Per-phase error from `process.metadata.phaseErrors` or from failed turns

## Tests

- **`packages/coc/test/spa/react/dag/PipelinePhasePopover.test.tsx`** (new)
  - Renders nothing when `phase` is `null`.
  - Renders input phase details: source type, item count, parameters grid.
  - Renders filter phase details: filter type, included/excluded counts.
  - Renders map phase details: concurrency, batch size, model, per-item status table.
  - Renders reduce phase details: reduce type, model, output preview truncated at 200 chars.
  - Renders job phase details: model, prompt preview, duration.
  - Shows error message in red for failed phase.
  - Shows "View in Conversation ↓" link for failed phase when `onScrollToConversation` provided.
  - Does not show "View in Conversation ↓" when `onScrollToConversation` is not provided.
  - Calls `onClose` when close button (×) is clicked.
  - Calls `onScrollToConversation` when the link is clicked.

- **`packages/coc/test/spa/react/dag/DAGNode.test.tsx`** (extend existing from 004)
  - Renders `<title>` element with phase name, status, and duration.
  - Applies `stroke-width="2.5"` and blue stroke when `selected` is true.
  - Applies default stroke-width when `selected` is false or undefined.
  - Has `cursor: pointer` style on the group element.

- **`packages/coc/test/spa/react/dag/PipelineDAGChart.test.tsx`** (extend existing from 004)
  - Clicking a node sets it as selected (passes `selected={true}` to that DAGNode).
  - Clicking the same node again deselects it (closes popover).
  - Clicking a different node switches selection.
  - Renders `PipelinePhasePopover` when a node is selected.
  - Does not render `PipelinePhasePopover` when no node is selected.
  - Pressing Escape clears selection.
  - Clicking outside the chart clears selection.

## Acceptance Criteria

- [ ] Clicking a DAG node opens an inline detail panel below the chart showing phase-specific information.
- [ ] Clicking the same node again closes the panel.
- [ ] Clicking a different node switches the panel to show that node's details.
- [ ] Escape key closes the panel.
- [ ] Clicking outside the chart area closes the panel.
- [ ] Hovering over a node shows a tooltip with phase name, status, duration, and item count.
- [ ] Selected node has a visually distinct border (blue, thicker stroke).
- [ ] Failed phases show error text in red within the popover.
- [ ] Failed phases show a "View in Conversation ↓" link that scrolls to the related conversation turn.
- [ ] Input phase popover shows: source type, item count, parameters.
- [ ] Filter phase popover shows: filter type, rules summary, included/excluded counts, duration.
- [ ] Map phase popover shows: concurrency, batch size, model, per-item status table (capped at 20 rows).
- [ ] Reduce phase popover shows: reduce type, model, output preview (200 char max).
- [ ] Job phase popover shows: model, prompt preview, duration.
- [ ] All new and extended tests pass.
- [ ] No regressions in existing DAG rendering or live update behavior.
- [ ] Popover panel has smooth slide-down animation via CSS max-height transition.
- [ ] All colors and typography follow existing SPA design tokens (matches Dialog, ToolCallView, ConversationMetadataPopover patterns).

## Dependencies

- Depends on: 004 (static DAG components — DAGNode with click handler prop, PipelineDAGChart, PipelineDAGSection)
- Depends on: 005 (live phase data via usePipelinePhase hook — provides the phase events that populate popover content)

## Assumed Prior State

Static DAG components exist. DAGNode accepts an `onClick` prop. PipelineDAGChart renders DAGNode and DAGEdge components within an SVG. PipelineDAGSection wraps PipelineDAGChart and connects it to process data. The `usePipelinePhase` hook provides live `PipelinePhaseEvent[]` data via SSE. Process metadata including `executionStats` and pipeline config are available on the process object.
