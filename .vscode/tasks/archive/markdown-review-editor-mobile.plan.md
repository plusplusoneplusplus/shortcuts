# Markdown Review Editor — Mobile Responsiveness

## Problem

The COC SPA's `MarkdownReviewEditor` has zero mobile-specific handling. When opened on a phone (via `MarkdownReviewDialog` or the Tasks tab), several critical issues make the editor unusable:

1. **CommentSidebar crushes the preview pane** — It renders as a fixed `w-[280px]` side panel, consuming ~75% of a 375px screen, leaving the markdown preview unreadable.
2. **Mode toggle toolbar has tiny touch targets** — `.mode-btn` uses `font-size: 11px`, `padding: 3px 8px` (~24px hit area), far below the 44px mobile minimum.
3. **Text selection for commenting is unusable** — The `mouseup` listener for selection doesn't handle touch events (`touchend`), making it impossible to select text and add comments on mobile.
4. **CommentPopover/InlineCommentPopup positioning** — While these already use `BottomSheet` on mobile (good!), the popovers are triggered by click positions calculated from mouse events, which can mis-position on touch.
5. **Context menu relies on right-click** — `onContextMenu` doesn't fire reliably on mobile; users have no way to access "Add Comment" or "Ask AI" actions.
6. **Code blocks and tables overflow** — `.code-block-content` and `.md-table-container` can overflow horizontally on narrow screens.
7. **MarkdownReviewDialog wastes header space** — The dialog header bar + the mode-toggle toolbar stack, consuming ~80px of chrome on mobile.

## Existing Mobile Infrastructure (to reuse)

The SPA already has solid responsive primitives — the editor just doesn't use them:

| Component | Location | What it provides |
|-----------|----------|-----------------|
| `useBreakpoint()` | `hooks/useBreakpoint.ts` | `isMobile` / `isTablet` / `isDesktop` flags |
| `BottomSheet` | `shared/BottomSheet.tsx` | Drag-to-dismiss bottom overlay |
| `ResponsiveSidebar` | `shared/ResponsiveSidebar.tsx` | Mobile: portal drawer with swipe; Desktop: static aside |
| `.touch-target` | `tailwind.css` L1328 | `min-h-[44px] min-w-[44px]` on mobile |
| `Dialog` | `shared/Dialog.tsx` | Already goes full-screen on mobile |

## Tasks

### 1. Convert CommentSidebar to a mobile drawer

**Files:** `MarkdownReviewEditor.tsx`, `CommentSidebar.tsx`

The sidebar currently renders inline with a fixed `w-[280px]`. On mobile, it should become a slide-in drawer that overlays the preview instead of squishing it.

**Changes:**
- In `MarkdownReviewEditor.tsx`: import `useBreakpoint`; on mobile, wrap `CommentSidebar` in a togglable overlay (use `ResponsiveSidebar` or a simple portal drawer)
- Add a floating "Comments (N)" badge/button in the bottom-right corner on mobile to toggle the sidebar drawer
- When mobile sidebar is open, it should overlay the full width (85vw, matching `ResponsiveSidebar`'s drawer style)
- On desktop, keep the current inline sidebar behavior unchanged
- In `CommentSidebar.tsx`: remove the hardcoded `w-[280px] min-w-[220px]` when rendered inside a mobile drawer (pass a prop or use `useBreakpoint` to apply `w-full` on mobile)

### 2. Enlarge toolbar touch targets on mobile

**Files:** `tailwind.css`, `MarkdownReviewEditor.tsx`

The `.mode-btn` and `.save-btn` are too small for touch interaction.

**Changes:**
- Add `@media (max-width: 767px)` overrides for `.mode-toggle`, `.mode-btn`, and `.save-btn`:
  - `.mode-btn`: `min-height: 44px; font-size: 14px; padding: 8px 16px;`
  - `.save-btn`: `min-height: 44px; font-size: 14px; padding: 8px 16px;`
  - `.mode-toggle`: `padding: 6px 8px; gap: 8px;`
- Alternatively, in the JSX, apply the `touch-target` utility class conditionally when `isMobile`

### 3. Add touch selection support for commenting

**File:** `MarkdownReviewEditor.tsx`

The current `mouseup` listener doesn't work on mobile touchscreens.

**Changes:**
- Add a parallel `touchend` event listener alongside `mouseup` that reads `window.getSelection()` after a short delay (touch selection events need ~100ms for the browser to finalize the selection)
- On mobile, show a floating toolbar (small bar with "💬 Comment" + "🤖 Ask AI" buttons) near the selection instead of relying on right-click context menu
- The floating toolbar should appear just above/below the selection and auto-dismiss when the selection is cleared

### 4. Add mobile action trigger (replace right-click context menu)

**File:** `MarkdownReviewEditor.tsx`

Since `onContextMenu` is unreliable on mobile, provide an alternative action trigger.

**Changes:**
- On mobile, after a text selection is detected (via the touch selection handler from Task 3), show a selection action bar with "Add Comment", "Ask AI", "Copy" buttons
- Use a small floating bar (positioned near the selection) or a `BottomSheet` with the same actions as the desktop context menu
- Keep the desktop `onContextMenu` handler unchanged

### 5. Compact the MarkdownReviewDialog header on mobile

**File:** `MarkdownReviewDialog.tsx`

On mobile, the `Dialog` goes full-screen but the internal header still uses `px-4 py-3` with title + subtitle, plus the mode-toggle is a separate bar — that's ~80px of chrome.

**Changes:**
- On mobile, merge the dialog header and mode-toggle into a single compact bar:
  - File name on the left (truncated), mode-toggle buttons on the right, close button at far right
  - Remove the subtitle line (full path) on mobile — it's already in the title attribute
  - Target: ~44px total for the merged header row
- Import `useBreakpoint` and conditionally render the compact layout

### 6. Fix horizontal overflow for code blocks and tables

**File:** `tailwind.css`

Code blocks and tables can overflow horizontally on narrow screens.

**Changes:**
- Add mobile-specific overflow rules:
  ```css
  @media (max-width: 767px) {
      .markdown-body .code-block-container {
          max-width: 100%;
      }
      .markdown-body .code-block-content {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
      }
      .markdown-body .md-table-container {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          max-width: calc(100vw - 32px);
      }
  }
  ```
- These are additive and won't affect desktop behavior

### 7. Improve mobile markdown body readability

**File:** `tailwind.css`

On mobile, the markdown content area uses `p-4` which is reasonable, but font sizes and spacing could be improved.

**Changes:**
- Add mobile-specific markdown body adjustments:
  ```css
  @media (max-width: 767px) {
      .markdown-body {
          font-size: 15px;
          line-height: 1.6;
      }
      .markdown-body .md-h1 { font-size: 1.5em; }
      .markdown-body .md-h2 { font-size: 1.3em; }
      .markdown-body .md-h3 { font-size: 1.15em; }
  }
  ```
- Ensure images are constrained: `img { max-width: 100%; height: auto; }`

## Files to Modify

| File | Changes |
|------|---------|
| `packages/coc/src/server/spa/client/react/shared/MarkdownReviewEditor.tsx` | Import `useBreakpoint`; mobile sidebar drawer toggle; touch selection handler; mobile selection action bar; conditional layout |
| `packages/coc/src/server/spa/client/react/tasks/comments/CommentSidebar.tsx` | Support full-width mode when rendered in mobile drawer |
| `packages/coc/src/server/spa/client/react/processes/MarkdownReviewDialog.tsx` | Compact merged header on mobile |
| `packages/coc/src/server/spa/client/tailwind.css` | Mobile media queries for toolbar, code blocks, tables, typography |

## Priority Order

1. **Task 1** (CommentSidebar → drawer) — Highest impact; sidebar is completely broken on mobile
2. **Task 2** (Touch targets) — Toolbar is barely usable
3. **Task 3 + 4** (Touch selection + action bar) — Core commenting workflow broken on mobile
4. **Task 5** (Compact header) — Reclaim ~36px vertical space
5. **Task 6** (Overflow fixes) — Content readability
6. **Task 7** (Typography) — Polish

## Testing

- Chrome DevTools mobile emulation: iPhone SE (375×667), iPhone 14 (390×844), Galaxy S21 (360×800)
- Verify: sidebar drawer opens/closes with animation, swipe-to-dismiss works
- Verify: mode-toggle buttons have ≥44px tap targets
- Verify: text selection → floating action bar appears on touch devices
- Verify: code blocks and tables scroll horizontally without page overflow
- Verify: desktop behavior is completely unchanged
- Run `cd packages/coc && npm run test:run` to verify no regressions
