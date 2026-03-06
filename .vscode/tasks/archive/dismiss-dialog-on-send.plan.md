# Dismiss Floating Chat Dialog on Send

## Problem

After clicking **Send** or pressing **Ctrl+Enter** in the `NewChatDialog` floating panel, the dialog stays open and transitions to showing the ongoing conversation. The desired behavior is for the floating dialog to **close** immediately after the message is sent, letting the user return to the main chat view.

## Acceptance Criteria

- [ ] Clicking the Send button (or pressing Ctrl+Enter) in the initial start-chat input closes the floating `NewChatDialog`.
- [ ] Clicking the Send button (or pressing Ctrl+Enter) in the follow-up input also closes the dialog.
- [ ] The newly created/active chat is visible in the main chat panel (background) after the dialog closes.
- [ ] Closing behavior is consistent on both desktop (FloatingDialog) and mobile (Dialog).
- [ ] No regression: the X / Cancel buttons still close the dialog as before.

## Relevant Files

- `packages/coc/src/server/spa/client/react/chat/NewChatDialog.tsx`
  - `handleStartChat()` (~line 217) — initial send handler; call `onClose()` after task creation succeeds.
  - `sendFollowUp()` (~line 276) — follow-up send handler; call `onClose()` after message is dispatched.
- `packages/coc/src/server/spa/client/react/shared/FloatingDialog.tsx` — wrapper; no changes needed.

## Subtasks

1. **Close on initial send** — In `handleStartChat()`, invoke `onClose()` after the POST to `/queue` succeeds (and the task/chat is navigated to).
2. **Close on follow-up send** — In `sendFollowUp()`, invoke `onClose()` after the POST to `/processes/{pid}/message` succeeds.
3. **Verify navigation** — Ensure the parent component navigates to (or already shows) the active chat in the background panel before or alongside the close, so the user sees the conversation immediately.
4. **Test both input paths** — Verify Ctrl+Enter and Send button on both the start screen and the follow-up screen.

## Notes

- `onClose` is already wired up for the X button; reuse it in the send handlers.
- The streaming/live indicator in the main panel will still work because the SSE subscription is set up before the dialog closes.
- Consider whether to close on *dispatch* (optimistic) or on *success* response — closing on dispatch is snappier UX.
- Mobile uses a modal `Dialog`; the same `onClose` prop applies, so the fix is identical.
