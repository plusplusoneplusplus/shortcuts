# Plan: Add Info Icon to Chat Conversation Page

## Problem

The chat conversation page (`/#repos/<ws>/chat`) is missing the information icon (ℹ️) that exists in the Tasks tab process detail view. The Tasks tab shows a circular "i" button that opens a `ConversationMetadataPopover` with rich metadata (process ID, model, status, duration, working directory, session ID, timestamps, etc.). The Chat page exposes none of this metadata to the user despite having the underlying data available in the `task` object.

## Current State

| Feature | Tasks Tab (`ProcessDetail.tsx`) | Chat Tab (`RepoChatTab.tsx`) |
|---|---|---|
| Info icon / metadata popover | ✅ `ConversationMetadataPopover` | ❌ Missing |
| Process/session metadata visible | ✅ ID, model, duration, status, etc. | ❌ Not exposed |

## Proposed Approach

Reuse the existing `ConversationMetadataPopover` component — already used in `ProcessDetail.tsx` — and render it in the active chat session header inside `RepoChatTab.tsx`. No new component is needed; this is purely a UI wiring task.

## Files Involved

| File | Change |
|---|---|
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Import `ConversationMetadataPopover` and render it in the active chat header |
| `packages/coc/src/server/spa/client/react/processes/ConversationMetadataPopover.tsx` | Read-only reference — no changes needed |

## Tasks

1. **Locate the active-session header in `RepoChatTab.tsx`**
   - Find the header/toolbar area rendered when a chat session is active (the right panel top bar).
   - Identify the `task` / process object available in scope that can be passed to the popover.

2. **Import `ConversationMetadataPopover`**
   - Add the import to `RepoChatTab.tsx`.
   - Confirm the props interface: `process` (the process/task object) and `turnsCount` (number of conversation turns).

3. **Render the info icon in the chat header**
   - Alongside any existing controls (cancel, resume buttons) in the active chat header, add:
     ```tsx
     <ConversationMetadataPopover process={activeTask} turnsCount={turns.length} />
     ```
   - Position it consistently with how it appears in `ProcessDetail.tsx` (top-right area of the header).

4. **Verify popover data completeness**
   - Confirm the `task` object in `RepoChatTab.tsx` contains the same fields `ConversationMetadataPopover` expects (process ID, type, status, model, session ID, timestamps, working directory, workspace).
   - If any fields are absent, check whether they can be sourced from the existing API response or require a small backend addition.

5. **Manual test**
   - Navigate to `/#repos/<ws>/chat`, open a chat session.
   - Confirm the "i" icon appears in the header.
   - Click it — verify the popover shows correct metadata (ID, model, timestamps, turn count, etc.).
   - Confirm it matches the style/behavior of the Tasks tab info icon.

## Notes

- The `ConversationMetadataPopover` is already self-contained with positioning, dark-mode styles, and keyboard/click-outside dismissal — no style work needed.
- Chat sessions that have no active task (e.g., while a new chat hasn't been sent yet) should **not** show the icon; render it conditionally only when `activeTask` is defined.
- No backend changes are anticipated unless the task object returned by the chat API is missing fields.
