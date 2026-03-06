---
status: done
---

# 005 — ReposView Mobile Responsiveness

## Overview

Adapt `ReposView.tsx` from a hard-coded two-pane desktop layout to a responsive **master-detail navigation pattern** on mobile. On phones, the user sees either the repo card list (master) or the repo detail with sub-tabs (detail) — never both. The existing desktop collapse behavior (`reposSidebarCollapsed` ↔ `MiniReposSidebar`) is preserved pixel-identically. Sub-tabs in `RepoDetail` become a horizontally scrollable strip on mobile.

**Depends on:** 001 (`useBreakpoint`), 002 (`ResponsiveSidebar`)

---

## Current Architecture

**File:** `packages/coc/src/server/spa/client/react/repos/ReposView.tsx`

```
┌─ #view-repos (flex, h-[calc(100vh-48px)]) ──────────────────────────┐
│ ┌─ aside (w-280px / w-48px collapsed) ─┐ ┌─ main (flex-1) ─────────┐│
│ │ ReposGrid (full sidebar)             │ │ RepoDetail              ││
│ │   or MiniReposSidebar (collapsed)    │ │   header + sub-tabs     ││
│ │ transition-[width,min-width,opacity] │ │   tab content           ││
│ │ duration-150 ease-out                │ │                         ││
│ └──────────────────────────────────────┘ └─────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

**State that drives selection and sidebar:**
- `state.selectedRepoId: string | null` — which repo's detail is shown (via `SET_SELECTED_REPO`)
- `state.reposSidebarCollapsed: boolean` — toggles between `ReposGrid` and `MiniReposSidebar` (via `TOGGLE_REPOS_SIDEBAR`)
- `state.activeRepoSubTab: RepoSubTab` — active tab in `RepoDetail` (via `SET_REPO_SUB_TAB`)

**Sidebar collapse mechanics (desktop only):**
- Expanded: `w-[280px] min-w-[240px]` → renders `ReposGrid` (searchable, grouped by remote)
- Collapsed: `w-12 min-w-[48px]` → renders `MiniReposSidebar` (color dots, 1–2 letter labels)
- Toggle dispatched from `TopBar.tsx` hamburger button (only on `repos` tab)
- `MiniReposSidebar` double-click: selects repo AND expands sidebar

**Sub-tabs in RepoDetail:**
```tsx
<div className="flex border-b border-[#e0e0e0] dark:border-[#3c3c3c] px-4">
    {SUB_TABS.map(t => (
        <button className={cn(
            'repo-sub-tab px-3 py-2 text-xs font-medium transition-colors relative',
            activeSubTab === t.key
                ? 'active text-[#0078d4] dark:text-[#3794ff]'
                : 'text-[#616161] dark:text-[#999] ...'
        )}>
            {t.label}
            {/* badges for tasks, queue running/queued, chat pending */}
            {activeSubTab === t.key && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#0078d4] dark:bg-[#3794ff]" />
            )}
        </button>
    ))}
</div>
```
Tabs: info, git, pipelines, tasks, queue, schedules, chat (7 total — too many to fit on mobile without scrolling).

---

## Target Layout by Breakpoint

### Mobile (< 768px) — Master-Detail Navigation

```
STATE A: No selection (master)          STATE B: Repo selected (detail)
┌────────────────────────────┐          ┌────────────────────────────┐
│ ┌────────────────────────┐ │          │ [← Back]  Repo Name       │
│ │ ReposGrid              │ │          │ ┌────────────────────────┐ │
│ │ (full-width, vertical  │ │  tap →   │ │ [Info|Git|Pipe|Task|…] │ │
│ │  card list, scrolls)   │ │  ───→    │ │ ← scrollable tab strip │ │
│ │                        │ │  ←───    │ │ ────────────────────── │ │
│ │ RepoCard (full-width)  │ │  ← back  │ │ Tab content            │ │
│ │ RepoCard (full-width)  │ │          │ │ (full-width, scrolls)  │ │
│ │ ...                    │ │          │ └────────────────────────┘ │
│ └────────────────────────┘ │          │                            │
│ ▄▄▄▄ BottomNav ▄▄▄▄▄▄▄▄▄▄ │          │ ▄▄▄▄ BottomNav ▄▄▄▄▄▄▄▄▄▄ │
└────────────────────────────┘          └────────────────────────────┘
h = calc(100vh - 48px - 56px)          h = calc(100vh - 48px - 56px)
     (top bar)  (bottom nav)
```

**View toggle logic:**
```ts
const hasSelection = state.selectedRepoId !== null;

if (isMobile) {
    if (hasSelection) → render RepoDetail full-screen with back button header
    else              → render ReposGrid full-width (single-column card list)
} else {
    → render current sidebar + detail layout unchanged
}
```

**On mobile:**
- `MiniReposSidebar` is never rendered (no 48px rail on phones)
- `reposSidebarCollapsed` state is ignored
- `ReposGrid` renders full-width without the sidebar wrapper
- `RepoCard` components stack vertically (single column, full-width)

### Tablet (768px–1023px) — Collapsible Sidebar

```
┌─ ResponsiveSidebar (260px, collapsible) ─┬─ main ──────────┐
│ ReposGrid                                │ RepoDetail       │
│ (grouped repo cards)                     │ (sub-tabs + tab  │
│                                          │  content)        │
└──────────────────────────────────────────┴──────────────────┘
```

- Sidebar rendered inside `<ResponsiveSidebar width={260} collapsible>`
- When collapsed, main panel takes full width
- `MiniReposSidebar` is NOT used on tablet — collapse hides sidebar entirely
- `reposSidebarCollapsed` state is ignored (collapse handled by `ResponsiveSidebar` internals)

### Desktop (≥ 1024px) — Unchanged (Preserve Existing Behavior Exactly)

```
┌─ aside (w-280px / w-48px collapsed) ─┬─ main ──────────────┐
│ ReposGrid (expanded)                 │ RepoDetail           │
│   or MiniReposSidebar (collapsed)    │                      │
└──────────────────────────────────────┴──────────────────────┘
```

**Critical:** Desktop layout must be pixel-identical to current behavior:
- `w-[280px] min-w-[240px]` expanded, `w-12 min-w-[48px]` collapsed
- `transition-[width,min-width,opacity] duration-150 ease-out` preserved
- `TOGGLE_REPOS_SIDEBAR` dispatch from TopBar still switches between `ReposGrid` and `MiniReposSidebar`
- `MiniReposSidebar` double-click still expands and selects
- `state.reposSidebarCollapsed` still drives the aside width

Implementation strategy: on desktop, render the existing `<aside>` element with the same classes and conditional logic — do NOT wrap in `ResponsiveSidebar`. Only tablet uses `ResponsiveSidebar`.

---

## Detailed Changes

### 1. ReposView.tsx — Component Restructure

**Imports to add:**
```ts
import { useBreakpoint } from '../hooks/useBreakpoint';
import { ResponsiveSidebar } from '../shared/ResponsiveSidebar';
```

**New derived values:**
```ts
const { breakpoint } = useBreakpoint();
const isMobile = breakpoint === 'mobile';
const isTablet = breakpoint === 'tablet';
const hasSelection = state.selectedRepoId !== null;
```

**Height class:**
```ts
const heightClass = isMobile
    ? 'h-[calc(100vh-48px-56px)]'   // top bar + bottom nav
    : 'h-[calc(100vh-48px)]';       // top bar only
```

**Back handler:**
```ts
const handleBack = useCallback(() => {
    dispatch({ type: 'SET_SELECTED_REPO', id: null });
    if (location.hash.startsWith('#repo/')) {
        location.hash = '#repos';
    }
}, [dispatch]);
```

**Rewritten JSX structure:**

```tsx
<div id="view-repos" className={`flex ${heightClass} overflow-hidden`}>
    {isMobile ? (
        // ── Mobile: master-detail ──
        hasSelection ? (
            <div className="flex-1 min-w-0 min-h-0 flex flex-col">
                <MobileRepoHeader onBack={handleBack} />
                <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-white dark:bg-[#1e1e1e] overflow-hidden">
                    <RepoDetail />
                </main>
            </div>
        ) : (
            <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-[#f3f3f3] dark:bg-[#252526] overflow-hidden">
                <ReposGrid />
            </div>
        )
    ) : isTablet ? (
        // ── Tablet: collapsible sidebar via ResponsiveSidebar ──
        <>
            <ResponsiveSidebar width={260} collapsible>
                <ReposGrid />
            </ResponsiveSidebar>
            <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-white dark:bg-[#1e1e1e] overflow-hidden">
                <RepoDetail />
            </main>
        </>
    ) : (
        // ── Desktop: existing aside with collapse to MiniReposSidebar ──
        <>
            <aside className={cn(
                'shrink-0 min-h-0 flex flex-col overflow-hidden transition-[width,min-width,opacity] duration-150 ease-out border-r border-[#e0e0e0] dark:border-[#3c3c3c]',
                state.reposSidebarCollapsed
                    ? 'w-12 min-w-[48px]'
                    : 'w-[280px] min-w-[240px]'
            )}>
                {state.reposSidebarCollapsed ? <MiniReposSidebar ... /> : <ReposGrid />}
            </aside>
            <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-white dark:bg-[#1e1e1e] overflow-hidden">
                <RepoDetail />
            </main>
        </>
    )}
</div>
```

**Why desktop aside is NOT wrapped in `ResponsiveSidebar`:** The existing collapse behavior uses `reposSidebarCollapsed` state to switch between two entirely different components (`ReposGrid` ↔ `MiniReposSidebar`) with a CSS width transition. `ResponsiveSidebar` handles a simple show/hide pattern. Wrapping the aside would break the `MiniReposSidebar` rail, the 48px collapsed width, and the TopBar hamburger toggle. Preserving the raw `<aside>` on desktop keeps the behavior pixel-identical with zero risk.

### 2. MobileRepoHeader — Local Component

Defined inside `ReposView.tsx` (not exported). Provides a back arrow and repo name.

```tsx
function MobileRepoHeader({ onBack }: { onBack: () => void }) {
    return (
        <div className="flex items-center h-11 px-3 gap-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] shrink-0">
            <button
                onClick={onBack}
                className="flex items-center justify-center w-8 h-8 rounded hover:bg-[#e0e0e0] dark:hover:bg-[#3c3c3c] transition-colors"
                aria-label="Back to repository list"
                data-testid="mobile-back-button"
            >
                ←
            </button>
            <span className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc] truncate">
                Repositories
            </span>
        </div>
    );
}
```

**Key requirements:**
- `h-11` (44px) for touch-friendly tap target
- `data-testid="mobile-back-button"` for test targeting
- `aria-label` for accessibility
- `shrink-0` so it doesn't collapse under long content

### 3. RepoDetail Sub-Tabs — Scrollable Tab Strip on Mobile

**File:** `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx`

The tab bar container gains responsive overflow behavior. The 7 sub-tabs (info, git, pipelines, tasks, queue, schedules, chat) don't all fit on a 375px screen at `px-3` each.

**Current tab container:**
```tsx
<div className="flex border-b border-[#e0e0e0] dark:border-[#3c3c3c] px-4">
```

**New tab container:**
```tsx
<div
    ref={tabStripRef}
    className={cn(
        'flex border-b border-[#e0e0e0] dark:border-[#3c3c3c] px-4',
        'overflow-x-auto scrollbar-hide',
        '-webkit-overflow-scrolling-touch'
    )}
    data-testid="repo-sub-tab-strip"
>
```

**Additions:**
- `overflow-x-auto` — enables horizontal scrolling when tabs overflow
- `scrollbar-hide` — Tailwind utility to hide the scrollbar visually (already available via `tailwind-scrollbar-hide` plugin, or add a small CSS rule: `.scrollbar-hide::-webkit-scrollbar { display: none; } .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }`)
- `-webkit-overflow-scrolling: touch` — momentum scrolling on iOS (apply via inline style or Tailwind arbitrary: `[--webkit-overflow-scrolling:touch]`)
- `data-testid="repo-sub-tab-strip"` — for test assertions on scroll behavior

**Tab buttons — prevent text wrapping:**
```tsx
<button
    key={t.key}
    data-subtab={t.key}
    className={cn(
        'repo-sub-tab px-3 py-2 text-xs font-medium transition-colors relative whitespace-nowrap shrink-0',
        // ... existing active/inactive classes unchanged
    )}
>
```

Additions to each tab button:
- `whitespace-nowrap` — prevents label text from wrapping
- `shrink-0` — prevents flex from compressing tab buttons

**Auto-scroll active tab into view:**

Add a `useEffect` in `RepoDetail` that scrolls the active tab into view when `activeSubTab` changes:

```ts
const tabStripRef = useRef<HTMLDivElement>(null);

useEffect(() => {
    if (!tabStripRef.current) return;
    const activeBtn = tabStripRef.current.querySelector(
        `[data-subtab="${activeSubTab}"]`
    ) as HTMLElement | null;
    if (activeBtn) {
        activeBtn.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'center',
        });
    }
}, [activeSubTab]);
```

This uses the existing `data-subtab` attribute already on each button. `inline: 'center'` positions the active tab in the horizontal center of the scroll container. `block: 'nearest'` prevents vertical scrolling.

**Desktop impact:** None. On desktop, all 7 tabs fit within the container, so `overflow-x-auto` has no visible effect. `scrollbar-hide` and `whitespace-nowrap` are no-ops when content doesn't overflow. The `scrollIntoView` call is a no-op when the element is already visible.

### 4. RepoCard Layout on Mobile

**File:** `packages/coc/src/server/spa/client/react/repos/RepoCard.tsx`

`RepoCard` is currently rendered inside `ReposGrid` which uses a scrollable flex column (`flex flex-col gap-1`). The cards already take available width within the sidebar. On mobile, `ReposGrid` renders full-width (no sidebar constraint), so cards automatically become full-width.

**Minimal change needed:** Ensure cards don't have any `max-width` or fixed-width constraints that would prevent full-width rendering. Current card uses `<Card className="repo-item p-2">` which relies on the `Card` component's default `w-full` behavior — no changes needed.

**Badge positioning:** The stats row at the bottom of `RepoCard` uses `flex flex-wrap gap-1` for badges (branch, task count, pipeline count, etc.). This already wraps on narrow widths. On mobile full-width, badges have more room and may unwrap into a single row — this is acceptable and visually cleaner.

**Grid vs list:** `ReposGrid` currently renders cards in a flex column, not a CSS grid. On mobile, this naturally becomes a single-column vertical list. No grid-to-list conversion needed.

### 5. Back Navigation Flow

```
┌─────────────────────────────────────────────┐
│            ReposView (mobile)               │
│                                             │
│  ┌──────────┐        ┌───────────────────┐  │
│  │  CARD    │ select  │                   │  │
│  │  LIST    │ ──────→ │  REPO DETAIL      │  │
│  │          │         │  + sub-tab strip   │  │
│  │ ReposGrid│ ←────── │  + tab content     │  │
│  │(full-w)  │  back   │  (full-screen)     │  │
│  └──────────┘        └───────────────────┘  │
│                                             │
│  Transitions driven by:                     │
│  • SET_SELECTED_REPO { id }  → DETAIL       │
│  • handleBack()              → CARD LIST    │
│    (sets selectedRepoId to null)            │
└─────────────────────────────────────────────┘
```

**Selection happens inside `ReposGrid`:** When user taps a `RepoCard`, `ReposGrid` dispatches `SET_SELECTED_REPO` with the repo ID. This causes `ReposView` to re-render; since `hasSelection` is now true, the mobile branch shows `RepoDetail` instead of `ReposGrid`.

**Back clears selection:** `handleBack` dispatches `SET_SELECTED_REPO` with `null`, returning `hasSelection` to false, which shows `ReposGrid` again. Hash is also synced to avoid stale URL state.

**No changes to `ReposGrid` or `RepoCard`:** Their existing click handlers and dispatch calls drive the view switch automatically.

---

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `packages/coc/src/server/spa/client/react/repos/ReposView.tsx` | **Modify** | Add `useBreakpoint` hook; branch layout into mobile/tablet/desktop; add `MobileRepoHeader` local component; add `handleBack` with hash sync; use `ResponsiveSidebar` for tablet; preserve raw `<aside>` for desktop collapse |
| `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx` | **Modify** | Add `overflow-x-auto scrollbar-hide` to sub-tab strip container; add `whitespace-nowrap shrink-0` to tab buttons; add `tabStripRef` and `useEffect` for auto-scroll on active tab change; add `data-testid="repo-sub-tab-strip"` |
| `packages/coc/test/spa/react/repos/ReposView.responsive.test.tsx` | **Create** | Unit tests for all responsive behaviors |

**Not changed (intentionally):**
- `ReposGrid.tsx` — renders unchanged, just full-width on mobile instead of sidebar-width
- `RepoCard.tsx` — no layout changes needed; cards already adapt to available width
- `MiniReposSidebar.tsx` — unchanged; only rendered on desktop
- `TopBar.tsx` — hamburger toggle still dispatches `TOGGLE_REPOS_SIDEBAR`; on mobile/tablet the aside isn't rendered so the toggle is ignored naturally
- `AppContext.tsx` — no reducer changes needed

---

## Scrollbar-Hide CSS

If the project does not already have a `scrollbar-hide` utility, add a small CSS block to the global styles or as a Tailwind plugin:

```css
.scrollbar-hide::-webkit-scrollbar {
    display: none;
}
.scrollbar-hide {
    -ms-overflow-style: none;
    scrollbar-width: none;
}
```

Alternatively, if using Tailwind's `@layer utilities`:
```css
@layer utilities {
    .scrollbar-hide {
        -ms-overflow-style: none;
        scrollbar-width: none;
    }
    .scrollbar-hide::-webkit-scrollbar {
        display: none;
    }
}
```

Check if this utility already exists before adding — search for `scrollbar-hide` or `scrollbar-width: none` in existing CSS/Tailwind config.

---

## Test Plan

**File:** `packages/coc/test/spa/react/repos/ReposView.responsive.test.tsx`

All tests mock `useBreakpoint` to control the returned breakpoint value and provide minimal AppContext wrappers. Follow existing test patterns from `packages/coc/test/spa/react/` (Vitest + @testing-library/react + jsdom).

**Setup:**
```ts
/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock useBreakpoint to control breakpoint
vi.mock('../hooks/useBreakpoint', () => ({
    useBreakpoint: vi.fn(),
}));

// Mock child components to isolate ReposView logic
vi.mock('./ReposGrid', () => ({ default: () => <div data-testid="repos-grid" /> }));
vi.mock('./RepoDetail', () => ({ default: () => <div data-testid="repo-detail" /> }));
vi.mock('./MiniReposSidebar', () => ({ default: () => <div data-testid="mini-sidebar" /> }));
```

### Test 1: Desktop — two-pane layout with 280px sidebar, collapse still works
```
Mock: useBreakpoint → 'desktop'
Mock: state.reposSidebarCollapsed = false
Assert: <aside> element rendered with class 'w-[280px]'
Assert: ReposGrid inside aside
Assert: RepoDetail in main panel
Assert: no MobileRepoHeader rendered
Mock: state.reposSidebarCollapsed = true
Re-render
Assert: <aside> element has class 'w-12'
Assert: MiniReposSidebar inside aside (not ReposGrid)
```

### Test 2: Desktop — transition classes preserved
```
Mock: useBreakpoint → 'desktop'
Assert: <aside> has class 'transition-[width,min-width,opacity]'
Assert: <aside> has class 'duration-150'
Assert: <aside> has class 'ease-out'
```

### Test 3: Mobile — no selection shows full-width card list, no sidebar
```
Mock: useBreakpoint → 'mobile'
Mock: state.selectedRepoId = null
Assert: data-testid="repos-grid" rendered
Assert: no <aside> element rendered
Assert: no data-testid="repo-detail" rendered
Assert: no data-testid="mini-sidebar" rendered
Assert: container height class includes bottom nav offset (h-[calc(100vh-48px-56px)])
```

### Test 4: Mobile — selected repo shows full-screen detail with back button
```
Mock: useBreakpoint → 'mobile'
Mock: state.selectedRepoId = 'repo-1'
Assert: data-testid="repo-detail" rendered
Assert: data-testid="repos-grid" NOT rendered
Assert: data-testid="mobile-back-button" rendered
Assert: aria-label="Back to repository list" on back button
```

### Test 5: Mobile — back button clears selection and returns to card list
```
Mock: useBreakpoint → 'mobile'
Mock: state.selectedRepoId = 'repo-1'
Action: click data-testid="mobile-back-button"
Assert: dispatch called with { type: 'SET_SELECTED_REPO', id: null }
Assert: after re-render with selectedRepoId=null, data-testid="repos-grid" is visible
```

### Test 6: Tablet — sidebar at 260px via ResponsiveSidebar
```
Mock: useBreakpoint → 'tablet'
Assert: ResponsiveSidebar rendered with width={260} prop
Assert: ReposGrid inside ResponsiveSidebar
Assert: RepoDetail in main panel
Assert: no <aside> element (tablet uses ResponsiveSidebar, not raw aside)
Assert: no MiniReposSidebar rendered
```

### Test 7: Sub-tab strip scrolls horizontally on mobile
```
Mock: useBreakpoint → 'mobile'
Mock: state.selectedRepoId = 'repo-1'
(Render actual RepoDetail, not mock)
Assert: data-testid="repo-sub-tab-strip" has class 'overflow-x-auto'
Assert: data-testid="repo-sub-tab-strip" has class 'scrollbar-hide'
Assert: all 7 tab buttons have class 'whitespace-nowrap'
Assert: all 7 tab buttons have class 'shrink-0'
```

### Test 8: Sub-tab auto-scrolls active tab into view
```
Mock: scrollIntoView on tab button elements
Render RepoDetail with activeSubTab = 'chat' (last tab, likely off-screen)
Assert: scrollIntoView called on the 'chat' tab button
Assert: called with { behavior: 'smooth', block: 'nearest', inline: 'center' }
```

### Test 9: Desktop — height calculation excludes bottom nav
```
Mock: useBreakpoint → 'desktop'
Assert: #view-repos has class 'h-[calc(100vh-48px)]'
Assert: #view-repos does NOT have class containing '56px'
```

### Test 10: Mobile — height calculation includes bottom nav
```
Mock: useBreakpoint → 'mobile'
Assert: #view-repos has class 'h-[calc(100vh-48px-56px)]'
```

---

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| User on mobile selects repo, then rotates to tablet/desktop | Two-pane layout appears with the selected repo shown in detail panel; no back button needed |
| User on desktop with repo selected, resizes to mobile | Detail view appears immediately (since `selectedRepoId` is non-null) with back button |
| Desktop collapse toggle fired while on mobile | `reposSidebarCollapsed` state changes but has no visible effect (no aside rendered on mobile) |
| Hash route `#repo/<id>` opened directly on mobile | Router sets `selectedRepoId`; mobile shows detail view with back button |
| Sub-tab strip on desktop (all tabs fit) | `overflow-x-auto` has no effect; no scrollbar shown; `scrollIntoView` is a no-op |
| Sub-tab strip on mobile (tabs overflow) | Horizontal swipe scrolls tabs; active tab auto-centered; no visible scrollbar |
| Switching sub-tabs rapidly on mobile | `scrollIntoView` with `behavior: 'smooth'` queues smoothly; no jank |
| 20+ repos on mobile | `ReposGrid` already uses `overflow-y-auto`; vertical scrolling works full-width |
| RepoCard with many badges on mobile | Badge row uses `flex-wrap`; wraps to second line if needed; more room on full-width |
| `MiniReposSidebar` double-click on desktop | Still works — expands sidebar and selects repo; desktop aside code path unchanged |

---

## Implementation Sequence

1. Add `scrollbar-hide` CSS utility if not already present
2. **RepoDetail.tsx:** Add `tabStripRef`, `overflow-x-auto scrollbar-hide` to tab container, `whitespace-nowrap shrink-0` to tab buttons, `useEffect` for auto-scroll, `data-testid`
3. **ReposView.tsx:** Add imports (`useBreakpoint`, `ResponsiveSidebar`, `useCallback`)
4. Add derived values (`isMobile`, `isTablet`, `hasSelection`, `heightClass`)
5. Define `handleBack` function with hash sync
6. Define `MobileRepoHeader` local component
7. Rewrite JSX with mobile/tablet/desktop branching, preserving desktop aside exactly
8. Create test file `packages/coc/test/spa/react/repos/ReposView.responsive.test.tsx` with all 10 tests
9. Run `npm run build` and `cd packages/coc && npm run test:run` to verify
