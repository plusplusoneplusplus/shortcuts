# Unify Enqueue Dialog with FloatingDialog Pattern

## Problem

The **Generate Task** dialog (`GenerateTaskDialog.tsx`) uses `FloatingDialog` on desktop (draggable, resizable, no backdrop) and falls back to `Dialog` on mobile. The **Enqueue/Queue Task** dialog (`EnqueueDialog.tsx`) always uses the basic `Dialog` component — a centered modal with a dark backdrop overlay that blocks the rest of the UI.

This inconsistency means:

- Queuing a task blocks the entire page behind a dark overlay; generating a task does not.
- Users cannot interact with the dashboard while the enqueue form is open.
- Two functionally similar "submit an AI prompt" dialogs behave differently.

## Analysis

### Current state

| Component | Desktop | Mobile | Draggable | Resizable | Backdrop |
|-----------|---------|--------|-----------|-----------|----------|
| `GenerateTaskDialog` | `FloatingDialog` | `Dialog` | ✅ | ✅ | ❌ (desktop) / ✅ (mobile) |
| `EnqueueDialog` | `Dialog` | `Dialog` | ❌ | ❌ | ✅ always |

### Shared base components

Both live in `packages/coc/src/server/spa/client/react/shared/`:

- **`Dialog.tsx`** — Fixed modal overlay with `bg-black/40` backdrop. Centered on desktop, full-screen on mobile. Props: `open`, `onClose`, `onMinimize`, `title`, `children`, `footer`, `className`, `id`, `disableClose`.
- **`FloatingDialog.tsx`** — Draggable, optionally resizable panel with **no** backdrop. Portal-rendered. Props superset of `Dialog` plus `resizable`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight`.

### Consumers (13 total)

Only `GenerateTaskDialog` conditionally picks `FloatingDialog` (desktop) vs `Dialog` (mobile). All 12 other consumers always use `Dialog`. This means the `FloatingDialog` pattern is proven but under-adopted.

## Proposal

Upgrade `EnqueueDialog` to use the same desktop/mobile split as `GenerateTaskDialog`:

```
Desktop → FloatingDialog (draggable, no backdrop)
Mobile  → Dialog (full-screen modal)
```

This is a **low-risk, surgical change** — the `FloatingDialog` component already exists, is tested, and both dialogs share nearly identical prop shapes.

### Why merge the pattern (not the components)

`EnqueueDialog` and `GenerateTaskDialog` are **not** candidates for component-level merging — their form fields, state management, submission flows, and context providers are different. What should be unified is the **dialog shell pattern**: both should use `FloatingDialog` on desktop and `Dialog` on mobile.

## Acceptance Criteria

- [x] `EnqueueDialog` renders inside `FloatingDialog` on desktop viewports (non-mobile).
- [x] `EnqueueDialog` continues to render inside `Dialog` on mobile viewports.
- [x] The enqueue dialog is draggable on desktop (no backdrop overlay).
- [x] All existing enqueue dialog functionality is preserved (form fields, submission, validation, skill selection, image paste).
- [x] Existing tests for `EnqueueDialog` pass (update selectors if needed).
- [x] No regressions in `GenerateTaskDialog` behavior.

## Subtasks

### 1. Update EnqueueDialog to use FloatingDialog on desktop
**File:** `packages/coc/src/server/spa/client/react/queue/EnqueueDialog.tsx`

- Import `FloatingDialog` and `useBreakpoint`.
- Add `const { isMobile } = useBreakpoint();` inside the component.
- Extract the dialog body into a `dialogContent` variable (same pattern as `GenerateTaskDialog`).
- Conditionally render `<FloatingDialog>` (desktop) or `<Dialog>` (mobile).
- Pass `resizable` prop for consistency with GenerateTaskDialog.

### 2. Update tests
- Verify existing tests still pass; update any selectors that depend on `dialog-overlay` test IDs.
- Add a test confirming `FloatingDialog` is rendered when `isMobile` is false.

### 3. (Optional) Audit other Dialog consumers
Review the 11 other `Dialog` consumers to identify which would also benefit from the floating pattern. Low-priority confirmation dialogs (delete, move) should stay as modal `Dialog`. Longer-form creation dialogs (AddRepoDialog, AddWikiDialog, AddPipelineDialog) could be candidates for a follow-up.

## Notes

- `FloatingDialog` already handles ESC key, minimize, close, and portal rendering — no extra plumbing needed.
- The `EnqueueDialog` already has an `onMinimize`-compatible close dispatch (`CLOSE_DIALOG`). Adding a minimize pill (like GenerateTaskDialog) could be a follow-up enhancement.
- Both components use Tailwind utility classes — no CSS file changes needed.
- The `FloatingDialog` z-index (`10002`) matches `Dialog`, so stacking order is preserved.
