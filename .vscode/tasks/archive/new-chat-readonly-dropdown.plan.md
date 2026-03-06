# Plan: New Chat Dropdown — Read-Only Selection

## Problem

The "+ New Chat" button in the CoC dashboard (`ChatSessionSidebar`) opens a fresh chat page, but the user must manually toggle the "Read-only" checkbox **after** the page loads.  
The request is to let users pre-select Read-Only mode **before** opening the chat, via a dropdown attached to the "New Chat" button.

---

## Current Architecture (relevant parts)

| File | Role |
|------|------|
| `packages/coc/src/server/spa/client/react/chat/ChatSessionSidebar.tsx` | Renders the `+ New Chat` button; calls `onNewChat: () => void` |
| `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx` | Owns `newChatTrigger` state; increments it in `handleNewChatFromTopBar`; passes it to `RepoChatTab` |
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Receives `newChatTrigger`; calls `handleNewChat()` on change; owns `readOnly` boolean state; renders the Read-only checkbox |

**Trigger flow today:**  
`ChatSessionSidebar (onNewChat click)` → `RepoChatTab.handleNewChat()` *(direct)*  
`TopBar New Chat button` → `RepoDetail.handleNewChatFromTopBar()` → increments `newChatTrigger` → `RepoChatTab useEffect` → `handleNewChat()`

---

## Proposed Solution

### UI change — Split/Dropdown button in `ChatSessionSidebar`

Replace the single "New Chat" `<Button>` with a **split button** (primary action + caret):

```
[ + New Chat  ▾ ]
                ┌────────────────────┐
                │ ✓  New Chat         │  ← default (read-only OFF)
                │    New Chat (Read-Only) │  ← sets read-only ON
                └────────────────────┘
```

- Clicking the **left part** fires the default (read-only = false).
- Clicking the **caret** opens the dropdown; selecting either option fires with the corresponding flag.
- The same dropdown pattern should be applied to the **top-bar** "New Chat" button in `RepoDetail` for consistency.

### Data flow change — carry `readOnly` through the trigger

Currently `newChatTrigger` is a plain counter (`number`).  
Add a companion ref `newChatReadOnlyRef` (a `React.MutableRefObject<boolean>`) that is set **just before** the trigger is incremented, so no interface breaking change is needed for the counter.

Alternatively (cleaner): change the prop to an object trigger:

```ts
// New shape
interface NewChatTrigger {
  count: number;
  readOnly: boolean;
}
```

Both approaches are acceptable; the object shape is preferred for clarity.

For the **direct** path (sidebar button → `RepoChatTab.handleNewChat`), extend `onNewChat` to accept a boolean:

```ts
onNewChat: (readOnly: boolean) => void;
```

### State change in `RepoChatTab`

`handleNewChat` currently resets state without setting `readOnly`. Update it to accept an optional `readOnly` argument and apply it:

```ts
const handleNewChat = useCallback((initialReadOnly = false) => {
  setReadOnly(initialReadOnly);
  // ... rest of reset logic
}, [...]);
```

---

## Files to Change

1. **`ChatSessionSidebar.tsx`**
   - Replace `<Button onClick={onNewChat}>` with a split-button component.
   - `onNewChat` prop signature: `(readOnly: boolean) => void`.
   - Add dropdown menu with two options.

2. **`RepoChatTab.tsx`**
   - Update `onNewChat` in the `ChatSessionSidebarProps` call to pass `(readOnly) => handleNewChat(readOnly)`.
   - Update `handleNewChat` to accept and apply `initialReadOnly`.
   - Update `newChatTrigger` effect to read the `readOnly` value from the updated trigger shape.

3. **`RepoDetail.tsx`**
   - Update `handleNewChatFromTopBar` to accept a `readOnly` boolean.
   - Change `newChatTrigger` state to `{ count: number; readOnly: boolean }`.
   - Apply the same split-button to the top-bar "New Chat" button (if one exists there).

4. **`ChatSessionSidebar` prop interface** (types only)
   - `onNewChat: (readOnly: boolean) => void`

---

## Out of Scope

- Persisting the last-used read-only preference across sessions.
- Changing the read-only toggle behavior once a chat is already started.
- Any backend changes (the `type: 'readonly-chat' | 'chat'` logic in `RepoChatTab` stays as-is).

---

## Notes

- A reusable `SplitButton` component may already exist in the SPA's shared UI; check before building a new one.
- The dropdown should be keyboard-accessible (arrow keys + Enter).
- Existing tests for `ChatSessionSidebar` and `RepoChatTab` will need to be updated to pass `readOnly` to `onNewChat`.
