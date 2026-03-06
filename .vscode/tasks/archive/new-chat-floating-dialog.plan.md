# New Chat as Floating Dialog

## Problem

Clicking **+ New Chat** or **New Chat (Read-Only)** from the top bar dropdown currently switches to the Chat tab and shows the default new-chat page. This is disruptive — the user loses context of whatever tab they were viewing.

## Proposed Approach

Reuse the existing `FloatingDialog` component (already used by Generate Task) to open a new chat session in a floating, resizable, minimizable overlay — instead of navigating away to the Chat tab.

## Acceptance Criteria

- [x] Clicking **New Chat** from the top-bar dropdown opens a `FloatingDialog` containing the chat UI instead of switching to the Chat tab.
- [x] Clicking **New Chat (Read-Only)** opens the same dialog with read-only mode enabled.
- [x] The dialog is **draggable**, **resizable**, and **minimizable** (matching Generate Task behavior).
- [x] Minimized chat dialogs appear as a small pill/bar at the bottom of the viewport (consistent with existing minimize UX).
- [x] The user can continue interacting with the current tab behind the dialog.
- [x] **New Chat (Terminal)** behavior is unchanged (still launches in terminal).
- [x] The chat sidebar **New Chat** button also opens the floating dialog (if applicable).
- [ ] Multiple floating chat dialogs can coexist (or: only one at a time — TBD, see notes).

## Subtasks

1. **Create `NewChatDialog` component** — ✅ Wrap the chat input/conversation UI inside a `FloatingDialog`. Accept props for `readOnly`, `onClose`, `onMinimize`, and workspace context.
2. **Wire up top-bar dropdown** — ✅ In `RepoDetail.tsx`, replace `handleNewChatFromTopBar` logic for New Chat / New Chat (Read-Only) to open the floating dialog instead of calling `switchSubTab('chat')`.
3. **Manage dialog state** — ✅ Add state in `RepoDetail` (or a shared context) to track open/minimized floating chat dialogs.
4. **Extract reusable chat body** — ✅ If the chat UI in `RepoChatTab` is tightly coupled to the tab layout, extract the core chat input + message list into a shared component that can render in both the tab and the dialog.
5. **Sidebar new-chat button** — ✅ Update `ChatSessionSidebar.tsx` new-chat dropdown to also open the floating dialog when not already on the chat tab.
6. **Test** — ✅ Add/update Vitest tests for the new dialog open/close/minimize flows.

## Key Files

| File | Role |
|------|------|
| `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx` | Top-bar New Chat button & dropdown |
| `packages/coc/src/server/spa/client/react/shared/FloatingDialog.tsx` | Reusable floating dialog (drag/resize/minimize) |
| `packages/coc/src/server/spa/client/react/tasks/GenerateTaskDialog.tsx` | Reference implementation using FloatingDialog |
| `packages/coc/src/server/spa/client/react/chat/RepoChatTab.tsx` | Current chat tab UI to extract from |
| `packages/coc/src/server/spa/client/react/chat/ChatSessionSidebar.tsx` | Sidebar new-chat dropdown |

## Notes

- **Multiple dialogs vs single**: Decide whether users can open multiple floating chats simultaneously. Start with single-dialog (simpler state management), expand later if needed.
- **Terminal option unchanged**: "New Chat (Terminal)" still launches via the existing terminal flow — no dialog needed.
- **Tab chat still works**: The Chat tab itself should remain functional for viewing history and existing sessions. The dialog is for *new* chats specifically.
- **Mobile**: On mobile the dialog may not make sense — consider keeping the current tab-switch behavior on small screens.
