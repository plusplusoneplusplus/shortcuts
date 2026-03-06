# Minimizable Enqueue AI Task Dialog

## Problem

The "Enqueue AI Task" dialog cannot be minimized. Users who open it to configure a task may want to reference other parts of the UI (e.g., process list, wiki, logs) before submitting, but the dialog blocks interaction or must be closed (losing form state).

## Proposed Approach

Pass an `onMinimize` handler to `EnqueueDialog`'s `FloatingDialog` (desktop) and `Dialog` (mobile) components. When minimized, the dialog collapses into the existing bottom-right minimized-pill tray via `MinimizedDialogsContext`. Restoring the pill re-opens the dialog with all form state intact.

The infrastructure already exists (`onMinimize` prop on both wrappers, `MinimizedDialogsContext`). Only `EnqueueDialog.tsx` needs to be updated.

## Acceptance Criteria

- [ ] A minimize button (−) appears in the header of the Enqueue AI Task dialog on both desktop (FloatingDialog) and mobile (Dialog).
- [ ] Clicking minimize collapses the dialog into a labeled pill in the bottom-right minimized-dialogs tray (label: "Enqueue Task" or the current prompt prefix).
- [ ] All form state (prompt text, images, skill, model, workspace, folder) is preserved while minimized.
- [ ] Clicking the pill restores the dialog at its previous position/size.
- [ ] Closing (×) the dialog while minimized removes the pill and discards form state (existing behavior).
- [ ] No regressions: Cancel, ESC, and post-submit close still work normally.

## Subtasks

1. **Add `onMinimize` to `EnqueueDialog` (desktop path)**
   - In `EnqueueDialog.tsx`, pass `onMinimize` to `<FloatingDialog>`.
   - The handler should call the `MinimizedDialogsContext` `minimize` action with an appropriate label (e.g., first ~30 chars of prompt or "Enqueue Task").

2. **Add `onMinimize` to `EnqueueDialog` (mobile path)**
   - Pass the same `onMinimize` handler to `<Dialog>` for the mobile render branch.

3. **Derive a meaningful pill label**
   - If the prompt field has content, use a truncated version (≤30 chars + "…").
   - Otherwise, fall back to `"Enqueue Task"`.

4. **Verify restore behavior**
   - Confirm `MinimizedDialogsContext` restore action re-dispatches `OPEN_DIALOG` (or equivalent) so the dialog re-opens with state intact.
   - If the context restore path calls `OPEN_DIALOG` fresh (losing state), adjust to use a separate `RESTORE_DIALOG` action that keeps existing `dialogState`.

5. **Manual smoke test**
   - Open dialog, fill fields, minimize, navigate elsewhere, restore, verify fields intact, submit.
   - Open dialog, minimize, close from pill, verify dialog gone.

## Notes

- `FloatingDialog` and `Dialog` both already accept `onMinimize?: () => void` — no changes needed to shared components.
- `MinimizedDialogsContext` is imported in both wrappers; `EnqueueDialog` itself doesn't need to import it directly — the wrappers handle registration.
- The dialog state lives in `QueueContext` reducer. If restore re-dispatches `OPEN_DIALOG` with no payload, default values will overwrite current form values. Investigate whether `dialogState` is preserved during minimize or needs to be guarded.
- Only `packages/coc/src/server/spa/client/react/queue/EnqueueDialog.tsx` is the primary change target.
