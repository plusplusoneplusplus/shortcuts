---
status: pending
---

# 005: SPA UI — Add batch aggregation trigger to `#memory/config` page

## Summary
Adds an **Explore Cache** status panel to `MemoryConfigPanel.tsx` (plus a new sibling component `ExploreCachePanel.tsx`) that shows `rawCount`, `consolidatedCount`, and `lastAggregation` fetched from a new `GET /api/memory/aggregate-tool-calls/stats` endpoint, and a button that fires `POST /api/memory/aggregate-tool-calls` (commit 004) to trigger on-demand aggregation.

## Motivation
Commit 004 exposes aggregation as a REST endpoint but there is no user-visible feedback — operators cannot see how many raw entries are waiting, when aggregation last ran, or trigger it manually without using `curl`. This commit completes the user-facing loop: a status panel + action button renders directly below the existing config card on the `#memory/config` sub-tab so the feature is fully self-contained in one page.

## Changes

### Files to Create

- `packages/coc/src/server/spa/client/react/views/memory/ExploreCachePanel.tsx` — New self-contained React component. Renders a `Card` titled "Explore Cache" showing three stat rows (`rawCount`, `consolidatedCount`, `lastAggregation`) fetched on mount from `GET /api/memory/aggregate-tool-calls/stats`. Includes an **"Aggregate now"** `Button` that calls `POST /api/memory/aggregate-tool-calls`, displays "Aggregating…" while in-flight (may be multi-second due to AI), shows a success message with counts on resolution, and refreshes stats after a successful run. Also includes a secondary **"Refresh"** `Button` (variant `secondary`) to re-fetch stats manually.

- `packages/coc/test/spa/react/memory/ExploreCachePanel.test.tsx` — Vitest + React Testing Library tests for the new component (see Tests section).

### Files to Modify

- `packages/coc/src/server/spa/client/react/views/memory/MemoryConfigPanel.tsx` — Import and render `<ExploreCachePanel />` below the existing `<Card>` inside the outermost `<div className="p-4 max-w-xl space-y-4">` wrapper. The `space-y-4` class on that div already provides the gap between cards.

- `packages/coc-server/src/memory/memory-routes.ts` — Register a new lightweight `GET /api/memory/aggregate-tool-calls/stats` route that instantiates `FileToolCallCacheStore` pointed at `config.storageDir` (resolved via `readMemoryConfig(dataDir)`) and calls `store.getStats()`, returning the `ToolCallCacheStats` JSON. This keeps the stats lookup separate from the write path and avoids any AI invocation.

### Files to Delete
- (none)

## Implementation Notes

### `ExploreCachePanel.tsx` — component design

```tsx
import { useState, useEffect, useCallback } from 'react';
import { getApiBase } from '../../utils/config';
import { Button, Card, Spinner } from '../../shared';
import type { ToolCallCacheStats } from '@plusplusoneplusplus/pipeline-core';

export function ExploreCachePanel() {
    const [stats, setStats] = useState<ToolCallCacheStats | null>(null);
    const [statsLoading, setStatsLoading] = useState(true);
    const [statsError, setStatsError] = useState<string | null>(null);

    const [aggregating, setAggregating] = useState(false);
    const [aggregateResult, setAggregateResult] = useState<string | null>(null);
    const [aggregateError, setAggregateError] = useState<string | null>(null);

    const fetchStats = useCallback(async () => {
        setStatsLoading(true);
        setStatsError(null);
        try {
            const res = await fetch(`${getApiBase()}/memory/aggregate-tool-calls/stats`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: ToolCallCacheStats = await res.json();
            setStats(data);
        } catch (err) {
            setStatsError(err instanceof Error ? err.message : String(err));
        } finally {
            setStatsLoading(false);
        }
    }, []);

    useEffect(() => { fetchStats(); }, [fetchStats]);

    const handleAggregate = async () => {
        setAggregating(true);
        setAggregateResult(null);
        setAggregateError(null);
        try {
            const res = await fetch(`${getApiBase()}/memory/aggregate-tool-calls`, {
                method: 'POST',
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json();
            // body shape from commit 004: { aggregated: number, consolidated: number }
            setAggregateResult(`Aggregated ${body.aggregated} entries → ${body.consolidated} consolidated`);
            await fetchStats(); // refresh counts
        } catch (err) {
            setAggregateError(err instanceof Error ? err.message : String(err));
        } finally {
            setAggregating(false);
        }
    };

    // ... render
}
```

**Key decisions:**
- `fetchStats` is extracted into a `useCallback` so both the `useEffect` on mount and the post-aggregate refresh call the same function, and it can be called by the Refresh button.
- `aggregateResult` is a formatted string (not raw JSON) shown as success feedback — clears automatically after `setTimeout(() => setAggregateResult(null), 4000)` to match the `saved` pattern in `handleSave`.
- `statsLoading` and `aggregating` are independent booleans: stats can be loading while the aggregate button is idle and vice versa.
- The "Aggregate now" `Button` is disabled while `aggregating` is true or `statsLoading` is true (prevents double-fire).
- Stats rows use a `<dl>` / `<div className="flex justify-between">` pattern consistent with other stat panels in the codebase (e.g. AdminPanel).
- `lastAggregation` renders as a locale date string (`new Date(stats.lastAggregation).toLocaleString()`) or the literal string `"Never"` when `stats.lastAggregation === null`.

### Stats route in `memory-routes.ts`

Register immediately after the existing `PUT /api/memory/config` route for grouping clarity:

```ts
routes.push({
    method: 'GET',
    pattern: '/api/memory/aggregate-tool-calls/stats',
    handler: async (_req, res) => {
        try {
            const config = readMemoryConfig(dataDir);
            const store = new FileToolCallCacheStore({ dataDir: config.storageDir });
            const stats = await store.getStats();
            sendJson(res, stats);
        } catch (err) {
            send500(res, err instanceof Error ? err.message : String(err));
        }
    },
});
```

`FileToolCallCacheStore` is imported from `@plusplusoneplusplus/pipeline-core` — same import already used in the route registered by commit 004 (`POST /api/memory/aggregate-tool-calls`). Both are pure async filesystem reads with no AI involvement, so latency is negligible.

### `MemoryConfigPanel.tsx` change

The only change is adding two lines — an import and the component element:

```tsx
import { ExploreCachePanel } from './ExploreCachePanel';

// Inside the return JSX, after the closing </Card> tag:
<ExploreCachePanel />
```

The outer `<div className="p-4 max-w-xl space-y-4">` already stacks children with `gap-4`, so no layout changes are needed.

### Assumed response shape for `POST /api/memory/aggregate-tool-calls` (commit 004)

The success message assumes the endpoint returns `{ aggregated: number, consolidated: number }`. If the actual shape differs, adjust the result string formatter in `handleAggregate` accordingly — the rest of the component is unaffected.

## Tests

File: `packages/coc/test/spa/react/memory/ExploreCachePanel.test.tsx`

Follow the pattern in `AdminPanel.test.tsx`: mock `global.fetch`, render in isolation (no `AppProvider` needed since `ExploreCachePanel` has no context dependency), use `act`/`waitFor`.

**Test cases:**

1. **Renders loading spinner on mount** — mock `fetch` to never resolve; assert `<Spinner>` (or the spinner's role/aria) is visible before data arrives.

2. **Renders stats after mount** — mock `GET .../stats` to resolve `{ rawCount: 12, consolidatedCount: 4, consolidatedExists: true, lastAggregation: '2024-01-15T10:00:00.000Z' }`; `waitFor` that the text `"12"`, `"4"`, and the locale-formatted date are in the document.

3. **Renders "Never" when lastAggregation is null** — mock stats with `lastAggregation: null`; assert the text `"Never"` is rendered.

4. **"Aggregate now" button disabled while aggregating** — after mount resolves stats, `fireEvent.click` the aggregate button (mock `POST` to hang); assert button becomes disabled (`button.disabled === true`).

5. **Shows "Aggregating…" label while POST is in-flight** — same setup; assert button text changes to `"Aggregating…"` (or the `loading` prop is passed to `Button` and `Spinner` renders inside it).

6. **Shows success message after aggregation** — mock `POST` to resolve `{ aggregated: 5, consolidated: 3 }`; `waitFor` that the success text `"Aggregated 5 entries → 3 consolidated"` is visible.

7. **Refreshes stats after successful aggregation** — verify `fetch` was called twice for the stats URL (once on mount, once after POST completes).

8. **Shows error message on POST failure** — mock `POST` to resolve with `ok: false, status: 500`; `waitFor` that an error string containing `"HTTP 500"` is visible.

9. **Shows stats fetch error** — mock `GET .../stats` to reject; assert an error message is rendered and no stats rows are shown.

10. **"Refresh" button re-fetches stats** — after initial load, `fireEvent.click` the Refresh button; assert `fetch` is called again for the stats URL.

## Acceptance Criteria

- [ ] Navigating to `#memory/config` in the SPA shows the new "Explore Cache" card below the existing config card
- [ ] The card displays `rawCount`, `consolidatedCount`, and `lastAggregation` (or "Never") fetched from `GET /api/memory/aggregate-tool-calls/stats`
- [ ] Clicking "Aggregate now" disables the button, shows a spinner/loading state, then shows a success message with entry counts
- [ ] Stats auto-refresh after a successful aggregation so `rawCount` drops to `0`
- [ ] Clicking "Refresh" re-fetches stats without triggering aggregation
- [ ] If the stats endpoint fails, an inline error message is shown (not a crash)
- [ ] If the aggregate endpoint fails, an inline error message replaces the success area
- [ ] `GET /api/memory/aggregate-tool-calls/stats` is registered in `memory-routes.ts` and responds with `ToolCallCacheStats` JSON
- [ ] All 10 test cases in `ExploreCachePanel.test.tsx` pass

## Dependencies
- Depends on: 001, 002, 003, 004

## Assumed Prior State
- `FileToolCallCacheStore` (with `getStats()`) exists in `@plusplusoneplusplus/pipeline-core` (added in 001–002 range)
- `POST /api/memory/aggregate-tool-calls` is registered in `memory-routes.ts` and returns `{ aggregated: number, consolidated: number }` (added in commit 004)
- `ToolCallCacheStats` interface is exported from `@plusplusoneplusplus/pipeline-core` (defined in `pipeline-core/src/memory/tool-call-cache-types.ts`)
- `getApiBase()` from `../../utils/config` returns the SPA's API base path (e.g. `/api`)
- `Button`, `Card`, `Spinner` are exported from `../../shared`
