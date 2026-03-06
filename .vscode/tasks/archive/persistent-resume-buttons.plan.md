# Persistent "Resume in Terminal" Button for CoC SPA Chat

## Problem

The "Resume" and "Resume in Terminal" buttons in the SPA Chat tab only appear when `sessionExpired === true` (triggered by a 410 HTTP response on follow-up). This means users can't resume a completed or failed chat in the CLI — the buttons are invisible unless they attempt to send a message first and get a 410.

## Proposed Approach

Make the resume actions persistently available whenever the chat task is **not actively running**. The input area should show three states:

| Task Status | Input Area |
|---|---|
| `running` / `queued` / streaming | Normal textarea + Send (current behavior) |
| `completed` / `failed` / expired | Textarea + Send **plus** Resume / Resume in Terminal / New Chat buttons below |
| No task selected | Empty / disabled |

### Key Design Decision

Instead of *replacing* the input with resume buttons (current expired-only behavior), show the resume buttons **below** the input area when the task is done/failed. This lets users both attempt a follow-up (which may trigger resume automatically) and explicitly click resume.

## Changes

### File: `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx`

1. **Derive a `taskFinished` boolean** from `task?.status`:
   ```ts
   const taskFinished = task?.status === 'completed' || task?.status === 'failed';
   ```

2. **Refactor the input area** (lines 517-548):
   - Always show the textarea + Send when NOT `sessionExpired` (keep current guard for full replacement when 410 received)
   - When `taskFinished || sessionExpired`: show the resume action buttons
   - Layout: when taskFinished but not expired, show buttons *below* the textarea as a secondary row
   - When sessionExpired: keep current behavior (buttons replace textarea entirely)

3. **Update header resume button** (lines 486-490):
   - Show header "↻ Resume" button when `sessionExpired || taskFinished`
   - Not when streaming or running

4. **Disable "Resume in Terminal"** appropriately:
   - Disabled when `!processId` or task is `running`/`queued`
   - Enabled when `completed`, `failed`, or `sessionExpired`

### Rough UI for `taskFinished` (not expired):

```
┌──────────────────────────────────────┐
│ [textarea: Follow up…]        [Send] │
├──────────────────────────────────────┤
│   [Resume]  [Resume in Terminal]     │
└──────────────────────────────────────┘
```

### Rough UI for `sessionExpired` (current, unchanged):

```
┌──────────────────────────────────────┐
│  [Resume] [Resume in Terminal] [New] │
└──────────────────────────────────────┘
```

## Todos

- [x] derive-task-finished: Add `taskFinished` derived boolean
- [x] refactor-input-area: Refactor input area to show resume buttons when task finished
- [x] update-header-button: Update header resume button visibility
- [x] verify-build: Verify build passes

## Notes

- The `sendFollowUp` function already handles the 410 → expired transition, so attempting to type in the textarea when the session is dead will naturally degrade to the expired state.
- `handleResumeChat` and `handleResumeInTerminal` functions don't need changes — they already work with `processId`/`chatTaskId`.
- No backend changes required.
