# Plan: Fix – Attached Image Not Cleared After Sending a Chat Message

## Problem

When a user attaches an image in the CoC chat input dialog and sends the message, the image thumbnail remains visible in the input area. The image should disappear immediately once the message is dispatched to the server.

### Screenshot Evidence
The screenshot shows the image thumbnail still present in the bottom input area even though the "YOU" message bubble (above) already shows the same image as part of the sent message.

## Root Cause

In both follow-up send handlers, `clearImages()` is called **after** `await waitForFollowUpCompletion(...)`, which resolves only when the AI finishes its entire response. This means the image thumbnail persists in the input for the full duration of the AI reply.

Additionally, `clearImages()` is not called in early-return paths (410 session-expired, non-ok response) or in `catch` blocks, meaning a failed send also leaves the thumbnail stuck.

### Affected Files

| File | Function | Issue |
|------|----------|-------|
| `packages/coc/src/server/spa/client/react/queue/QueueTaskDetail.tsx` | `sendFollowUp` | `clearImages()` called after `waitForFollowUpCompletion`, not on error/early-return paths |
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | `sendFollowUp` | `followUpImagePaste.clearImages()` called after `waitForFollowUpCompletion`, not on error/early-return paths |

## Proposed Fix

Move `clearImages()` to be called immediately after the server confirms the message was accepted (i.e., after `response.ok` is confirmed, before `waitForFollowUpCompletion`). This mirrors the UX of clearing the text input (`setFollowUpInput('')` / `setInputValue('')`), which also happens immediately on send.

For the error/early-return paths, the image should be **preserved** so the user can retry — this matches the existing behavior for the text input (`lastFailedMessageRef`). Only clear images on the success path, but do so earlier (right after send, not after completion).

### Change in `QueueTaskDetail.tsx` (`sendFollowUp`)

```diff
- await waitForFollowUpCompletion(selectedProcessId);
- clearImages();
+ clearImages();
+ await waitForFollowUpCompletion(selectedProcessId);
```

### Change in `RepoChatTab.tsx` (`sendFollowUp`)

```diff
- await waitForFollowUpCompletion(processId);
- sessionsHook.refresh();
- followUpImagePaste.clearImages();
+ followUpImagePaste.clearImages();
+ await waitForFollowUpCompletion(processId);
+ sessionsHook.refresh();
```

## Tasks

1. **Fix `QueueTaskDetail.tsx`** — Move `clearImages()` to execute immediately after `response.ok` is confirmed, before `waitForFollowUpCompletion`.
2. **Fix `RepoChatTab.tsx`** — Move `followUpImagePaste.clearImages()` to execute immediately after `response.ok` is confirmed, before `waitForFollowUpCompletion`.
3. **Verify the sent message bubble** — Ensure the user-turn bubble still correctly captures the images snapshot (it already does via `sentFollowUpImages` / spread into the turn state before sending, so this is safe).
4. **Manual smoke test** — Attach an image, send, confirm thumbnail clears instantly; also confirm the image appears in the sent message bubble.

## Notes

- The initial-message send path (not follow-up) likely shares the same pattern and should be audited too if it exists.
- No backend changes needed; this is purely a frontend state-timing fix.
- The fix is minimal (move 1 line in each file) and has no side effects on the message payload or the AI response handling.
