# Archive Chat Feature Plan

## Problem Statement

The chat conversation list in the CoC dashboard's Chat tab grows indefinitely with no way to declutter it. Users can only pin chats but cannot archive (hide) old ones. This plan adds:

1. **"Archive Chat" / "Unarchive Chat"** right-click context menu item (alongside existing "Pin Chat")
2. **"Show Archived" toggle switch** at the top of the chat list (default: **off**, archived chats hidden)

## Reference Image

- Screenshot shows the Chat tab with a long list and a right-click menu showing only "Pin Chat"
- New "Archive Chat" item goes below "Pin Chat" in that same context menu
- Toggle appears in the header row near the "New Chat" button or just below it

---

## Approach

Follow the exact same pattern as the existing `usePinnedChats` hook:
- Persist archived session IDs in `UserPreferences.archivedChats: Record<string, string[]>` (workspace-scoped)
- New hook `useArchivedChats` mirrors `usePinnedChats` API
- Filter archived sessions from the main list when toggle is off
- Show archived sessions in a visually distinct section when toggle is on

---

## Scope

**In scope:**
- `archivedChats` preference field (backend type + persistence)
- `useArchivedChats` React hook
- Archive/Unarchive context menu item in `ChatSessionSidebar`
- "Show Archived" toggle in `ChatSessionSidebar` header
- Archived sessions section (shown when toggle is on)
- Pinned chats cannot be archived simultaneously (archive action auto-unpins)

**Out of scope:**
- Bulk archive actions
- Archive indicator icon on chat cards
- Server-side filtering of archived chats

---

## Files to Change

| File | Change |
|------|--------|
| `packages/coc-server/src/handlers/preferences-handler.ts` | Add `archivedChats?: Record<string, string[]>` to `UserPreferences` |
| `packages/coc/src/server/spa/client/react/chat/useArchivedChats.ts` | **New file** — mirrors `usePinnedChats.ts` |
| `packages/coc/src/server/spa/client/react/chat/ChatSessionSidebar.tsx` | Add archive context menu item, "Show Archived" toggle, archived sessions section |
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Wire `useArchivedChats` hook, pass props to sidebar |
| `packages/coc/src/server/spa/client/react/types/dashboard.ts` | *(optional)* No change needed — `archived` is derived from preference set, not stored on `ChatSessionItem` |

---

## Detailed Task Breakdown

### Task 1 — Backend: Add `archivedChats` to `UserPreferences`

**File:** `packages/coc-server/src/handlers/preferences-handler.ts`

- Add `archivedChats?: Record<string, string[]>` to the `UserPreferences` interface (same structure as `pinnedChats`)
- The existing PATCH handler already does a shallow merge, so no handler logic change needed

---

### Task 2 — Frontend Hook: `useArchivedChats`

**File:** `packages/coc/src/server/spa/client/react/chat/useArchivedChats.ts` *(new)*

Mirrors `usePinnedChats.ts` exactly but operates on the `archivedChats` preference key:

```ts
// Returns:
{
  archiveSet: Set<string>,          // archived session IDs for current workspace
  toggleArchive: (sessionId: string) => void,  // archive or unarchive
  isArchived: (sessionId: string) => boolean,
}
```

- `toggleArchive` auto-removes from pinned if the session is currently pinned (requires `pinnedChats` context or a passed-in `onUnpin` callback)

---

### Task 3 — Sidebar UI: Context Menu + Toggle + Archived Section

**File:** `packages/coc/src/server/spa/client/react/chat/ChatSessionSidebar.tsx`

#### 3a. New props on `ChatSessionSidebarProps`:
```ts
archiveSet: Set<string>
onToggleArchive: (sessionId: string) => void
showArchived: boolean
onToggleShowArchived: () => void
```

#### 3b. Context menu — add item after "Pin Chat":
```ts
{
  label: archiveSet.has(contextMenu.sessionId) ? 'Unarchive Chat' : 'Archive Chat',
  icon: '🗄️',
  onClick: () => onToggleArchive(contextMenu.sessionId),
}
```

#### 3c. Header toggle switch — add to the sidebar header area:
```
[Chats]                    [New Chat ▼]
                           [ ] Show Archived
```
A small checkbox/toggle labeled "Show Archived" (default unchecked).

#### 3d. Session filtering logic:
- Main list: exclude archived sessions (always)
- Archived section: show only when `showArchived === true`, rendered below the unpinned list with a subtle divider label "Archived"

---

### Task 4 — Wire in `RepoChatTab`

**File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx`

- Instantiate `useArchivedChats(workspaceId)`
- Add local `showArchived` state: `const [showArchived, setShowArchived] = useState(false)`
- Pass all four new props to `<ChatSessionSidebar>`
- Pass `onUnpin` callback to `useArchivedChats` so archiving a pinned chat auto-unpins it

---

## UI Behavior Details

| Scenario | Behavior |
|----------|----------|
| Archive a pinned chat | Automatically unpinned, then archived |
| Archive currently-open chat | Chat remains open/visible in panel; just removed from main list |
| Toggle "Show Archived" on | Archived section appears at bottom of list with "Archived" label |
| Toggle "Show Archived" off | Archived section hidden; default state |
| Unarchive via right-click | Session moves back to main list (top of unpinned section) |
| Empty archived section | When `showArchived` is on but no archived chats exist, show "No archived chats" empty state |

---

## Notes

- `archivedChats` persists via the same `PATCH /api/preferences` endpoint as `pinnedChats` — no new API endpoints needed
- The toggle state (`showArchived`) is ephemeral UI state (not persisted), resets on page refresh — this is intentional (default hidden)
- Mobile long-press context menu supports the new item automatically via the existing `ContextMenu` component
