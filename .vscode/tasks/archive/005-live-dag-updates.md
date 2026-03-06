---
status: pending
---

# 005: Live DAG Updates via SSE

## Summary

Wire SSE `pipeline-phase` and `pipeline-progress` events into the static DAG components (from commit 004) so the visualization updates in real time while a pipeline is running. A new `usePipelinePhase` hook encapsulates all SSE subscription, throttling, and state management; `PipelineDAGSection` consumes it to swap between live and static data sources.

## Motivation

Commits 001–004 established the type system, executor phase emissions, SSE relay, and static DAG rendering. This commit closes the loop: it makes the DAG _live_ — nodes transition through pending → running → completed/failed/skipped as events arrive, the progress bar animates, and the running node shows an elapsed-time counter. Keeping this separate from 004 isolates the real-time reactivity concerns (EventSource lifecycle, throttling, timer management, disconnect handling) from the pure rendering logic.

## Changes

### Files to Create

- **`packages/coc/src/server/spa/client/react/hooks/usePipelinePhase.ts`** — Custom React hook that:
  - Accepts an `EventSource | null` ref and initial `PipelineProcessMetadata` (from process.metadata).
  - Listens for `pipeline-phase` and `pipeline-progress` named SSE events via `addEventListener` (same pattern as `QueueTaskDetail.tsx` lines 365–435 — cast `Event` to `MessageEvent`, JSON-parse `.data`).
  - Maintains internal state:
    - `phases: Map<PipelinePhase, { status: PhaseStatus; startedAt?: number; completedAt?: number; stats?: PhaseStats }>` — updated on every `pipeline-phase` event.
    - `progress: { completedItems: number; failedItems: number; totalItems: number; percentage: number }` — updated on `pipeline-progress` events, **throttled at 250 ms** via a `useRef`-held timestamp + `setTimeout` coalesce (not `requestAnimationFrame` — we want deterministic timing for tests).
    - `disconnected: boolean` — set `true` on `EventSource.onerror`; freezes last-known state.
  - Merges live state with initial metadata: when `eventSource` is non-null and `disconnected` is `false`, SSE state takes priority; otherwise falls back to metadata.
  - Exports a `buildDAGDataFromLive(phases, progress)` companion or calls it internally, returning `DAGChartData` (same shape `PipelineDAGChart` expects).
  - Cleans up listeners on unmount or when `eventSource` changes (return cleanup from `useEffect`).
  - Follows the ref-callback pattern from `useWebSocket` (lines 23–31): stores the latest callback in a `useRef` to avoid re-subscribing on every render.

### Files to Modify

- **`packages/coc/src/server/spa/client/react/processes/ProcessDetail.tsx`**
  - **Extract EventSource ref sharing.** The existing `eventSourceRef` (line 63) already holds the `EventSource` for the selected process. Pass it as a prop to `PipelineDAGSection`:
    ```tsx
    <PipelineDAGSection process={metadataProcess} eventSourceRef={eventSourceRef} />
    ```
    Insert `PipelineDAGSection` between the header `<div>` (line 266) and the conversation turns section (line 268). Conditionally render only when `metadataProcess?.metadata?.pipelineName` is truthy (same guard `PipelineResultCard` uses at line 20).
  - **Do NOT move SSE setup out of ProcessDetail.** The existing `useEffect` at lines 122–150 handles conversation streaming (chunks, tool calls). Pipeline-phase events are _additional_ named events on the same `EventSource` — the hook in `usePipelinePhase` attaches its own listeners without conflicting.
  - Add import for `PipelineDAGSection`.

- **`packages/coc/src/server/spa/client/react/processes/dag/PipelineDAGSection.tsx`** (from commit 004)
  - Add `eventSourceRef: React.RefObject<EventSource | null>` to props interface.
  - Call `usePipelinePhase(eventSourceRef.current, process?.metadata)` to get live `DAGChartData`.
  - **Running-node duration timer:** Add a `useEffect` with 1-second `setInterval` that updates a `now` state variable (same pattern as `ProcessDetail.tsx` lines 71–75). Only active when `process.status === 'running'`. Used to compute elapsed time for the currently-running DAG node.
  - **Data source selection:**
    - If `process.status === 'running'` → use `DAGChartData` from the hook (live).
    - If process is terminal (`completed`, `failed`, `cancelled`) → use `buildDAGData(process)` (static, from commit 004).
  - Pass `disconnected` flag from hook to render a subtle warning icon/tooltip when SSE drops.

- **`packages/coc/src/server/spa/client/react/processes/dag/buildDAGData.ts`** (from commit 004)
  - Add exported function `buildDAGDataFromLive(phases, progress)`:
    - Accepts the `phases` map and `progress` object from `usePipelinePhase`.
    - Constructs `DAGChartData` (nodes + edges + progress bar data) from live state.
    - Maps each `PipelinePhase` to a `DAGNode` with status-derived color (from `dag-colors`).
    - Computes edge states: edge is "active" if source node is completed and target is running.
  - Existing `buildDAGData(process)` remains unchanged — used for terminal processes.

- **`packages/coc/src/server/spa/client/react/processes/dag/DAGNode.tsx`** (from commit 004)
  - Add CSS `transition` property on the node's root element for `background-color`, `border-color`, and `box-shadow` (e.g. `transition: background-color 300ms ease, border-color 300ms ease, box-shadow 300ms ease`). This makes phase transitions visually smooth without any JS timer.
  - Ensure the "running" state uses a CSS `@keyframes` pulse animation (not a JS interval). The animation class should be applied conditionally when `node.status === 'running'`.
  - When `node.status === 'running'` and an `elapsedMs` prop is provided, render the elapsed duration below the node label using `formatDuration` from `../utils/format`.

- **`packages/coc/src/server/spa/client/react/processes/dag/DAGProgressBar.tsx`** (from commit 004)
  - Add CSS `transition: width 300ms ease` to the progress fill element so progress bar width changes animate smoothly instead of jumping.

- **`packages/coc-server/src/sse-handler.ts`**
  - Add two new event type branches in the `onProcessOutput` callback (line 84):
    ```typescript
    } else if (event.type === 'pipeline-phase') {
        sendEvent(res, 'pipeline-phase', {
            phase: event.phase,
            status: event.status,
            stats: event.stats,
        });
    } else if (event.type === 'pipeline-progress') {
        sendEvent(res, 'pipeline-progress', {
            completedItems: event.completedItems,
            failedItems: event.failedItems,
            totalItems: event.totalItems,
            percentage: event.percentage,
        });
    }
    ```
  - This follows the exact same `sendEvent(res, eventName, data)` pattern used for `chunk`, `tool-start`, `tool-complete`, etc. (lines 85–108).

### Files to Delete

(none)

## Implementation Notes

### SSE Event Listener Pattern

Follow the established pattern from `QueueTaskDetail.tsx` (lines 346–446):
```typescript
es.addEventListener('pipeline-phase', (event: Event) => {
    try {
        const data = JSON.parse((event as MessageEvent).data);
        // update phase state
    } catch { /* ignore parse errors */ }
});
```
Named SSE events use `addEventListener`, not `onmessage`. The `onmessage` handler on ProcessDetail's EventSource (line 133) only fires for unnamed events — our named `pipeline-phase` / `pipeline-progress` events will not conflict.

### Throttling Strategy

Progress events can fire rapidly (once per map item). Throttle at 250 ms using a ref-based approach:
```typescript
const lastProgressRef = useRef(0);
const pendingProgressRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const applyProgress = (data: ProgressData) => { setProgress(data); lastProgressRef.current = Date.now(); };

// In event listener:
const now = Date.now();
if (now - lastProgressRef.current >= 250) {
    applyProgress(data);
} else {
    if (pendingProgressRef.current) clearTimeout(pendingProgressRef.current);
    pendingProgressRef.current = setTimeout(() => applyProgress(data), 250 - (now - lastProgressRef.current));
}
```
Phase events (transitions) are NOT throttled — they're infrequent and should render immediately.

### EventSource Sharing

The `EventSource` at `/api/processes/:id/stream` supports multiple `addEventListener` calls. ProcessDetail already listens for `onmessage` (unnamed events). The `usePipelinePhase` hook adds `addEventListener('pipeline-phase', ...)` and `addEventListener('pipeline-progress', ...)` on the same instance. Both listeners receive their respective events independently — this is standard EventSource behavior per the [SSE specification](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation).

### Disconnect Handling

On `EventSource.onerror`, set `disconnected: true` in hook state. The DAG freezes at the last known state. `PipelineDAGSection` renders a small ⚠️ icon with tooltip "Live updates disconnected" next to the section header. When the process later resolves to a terminal state (detected via the main `processes` array update from WebSocket), the static path kicks in automatically.

### Running Node Timer

The 1-second timer in `PipelineDAGSection` mirrors ProcessDetail's own timer (lines 71–75):
```typescript
useEffect(() => {
    if (process?.status !== 'running') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
}, [process?.status]);
```
The `now` value is passed to `DAGNode` as `elapsedMs = now - node.startedAt` for the running node.

### CSS Transitions vs JS Timers

All visual transitions use CSS — no JS `requestAnimationFrame` loops:
- Node color/border: `transition: background-color 300ms ease, border-color 300ms ease`
- Progress bar width: `transition: width 300ms ease`
- Running pulse: `@keyframes dag-node-pulse { ... }` with `animation: dag-node-pulse 2s ease-in-out infinite`

This ensures smooth 60fps animations with zero React re-render cost for the animation frames.

## Tests

- **`packages/coc/test/spa/react/hooks/usePipelinePhase.test.ts`** — Unit tests for the hook:
  - Mock `EventSource` with `addEventListener`/`removeEventListener` tracking.
  - Verify phase state updates on `pipeline-phase` events.
  - Verify progress state updates on `pipeline-progress` events.
  - Verify 250ms throttle: fire two progress events 100ms apart → only one state update within the window, second coalesced via timeout.
  - Verify disconnect: simulate `onerror` → `disconnected` becomes `true`, state freezes.
  - Verify cleanup: unmount removes all listeners.
  - Verify merge priority: live SSE state overrides initial metadata when `eventSource` is active.
  - Follow test patterns from `usePreferences.test.tsx` and `useQueueActivity.test.ts` — use `vi.fn()`, `vi.useFakeTimers()`, `@testing-library/react` `renderHook`.

- **`packages/coc/test/spa/react/dag/PipelineDAGSection.test.tsx`** — Component integration tests:
  - Render with mock process (running) + mock EventSource → verify DAG nodes update on SSE events.
  - Render with terminal process → verify static `buildDAGData` path is used.
  - Verify disconnect warning renders when EventSource errors.
  - Verify running-node timer updates elapsed display every second (advance fake timers).
  - Mock `usePipelinePhase` if needed to isolate component logic from hook internals.
  - Use `renderWithProviders` from `test-utils.tsx` for context setup.

- **`packages/coc/test/spa/react/dag/buildDAGData.test.ts`** — Unit tests for `buildDAGDataFromLive`:
  - Verify correct `DAGChartData` shape from various phase/progress combinations.
  - Verify edge active state derivation.
  - Verify graceful handling of empty/partial data.

- **`packages/coc/test/coc-server/sse-handler.test.ts`** — (extend existing or create) Verify that `pipeline-phase` and `pipeline-progress` event types in `onProcessOutput` are relayed as named SSE events.

## Acceptance Criteria

- [ ] When a pipeline process is running, the DAG section appears in ProcessDetail below the header.
- [ ] DAG nodes transition through pending → running → completed/failed/skipped as `pipeline-phase` SSE events arrive.
- [ ] Progress bar animates smoothly (CSS transition) as `pipeline-progress` SSE events arrive.
- [ ] Progress updates are throttled at 250ms — no more than 4 React re-renders per second from progress events.
- [ ] Phase transition events cause immediate re-render (no throttle).
- [ ] Running node displays a pulsing animation (CSS keyframes) and an elapsed duration counter (1s interval).
- [ ] When process reaches terminal state, DAG switches to static data from `process.metadata`.
- [ ] On SSE disconnect, DAG freezes at last known state and shows a disconnect warning.
- [ ] Unmounting the component cleans up all SSE listeners, intervals, and timeouts.
- [ ] All new tests pass (`npm run test:run` in `packages/coc`).
- [ ] No regressions to existing ProcessDetail SSE streaming (conversation chunks, tool events).
- [ ] `sse-handler.ts` relays `pipeline-phase` and `pipeline-progress` events server-side.

## Dependencies

- Depends on: 001 (types), 002 (executor emissions + bridge), 003 (SSE relay + client listeners), 004 (static DAG components)

## Assumed Prior State

Pipeline executor emits `pipeline-phase` and `pipeline-progress` events via `onPhaseChange` callback. Queue executor bridge wires these to `store.emitProcessEvent`. SSE handler in `coc-server/src/sse-handler.ts` relays named events using `sendEvent(res, eventName, data)`. ProcessDetail.tsx has an `eventSourceRef` at line 63 holding the `EventSource` for the selected running process. Static DAG components exist under `processes/dag/`: `PipelineDAGSection`, `PipelineDAGChart`, `DAGNode`, `DAGEdge`, `DAGProgressBar`, `buildDAGData`, `dag-colors`, `types` — all rendering completed pipeline state from `process.metadata`.
