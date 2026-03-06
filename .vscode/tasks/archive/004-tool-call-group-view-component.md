---
status: pending
---

# 004: Add ToolCallGroupView Component

## Summary

Creates `ToolCallGroupView.tsx` — a self-contained React component that renders a
group of consecutive same-category tool calls as a single collapsible row.
Also adds `ToolCallGroupView.test.tsx` covering the four primary behaviours:
collapsed summary rendering, click-to-expand, streaming auto-expand, and minimal-mode
CSS class.

## Motivation

Commit 001 introduced `ToolGroupCategory`, `GroupChunk`, and `getCategoryLabel()`.
This commit delivers the visual representation for those group chunks so that a run of
e.g. 5 `view` + 3 `glob` reads can be collapsed to one header row instead of 8 full
`ToolCallView` cards, dramatically reducing vertical scroll distance.

## Changes

### Files to Create

#### `packages/coc/src/server/spa/client/react/processes/ToolCallGroupView.tsx`

Full implementation of the component.  No new dependencies — only React, the `cn()`
helper from `../shared`, and the types/utilities already established in Commit 001.

#### `packages/coc/test/spa/react/ToolCallGroupView.test.ts`

Vitest unit tests (no DOM renderer required; tests focus on logic derivations and
class/prop assertions through shallow output inspection).

### Files to Modify

None — this commit is additive only.

### Files to Delete

None.

---

## Implementation Notes

### Props interface

```ts
// ToolCallGroupView.tsx

import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '../shared';
import type { ToolGroupCategory } from './toolGroupUtils';
import { getCategoryLabel } from './toolGroupUtils';

interface RenderToolCall {
    id: string;
    toolName: string;
    name?: string;
    args?: any;
    result?: string;
    error?: string;
    status?: string;
    startTime?: string;
    endTime?: string;
    parentToolCallId?: string;
}

export interface ToolCallGroupViewProps {
    category: ToolGroupCategory;          // 'read' | 'write' | 'shell'
    toolCalls: RenderToolCall[];          // ordered array of grouped tool calls
    compactness: 0 | 1 | 2;
    isStreaming?: boolean;
    renderToolTree: (toolId: string, depth: number) => React.ReactNode;
}
```

`RenderToolCall` is a local re-declaration matching the type in `ConversationTurnBubble.tsx`
(lines 48-59).  It is intentionally duplicated here rather than exported from that file to
keep the component independently testable.  When the type is later extracted to a shared
module the local alias can be removed.

---

### State

```ts
const [expanded, setExpanded] = useState(false);
```

Single boolean.  All derived values (summary label, time string, status icon) are
computed inline without extra state.

---

### Streaming effect

```ts
useEffect(() => {
    if (isStreaming) {
        setExpanded(true);
    } else {
        setExpanded(false);
    }
}, [isStreaming]);
```

`isStreaming` going `true → false` collapses the group.  If the user manually expands
during a non-streaming phase the next streaming start will re-force expansion.
The effect runs on every `isStreaming` change, not just mount.

---

### Category icon map

```ts
const CATEGORY_ICONS: Record<ToolGroupCategory, string> = {
    read:  '📄',
    write: '✏️',
    shell: '💻',
};
```

Follows the emoji-first icon pattern used throughout `ToolCallView.tsx` (e.g. `📁` for
file paths, `statusIndicator()` returning `✅`/`❌`/`🔄`/`⏳`).

---

### Time helpers

Two private helpers, consistent with `formatStartTime` / `formatDuration` in `ToolCallView.tsx`:

```ts
function groupStartLabel(toolCalls: RenderToolCall[]): string {
    const first = toolCalls.find(tc => tc.startTime);
    if (!first?.startTime) return '';
    const d = new Date(first.startTime);
    if (isNaN(d.getTime())) return '';
    const MM = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    return `${MM}/${dd} ${hh}:${mm}:${ss}Z`;
}

function groupDuration(toolCalls: RenderToolCall[]): string {
    const starts = toolCalls.map(tc => tc.startTime ? new Date(tc.startTime).getTime() : NaN).filter(n => !isNaN(n));
    const ends   = toolCalls.map(tc => tc.endTime   ? new Date(tc.endTime).getTime()   : NaN).filter(n => !isNaN(n));
    if (starts.length === 0) return '';
    const firstStart = Math.min(...starts);
    const lastEnd    = ends.length > 0 ? Math.max(...ends) : Date.now();
    const ms = lastEnd - firstStart;
    if (!Number.isFinite(ms) || ms < 0) return '';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}
```

---

### Status derivation

```ts
const allSucceeded = toolCalls.every(tc => tc.status === 'completed');
const anyFailed    = toolCalls.some(tc  => tc.status === 'failed');
const statusIcon   = anyFailed ? '❌' : allSucceeded ? '✅' : '🔄';
```

Mirrors `statusIndicator()` semantics in `ToolCallView.tsx`.

---

### JSX structure

```tsx
export function ToolCallGroupView({
    category,
    toolCalls,
    compactness,
    isStreaming,
    renderToolTree,
}: ToolCallGroupViewProps) {
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        setExpanded(!!isStreaming);
    }, [isStreaming]);

    const toggle = useCallback(() => setExpanded(v => !v), []);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
        }
    }, [toggle]);

    const allSucceeded = toolCalls.every(tc => tc.status === 'completed');
    const anyFailed    = toolCalls.some(tc  => tc.status === 'failed');
    const statusIcon   = anyFailed ? '❌' : allSucceeded ? '✅' : '🔄';
    const summaryLabel = getCategoryLabel(category, toolCalls.map(tc => tc.toolName));
    const startLabel   = groupStartLabel(toolCalls);
    const duration     = groupDuration(toolCalls);
    const isMinimal    = compactness === 2;

    return (
        <div
            className={cn(
                'tool-call-group my-1 rounded border border-[#e0e0e0] dark:border-[#3c3c3c]',
                'bg-[#f8f8f8] dark:bg-[#1e1e1e] text-xs',
                isMinimal && !expanded && 'tool-call-group--minimal'
            )}
            data-category={category}
        >
            {/* ── Header row ─────────────────────────────────────────── */}
            <div
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                className={cn(
                    'tool-call-group-header flex items-center gap-2 px-2.5 py-1.5',
                    'cursor-pointer select-none',
                    'hover:bg-black/[0.03] dark:hover:bg-white/[0.03]',
                    isMinimal && !expanded && 'tool-call-group-header--minimal overflow-hidden max-h-6 transition-[max-height] duration-200'
                )}
                onClick={toggle}
                onKeyDown={handleKeyDown}
            >
                {/* status + category icon */}
                <span className="shrink-0">{statusIcon}</span>
                <span className="shrink-0">{CATEGORY_ICONS[category]}</span>

                {/* summary label e.g. "4 read operations (glob×1, view×3)" */}
                <span className="tool-call-group-label font-medium text-[#0078d4] dark:text-[#3794ff] truncate min-w-0">
                    {summaryLabel}
                </span>

                {/* timestamps */}
                {startLabel && (
                    <span className="text-[#848484] ml-auto shrink-0">{startLabel}</span>
                )}
                {duration && (
                    <span className={cn('text-[#848484] shrink-0', !startLabel && 'ml-auto')}>
                        {duration}
                    </span>
                )}

                {/* expand chevron */}
                <span className={cn('text-[#848484] shrink-0', !duration && !startLabel && 'ml-auto')}>
                    {expanded ? '▼' : '▶'}
                </span>
            </div>

            {/* ── Expanded body ───────────────────────────────────────── */}
            {expanded && (
                <div className="tool-call-group-body border-t border-[#e0e0e0] dark:border-[#3c3c3c] py-1">
                    {toolCalls.map(tc => (
                        <React.Fragment key={tc.id}>
                            {renderToolTree(tc.id, 0)}
                        </React.Fragment>
                    ))}
                </div>
            )}
        </div>
    );
}
```

**CSS class inventory:**

| Class | Purpose |
|---|---|
| `tool-call-group` | Root card — same visual frame as `tool-call-card` |
| `tool-call-group--minimal` | Applied on root when `compactness===2` and collapsed |
| `tool-call-group-header` | Clickable header row |
| `tool-call-group-header--minimal` | Constrains header height to `max-h-6` with transition |
| `tool-call-group-label` | Summary text, styled like `tool-call-name` |
| `tool-call-group-body` | Wrapper for the per-tool `renderToolTree` output |

All colours are identical to `ToolCallView.tsx`: `#0078d4`/`#3794ff` for names,
`#848484` for muted text/icons, `#e0e0e0`/`#3c3c3c` for borders, `#f8f8f8`/`#1e1e1e`
for card background.

---

### Minimal mode detail

When `compactness === 2` and `expanded === false`:
- Root gets `tool-call-group--minimal` (signals callers/CSS the stripe mode)
- Header gets `tool-call-group-header--minimal max-h-6 overflow-hidden transition-[max-height] duration-200`
- On hover the browser expands the header naturally because hover removes the class via
  `hover:` variant; on click `expanded` flips to `true` which removes both classes

The `max-h-6` (1.5 rem) leaves just enough height to show the status icon + label as a
thin stripe, visible but unobtrusive.  The CSS `transition-[max-height]` gives a smooth
200 ms expand.

---

### `getCategoryLabel` signature (from Commit 001)

The caller passes `toolCalls.map(tc => tc.toolName)` as the second argument.
The utility in `toolGroupUtils.ts` is expected to:
1. Count occurrences of each name: `{ view: 3, glob: 1 }`
2. Format as `"4 read operations (glob×1, view×3)"` (alphabetical or insertion-order)

The component does not contain this logic itself — it delegates entirely to `getCategoryLabel`.

---

## Tests

**File:** `packages/coc/test/spa/react/ToolCallGroupView.test.ts`

Tests run under Vitest (matching all other SPA test files in `test/spa/react/`).
They import the component and call pure helper functions extracted for testability,
rather than mounting a JSDOM tree (consistent with e.g. `timeline-utils.test.ts`).

### Test cases

#### 1 — `groupStartLabel` / `groupDuration` pure helpers

```ts
describe('groupStartLabel', () => {
    it('returns empty string when no toolCalls have startTime', () => { ... });
    it('formats first startTime as MM/DD HH:MM:SSZ', () => { ... });
    it('uses the earliest startTime across multiple calls', () => { ... });
});

describe('groupDuration', () => {
    it('returns empty string when no timing data', () => { ... });
    it('returns ms string for sub-second durations', () => { ... });
    it('returns Xs string for multi-second durations', () => { ... });
    it('spans from first start to last end', () => { ... });
});
```

#### 2 — Status icon derivation

```ts
describe('status icon derivation', () => {
    it('returns ✅ when all toolCalls have status completed', () => { ... });
    it('returns ❌ when any toolCall has status failed', () => { ... });
    it('returns 🔄 when any toolCall has status running', () => { ... });
});
```

#### 3 — CATEGORY_ICONS map

```ts
it('maps read → 📄, write → ✏️, shell → 💻', () => {
    expect(CATEGORY_ICONS['read']).toBe('📄');
    expect(CATEGORY_ICONS['write']).toBe('✏️');
    expect(CATEGORY_ICONS['shell']).toBe('💻');
});
```

#### 4 — Component props smoke test (JSX shape)

Use a minimal React `createElement` call and check the returned element's `props`:

```ts
import { ToolCallGroupView } from '../../../src/server/spa/client/react/processes/ToolCallGroupView';

it('renders without throwing', () => {
    const toolCalls = [
        { id: 'tc1', toolName: 'view', status: 'completed', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T00:00:01Z' },
        { id: 'tc2', toolName: 'glob', status: 'completed', startTime: '2025-01-01T00:00:01Z', endTime: '2025-01-01T00:00:02Z' },
    ];
    const el = createElement(ToolCallGroupView, {
        category: 'read',
        toolCalls,
        compactness: 0,
        renderToolTree: () => null,
    });
    expect(el).toBeTruthy();
    expect(el.props.category).toBe('read');
});
```

#### 5 — Exported surface

```ts
it('exports ToolCallGroupView as named export', () => {
    const mod = await import('../../../src/server/spa/client/react/processes/ToolCallGroupView');
    expect(typeof mod.ToolCallGroupView).toBe('function');
});
```

---

## Acceptance Criteria

1. `ToolCallGroupView.tsx` exists at the specified path and compiles under `tsc --noEmit`.
2. Header row is always visible; body is hidden when `expanded === false`.
3. Clicking the header (or pressing Enter/Space) toggles `expanded`.
4. `aria-expanded` attribute reflects the current `expanded` value.
5. When `isStreaming` is `true`, `expanded` is forced to `true`; when it returns to `false`,
   `expanded` resets to `false`.
6. When `compactness === 2` and `expanded === false`, the root element has CSS class
   `tool-call-group--minimal` and the header has `tool-call-group-header--minimal`.
7. The summary label is produced by `getCategoryLabel` from `toolGroupUtils.ts` (not
   hand-coded inline).
8. Time display follows the same `MM/DD HH:MM:SSZ` + duration format as `ToolCallView.tsx`.
9. Status icon is `✅` only when **all** tool calls in the group succeeded; `❌` if any
   failed; `🔄` otherwise.
10. `renderToolTree(tc.id, 0)` is called once per tool call in the group when expanded,
    with depth `0`.
11. All Vitest tests in `ToolCallGroupView.test.ts` pass (`npm run test:run` in
    `packages/coc/`).

---

## Dependencies

- **Commit 001** must be applied first:
  - `ToolGroupCategory` type (`'read' | 'write' | 'shell'`)
  - `getCategoryLabel(category: ToolGroupCategory, toolNames: string[]): string`
  - Both exported from `processes/toolGroupUtils.ts`
- No other commits are required before this one.

---

## Assumed Prior State

- `packages/coc/src/server/spa/client/react/processes/toolGroupUtils.ts` exists with
  at minimum:
  ```ts
  export type ToolGroupCategory = 'read' | 'write' | 'shell';
  export function getCategoryLabel(category: ToolGroupCategory, toolNames: string[]): string;
  ```
- `cn()` is available from `../shared` (already used by `ToolCallView.tsx`).
- `RenderToolCall` shape matches lines 48-59 of `ConversationTurnBubble.tsx`:
  `id`, `toolName`, `name?`, `args`, `result?`, `error?`, `status?`, `startTime?`,
  `endTime?`, `parentToolCallId?`.
- No existing `ToolCallGroupView.tsx` or `ToolCallGroupView.test.ts` file.
- Vitest test runner is already configured for `packages/coc/test/spa/react/`
  (confirmed by `timeline-utils.test.ts` and many other files in that directory).
