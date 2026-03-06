# Plan: Add New Chat Button to Top Bar

## Problem

The "New Chat" action is only accessible from the Chat tab's sidebar (`ChatSessionSidebar`). Users want a top-bar shortcut, consistent with the existing **+ Queue Task** and **✨ Generate Plan** buttons, so they can start a fresh chat from any tab without first navigating to Chat.

## Approach

Add a **+ New Chat** `<Button>` into the `RepoDetail` header section (same file and same JSX block as Queue Task and Generate Plan). When clicked, it navigates to the Chat tab and triggers the same `handleNewChat` logic already implemented in `RepoChatTab`.

---

## Key Files

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx` | Add `+ New Chat` button in the header button group |
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Expose `handleNewChat` or allow triggering it via a URL/hash flag |

---

## Implementation Notes

### Button placement
In `RepoDetail.tsx`, the header already contains:
```tsx
<Button variant="primary" size="sm" ...>+ Queue Task</Button>
<Button variant="primary" size="sm" ...>✨ Generate Plan</Button>
```
Add directly after (or before) these:
```tsx
<Button variant="primary" size="sm" onClick={handleNewChatFromTopBar} data-testid="repo-new-chat-btn">
  + New Chat
</Button>
```

### Triggering new chat from outside the Chat tab
`handleNewChat` lives inside `RepoChatTab` and resets local state. Two clean options:

**Option A (recommended) — URL hash flag**
`handleNewChatFromTopBar` simply sets `location.hash` to:
```
#repos/<workspaceId>/chat?newChat=1
```
`RepoChatTab` already reads the hash on mount/update; add a check for the `?newChat=1` query param and call `handleNewChat()` + strip the param, then switch the active tab to "Chat".

**Option B — lifted state / context**
Lift `handleNewChat` into a shared context or `RepoDetail` state so both the sidebar button and the top bar button call the same function directly. This is more invasive but avoids URL coupling.

**Recommendation:** Option A — minimal change, no new context, consistent with existing hash-based navigation.

### Tab switching
When the top-bar button is clicked and the user is not on the Chat tab, the active tab must switch to "Chat". `RepoDetail` already manages `activeTab` state — set it to `'chat'` in the click handler before (or as part of) the hash navigation.

---

## Todos

1. **Explore tab switching** — confirm how `activeTab` is managed in `RepoDetail.tsx` and how it can be set programmatically.
2. **Add URL param handling in `RepoChatTab`** — detect `?newChat=1` in the hash, call `handleNewChat()`, then clean the param from the URL.
3. **Add `+ New Chat` button in `RepoDetail.tsx`** — insert button in the header group with the same `variant="primary" size="sm"` props; handler sets `activeTab = 'chat'` and navigates to the new-chat hash.
4. **Wire up tab switching** — ensure clicking the button both navigates the hash and activates the Chat tab.
5. **Test manually** — verify button appears on all tabs, clicking it switches to Chat tab and clears any existing conversation.
6. **Add/update tests** — add a test for the new button in the existing SPA test suite.

---

## Out of Scope

- Changing the icon or label style beyond matching the existing buttons.
- Persisting "new chat" intent across page reloads.
- Mobile/responsive layout changes.
