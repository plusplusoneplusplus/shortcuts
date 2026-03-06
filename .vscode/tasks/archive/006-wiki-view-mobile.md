---
status: pending
---

# 006: Wiki View Mobile Responsiveness

## Summary

Adapt WikiList, WikiDetail (browse/ask/graph tabs), and Mermaid diagrams for mobile viewports. Introduce a shared `BottomSheet` component for TOC display on small screens.

## Motivation

The wiki view is the most content-dense area of the SPA — three-column browse layout (tree + article + TOC), interactive graphs, and a chat panel. Each sub-view needs distinct mobile adaptations to remain usable on narrow screens without losing functionality.

## Changes

### Files to Create

- `packages/coc/src/server/spa/client/react/shared/BottomSheet.tsx` — Reusable bottom sheet overlay component

  **Component API:**
  ```tsx
  interface BottomSheetProps {
      isOpen: boolean;
      onClose: () => void;
      title?: string;
      children: React.ReactNode;
      height?: number; // percentage of viewport, default 60
  }
  ```

  **Implementation details:**
  - Portal-rendered (`ReactDOM.createPortal` to `document.body`) so it escapes any `overflow: hidden` ancestors
  - **Backdrop:** `fixed inset-0 bg-black/40 dark:bg-black/60` (matches Dialog.tsx pattern), `z-[9500]` (above sidebar `z-[9000]`, below Dialog `z-[10002]`)
  - **Sheet container:** `fixed bottom-0 left-0 right-0`, `rounded-t-2xl`, white/dark background, height from prop as `max-h-[${height}vh]`
  - **Drag handle:** 4px-tall, 40px-wide, centered gray pill at top (`bg-[#c0c0c0] dark:bg-[#555]`), touch-draggable
  - **Slide animation:** CSS transition `transform 300ms ease-out`, translate from `translateY(100%)` to `translateY(0)` on open
  - Backdrop tap calls `onClose`; `Escape` key calls `onClose`
  - Body scroll locked while open (`overflow: hidden` on `document.body`)
  - Content area: `overflow-y-auto flex-1` so children scroll within the sheet

- `packages/coc/test/spa/react/shared/BottomSheet.test.tsx` — Unit tests for the BottomSheet component
- `packages/coc/test/spa/react/wiki/WikiViewMobile.test.tsx` — Mobile-specific wiki view tests

### Files to Modify

- `packages/coc/src/server/spa/client/react/shared/index.ts` — Add `BottomSheet` and `BottomSheetProps` to barrel exports

  Current exports end with `SuggestionChips` and `cn`. Append:
  ```ts
  export { BottomSheet } from './BottomSheet';
  export type { BottomSheetProps } from './BottomSheet';
  ```

- `packages/coc/src/server/spa/client/react/wiki/WikiList.tsx` — Mobile single-column layout

  The existing grid at line ~116 uses `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3`. This already collapses to single column at mobile widths via `grid-cols-1` default. Verify and if needed adjust:
  - Ensure cards have `w-full` on mobile (no fixed widths)
  - Add `px-2 sm:px-0` padding for edge-to-edge cards with small gutters on mobile
  - If card content truncates repo paths too aggressively on narrow screens, ensure `break-all` or `truncate` is applied

- `packages/coc/src/server/spa/client/react/wiki/WikiDetail.tsx` — Mobile browse tab layout

  **Sidebar → ResponsiveSidebar conversion (lines ~227-238):**

  Replace the static `w-56` sidebar wrapper:
  ```tsx
  // Before
  {graph && activeTab === 'browse' && (
      <div className="w-56 flex-shrink-0 border-r ...">
          <WikiComponentTree ... />
      </div>
  )}
  ```
  ```tsx
  // After
  {graph && activeTab === 'browse' && (
      <ResponsiveSidebar title="Components" side="left">
          <WikiComponentTree ... />
      </ResponsiveSidebar>
  )}
  ```

  Import `useBreakpoint` from hooks and `ResponsiveSidebar` from shared (provided by commits 001-002).

  **Tab bar on mobile:** The 4 tab buttons (`Browse`, `Ask`, `Graph`, `Admin`) should wrap or use horizontal scroll on very narrow screens. Add `overflow-x-auto flex-nowrap` to the tab container and `flex-shrink-0 whitespace-nowrap` to each tab button.

- `packages/coc/src/server/spa/client/react/wiki/WikiComponent.tsx` — Mobile TOC and article layout

  **Article takes full width on mobile (lines ~216-319):**

  The current flex layout is `<div className="flex items-start">` with article `flex-1 min-w-0` and TOC aside `w-48 hidden lg:block`. The TOC is already hidden below `lg` breakpoint. Changes:
  - Add mobile padding adjustment: `p-4 sm:p-4` → `p-2 sm:p-4` (tighter on mobile)
  - Add a **floating TOC button** visible only on mobile when TOC entries exist:
    ```tsx
    {toc.length > 0 && (
        <>
            <button
                className="fixed bottom-20 right-4 z-[8000] lg:hidden w-10 h-10 rounded-full bg-[#0078d4] text-white shadow-lg flex items-center justify-center text-xs font-bold"
                onClick={() => setTocSheetOpen(true)}
                aria-label="Table of contents"
                id="wiki-toc-fab"
            >
                TOC
            </button>
            <BottomSheet
                isOpen={tocSheetOpen}
                onClose={() => setTocSheetOpen(false)}
                title="On this page"
                height={60}
            >
                <nav className="space-y-1 p-3">
                    {toc.map(h => (
                        <a key={h.slug} href={`#${h.slug}`}
                           className={cn('block text-sm py-1', ...)}
                           onClick={(e) => { e.preventDefault(); scrollToHeading(h.slug); setTocSheetOpen(false); }}
                           style={{ paddingLeft: `${(h.level - 2) * 12}px` }}>
                            {h.text}
                        </a>
                    ))}
                </nav>
            </BottomSheet>
        </>
    )}
    ```
  - Position: `bottom-20` (80px from bottom) keeps it above `BottomNav` (commits 001-002 reserve ~56px)
  - `z-[8000]` keeps FAB below sidebar (9000) and bottom sheet (9500)
  - State: add `const [tocSheetOpen, setTocSheetOpen] = useState(false)` to WikiComponent
  - Import `BottomSheet` from shared, `cn` from shared

- `packages/coc/src/server/spa/client/react/wiki/WikiAsk.tsx` — Mobile chat layout

  **Full-width chat on mobile:**
  - The chat container (`flex flex-col h-full`) already fills available space — no width changes needed
  - **Input area fixed to bottom:** The input section (lines ~283-308) already uses `border-t` and sits at flex-end. On mobile, add bottom padding to clear `BottomNav`:
    ```tsx
    <div className={cn(
        'flex items-end gap-2 p-3 border-t border-[#e0e0e0] dark:border-[#3c3c3c]',
        isMobile && 'pb-[calc(0.75rem+56px)]'  // clear BottomNav height
    )}>
    ```
  - **Suggestion chips horizontal scroll:** `SuggestionChips` already renders as a flex row. Wrap or modify the chips container to add `overflow-x-auto flex-nowrap` on mobile so chips scroll horizontally instead of wrapping:
    ```tsx
    <div className={cn('flex gap-1.5 flex-wrap', isMobile && 'flex-nowrap overflow-x-auto')}>
    ```
  - Import `useBreakpoint` to get `isMobile` flag
  - Expanded mode (`Ctrl+I`) should be disabled or adapted on mobile — on mobile the ask panel is already full-screen, so expansion is a no-op

- `packages/coc/src/server/spa/client/react/wiki/WikiGraph.tsx` — Mobile graph adaptations

  **Mermaid diagrams in scrollable container:**

  WikiGraph uses D3 force-directed graph (not Mermaid), so Mermaid changes apply to `WikiComponent.tsx` where `useMermaid` renders diagrams inside article content. In WikiComponent, after mermaid rendering, wrap `.mermaid-container` elements with a scrollable wrapper:
  - In the `useMermaid` hook or in WikiComponent's post-render effect, add `overflow-x-auto` to each `.mermaid-container`:
    ```ts
    container.querySelectorAll('.mermaid-container').forEach(el => {
        (el as HTMLElement).style.overflowX = 'auto';
        (el as HTMLElement).style.webkitOverflowScrolling = 'touch';
    });
    ```
  - This enables horizontal scrolling for wide diagrams on mobile without modifying the hook's core logic

  **Pinch-to-zoom for Mermaid SVGs:**
  - The existing `setupZoomPan()` in `useMermaid.ts` uses mouse events (`mousedown`, `mousemove`, `mouseup`) and `Ctrl/Cmd+wheel` for zoom
  - Add `touchstart`, `touchmove`, `touchend` pointer event handlers alongside mouse events:
    - Single-touch: pan (translate)
    - Two-finger pinch: zoom (calculate distance delta between two touches, map to scale factor)
  - Use `touch-action: none` on `.mermaid-content` to prevent browser default pinch-zoom
  - Keep existing mouse handlers unchanged for desktop

  **"Rotate device" hint:**
  - In WikiComponent, when `isMobile && toc.length > 3` (proxy for complex article with likely large diagrams), show a subtle dismissible hint:
    ```tsx
    <div className="lg:hidden text-xs text-center text-[#848484] py-1">
        📱 Rotate device for better diagram viewing
    </div>
    ```
  - Show once per session (track in `useState` or `sessionStorage`)

  **D3 graph (WikiGraph.tsx):**
  - D3's `d3.drag()` already handles touch via pointer events — no changes needed
  - `d3.zoom()` already supports touch pinch — no changes needed
  - Add `touch-action: none` to the SVG element to prevent browser interference:
    ```tsx
    <svg ref={svgRef} className="w-full h-full" style={{ touchAction: 'none' }} />
    ```

## Implementation Notes

**Z-index hierarchy (complete stack):**
| Layer | z-index | Component |
|-------|---------|-----------|
| Dialog overlay | 10002 | Dialog.tsx (existing) |
| BottomSheet | 9500 | BottomSheet.tsx (new) |
| ResponsiveSidebar | 9000 | ResponsiveSidebar (commit 002) |
| TOC FAB button | 8000 | WikiComponent.tsx (new) |
| BottomNav | 7000 | BottomNav (commit 002, assumed) |

**BottomSheet drag-to-dismiss behavior:**
- Track touch start Y position on the drag handle
- On `touchmove`, calculate delta Y; if dragging down > 100px, dismiss on `touchend`
- Visual feedback: sheet follows finger position during drag (translate Y by delta)
- CSS: `will-change: transform` for smooth animation

**TOC FAB positioning:**
- `fixed bottom-20 right-4` → 80px from bottom, 16px from right edge
- The 80px bottom offset clears the BottomNav (56px) with 24px gap
- `lg:hidden` ensures it only shows on mobile/tablet (below 1024px), matching the existing `hidden lg:block` on the desktop TOC sidebar

**WikiList grid behavior:**
- The existing `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` is already mobile-friendly
- Main adjustment is padding and ensuring card content doesn't overflow on narrow widths

**Mermaid touch zoom implementation approach:**
- Use the existing `ZoomState` object from `setupZoomPan()`
- Add a `getTouchDistance(e: TouchEvent)` helper: `Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)`
- On `touchstart` with 2 touches: record initial distance and current scale
- On `touchmove` with 2 touches: new scale = initial scale × (current distance / initial distance), clamped to `[MIN_ZOOM, MAX_ZOOM]`
- Apply via same `transform: translate(...) scale(...)` as mouse zoom

## Tests

### `packages/coc/test/spa/react/shared/BottomSheet.test.tsx`
- BottomSheet renders nothing when `isOpen` is false
- BottomSheet renders backdrop + sheet + title + children when `isOpen` is true
- Clicking backdrop calls `onClose`
- Pressing Escape calls `onClose`
- Sheet has correct z-index (`z-[9500]`)
- Custom `height` prop applies as max-height style
- Default height is 60vh when no `height` prop provided
- Drag handle element is present
- Body gets `overflow: hidden` when open, restored on close

### `packages/coc/test/spa/react/wiki/WikiViewMobile.test.tsx`
- **WikiList mobile:** renders single-column grid on mobile viewport (verify `grid-cols-1` active)
- **WikiDetail browse tab:** sidebar renders inside `ResponsiveSidebar` (check for drawer trigger button on mobile)
- **WikiDetail browse tab:** article content takes full width when sidebar is collapsed on mobile
- **WikiComponent TOC FAB:** button with id `wiki-toc-fab` visible when TOC has entries and viewport is mobile-width
- **WikiComponent TOC FAB:** clicking TOC button opens BottomSheet with TOC links
- **WikiComponent TOC FAB:** clicking a TOC link in the bottom sheet closes the sheet
- **WikiComponent TOC FAB:** TOC FAB is hidden on desktop (lg breakpoint)
- **WikiAsk mobile:** input area has bottom padding to clear BottomNav on mobile
- **WikiAsk mobile:** suggestion chips container has `overflow-x-auto` and `flex-nowrap` on mobile
- **Mermaid container:** `.mermaid-container` elements have `overflow-x: auto` style
- **WikiGraph SVG:** has `touch-action: none` style for touch compatibility

## Acceptance Criteria

- [ ] WikiList cards display in single column on viewports < 640px
- [ ] WikiDetail browse tab: component tree renders inside ResponsiveSidebar (drawer on mobile)
- [ ] Article content occupies full width on mobile when sidebar drawer is closed
- [ ] Desktop TOC sidebar (`hidden lg:block`) remains unchanged
- [ ] Floating TOC button appears on mobile when article has headings, positioned bottom-right above BottomNav
- [ ] Tapping TOC button opens BottomSheet with all TOC entries; tapping entry scrolls to heading and closes sheet
- [ ] BottomSheet slides up with animation, dismisses on backdrop tap or Escape
- [ ] BottomSheet z-index (9500) layers correctly between sidebar (9000) and Dialog (10002)
- [ ] WikiAsk input area clears BottomNav on mobile
- [ ] Suggestion chips scroll horizontally on mobile
- [ ] Mermaid diagrams horizontally scrollable on mobile
- [ ] Mermaid diagrams support pinch-to-zoom on touch devices
- [ ] D3 graph SVG has `touch-action: none` for proper touch handling
- [ ] BottomSheet shared component exported from `shared/index.ts`
- [ ] All new and existing wiki tests pass
- [ ] No visual regression on desktop (lg+ viewports)

## Dependencies

- Depends on: 001 (`useBreakpoint` hook), 002 (`ResponsiveSidebar`, `BottomNav` components with established z-index conventions)

## Assumed Prior State

- `useBreakpoint` hook exists at `packages/coc/src/server/spa/client/react/hooks/useBreakpoint.ts`, returning `{ isMobile, isTablet, isDesktop }` based on viewport width
- `ResponsiveSidebar` component exists at `packages/coc/src/server/spa/client/react/shared/ResponsiveSidebar.tsx`, accepting `title`, `side`, and `children` props; renders as drawer overlay on mobile, static sidebar on desktop; uses `z-[9000]`
- `BottomNav` component exists and occupies ~56px at screen bottom on mobile; content areas have been adjusted for this height (commit 002)
- Shared components barrel (`shared/index.ts`) already exports `ResponsiveSidebar`
- Dialog.tsx uses `z-[10002]` for its overlay (existing, unchanged)
- The wiki source files (`WikiView.tsx`, `WikiDetail.tsx`, `WikiComponent.tsx`, `WikiAsk.tsx`, `WikiGraph.tsx`, `WikiComponentTree.tsx`) are in their current unmodified state as described in the Changes section
