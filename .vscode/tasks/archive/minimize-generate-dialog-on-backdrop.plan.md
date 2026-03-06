# Minimize Generate Task Dialog on Backdrop Click

## Problem

Clicking outside the **Generate Task** dialog (on the backdrop overlay) currently calls `onClose`, which destroys the dialog and loses any unsaved form state (prompt, task name, folder selection, effort level). Users expect backdrop clicks to dismiss the dialog temporarily — not permanently close it.

## Proposed Approach

Change the backdrop `onClick` in `Dialog.tsx` to call `onMinimize` (when provided) instead of `onClose`. This is a one-line change that piggybacks on the already-implemented minimize/restore infrastructure.

The `GenerateTaskDialog` already has full minimize support:
- `minimized` prop renders a floating pill at bottom-right
- `onMinimize` / `onRestore` callbacks exist
- `RepoDetail` already tracks `generateDialog.minimized` state
- Escape key already triggers minimize (when `onMinimize` is provided)

The only gap is the backdrop click path.

## Acceptance Criteria

- [ ] Clicking the backdrop (outside the dialog panel) minimizes the dialog instead of closing it — the floating "✨ Generate Task" pill appears at bottom-right
- [ ] All previously entered form state (prompt, task name, folder, effort) is preserved when restoring from the pill
- [ ] Clicking the floating pill restores the full dialog
- [ ] Clicking the **Close** button still fully closes the dialog (no change to `onClose` behavior)
- [ ] Clicking the **×** header button still fully closes the dialog
- [ ] On mobile (full-screen mode) behavior is unchanged — no backdrop exists on mobile
- [ ] Dialogs that do **not** pass `onMinimize` continue to close on backdrop click (backward compatible)
- [ ] Existing tests pass; new test covers backdrop-click-minimizes behavior

## Subtasks

1. **`Dialog.tsx` — change backdrop click handler**
   - File: `packages/coc/src/server/spa/client/react/shared/Dialog.tsx`
   - Line ~62: `onClick={isMobile ? undefined : onClose}`
   - Change to: `onClick={isMobile ? undefined : (onMinimize ?? onClose)}`

2. **Verify `GenerateTaskDialog` already wires `onMinimize` to `Dialog`**
   - Confirm `GenerateTaskDialog.tsx` passes `onMinimize={onMinimize}` to `<Dialog>`
   - Confirm `RepoDetail.tsx` passes `onMinimize` callback that sets `minimized: true`

3. **Add/update test**
   - File: relevant `.test.tsx` for `Dialog` or `GenerateTaskDialog`
   - Assert: simulating a backdrop click when `onMinimize` is provided calls `onMinimize`, not `onClose`

## Notes

- The Escape key path already does the right thing (line 28 of `Dialog.tsx`): `if (onMinimize) onMinimize(); else onClose();` — the backdrop click just needs the same pattern.
- No state changes needed in `RepoDetail` — minimize state is already tracked.
- The floating pill already shows a prompt preview and a "Restore" label.
- This change applies to **any** dialog that opts in via `onMinimize` prop, not just `GenerateTaskDialog`.
