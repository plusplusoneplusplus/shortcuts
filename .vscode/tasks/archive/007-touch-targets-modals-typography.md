---
status: pending
---

# 007: Touch Targets, Full-Screen Modals, and Responsive Typography

**Series:** Mobile-Responsive SPA Dashboard (commit 7 of 8)
**Depends on:** 001–006 (responsive foundation, sidebar, bottom nav, all three view layouts, BottomSheet component)

## Summary

Make the SPA dashboard feel native on touch devices by enforcing 44px minimum touch targets on all interactive elements, converting modals to full-screen overlays on mobile, routing floating popovers/context menus through the `BottomSheet` component on mobile, and adding responsive typography and spacing scales.

## Motivation

After commits 001–006 the dashboard has a mobile-friendly layout (sidebars collapse, views stack, bottom nav exists). However, buttons are still too small to tap reliably, dialogs float in a centered box that crowds the mobile viewport, context menus are tiny floating rectangles unreachable by thumb, and font sizes/spacing are fixed at desktop values. This commit closes the "feels native on mobile" gap described in the spec's P1 (touch & interaction) and P2 (content polish) phases.

## Changes

### Files to Modify

#### 1. `packages/coc/src/server/spa/client/react/shared/Button.tsx`

Add mobile-specific minimum touch target heights to each size variant. The approach uses Tailwind responsive prefixes so that on desktop the button keeps its compact size and on mobile it meets the 44px minimum.

Update `sizeMap`:

```ts
const sizeMap = {
    sm: 'px-2 py-1 text-xs rounded       min-h-[44px] md:min-h-0',
    md: 'px-3 py-1.5 text-sm rounded-md  min-h-[44px] md:min-h-0',
    lg: 'px-4 py-2 text-base rounded-md  min-h-[44px] md:min-h-0',
};
```

- `min-h-[44px]` applies at all widths (mobile-first).
- `md:min-h-0` removes the minimum at ≥768px so desktop buttons stay compact.
- No other props or component logic changes needed.

#### 2. `packages/coc/src/server/spa/client/react/shared/Dialog.tsx`

Make the dialog full-screen on mobile, centered with backdrop on tablet+.

Import the `useBreakpoint` hook:

```ts
import { useBreakpoint } from '../hooks/useBreakpoint';
```

Inside the component, call the hook:

```ts
const { isMobile } = useBreakpoint();
```

**Overlay classes** — change based on `isMobile`:

| Viewport | Overlay classes |
|----------|----------------|
| Mobile (`isMobile`) | `fixed inset-0 z-[10002] bg-white dark:bg-[#252526]` (full-screen, opaque background, no flex centering) |
| Tablet+ (`!isMobile`) | `fixed inset-0 z-[10002] flex items-center justify-center bg-black/40 dark:bg-black/60` (current behavior) |

**Panel classes** — change based on `isMobile`:

| Viewport | Panel classes |
|----------|--------------|
| Mobile | `w-full h-full flex flex-col p-4 overflow-y-auto` (full viewport, scrollable, no rounded corners, no border, no max-w) |
| Tablet+ | `relative w-full max-w-lg rounded-lg bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] shadow-xl p-6 flex flex-col gap-4` (current) |

**Close button on mobile**: Always show the `×` close button in the top-right corner on mobile, regardless of `disableClose`. On mobile full-screen there is no backdrop to tap, so the close button is the only dismiss mechanism (besides Escape key, which remains unchanged).

**Backdrop click**: On mobile, remove the `onClick={onClose}` from the overlay since the overlay IS the panel background. On tablet+, keep current backdrop-click-to-close behavior.

Preserve the existing `className` max-width override regex logic — on mobile it is irrelevant since `max-w-lg` is not applied, but on tablet+ it must still work.

#### 3. `packages/coc/src/server/spa/client/tailwind.css`

Add responsive utility classes at the end of the file (after existing `@layer utilities` or in a new `@layer utilities` block):

```css
@layer utilities {
    /* Mobile touch target — apply to any interactive element that needs 44px min */
    .touch-target {
        @apply min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0;
    }
}
```

Add responsive typography and spacing in a new `@layer base` section:

```css
@layer base {
    /* Responsive body text */
    body {
        @apply text-sm lg:text-base;
    }

    /* Responsive headings */
    h1 { @apply text-xl lg:text-2xl; }
    h2 { @apply text-lg lg:text-xl; }
    h3 { @apply text-base lg:text-lg; }
    h4 { @apply text-sm lg:text-base; }

    /* Responsive container padding */
    .responsive-container {
        @apply p-3 md:p-4 lg:p-6;
    }
}
```

Typography scale rationale:

| Element | Mobile (< 1024px) | Desktop (≥ 1024px) |
|---------|-------------------|---------------------|
| Body    | `text-sm` (14px)  | `text-base` (16px)  |
| h1      | `text-xl` (20px)  | `text-2xl` (24px)   |
| h2      | `text-lg` (18px)  | `text-xl` (20px)    |
| h3      | `text-base` (16px)| `text-lg` (18px)    |
| h4      | `text-sm` (14px)  | `text-base` (16px)  |

#### 4. `packages/coc/src/server/spa/client/react/tasks/comments/ContextMenu.tsx`

On mobile, render the context menu as a `BottomSheet` instead of a portal-based floating menu.

Import `useBreakpoint` and `BottomSheet`:

```ts
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { BottomSheet } from '../../shared/BottomSheet';
```

Wrap the return with a conditional:

- If `isMobile`, render `<BottomSheet open={true} onClose={onClose}>` containing the menu items as a vertical list with `touch-target` class on each item. No submenu nesting — flatten submenus into the list with section headers.
- If `!isMobile`, render the current portal-based fixed-position menu unchanged.

Ensure each menu item in the BottomSheet has `min-h-[44px]` and appropriate padding (`py-3 px-4`).

#### 5. `packages/coc/src/server/spa/client/react/tasks/comments/CommentPopover.tsx`

On mobile, render as a `BottomSheet` instead of a floating popover.

Import `useBreakpoint` and `BottomSheet`:

```ts
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { BottomSheet } from '../../shared/BottomSheet';
```

Conditional rendering:

- If `isMobile`, render `<BottomSheet open={true} onClose={onClose}>` with the popover content (comment text, action buttons). Action buttons get `touch-target` class.
- If `!isMobile`, render the current portal-based fixed-position popover unchanged.

#### 6. `packages/coc/src/server/spa/client/react/tasks/comments/AICommandMenu.tsx`

On mobile, render as a `BottomSheet` instead of a dropdown.

Same pattern: import `useBreakpoint` + `BottomSheet`, conditional render. Menu items in the bottom sheet get `min-h-[44px]` padding.

#### 7. `packages/coc/src/server/spa/client/react/tasks/comments/InlineCommentPopup.tsx`

On mobile, render as a `BottomSheet` instead of an inline floating popup.

Same pattern: import `useBreakpoint` + `BottomSheet`, conditional render. The comment input textarea and submit button render inside the bottom sheet on mobile.

#### 8. `packages/coc/src/server/spa/client/react/processes/ToolResultPopover.tsx`

On mobile, render as a `BottomSheet` instead of a fixed-position popover.

Import `useBreakpoint` and `BottomSheet`. The bottom sheet version uses `max-h-[70vh]` with overflow scroll for the tool result content.

#### 9. `packages/coc/src/server/spa/client/react/processes/ConversationMetadataPopover.tsx`

On mobile, render as a `BottomSheet`. Same pattern as ToolResultPopover.

#### 10. `packages/coc/src/server/spa/client/react/processes/dag/PipelinePhasePopover.tsx`

On mobile, render as a `BottomSheet`. Same pattern — DAG phase details show in a bottom sheet.

#### 11. `packages/coc/src/server/spa/client/react/admin/AdminPanel.tsx`

The stats grid already uses `grid grid-cols-1 md:grid-cols-3` which stacks on mobile — no grid change needed.

Changes:
- Add `touch-target` class to all `<Button>` elements in the admin panel (Export, Import, Wipe Data, Save Config buttons).
- Add `responsive-container` class to the outermost container div for responsive padding.
- Ensure all `<input>` and `<select>` elements have `min-h-[44px]` on mobile: add `min-h-[44px] md:min-h-0` to the shared input class string.
- Ensure form labels and their inputs stack vertically on mobile: any `flex-row` groupings of label + input should use `flex-col md:flex-row`.

#### 12. `packages/coc/src/server/spa/client/react/layout/TopBar.tsx`

Add `touch-target` class to interactive elements in the top bar (theme toggle button, WS indicator if clickable, hamburger/menu button).

### Files to Create

- (None — all changes are modifications to existing files)

### Files to Delete

- (None)

## Implementation Notes

1. **`min-h-[44px] md:min-h-0` pattern.** This is the standard mobile-first approach: set the 44px minimum at all widths, then reset it at `md:` (768px). The `md:min-h-0` effectively means "no minimum height" since 0 allows natural content sizing. This pattern is used in Button, input elements, and list items.

2. **`touch-target` utility class.** The `@layer utilities` definition in `tailwind.css` provides a reusable shorthand. Components that are not `Button` (e.g., list items, dropdown options, icon-only interactive elements) should apply `touch-target` directly. Button.tsx uses inline classes instead, since its sizeMap is the canonical size source.

3. **Dialog mobile layout.** The full-screen mobile dialog removes `max-w-lg`, `rounded-lg`, `border`, and `shadow-xl` since they are meaningless in full-screen mode. The panel gets `overflow-y-auto` for content that exceeds viewport height. The opaque `bg-white`/`bg-[#252526]` background replaces the translucent `bg-black/40` backdrop.

4. **BottomSheet integration for popovers.** The `BottomSheet` component (from commit 006) already handles portal rendering, backdrop, swipe-to-dismiss, and proper z-indexing. The popover components only need to wrap their content in `<BottomSheet>` on mobile — no z-index or positioning changes needed. The BottomSheet handles all of that.

5. **Context menu flattening.** `ContextMenu.tsx` supports nested submenus. On mobile BottomSheet mode, submenus are flattened into the same list with a section header (e.g., bold text separator) for the parent item. This avoids deeply nested bottom sheets which are a poor mobile UX. Separator items (`{ type: 'separator' }`) render as `<hr>` dividers in the bottom sheet.

6. **AdminPanel input sizing.** The admin panel inputs already use a consistent class pattern (`px-2 py-1 text-sm rounded border ...`). Adding `min-h-[44px] md:min-h-0` to this pattern ensures touch-friendly inputs on mobile without changing desktop appearance.

7. **Typography scope.** The `@layer base` heading styles apply globally to `h1`–`h4` elements. The `.wiki-article` and `.markdown-body` custom classes in `tailwind.css` already define their own heading sizes for wiki content — those are more specific and will take precedence within those contexts. The base-level heading styles affect headings in cards, dialogs, and panel titles.

8. **No changes to DAG node touch targets.** DAG nodes (`DAGNode.tsx`) use pinch-to-zoom for interaction (handled in prior commits). Adding 44px minimum to DAG nodes would break the graph layout. Touch interaction on DAG is handled via zoom controls, not per-node tapping.

## Tests

### Unit Tests

All tests go in existing test file locations or new test files alongside the components.

#### Button touch targets — `packages/coc/test/spa/react/shared/Button.test.ts`

- **`renders with min-h-[44px] class by default (mobile)`** — Render `<Button>text</Button>`, assert the `<button>` element's className contains `min-h-[44px]`.
- **`renders with md:min-h-0 class for desktop reset`** — Same render, assert className contains `md:min-h-0`.
- **`all size variants include touch target classes`** — Render with `size="sm"`, `size="md"`, `size="lg"`, each should contain `min-h-[44px]`.

#### Dialog responsive layout — `packages/coc/test/spa/react/shared/Dialog.test.ts`

- **`renders full-screen on mobile viewport`** — Mock viewport to 375px via `mockViewport(375)`, render `<Dialog open onClose={fn}><p>Content</p></Dialog>`, assert the overlay does NOT have `flex items-center justify-center` classes, assert the panel has `w-full h-full`.
- **`renders centered with backdrop on desktop viewport`** — Mock viewport to 1280px, render same dialog, assert overlay has `flex items-center justify-center`, assert panel has `max-w-lg rounded-lg`.
- **`close button always visible on mobile`** — Mock 375px, render dialog with `disableClose={true}`, assert close button (`×`) is present and enabled (on mobile, `disableClose` is overridden because there is no backdrop to click).
- **`backdrop click does not fire onClose on mobile`** — Mock 375px, render dialog, click the overlay element, assert `onClose` was NOT called (since overlay is opaque full-screen background, not a dismissible backdrop).

#### Typography scale — `packages/coc/test/spa/react/typography.test.ts`

- **`tailwind.css contains responsive body text classes`** — Read `tailwind.css` file content, assert it contains `text-sm lg:text-base` pattern.
- **`tailwind.css contains responsive heading classes`** — Assert file contains `text-xl lg:text-2xl` for h1, `text-lg lg:text-xl` for h2.
- **`tailwind.css defines .touch-target utility`** — Assert file contains `.touch-target` with `min-h-[44px]`.
- **`tailwind.css defines .responsive-container utility`** — Assert file contains `.responsive-container` with `p-3 md:p-4 lg:p-6`.

#### ContextMenu mobile rendering — `packages/coc/test/spa/react/tasks/comments/ContextMenu.test.ts`

- **`renders as BottomSheet on mobile viewport`** — Mock 375px, render ContextMenu with items, assert `BottomSheet` component is in the tree (check for BottomSheet-specific DOM markers), assert NO portal-based fixed-position menu.
- **`renders as floating menu on desktop viewport`** — Mock 1280px, render ContextMenu, assert portal-based fixed menu is present, no BottomSheet.
- **`flattens submenus in BottomSheet mode`** — Mock 375px, render ContextMenu with items that have sub-items, assert all items (parent + children) appear in a flat list.

#### AdminPanel mobile layout — `packages/coc/test/spa/react/admin/AdminPanel.test.ts`

- **`admin inputs have touch-target min-height on mobile`** — Mock 375px, render AdminPanel (mock API responses), assert input elements contain `min-h-[44px]` class.
- **`admin panel uses responsive-container class`** — Render AdminPanel, assert outermost container has `responsive-container` class.

## Acceptance Criteria

- [ ] `Button.tsx` sizeMap includes `min-h-[44px] md:min-h-0` for all three sizes (sm, md, lg)
- [ ] `Dialog.tsx` renders full-screen (`inset-0`, `w-full h-full`, no `max-w-lg`) on mobile viewport (<768px)
- [ ] `Dialog.tsx` renders centered with backdrop (`max-w-lg`, `rounded-lg`, `bg-black/40`) on tablet+ viewport (≥768px)
- [ ] `Dialog.tsx` close button visible and enabled on mobile even when `disableClose` is true
- [ ] `Dialog.tsx` backdrop click does not dismiss on mobile (no backdrop to click)
- [ ] `tailwind.css` defines `.touch-target` utility with `min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0`
- [ ] `tailwind.css` defines responsive body text: `text-sm` default, `lg:text-base` for large screens
- [ ] `tailwind.css` defines responsive headings: h1 `text-xl`/`lg:text-2xl`, h2 `text-lg`/`lg:text-xl`, h3 `text-base`/`lg:text-lg`, h4 `text-sm`/`lg:text-base`
- [ ] `tailwind.css` defines `.responsive-container` with `p-3 md:p-4 lg:p-6`
- [ ] `ContextMenu.tsx` renders as `BottomSheet` on mobile, floating portal menu on desktop
- [ ] `CommentPopover.tsx` renders as `BottomSheet` on mobile, floating portal popover on desktop
- [ ] `AICommandMenu.tsx` renders as `BottomSheet` on mobile, dropdown on desktop
- [ ] `InlineCommentPopup.tsx` renders as `BottomSheet` on mobile, inline popup on desktop
- [ ] `ToolResultPopover.tsx` renders as `BottomSheet` on mobile, floating popover on desktop
- [ ] `ConversationMetadataPopover.tsx` renders as `BottomSheet` on mobile, floating popover on desktop
- [ ] `PipelinePhasePopover.tsx` renders as `BottomSheet` on mobile, floating popover on desktop
- [ ] `AdminPanel.tsx` inputs and buttons have 44px min-height on mobile
- [ ] `AdminPanel.tsx` uses `responsive-container` for padding
- [ ] `TopBar.tsx` interactive elements have `touch-target` class
- [ ] All existing tests still pass (no regressions)
- [ ] SPA builds successfully (`npm run build` from repo root)

## Dependencies

- **001** — `useBreakpoint` hook, Tailwind breakpoint config
- **002** — `ResponsiveSidebar` (sidebar pattern used across views)
- **003** — Bottom navigation bar
- **004** — Processes view responsive layout
- **005** — Repos view responsive layout
- **006** — Wiki view responsive layout, `BottomSheet` component

## Assumed Prior State

All prior commits (001–006) are merged. The following exist and work:
- `useBreakpoint` hook returning `{ isMobile, isTablet, isDesktop, breakpoint }`
- Tailwind breakpoints: `sm: 640px`, `md: 768px`, `lg: 1024px`
- `BottomSheet` shared component (from commit 006) with portal rendering, backdrop, swipe-to-dismiss
- `mockViewport` test helper for simulating viewport widths
- All three views (Processes, Repos, Wiki) already use responsive layouts
- Bottom navigation bar replaces tab bar on mobile
- `ResponsiveSidebar` component handles sidebar collapse/overlay
