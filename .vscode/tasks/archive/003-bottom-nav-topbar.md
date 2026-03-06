---
status: pending
---

# 003 — Bottom Navigation Bar & Responsive TopBar

**Commit 3 of 8** in the mobile-responsive SPA series.
**Depends on:** 001 (useBreakpoint hook, ResponsiveSidebar, test helpers)

---

## Goal

Replace the desktop-only tab navigation in `TopBar` with a mobile bottom navigation bar and a responsive top bar that adapts across mobile / tablet / desktop breakpoints.

---

## Current State

### TopBar.tsx (lines 43–108)

```tsx
<header className="h-12 px-3 flex items-center justify-between border-b ...">
  <div className="flex items-center gap-3 min-w-0">
    <button id="hamburger-btn">☰</button>
    <span className="text-sm font-semibold">AI Execution Dashboard</span>
    <nav id="tab-bar">
      {TABS.map(({ label, tab }) => <button ...>{label}</button>)}
    </nav>
  </div>
  <div className="flex items-center gap-1">
    <span data-testid="ws-status-indicator">●</span>
    <a id="admin-toggle" href="#admin">⚙</a>
    <button id="theme-toggle">{themeEmoji}</button>
  </div>
</header>
```

- Three tabs: `TABS = [{ label: 'Repos', tab: 'repos' }, { label: 'Processes', tab: 'processes' }, { label: 'Wiki', tab: 'wiki' }]`
- Tab switching: `dispatch({ type: 'SET_ACTIVE_TAB', tab })` + `location.hash = '#' + tab`
- `DashboardTab = 'processes' | 'repos' | 'wiki' | 'reports' | 'admin'`
- Icons are Unicode/emoji strings (☰, ⚙, 🌗/🌙/☀️) — no SVG icon library in use

### Content area heights (set per-view, NOT in App.tsx)

These four locations use `h-[calc(100vh-48px)]` to fill below the 48px TopBar:

| File | Line | Class |
|------|------|-------|
| `processes/ProcessesView.tsx` | 16 | `flex h-[calc(100vh-48px)] overflow-hidden` |
| `repos/ReposView.tsx` | 155 | `flex items-center justify-center h-[calc(100vh-48px)]` (empty state) |
| `repos/ReposView.tsx` | 162 | `flex h-[calc(100vh-48px)] overflow-hidden` (normal state) |
| `wiki/WikiDetail.tsx` | 187 | `flex flex-col h-[calc(100vh-48px)] overflow-hidden` |

### App.tsx layout (AppInner, line 302–316)

```tsx
<ToastProvider ...>
  <TopBar />       {/* h-12 = 48px, no wrapper div */}
  <Router />       {/* renders view components directly */}
  <ToastContainer />
  <EnqueueDialog />
  <MarkdownReviewDialog />
</ToastProvider>
```

No intermediate content wrapper — each view manages its own height.

---

## Design Decisions

### 1. Bottom Nav z-index: `z-[8000]`

The codebase's z-index layers (from the spec):
- Bottom nav: **8000**
- Sidebar drawer (from 001/002): **9000** (overlays bottom nav)
- Dialogs (EnqueueDialog, MarkdownReviewDialog): **10002** (overlays everything)

### 2. Icon approach: inline SVG, not a library

The SPA already uses inline SVG paths (e.g., `GitPanelHeader.tsx` branch icon at 16×16 viewBox). We follow the same pattern — three small SVG icon components for Repos, Processes, Wiki. No icon library dependency.

Icon choices (Heroicons-style, 24×24 viewBox):
- **Repos** → folder icon (outlined inactive, filled active)
- **Processes** → play-circle icon (outlined inactive, filled active)
- **Wiki** → book-open icon (outlined inactive, filled active)

### 3. Admin link → hamburger menu on mobile

Admin is not a primary navigation target. On mobile, the admin link (⚙) stays in the TopBar's right-hand controls rather than becoming a 4th bottom nav item. This keeps the bottom nav clean with exactly 3 items.

### 4. Content height strategy

Rather than wrapping all views in a shared container, we update each view's `calc()` expression to be breakpoint-aware:
- Mobile (< 768px): `h-[calc(100vh-48px-56px)]` — top bar (48px) + bottom nav (56px)
- Desktop (≥ 768px): `h-[calc(100vh-48px)]` — unchanged

This uses the `md:` Tailwind prefix: `h-[calc(100vh-48px-56px)] md:h-[calc(100vh-48px)]`.

### 5. Safe area inset

iPhone notch/home indicator: `padding-bottom: env(safe-area-inset-bottom)` on the bottom nav. The 56px height is the _minimum_ — the safe area padding extends it further on notched devices.

---

## Files to Create

### `packages/coc/src/server/spa/client/react/layout/BottomNav.tsx`

```
New file — mobile bottom navigation bar.
```

**Structure:**

```tsx
import { useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { useBreakpoint } from '../hooks/useBreakpoint';  // from commit 001
import type { DashboardTab } from '../types/dashboard';

// --- Inline SVG icon components (24×24 viewBox) ---

// FolderIcon: Heroicons folder (outlined variant + filled variant)
// PlayCircleIcon: Heroicons play-circle
// BookOpenIcon: Heroicons book-open

interface NavItem {
  tab: DashboardTab;
  label: string;
  icon: (active: boolean) => JSX.Element;
}

const NAV_ITEMS: NavItem[] = [
  { tab: 'repos',     label: 'Repos',     icon: (active) => active ? <FolderIconFilled /> : <FolderIconOutline /> },
  { tab: 'processes', label: 'Processes', icon: (active) => active ? <PlayCircleIconFilled /> : <PlayCircleIconOutline /> },
  { tab: 'wiki',      label: 'Wiki',      icon: (active) => active ? <BookOpenIconFilled /> : <BookOpenIconOutline /> },
];

export function BottomNav() { ... }
```

**Rendering logic:**

- Call `useBreakpoint()` — if `isDesktop` or `isTablet` (≥ 768px), return `null` (don't render)
- Render a `<nav>` with:
  - Position: `fixed bottom-0 left-0 right-0 z-[8000]`
  - Height: `h-14` (56px)
  - Background: `bg-[#f3f3f3] dark:bg-[#252526]` (matches TopBar)
  - Border top: `border-t border-[#e0e0e0] dark:border-[#3c3c3c]`
  - Safe area: `pb-[env(safe-area-inset-bottom)]` via inline style `{ paddingBottom: 'env(safe-area-inset-bottom)' }`
  - Flex row: `flex items-center justify-around`
- Each item is a `<button>` with:
  - Tap target: `flex-1 h-full` (full height of 56px, spans 1/3 width)
  - Content: column layout `flex flex-col items-center justify-center gap-0.5`
  - Icon: `w-6 h-6` SVG
  - Label: `text-[10px] font-medium`
  - Active color: `text-[#0078d4]` (matches existing active tab accent)
  - Inactive color: `text-[#616161] dark:text-[#999999]`
  - `aria-current="page"` when active
  - `data-tab={tab}` for test selectors
  - onClick: `dispatch({ type: 'SET_ACTIVE_TAB', tab })` + `location.hash = '#' + tab`

**SVG icon details (24×24, currentColor):**

Each icon pair (outlined + filled) is a small functional component. The SVGs use `fill="none" stroke="currentColor" strokeWidth={1.5}` for outlined, and `fill="currentColor"` for filled. Paths sourced from Heroicons 24/outline and 24/solid sets:

- **FolderIconOutline**: `M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25...` (standard Heroicons folder)
- **FolderIconFilled**: solid variant
- **PlayCircleIconOutline**: `M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z` + play triangle
- **PlayCircleIconFilled**: solid variant
- **BookOpenIconOutline**: `M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062...`
- **BookOpenIconFilled**: solid variant

---

## Files to Modify

### 1. `packages/coc/src/server/spa/client/react/layout/TopBar.tsx`

**Changes:**

1. **Import `useBreakpoint`** from `../hooks/useBreakpoint`

2. **Conditionally hide tab bar on mobile:**
   - Wrap the `<nav id="tab-bar">` in a responsive visibility class: `hidden md:flex`
   - This hides tabs below 768px (where BottomNav takes over)

3. **Responsive title:**
   - Replace the static `<span>` title with:
     - Mobile (< 768px): show abbreviated text "CoC" or a small icon — use `md:hidden` / `hidden md:inline` pattern
     - Desktop (≥ 768px): show full "AI Execution Dashboard" — `hidden md:inline`
   - Implementation: two `<span>` elements with opposite visibility classes

4. **Keep all right-side controls** (WS indicator, admin link, theme toggle) visible at all breakpoints — these are small enough and important enough to remain.

**Diff sketch:**

```diff
 import { useCallback } from 'react';
 import { useApp } from '../context/AppContext';
 import { useTheme } from './ThemeProvider';
+import { useBreakpoint } from '../hooks/useBreakpoint';
 import type { DashboardTab } from '../types/dashboard';
 import type { WsStatus } from '../hooks/useWebSocket';

 export function TopBar() {
     const { state, dispatch } = useApp();
     const { theme, toggleTheme } = useTheme();
+    const { isMobile } = useBreakpoint();

     // ... switchTab, toggleReposSidebar unchanged ...

     return (
         <header className="h-12 px-3 flex items-center justify-between ...">
             <div className="flex items-center gap-3 min-w-0">
                 <button id="hamburger-btn" ...>☰</button>
-                <span className="text-sm font-semibold whitespace-nowrap">AI Execution Dashboard</span>
-                <nav className="flex items-center gap-1 min-w-0" id="tab-bar">
+                <span className="text-sm font-semibold whitespace-nowrap md:hidden">CoC</span>
+                <span className="text-sm font-semibold whitespace-nowrap hidden md:inline">AI Execution Dashboard</span>
+                <nav className="hidden md:flex items-center gap-1 min-w-0" id="tab-bar">
                     {TABS.map(...)}
                 </nav>
             </div>
             {/* right-side controls unchanged */}
         </header>
     );
 }
```

### 2. `packages/coc/src/server/spa/client/react/App.tsx`

**Changes:**

1. **Import BottomNav:**
   ```tsx
   import { BottomNav } from './layout/BottomNav';
   ```

2. **Render BottomNav after Router** in `AppInner`:
   ```diff
    <ToastProvider ...>
        <TopBar />
        <Router />
   +    <BottomNav />
        <ToastContainer ... />
        <EnqueueDialog />
        <MarkdownReviewDialog />
    </ToastProvider>
   ```

   BottomNav internally returns `null` on tablet/desktop, so no conditional needed here.

### 3. Content area height adjustments

Update the four `h-[calc(100vh-48px)]` instances to account for the 56px bottom nav on mobile:

**`processes/ProcessesView.tsx` line 16:**
```diff
-<div id="view-processes" className="flex h-[calc(100vh-48px)] overflow-hidden">
+<div id="view-processes" className="flex h-[calc(100vh-48px-56px)] md:h-[calc(100vh-48px)] overflow-hidden">
```

**`repos/ReposView.tsx` line 155 (empty state):**
```diff
-<div id="view-repos" className="flex items-center justify-center h-[calc(100vh-48px)] text-sm ...">
+<div id="view-repos" className="flex items-center justify-center h-[calc(100vh-48px-56px)] md:h-[calc(100vh-48px)] text-sm ...">
```

**`repos/ReposView.tsx` line 162 (normal state):**
```diff
-<div id="view-repos" className="flex h-[calc(100vh-48px)] overflow-hidden">
+<div id="view-repos" className="flex h-[calc(100vh-48px-56px)] md:h-[calc(100vh-48px)] overflow-hidden">
```

**`wiki/WikiDetail.tsx` line 187:**
```diff
-<div className="flex flex-col h-[calc(100vh-48px)] overflow-hidden" id="view-wiki">
+<div className="flex flex-col h-[calc(100vh-48px-56px)] md:h-[calc(100vh-48px)] overflow-hidden" id="view-wiki">
```

The `md:` prefix matches the 768px breakpoint where BottomNav stops rendering, so the math stays consistent.

---

## Unit Tests

### New: `packages/coc/src/server/spa/client/react/layout/__tests__/BottomNav.test.tsx`

Uses Vitest + React Testing Library. Mock `useBreakpoint` to control viewport.

| # | Test case | Setup | Assertion |
|---|-----------|-------|-----------|
| 1 | Renders on mobile | `useBreakpoint → { isMobile: true }` | Component mounts, `<nav>` present, 3 buttons rendered |
| 2 | Hidden on desktop | `useBreakpoint → { isDesktop: true }` | Returns null, nothing in DOM |
| 3 | Hidden on tablet | `useBreakpoint → { isTablet: true }` | Returns null, nothing in DOM |
| 4 | Active tab styling — repos | `activeTab: 'repos'` | Repos button has `text-[#0078d4]`, others have muted color |
| 5 | Active tab styling — processes | `activeTab: 'processes'` | Processes button has accent color |
| 6 | Active tab styling — wiki | `activeTab: 'wiki'` | Wiki button has accent color |
| 7 | Tab switching dispatches action | Click Processes button | `dispatch` called with `{ type: 'SET_ACTIVE_TAB', tab: 'processes' }` |
| 8 | Tab switching updates hash | Click Wiki button | `location.hash` set to `'#wiki'` |
| 9 | aria-current on active tab | `activeTab: 'repos'` | Repos button has `aria-current="page"`, others do not |
| 10 | Safe area padding present | Render on mobile | Nav element has `paddingBottom` style with `env(safe-area-inset-bottom)` |
| 11 | Correct z-index | Render on mobile | Nav has class containing `z-[8000]` |
| 12 | Each button has data-tab attr | Render on mobile | `data-tab="repos"`, `data-tab="processes"`, `data-tab="wiki"` present |

### Modified: TopBar tests (if existing, or new `TopBar.test.tsx`)

| # | Test case | Setup | Assertion |
|---|-----------|-------|-----------|
| 1 | Tab bar hidden on mobile | Mock `useBreakpoint → { isMobile: true }` | `#tab-bar` nav element has `hidden` class (or is not visible) |
| 2 | Tab bar visible on desktop | Mock `useBreakpoint → { isDesktop: true }` | `#tab-bar` nav element visible with 3 tab buttons |
| 3 | Mobile title shows "CoC" | Mobile viewport | Short title span visible, full title span hidden |
| 4 | Desktop title shows full text | Desktop viewport | "AI Execution Dashboard" visible |
| 5 | Admin link always visible | Both mobile and desktop | `#admin-toggle` present in DOM at all breakpoints |
| 6 | WS indicator always visible | Both mobile and desktop | `[data-testid="ws-status-indicator"]` present at all breakpoints |

### Content height tests (optional, can verify via snapshot or class inspection)

| # | Test case | Assertion |
|---|-----------|-----------|
| 1 | ProcessesView has mobile height class | Root div contains `h-[calc(100vh-48px-56px)]` |
| 2 | ProcessesView has desktop height class | Root div contains `md:h-[calc(100vh-48px)]` |
| 3 | ReposView has responsive height | Both mobile and desktop calc classes present |
| 4 | WikiDetail has responsive height | Both mobile and desktop calc classes present |

---

## Implementation Order

1. Create SVG icon components (can be in BottomNav.tsx or a shared icons file)
2. Create `BottomNav.tsx` with full rendering logic
3. Modify `TopBar.tsx` — hide tabs on mobile, responsive title
4. Add `<BottomNav />` to `App.tsx`
5. Update content heights in ProcessesView, ReposView, WikiDetail
6. Write BottomNav tests
7. Write/update TopBar tests
8. Manual verification: resize browser at 375px, 768px, 1024px widths

---

## Acceptance Criteria

- [ ] Bottom nav visible on viewports < 768px with three icon+label buttons
- [ ] Bottom nav hidden on viewports ≥ 768px
- [ ] Tapping a bottom nav item switches the active tab (same behavior as TopBar tabs)
- [ ] Active bottom nav item shows filled icon + `#0078d4` accent color
- [ ] Inactive items show outlined icon + muted color
- [ ] TopBar tab buttons hidden on mobile, visible on tablet/desktop
- [ ] TopBar title shows "CoC" on mobile, "AI Execution Dashboard" on desktop
- [ ] Admin link (⚙) and WS indicator remain in TopBar at all breakpoints
- [ ] Content area does not overlap with or get hidden behind the bottom nav on mobile
- [ ] Safe area inset applied for notched devices
- [ ] z-index layering: bottom nav (8000) < sidebar drawer (9000) < dialogs (10002)
- [ ] All new and modified tests pass
- [ ] No visual regression on desktop (≥ 1024px) — layout identical to current state
