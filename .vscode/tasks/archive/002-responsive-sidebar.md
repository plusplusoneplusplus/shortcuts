---
status: done
---

# 002 — ResponsiveSidebar Shared Component

**Series:** Mobile-Responsive SPA Dashboard (commit 2 of 8)
**Depends on:** 001 (useBreakpoint hook, Tailwind breakpoint config, test helpers)

## Goal

Replace the hard-coded fixed-width sidebar patterns in the SPA with a single
`ResponsiveSidebar` shared component that adapts across mobile / tablet / desktop
viewports via the `useBreakpoint` hook from commit 001.

## Current State

| View | Selector | Width | Collapse? |
|------|----------|-------|-----------|
| `ProcessesView.tsx` | `<aside className="w-[320px] min-w-[320px] max-w-[320px] shrink-0 …">` | 320 px fixed | No |
| `ReposView.tsx` | `cn(…, collapsed ? 'w-12 min-w-[48px]' : 'w-[280px] min-w-[240px]')` | 280 px / 48 px | Yes |
| `WikiView` → `WikiDetail` | own sidebar pattern | varies | varies |
| `Dialog.tsx` | Portal to `document.body`, `z-[10002]`, `bg-black/40` | — | — |

Existing utility: `shared/cn.ts` — `cn(...classes)` filters falsy values and
joins with space (lightweight Tailwind class merge).

## Planned Changes

### 1. New file — `packages/coc/src/server/spa/client/react/shared/ResponsiveSidebar.tsx`

#### Props

```ts
interface ResponsiveSidebarProps {
  children: React.ReactNode;
  /** Controls mobile drawer open state. Ignored on tablet/desktop. */
  isOpen: boolean;
  /** Called when the user dismisses the mobile drawer (backdrop tap or swipe). */
  onClose: () => void;
  /** Desktop sidebar width. Default: 320 */
  width?: number;
  /** Tablet sidebar width. Default: 260 */
  tabletWidth?: number;
  /** Extra classes forwarded to the outer element. */
  className?: string;
}
```

#### Behaviour Matrix

| Breakpoint | Condition | Rendering |
|------------|-----------|-----------|
| **Mobile** (`< 768px`) | `isOpen = true` | Portal → `document.body`. Fixed-position overlay drawer sliding in from the left. Semi-transparent backdrop. Focus trap. Body scroll lock. |
| **Mobile** (`< 768px`) | `isOpen = false` | Nothing rendered (unmounted or `translate-x: -100%` + `pointer-events-none`). |
| **Tablet** (`768–1023px`) | always | Inline `<aside>` at `tabletWidth` px. Collapsible via parent state (same pattern as ReposView today). |
| **Desktop** (`≥ 1024px`) | always | Inline `<aside>` at `width` px. Always visible. Matches current fixed-width behaviour. |

#### Mobile Drawer Details

- **Portal target:** `document.body` (same as `Dialog.tsx`).
- **Z-index:** `z-[9000]` — safely below `Dialog.tsx`'s `z-[10002]` so modals
  always sit on top of the drawer.
- **Backdrop:** `<div className="fixed inset-0 z-[9000] bg-black/50">` — click
  calls `onClose`.
- **Drawer panel:** `<aside className="fixed inset-y-0 left-0 z-[9001] w-[85vw] max-w-[360px] …">`.
  - Width: `85vw` capped at `360px` so the drawer never covers the full screen
    and a sliver of backdrop is always tappable.
- **Animation:** CSS `transform: translateX(…)` with `transition: transform 200ms ease-in-out`.
  - Open → `translate-x-0`
  - Closed → `-translate-x-full`
  - GPU-accelerated (composite-only property).
- **Focus trap:** On open, move focus into the drawer. On close, restore focus to
  the element that triggered the open. Trap Tab/Shift-Tab within the drawer via
  a lightweight sentinel-element approach (first/last focusable bounds).
- **Body scroll lock:** On open, set `document.body.style.overflow = 'hidden'`.
  Restore on close or unmount (useEffect cleanup).

#### Swipe-to-Dismiss (Mobile Only)

Implemented inside `ResponsiveSidebar.tsx` as touch event handlers on the drawer
panel element.

```
touchstart  → record startX, startY, timestamp
touchmove   → compute deltaX, deltaY; if |deltaX| > 10 && |deltaY| < 30
              → apply live translateX (clamped to [-drawer-width, 0]) for tactile feel
touchend    → if deltaX < -50 && |deltaY| < 30 → call onClose
              else → snap back to translate-x-0 (transition 150ms)
```

- Threshold: 50 px horizontal swipe, less than 30 px vertical drift.
- Direction: swipe left to dismiss (negative deltaX).
- Live tracking: the drawer follows the finger during the swipe for a native
  feel, overriding the CSS transition temporarily.
- Only attached when `isMobile` is true.

#### Inline Panel (Tablet / Desktop)

```tsx
<aside
  className={cn(
    'shrink-0 min-h-0 flex flex-col overflow-hidden',
    'border-r border-[#e0e0e0] dark:border-[#3c3c3c]',
    'bg-[#f3f3f3] dark:bg-[#252526]',
    className
  )}
  style={{ width: effectiveWidth, minWidth: effectiveWidth, maxWidth: effectiveWidth }}
>
  {children}
</aside>
```

- `effectiveWidth` = `isTablet ? tabletWidth : width`.
- Uses inline `style` for the pixel width so the prop-driven value doesn't
  require dynamic Tailwind class generation.
- Transition on `width` / `min-width` kept via Tailwind `transition-[width,min-width]
  duration-150 ease-out` for smooth collapse (ReposView pattern).

### 2. Shared Styles / Constants

No new CSS file. All styling via Tailwind utility classes and inline styles.
Constants (z-indices, animation durations) defined as module-level `const` in
`ResponsiveSidebar.tsx`:

```ts
const DRAWER_BACKDROP_Z = 9000;
const DRAWER_PANEL_Z   = 9001;
const ANIMATION_MS     = 200;
const SWIPE_THRESHOLD  = 50;   // px horizontal
const SWIPE_MAX_DRIFT  = 30;   // px vertical
```

### 3. Tests — `packages/coc/test/spa/shared/ResponsiveSidebar.test.tsx`

Uses Vitest + React Testing Library. Viewport mocking via `mockViewport(width)`
helper from commit 001.

| # | Test Case | Setup | Assertion |
|---|-----------|-------|-----------|
| 1 | Desktop: renders children in inline panel | `mockViewport(1280)` | `<aside>` in DOM with `width: 320px`, children visible, no portal overlay |
| 2 | Desktop: respects custom `width` prop | `mockViewport(1280)`, `width={400}` | `style.width === '400px'` |
| 3 | Mobile: hidden when `isOpen=false` | `mockViewport(375)`, `isOpen={false}` | No overlay in DOM (or `translateX(-100%)` + `pointer-events-none`) |
| 4 | Mobile: visible as overlay when `isOpen=true` | `mockViewport(375)`, `isOpen={true}` | Portal renders backdrop (`bg-black/50`) and drawer at `z-[9001]` |
| 5 | Mobile: children rendered inside drawer | `mockViewport(375)`, `isOpen={true}` | `getByText('child content')` inside the drawer panel |
| 6 | Mobile: backdrop click calls `onClose` | `mockViewport(375)`, `isOpen={true}` | `fireEvent.click(backdrop)` → `onClose` called once |
| 7 | Mobile: drawer width is `85vw` / max `360px` | `mockViewport(375)`, `isOpen={true}` | Drawer element has correct class/style |
| 8 | Mobile: slide-in animation class present | `mockViewport(375)`, `isOpen={true}` | Element has `translate-x-0` (not `-translate-x-full`) |
| 9 | Tablet: renders at `tabletWidth` | `mockViewport(900)`, `tabletWidth={260}` | `style.width === '260px'` |
| 10 | Tablet: renders at default 260px without prop | `mockViewport(900)` | `style.width === '260px'` |
| 11 | Swipe dismiss: calls `onClose` on left swipe | `mockViewport(375)`, simulate touch sequence (deltaX = -60) | `onClose` called |
| 12 | Swipe dismiss: no dismiss on short swipe | `mockViewport(375)`, simulate touch (deltaX = -30) | `onClose` not called |
| 13 | Swipe dismiss: no dismiss on vertical swipe | `mockViewport(375)`, simulate touch (deltaX = -60, deltaY = 50) | `onClose` not called |
| 14 | Body scroll lock on mobile open | `mockViewport(375)`, `isOpen={true}` | `document.body.style.overflow === 'hidden'` |
| 15 | Body scroll restored on close | `mockViewport(375)`, open then set `isOpen={false}` | `document.body.style.overflow` restored |
| 16 | Z-index below Dialog | `mockViewport(375)`, `isOpen={true}` | Backdrop z-index `9000`, panel z-index `9001` (both < `10002`) |
| 17 | Extra `className` forwarded | `mockViewport(1280)`, `className="my-extra"` | `<aside>` has `my-extra` class |

### 4. Export

Add `ResponsiveSidebar` to the barrel export if `shared/index.ts` exists,
otherwise import directly from `shared/ResponsiveSidebar` in consuming views.

## Files Changed

| File | Action |
|------|--------|
| `packages/coc/src/server/spa/client/react/shared/ResponsiveSidebar.tsx` | **Create** |
| `packages/coc/test/spa/shared/ResponsiveSidebar.test.tsx` | **Create** |

> **Note:** This commit does NOT modify `ProcessesView.tsx`, `ReposView.tsx`, or
> `WikiView` to consume the new component — that migration is a separate commit
> (003+) to keep this change small and independently testable.

## Z-Index Strategy

```
Layer                Z-Index
─────────────────────────────
Dialog backdrop      10002    (existing — unchanged)
Dialog content       10002    (existing — unchanged)
Sidebar drawer       9001     (new)
Sidebar backdrop     9000     (new)
Normal content       auto     (existing)
```

## Acceptance Criteria

- [ ] `ResponsiveSidebar` renders inline `<aside>` on desktop at specified width
- [ ] `ResponsiveSidebar` renders portal overlay drawer on mobile with slide animation
- [ ] Backdrop tap and swipe-left dismiss the drawer
- [ ] Focus trap active while drawer is open
- [ ] Body scroll locked while drawer is open on mobile
- [ ] Tablet renders at `tabletWidth` inline
- [ ] Z-index sits below Dialog overlays
- [ ] All 17 test cases pass (`npm run test:run` in `packages/coc`)
- [ ] No regressions in existing SPA tests
