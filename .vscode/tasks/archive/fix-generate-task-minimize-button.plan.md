# Fix: Minimize Button in Generate Task Dialog is Not Standard

## Problem

The **Generate Task** dialog (`GenerateTaskDialog.tsx`) has a minimize button that renders using the `▬` (U+25AC BLACK RECTANGLE) Unicode character. This appears as a filled dark square, which looks non-standard and inconsistent with the conventional minimize button affordance (a horizontal line `−`).

Additionally, the dialog header layout is fragmented:
- The minimize button (`▬`) lives inside `Dialog.tsx`'s flex header row, pushed right via `ml-auto`.
- The close button (`×`) is rendered as a **separate absolutely-positioned child** inside `GenerateTaskDialog.tsx`, overlaid on the dialog panel rather than being part of the header row.

This results in two visually mismatched window-control buttons that are not co-located in the same DOM container, making hover/focus behavior and spacing inconsistent.

## Proposed Fix

### 1. Replace the minimize icon in `Dialog.tsx`

**File:** `packages/coc/src/server/spa/client/react/shared/Dialog.tsx`

Change the button content from `▬` to `−` (U+2212 MINUS SIGN) so it matches the visual convention of a minimize/collapse control (a horizontal line).

```diff
- ▬
+ −
```

Update the button styling to match the close button size and feel (same font size, padding, and hover state as the `×` button in `GenerateTaskDialog.tsx`).

### 2. Move the close button into `Dialog.tsx`'s header

**Files:**
- `packages/coc/src/server/spa/client/react/shared/Dialog.tsx`
- `packages/coc/src/server/spa/client/react/repos/GenerateTaskDialog.tsx`

Add an `onClose`-driven `×` close button to Dialog's header row (right of the minimize button), and remove the manually added `absolute`-positioned close button from `GenerateTaskDialog.tsx`.

New header layout (right side of flex row):
```
[title]  ···  [−]  [×]
```

The close button should:
- Be disabled (pointer-events-none + reduced opacity) when the dialog is in a submitting/loading state — pass an `isSubmitting` prop or expose a `disableClose` prop on `DialogProps`.
- Have `aria-label="Close"` and `title="Close"`.

### 3. Consistent button styling

Both window-control buttons should share the same style class:
```
text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-lg leading-none px-1
```

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/shared/Dialog.tsx` | Replace `▬` → `−`; add `×` close button in header; add optional `disableClose` prop |
| `packages/coc/src/server/spa/client/react/repos/GenerateTaskDialog.tsx` | Remove hand-rolled `absolute top-3 right-3` close button |
| Dialog test files (if any) | Update snapshots / selectors for new button markup |

## Acceptance Criteria

- Minimize button shows a horizontal line (`−`), not a filled block.
- Close (`×`) and minimize (`−`) buttons are side-by-side in the top-right of the dialog header.
- Styling (size, color, hover) is identical for both buttons.
- Close button is visually disabled while the task is being submitted.
- Escape key still triggers minimize when `onMinimize` is provided; triggers close otherwise.
- No regression in existing dialog behaviour for other dialogs that use `Dialog.tsx` without `onMinimize`.
