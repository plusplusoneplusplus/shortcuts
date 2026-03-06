# Plan: Minimizable Markdown Preview Dialog

## Problem

When a file-path link is clicked in a CoC chat conversation, a full-screen `MarkdownReviewDialog` modal opens. Closing it destroys the dialog state. The user must navigate back to the chat, find the link, and click it again to reopen the same file. There is no minimize-and-restore affordance.

## Proposed Approach

Add a **minimize** button to the dialog header. When minimized, the dialog hides and a **floating restore chip** appears (bottom-right corner of the screen). Clicking the chip reopens the full dialog at the same scroll position. Closing the chip dismisses entirely (current behavior).

### UI Sketch

- **Dialog header** (existing): `[title]  [subtitle]`  →  add `[−]` minimize  `[✕]` close
- **Floating chip** (new, shown only when minimized): pill at bottom-right with filename + `[⬆]` restore + `[✕]` close

## Current State

| File | Relevant Detail |
|------|----------------|
| `packages/coc/src/server/spa/client/react/processes/MarkdownReviewDialog.tsx` | Dialog component, renders header + `MarkdownReviewEditor` |
| `packages/coc/src/server/spa/client/react/App.tsx` | Holds `reviewDialog` state (`open`, `wsId`, `filePath`, `displayPath`, `fetchMode`); renders `<MarkdownReviewDialog>` at root |

## Acceptance Criteria

1. The `MarkdownReviewDialog` header has a minimize button (`−`) distinct from the close button (`✕`).
2. Clicking minimize hides the dialog modal without destroying state (scroll position preserved on restore).
3. A floating restore chip appears in the bottom-right corner when the dialog is minimized, showing the short filename.
4. Clicking the chip body (or a restore icon) reopens the full dialog at the previous scroll position.
5. Clicking `✕` on the chip dismisses the preview entirely (same as current close behavior).
6. Opening a new file link while another is minimized replaces the minimized state (only one preview at a time).
7. Works correctly on both mobile and desktop breakpoints.
8. No regression: existing close behavior is unchanged when minimize is not used.

## Subtasks

### 1. Extend App-level `reviewDialog` state
- Add `minimized: boolean` field to `MarkdownReviewDialogState` in `App.tsx`
- Add `setMinimized` handler that sets `minimized: true, open: false` (keeps wsId/filePath intact)
- Pass `onMinimize` callback down to `MarkdownReviewDialog`
- When a new link is opened, reset `minimized` to `false`

### 2. Add minimize button to `MarkdownReviewDialog`
- Add `onMinimize?: () => void` prop
- Render a `[−]` icon button in both mobile and desktop headers (left of `✕`)
- Button is hidden if `onMinimize` is not provided (backward compat)

### 3. Preserve scroll position
- Lift `scrollTop` state or use a `ref` inside `MarkdownReviewEditor` / `MarkdownReviewDialog`
- On minimize, capture current `scrollTop`; on restore, restore it via `scrollTo` after mount

### 4. Create `MarkdownReviewMinimizedChip` component
- New file: `packages/coc/src/server/spa/client/react/processes/MarkdownReviewMinimizedChip.tsx`
- Props: `fileName: string`, `onRestore: () => void`, `onClose: () => void`
- Fixed position: `bottom-4 right-4`, `z-50`, pill shape, VS Code theme colors
- Renders: file icon + truncated filename + restore chevron + close `✕`

### 5. Wire chip into `App.tsx`
- Render `<MarkdownReviewMinimizedChip>` conditionally when `reviewDialog.minimized === true`
- `onRestore` → sets `open: true, minimized: false`
- `onClose` → resets dialog state fully

### 6. Mobile consideration
- On mobile, position chip at `bottom-16 right-4` (above `BottomNav`)
- Use `useBreakpoint` hook already available

## Notes

- Only one preview dialog exists globally (App-level singleton). No need to support multiple minimized previews.
- `MarkdownReviewDialog` already guards `if (!open || !wsId || !filePath) return null` — change to only guard `!wsId || !filePath` and control rendering with `open` CSS visibility, or keep early return and handle scroll restoration via stored offset in state.
- Simpler scroll preservation: store `scrollTop` in `reviewDialog` state; pass as `initialScrollTop` prop to `MarkdownReviewEditor`.
- The `Dialog` shared component likely uses `open` prop for a backdrop/portal — check whether it unmounts children on `open=false`; if so, we must not rely on DOM for scroll position.
