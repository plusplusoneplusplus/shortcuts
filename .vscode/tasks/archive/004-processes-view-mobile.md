---
status: pending
---

# 004 — ProcessesView Mobile Responsiveness

## Overview

Adapt `ProcessesView.tsx` from a hard-coded two-pane desktop layout to a responsive **master-detail navigation pattern** on mobile. On phones, the user sees either the process list (master) or the process detail (detail) — never both. Selection state (`state.selectedId` / `queueState.selectedTaskId`) drives which screen is visible. Desktop layout remains pixel-identical.

**Depends on:** 001 (`useBreakpoint`), 002 (`ResponsiveSidebar`, `BottomNav`)

---

## Current Architecture

**File:** `packages/coc/src/server/spa/client/react/processes/ProcessesView.tsx` (31 lines)

```
┌─ #view-processes (flex, h-[calc(100vh-48px)]) ─────────────────┐
│ ┌─ aside (w-320px fixed) ──┐ ┌─ main (flex-1) ────────────────┐│
│ │ ProcessFilters            │ │ QueueTaskDetail | ProcessDetail ││
│ │ ProcessesSidebar (scroll) │ │                                ││
│ └───────────────────────────┘ └────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

**State that drives selection:**
- `state.selectedId: string | null` — legacy process (via `SELECT_PROCESS` action in AppContext reducer)
- `queueState.selectedTaskId: string | null` — queue task (via `SELECT_QUEUE_TASK` in QueueContext)
- Both are set when clicking items in `ProcessesSidebar`; both can be `null` (no selection)

**Key observation:** The main panel already conditionally renders `QueueTaskDetail` vs `ProcessDetail` based on `queueState.selectedTaskId`. The mobile pattern extends this: when _neither_ ID is set, mobile shows the list; when _either_ is set, mobile shows the detail.

---

## Target Layout by Breakpoint

### Mobile (< 768px) — Master-Detail Navigation

```
STATE A: No selection (master)          STATE B: Process selected (detail)
┌────────────────────────────┐          ┌────────────────────────────┐
│ [▼ Filters] (accordion)   │          │ [← Back]  Process Title    │
│ ┌────────────────────────┐ │          │ ┌────────────────────────┐ │
│ │ ProcessesSidebar       │ │  tap →   │ │ ProcessDetail          │ │
│ │ (full-width, scrolls)  │ │  ───→    │ │ (full-width, scrolls)  │ │
│ │                        │ │  ←───    │ │                        │ │
│ └────────────────────────┘ │  ← back  │ └────────────────────────┘ │
│ ▄▄▄▄ BottomNav ▄▄▄▄▄▄▄▄▄▄ │          │ ▄▄▄▄ BottomNav ▄▄▄▄▄▄▄▄▄▄ │
└────────────────────────────┘          └────────────────────────────┘
h = calc(100vh - 48px - 56px)          h = calc(100vh - 48px - 56px)
     (top bar)  (bottom nav)
```

**View toggle logic (pseudocode):**
```ts
const hasSelection = state.selectedId !== null || queueState.selectedTaskId !== null;

if (isMobile) {
    if (hasSelection) → render detail view with back button header
    else              → render list view with collapsible filters
} else {
    → render current two-pane layout unchanged
}
```

### Tablet (768px–1023px) — Collapsible Sidebar

```
┌─ ResponsiveSidebar (260px, collapsible) ─┬─ main ──────────┐
│ ProcessFilters                            │ ProcessDetail    │
│ ProcessesSidebar                          │                  │
└───────────────────────────────────────────┴──────────────────┘
```

- Sidebar rendered inside `<ResponsiveSidebar width={260} collapsible>` from commit 002
- When collapsed, main panel takes full width
- Collapse toggle handled by `ResponsiveSidebar` internals

### Desktop (≥ 1024px) — Unchanged

```
┌─ ResponsiveSidebar (320px, always visible) ─┬─ main ──────┐
│ ProcessFilters                               │ Detail      │
│ ProcessesSidebar                             │             │
└──────────────────────────────────────────────┴─────────────┘
```

- Identical to current behavior, just wrapped in `ResponsiveSidebar` at `width={320}`

---

## Detailed Changes

### 1. ProcessesView.tsx — Component Restructure

**Imports to add:**
```ts
import { useBreakpoint } from '../hooks/useBreakpoint';
import { ResponsiveSidebar } from '../shared/ResponsiveSidebar';
import { useApp } from '../context/AppContext';
import { useState } from 'react';
```

**New local state:**
```ts
const { breakpoint } = useBreakpoint();          // 'mobile' | 'tablet' | 'desktop'
const { state, dispatch } = useApp();
const isMobile = breakpoint === 'mobile';
const [filtersExpanded, setFiltersExpanded] = useState(false);
```

**Selection detection:**
```ts
const hasSelection = state.selectedId !== null || queueState.selectedTaskId !== null;
```

**Back handler (clears both selection types):**
```ts
const handleBack = () => {
    dispatch({ type: 'SELECT_PROCESS', id: null });
    queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null });
};
```
This requires destructuring `queueDispatch` from `useQueue()` (currently only `state` is destructured).

**Height class:**
```ts
const heightClass = isMobile
    ? 'h-[calc(100vh-48px-56px)]'   // top bar + bottom nav
    : 'h-[calc(100vh-48px)]';       // top bar only
```

**Rewritten JSX structure:**

```tsx
<div id="view-processes" className={`flex ${heightClass} overflow-hidden`}>
    {isMobile ? (
        // ── Mobile: master-detail ──
        hasSelection ? (
            <div className="flex-1 min-w-0 min-h-0 flex flex-col">
                <MobileDetailHeader onBack={handleBack} />
                <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-white dark:bg-[#1e1e1e]">
                    {queueState.selectedTaskId ? <QueueTaskDetail /> : <ProcessDetail />}
                </main>
            </div>
        ) : (
            <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-[#f3f3f3] dark:bg-[#252526]">
                <MobileFiltersAccordion
                    expanded={filtersExpanded}
                    onToggle={() => setFiltersExpanded(prev => !prev)}
                />
                <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
                    <ProcessesSidebar />
                </div>
            </div>
        )
    ) : (
        // ── Tablet & Desktop: sidebar + detail ──
        <>
            <ResponsiveSidebar width={breakpoint === 'tablet' ? 260 : 320}>
                <ProcessFilters />
                <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
                    <ProcessesSidebar />
                </div>
            </ResponsiveSidebar>
            <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-white dark:bg-[#1e1e1e]">
                {queueState.selectedTaskId ? <QueueTaskDetail /> : <ProcessDetail />}
            </main>
        </>
    )}
</div>
```

### 2. MobileDetailHeader — Local Component

Defined inside `ProcessesView.tsx` (not exported) or in a small helper file.

```tsx
function MobileDetailHeader({ onBack }: { onBack: () => void }) {
    return (
        <div className="flex items-center h-11 px-3 gap-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] shrink-0">
            <button
                onClick={onBack}
                className="flex items-center justify-center w-8 h-8 rounded hover:bg-[#e0e0e0] dark:hover:bg-[#3c3c3c] transition-colors"
                aria-label="Back to process list"
                data-testid="mobile-back-button"
            >
                ← {/* or use a chevron-left SVG icon */}
            </button>
            <span className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc] truncate">
                Process Detail
            </span>
        </div>
    );
}
```

**Key requirements:**
- `h-11` (44px) for touch-friendly tap target
- `data-testid="mobile-back-button"` for test targeting
- `aria-label` for accessibility
- `shrink-0` so it doesn't collapse when detail content is long

### 3. MobileFiltersAccordion — Local Component

Wraps `ProcessFilters` in a collapsible section, default collapsed.

```tsx
function MobileFiltersAccordion({
    expanded,
    onToggle,
}: {
    expanded: boolean;
    onToggle: () => void;
}) {
    return (
        <div className="border-b border-[#e0e0e0] dark:border-[#3c3c3c] shrink-0">
            <button
                onClick={onToggle}
                className="flex items-center justify-between w-full px-3 h-11 text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#e0e0e0] dark:hover:bg-[#3c3c3c] transition-colors"
                aria-expanded={expanded}
                aria-controls="mobile-process-filters"
                data-testid="mobile-filters-toggle"
            >
                <span>Filters</span>
                <span className={`transition-transform ${expanded ? 'rotate-180' : ''}`}>
                    ▼
                </span>
            </button>
            {expanded && (
                <div id="mobile-process-filters" data-testid="mobile-filters-panel">
                    <ProcessFilters />
                </div>
            )}
        </div>
    );
}
```

**Key requirements:**
- Default collapsed (`filtersExpanded` initialized to `false`)
- `h-11` toggle button for touch
- `aria-expanded` + `aria-controls` for accessibility
- Chevron rotates when expanded
- `ProcessFilters` renders full-width (its existing `w-full` classes work as-is)

### 4. QueueContext Dispatch — Destructuring Change

Current line 13:
```ts
const { state: queueState } = useQueue();
```

Change to:
```ts
const { state: queueState, dispatch: queueDispatch } = useQueue();
```

This is needed because `handleBack` must clear `selectedTaskId` via `queueDispatch`.

---

## State Machine — Mobile View Transitions

```
┌─────────────────────────────────────────────┐
│            ProcessesView (mobile)            │
│                                             │
│  ┌──────────┐        ┌───────────────────┐  │
│  │          │ select  │                   │  │
│  │  LIST    │ ──────→ │  DETAIL           │  │
│  │  VIEW    │         │  (ProcessDetail   │  │
│  │          │ ←────── │   or QueueTask)   │  │
│  │          │  back   │                   │  │
│  └──────────┘        └───────────────────┘  │
│                                             │
│  Transitions driven by:                     │
│  • SELECT_PROCESS { id }  → enters DETAIL   │
│  • SELECT_QUEUE_TASK {id} → enters DETAIL   │
│  • handleBack()           → returns to LIST │
│    (sets both IDs to null)                  │
└─────────────────────────────────────────────┘
```

**Important:** Selection happens inside `ProcessesSidebar` (via its existing onClick handlers that call `dispatch({ type: 'SELECT_PROCESS', id })` and `queueDispatch({ type: 'SELECT_QUEUE_TASK', id })`). No changes to `ProcessesSidebar` are needed for the mobile transition — the existing dispatch calls automatically trigger the view switch because `ProcessesView` re-renders when `state.selectedId` or `queueState.selectedTaskId` change.

**Hash routing interaction:** `ProcessesSidebar` also updates `location.hash` on click (e.g., `#process/<id>`). The app's router sets `selectedId` from the hash. On mobile back, `handleBack` clears `selectedId`; the hash should also be updated to `#processes` to keep URL in sync:

```ts
const handleBack = () => {
    dispatch({ type: 'SELECT_PROCESS', id: null });
    queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null });
    if (location.hash.startsWith('#process/')) {
        location.hash = '#processes';
    }
};
```

---

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `packages/coc/src/server/spa/client/react/processes/ProcessesView.tsx` | **Modify** | Replace hard-coded aside with responsive layout; add `MobileDetailHeader`, `MobileFiltersAccordion` local components; use `useBreakpoint` and `ResponsiveSidebar` |
| `packages/coc/src/server/spa/client/react/processes/ProcessesView.test.tsx` | **Create** | Unit tests for all responsive behaviors |

**Not changed (intentionally):**
- `ProcessFilters.tsx` — renders unchanged, just wrapped differently on mobile
- `ProcessesSidebar.tsx` — renders unchanged, used full-width on mobile
- `ProcessDetail.tsx` — renders unchanged, gets full screen on mobile
- `AppContext.tsx` — no reducer changes needed
- `QueueContext.tsx` — no reducer changes needed

---

## Test Plan

**File:** `packages/coc/src/server/spa/client/react/processes/ProcessesView.test.tsx`

All tests mock `useBreakpoint` to control the returned breakpoint value, and provide minimal AppContext/QueueContext wrappers.

### Test 1: Desktop — two-pane layout with 320px sidebar
```
Mock: useBreakpoint → 'desktop'
Assert: ResponsiveSidebar rendered with width={320}
Assert: ProcessFilters and ProcessesSidebar inside sidebar
Assert: main panel renders ProcessDetail or QueueTaskDetail
Assert: no MobileDetailHeader rendered
Assert: no MobileFiltersAccordion rendered
```

### Test 2: Tablet — sidebar at 260px
```
Mock: useBreakpoint → 'tablet'
Assert: ResponsiveSidebar rendered with width={260}
Assert: two-pane layout (sidebar + main) present
```

### Test 3: Mobile — no selection shows full-width list
```
Mock: useBreakpoint → 'mobile'
Mock: state.selectedId = null, queueState.selectedTaskId = null
Assert: ProcessesSidebar is rendered
Assert: no ProcessDetail rendered
Assert: no QueueTaskDetail rendered
Assert: MobileFiltersAccordion rendered (collapsed by default)
Assert: container height class includes bottom nav offset (48px + 56px)
```

### Test 4: Mobile — selected process shows full-screen detail with back button
```
Mock: useBreakpoint → 'mobile'
Mock: state.selectedId = 'proc-123'
Assert: ProcessDetail rendered
Assert: ProcessesSidebar NOT rendered
Assert: MobileDetailHeader rendered with back button (data-testid="mobile-back-button")
```

### Test 5: Mobile — selected queue task shows QueueTaskDetail
```
Mock: useBreakpoint → 'mobile'
Mock: queueState.selectedTaskId = 'task-456'
Assert: QueueTaskDetail rendered (not ProcessDetail)
Assert: MobileDetailHeader rendered
```

### Test 6: Mobile — back button clears selection and returns to list
```
Mock: useBreakpoint → 'mobile'
Mock: state.selectedId = 'proc-123'
Action: click data-testid="mobile-back-button"
Assert: dispatch called with { type: 'SELECT_PROCESS', id: null }
Assert: queueDispatch called with { type: 'SELECT_QUEUE_TASK', id: null }
Assert: after re-render, ProcessesSidebar is visible again
```

### Test 7: Mobile — filters accordion toggle
```
Mock: useBreakpoint → 'mobile', no selection
Assert: data-testid="mobile-filters-toggle" is present
Assert: data-testid="mobile-filters-panel" is NOT present (collapsed)
Action: click "mobile-filters-toggle"
Assert: data-testid="mobile-filters-panel" IS present (expanded)
Assert: ProcessFilters rendered inside the panel
Action: click "mobile-filters-toggle" again
Assert: data-testid="mobile-filters-panel" is NOT present (collapsed again)
```

### Test 8: Mobile — height calculation includes bottom nav
```
Mock: useBreakpoint → 'mobile'
Assert: #view-processes has class 'h-[calc(100vh-48px-56px)]'
```

### Test 9: Desktop — height calculation excludes bottom nav
```
Mock: useBreakpoint → 'desktop'
Assert: #view-processes has class 'h-[calc(100vh-48px)]'
```

---

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| User on mobile selects process, then rotates to desktop | Two-pane layout appears with the selected process shown in detail panel (no jarring transition) |
| User on desktop with process selected, resizes to mobile | Detail view appears immediately (since `selectedId` is non-null) with back button |
| Back button pressed when `selectedTaskId` is set (not `selectedId`) | Both IDs cleared; user returns to list |
| Hash route `#process/<id>` opened directly on mobile | Router sets `selectedId`; mobile shows detail view with back button |
| Very long process list on mobile | `ProcessesSidebar` already has `overflow-y-auto`; full-width scrolling works |
| Filters expanded on mobile, then user selects a process | View switches to detail; filter state preserved for when they come back |

---

## Implementation Sequence

1. Add imports (`useBreakpoint`, `ResponsiveSidebar`, `useApp`, `useState`)
2. Destructure `queueDispatch` from `useQueue()`
3. Add local state and derived values (`isMobile`, `hasSelection`, `filtersExpanded`, `heightClass`)
4. Define `handleBack` function with hash sync
5. Define `MobileDetailHeader` local component
6. Define `MobileFiltersAccordion` local component
7. Rewrite JSX with mobile/tablet/desktop branching
8. Write test file with all 9 test cases
9. Run `npm run build` and `npm run test:run` in `packages/coc/` to verify
