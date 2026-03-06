# Plan: Per-Chat Input Box State & Disabled Logic

## Problem

In `RepoChatTab.tsx`, the chat input box (`inputValue`) is a single piece of React state
shared by all sessions. When the user types something then switches to a different chat
session, the same text is still visible — input is not per-chat.

Additionally, the `disabled` state of the textarea and send button today only tracks
`sending` (an in-flight API call), not the status of the **focused chat's task**
(e.g., `queued`, `running`, `completed`, `failed`). A streaming or queued task in the
currently focused chat should also block new input.

---

## Goals

1. **Per-chat input value** — each chat session remembers its own draft input text.
2. **Per-chat disabled state** — the input and send button are disabled/enabled based on
   the focused chat's task status, not just `sending`.
3. **Slash-command menu cleanup** — dismiss the slash-command menu when switching sessions
   (minor cleanup, in scope).

---

## Approach

### 1. Store input drafts in a `Map<sessionId, string>`

Introduce a `useRef` (or `useState`) map that stores draft text keyed by session ID:

```ts
const inputDrafts = useRef<Map<string | null, string>>(new Map());
```

- When `inputValue` changes, write: `inputDrafts.current.set(selectedTaskId, value)`
- When `handleSelectSession(taskId)` is called, read: `setInputValue(inputDrafts.current.get(taskId) ?? '')`
- When `handleNewChat()` is called, key is `null` → always start with `''` and clear the `null` key draft
- When a chat is sent (`handleStartChat` / `sendFollowUp`), clear the draft: `inputDrafts.current.delete(selectedTaskId)` (already sets `inputValue('')`)

**Why `useRef` not `useState`?**
The map of drafts doesn't need to trigger re-renders; only `inputValue` (for the
controlled textarea) needs to be reactive. `useRef` avoids double renders.

### 2. Derive `inputDisabled` from focused task status

Introduce a derived boolean:

```ts
const inputDisabled =
    sending ||
    isStreaming ||
    task?.status === 'queued' ||
    task?.status === 'running';
```

- `sending` — existing flag for in-flight HTTP calls
- `isStreaming` — active SSE stream
- `task?.status === 'queued' | 'running'` — the focused chat has an active task

Apply `inputDisabled` to:
- Follow-up `<textarea disabled={inputDisabled} />`
- Send button `<Button disabled={inputDisabled || !inputValue.trim()} />`
- Start Chat button (no task yet, so only `sending` applies there — keep as-is)
- `SuggestionChips disabled={inputDisabled || sessionExpired}`

> When `taskFinished` (`completed` | `failed`) or when `task === null` (new chat),
> the input is **enabled**.

### 3. Clear slash-command menu on session switch

In both `handleSelectSession` and `handleNewChat`, add:
```ts
slashCommands.dismissMenu?.();
```

(Only if `useSlashCommands` exposes a dismiss method; verify before implementing.)

---

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Main changes (drafts map, disabled logic, session switch cleanup) |
| `packages/coc/src/server/spa/client/react/hooks/useSlashCommands.ts` (if exists) | Expose `dismissMenu()` if not already present |

---

## Detailed Code Changes

### A. Add `inputDrafts` ref (near line 89)

```ts
// after: const [inputValue, setInputValue] = useState('');
const inputDrafts = useRef<Map<string | null, string>>(new Map());
```

### B. Persist draft on every keystroke (in `onChange` handler, both textareas)

```ts
onChange={e => {
    setInputValue(e.target.value);
    inputDrafts.current.set(selectedTaskId ?? null, e.target.value);  // ← add
    slashCommands.handleInputChange(e.target.value, ...);
}}
```

### C. Restore draft in `handleSelectSession` (line ~438)

```ts
const handleSelectSession = useCallback((taskId: string) => {
    if (isStreaming) stopStreaming();
    currentChatTaskIdRef.current = taskId;
    setSelectedTaskId(taskId);
    setTurnsAndCache([]);
    setError(null);
    setSessionExpired(false);
    setSuggestions([]);
    setInputValue(inputDrafts.current.get(taskId) ?? '');  // ← restore draft
    slashCommands.dismissMenu?.();                          // ← dismiss menu
    loadSession(taskId);
    ...
}, [..., inputDrafts]);
```

### D. Clear null-key draft in `handleNewChat` (line ~471 already has `setInputValue('')`)

```ts
setInputValue('');
inputDrafts.current.delete(null);   // ← clear the "new chat" draft slot
slashCommands.dismissMenu?.();      // ← dismiss menu
```

### E. Clear sent draft after successful send

In `handleStartChat` (line ~495) and `sendFollowUp` (line ~563) after `setInputValue('')`:
```ts
inputDrafts.current.delete(selectedTaskId ?? null);  // ← remove draft after send
```

### F. Add `inputDisabled` derived value (near `taskFinished` at line 114)

```ts
const taskFinished = task?.status === 'completed' || task?.status === 'failed';
const inputDisabled = sending || isStreaming || task?.status === 'queued' || task?.status === 'running';
```

### G. Apply `inputDisabled` to UI

```tsx
// Follow-up textarea (~line 979):
disabled={inputDisabled}

// Follow-up Send button (~line 1009):
disabled={inputDisabled || !inputValue.trim()}

// SuggestionChips (~line 970):
disabled={inputDisabled || sessionExpired}
```

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| User types in Chat A, switches to Chat B (empty draft), comes back to Chat A | Chat A draft is restored ✅ |
| User types in Chat A, sends message | Draft cleared, input cleared ✅ |
| User has Chat A running (`status: running`), switches to Chat B (finished) | Chat B input is enabled; Chat A would be disabled when refocused ✅ |
| User opens a new chat, types, clicks an existing session | New-chat draft is saved under key `null`; switching back restores it ✅ |
| Session expires | `sessionExpired` hides follow-up section (existing logic unchanged) ✅ |
| Slash-command menu open, user switches session | Menu is dismissed ✅ |

---

## Out of Scope

- Persisting drafts across page refreshes (sessionStorage/localStorage)
- Showing a "draft saved" indicator
- Per-session input history
