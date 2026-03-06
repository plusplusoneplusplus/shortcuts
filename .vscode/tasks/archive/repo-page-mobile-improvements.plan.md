# Repository Page — Mobile Responsiveness Improvements

## Problem

The CoC SPA repository detail page has significant layout issues on mobile viewports. The page was designed primarily for desktop and lacks proper responsive adaptation, making it nearly unusable on phones.

## Observed Issues (from screenshot)

| # | Issue | Severity | Root Cause |
|---|-------|----------|------------|
| 1 | **Header action buttons overflow horizontally** — New Chat, Queue Task, Generate Plan, Edit, Remove all render in a single row, pushing off-screen | High | Header uses `flex items-center gap-3` with no wrapping or collapsing strategy |
| 2 | **Repo name clipped** — the colored dot and "shortcuts" label are partially cut off on the left | Medium | Buttons consume all horizontal space, squeezing the title |
| 3 | **Chat split-panel is broken on mobile** — sidebar (w-80 = 320px) and detail panel render side-by-side | Critical | `RepoChatTab` uses fixed `w-80 flex-shrink-0` sidebar without mobile breakpoint handling |
| 4 | **Chat detail text wraps character-by-character** — vertical letter stacking ("s f r o m t h e s e p l a n s?") | Critical | Detail panel gets ~30px width after the 320px sidebar consumes the viewport |
| 5 | **Chat detail header truncated** — "Chat" title and tab labels ("Resu Terr") are clipped | High | Same root cause as #3 — insufficient width for the detail panel |
| 6 | **Duplicate "New Chat" button** — one in the repo header, another inside the Chat tab body | Low | Both are always visible; no mobile-aware deduplication |
| 7 | **Tab bar scrolled off** — Info and Git tabs appear scrolled off-screen to the left | Low | `overflow-x-auto` works but no visual affordance (scroll indicators) |

## Improvement Bullets

### 1. Collapse header action buttons into an overflow menu on mobile
- **What:** On `< md` breakpoints, replace the row of 5 buttons with a single "⋯" (more actions) dropdown/bottom-sheet.
- **Where:** `RepoDetail.tsx`, header section (lines ~147–223).
- **How:** Use `useBreakpoint()` to detect mobile. Render primary action (e.g., New Chat) as the only visible button; move Queue Task, Generate Plan, Edit, Remove into a popover/action-sheet menu.
- **Benefit:** Frees up horizontal space for the repo name and prevents overflow.

### 2. Stack repo name above action buttons on small screens
- **What:** On mobile, render the repo name + color dot on one row, and action button(s) on a second row below.
- **Where:** `RepoDetail.tsx`, header flex container.
- **How:** Change the header to `flex flex-wrap` or use conditional `flex-col` on mobile. The title row gets `w-full` to force a line break before buttons.
- **Benefit:** Repo name is always fully visible.

### 3. Convert Chat sidebar to a mobile drawer using `ResponsiveSidebar`
- **What:** On mobile, replace the fixed `w-80` chat session sidebar with a swipe-to-dismiss drawer (the pattern already exists in `ResponsiveSidebar.tsx`).
- **Where:** `RepoChatTab.tsx` (lines ~862–880).
- **How:** Wrap `ChatSessionSidebar` with `ResponsiveSidebar`. On mobile, show only the chat detail full-width, with a toggle button (e.g., hamburger / "Sessions" button) to open the drawer. When a session is selected from the drawer, auto-close it.
- **Benefit:** Eliminates the character-by-character text wrapping bug — chat detail gets the full viewport width.

### 4. Make chat detail panel full-width on mobile
- **What:** When the sidebar is a drawer (mobile), the conversation area should occupy 100% width.
- **Where:** `RepoChatTab.tsx`, right panel container.
- **How:** Remove `min-w-0` constraint in favor of `w-full` on mobile. Ensure the input textarea, model selector, and turn bubbles all have proper mobile padding.
- **Benefit:** Chat becomes readable and usable on phones.

### 5. Deduplicate "New Chat" button on mobile
- **What:** When viewing the Chat tab on mobile, hide the "New Chat" button from the repo header (it already appears in the chat sidebar/drawer).
- **Where:** `RepoDetail.tsx` header, conditional on active tab + breakpoint.
- **How:** If `activeTab === 'chat' && isMobile`, omit the New Chat button from the header.
- **Benefit:** Reduces visual clutter and frees header space.

### 6. Add scroll affordance to tab bar on mobile
- **What:** Show a subtle gradient fade or arrow indicator on the edges of the tab strip when tabs are scrolled off-screen.
- **Where:** `RepoDetail.tsx`, tab bar container.
- **How:** Add left/right gradient overlays (e.g., `bg-gradient-to-r from-white`) that appear/disappear based on scroll position. Use an `IntersectionObserver` or `scrollLeft` check.
- **Benefit:** Users know there are more tabs to discover by scrolling.

### 7. (Optional) Bottom-sheet for chat input on mobile
- **What:** On mobile, the chat input area could benefit from being a fixed bottom bar that stays visible while scrolling conversation.
- **Where:** `RepoChatTab.tsx`, input section.
- **How:** Use `sticky bottom-0` or `fixed` positioning on mobile.
- **Benefit:** Users can always access the input without scrolling to the bottom.

## Key Files

| File | Changes |
|------|---------|
| `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx` | Header layout, button collapsing, tab scroll affordance |
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Sidebar → drawer, full-width detail, input positioning |
| `packages/coc/src/server/spa/client/react/shared/ResponsiveSidebar.tsx` | Reuse existing pattern (no changes expected) |
| `packages/coc/src/server/spa/client/react/shared/useBreakpoint.ts` | Reuse existing hook (no changes expected) |

## Priority Order

1. **#3 + #4** — Chat drawer + full-width detail (fixes the critical usability blocker)
2. **#1 + #2** — Header button overflow (high-visibility fix)
3. **#5** — Deduplicate New Chat button (quick win)
4. **#6** — Tab scroll affordance (polish)
5. **#7** — Sticky chat input (optional enhancement)
