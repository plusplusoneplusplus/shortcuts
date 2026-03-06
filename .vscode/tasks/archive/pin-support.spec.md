# Chat Pin Support — UX Specification

## User Story

As a CoC dashboard user with many chat sessions, I want to **pin important chats** to the top of the sidebar so I can quickly return to ongoing or reference conversations without scrolling through the full history.

---

## Entry Points

| Trigger | Location | Action |
|---------|----------|--------|
| **Pin icon on hover** | Chat session card (right side) | Toggle pin/unpin on the hovered card |
| **Right-click context menu** | Chat session card | "Pin Chat" / "Unpin Chat" menu item |

No keyboard shortcut or Command Palette entry needed — this is a lightweight, mouse-driven interaction scoped to the sidebar.

---

## User Flow

### Pinning a Chat

```
Initial state:
┌─────────────────────────┐
│ Chats            [+ New] │
├─────────────────────────┤
│ ⏳ why does the wiki...  │  ← hover shows 📌 icon
│ ✅ IMPORTANT: Output...  │
│ ❌ change to Generate... │
│ ✅ chagne to Generate... │
│ ✅ rename to Generate... │
└─────────────────────────┘

User hovers "IMPORTANT: Output..." → pin icon (📌) appears on right edge
User clicks 📌

After state:
┌─────────────────────────┐
│ Chats            [+ New] │
├─────────────────────────┤
│ 📌 Pinned                │  ← section header (subtle, muted text)
│ ✅ IMPORTANT: Output...  │  ← pinned card (pin icon always visible)
├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┤  ← thin separator line
│ ⏳ why does the wiki...  │
│ ❌ change to Generate... │
│ ✅ chagne to Generate... │
│ ✅ rename to Generate... │
└─────────────────────────┘
```

### Unpinning a Chat

- On pinned cards, the 📌 icon is **always visible** (not just on hover).
- Clicking the 📌 on a pinned card unpins it and moves it back to the chronological list.
- Right-click → "Unpin Chat" achieves the same.

### Multiple Pins

- Multiple chats can be pinned. Pinned chats are ordered by **pin time** (most recently pinned on top).
- No limit on number of pinned chats (user self-moderates).

---

## Visual Design

### Pin Icon

- **Unpinned card (hover):** Muted/ghost 📌 icon appears on the right side of the card, next to the existing ✕ cancel button area.
- **Pinned card:** Solid 📌 icon, always visible (not just on hover). Uses the accent/primary color for emphasis.

### Section Layout

```
┌───────────────────────────────┐
│ 📌 Pinned            (count) │  ← Only shown when ≥1 pin exists
│  ┌─────────────────────────┐  │
│  │ 📌 ✅ IMPORTANT: Out... │  │  ← Pin icon replaces status icon position
│  │    2 turns · 1h ago     │  │
│  └─────────────────────────┘  │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │  ← Dashed/thin separator
│  ┌─────────────────────────┐  │
│  │ ⏳ why does the wiki... │  │  ← Normal cards, unchanged
│  │    — · 13m ago · ✕      │  │
│  └─────────────────────────┘  │
│  ┌─────────────────────────┐  │
│  │ ❌ change to Generate.. │  │
│  │    1 turns · 8h · exprd │  │
│  └─────────────────────────┘  │
└───────────────────────────────┘
```

### Card Appearance

| State | Pin Icon | Position |
|-------|----------|----------|
| Unpinned, not hovered | Hidden | — |
| Unpinned, hovered | Ghost/muted 📌 | Right side of card, inline with status line |
| Pinned | Solid 📌 (accent color) | Left side, before status icon |
| Pinned, hovered | Solid 📌 + slight highlight | Same, with hover effect |

### Section Header ("📌 Pinned")

- Small, muted text label — not a card, just a visual grouping label.
- Shown only when at least one chat is pinned. Hidden when zero pins.
- Optionally show count: `📌 Pinned (2)`.

---

## Edge Cases & Error Handling

| Scenario | Behavior |
|----------|----------|
| **Pin a running/queued chat** | Allowed — running chats can be pinned |
| **Pinned chat expires/fails** | Stays pinned; status icon updates normally (❌ expired) |
| **Pinned chat is cancelled** | Stays pinned with cancelled status |
| **Delete a pinned chat** | Removes from pinned list and chat list |
| **No pinned chats** | "Pinned" section header is hidden; sidebar looks identical to current UI |
| **Server restart** | Pin state persists (stored in `~/.coc/preferences.json`) |
| **Chat ID no longer in history** | Stale pin IDs silently pruned on next load |

---

## Persistence

### Storage: `~/.coc/preferences.json`

Extend the existing `UserPreferences` interface:

```typescript
export interface UserPreferences {
    // ... existing fields ...
    pinnedChats?: Record<string, string[]>;
    //            ^workspaceId  ^taskIds (ordered by pin time, newest first)
}
```

**Why per-workspace?** Chat sessions are already scoped to `repoId`/`workspaceId` (fetched via `/queue/history?type=chat&repoId=...`). Pins follow the same scoping.

### API

| Method | Endpoint | Body | Purpose |
|--------|----------|------|---------|
| `PATCH` | `/api/preferences` | `{ pinnedChats: { "<wsId>": [...ids] } }` | Update pins (uses existing preferences PATCH endpoint) |

No new API endpoints needed — leverage the existing preferences PATCH merge behavior.

### Client-Side

The `useChatSessions` hook or a new `usePinnedChats` hook:
1. On load: fetch preferences, extract `pinnedChats[workspaceId]`.
2. Partition sessions into pinned vs. unpinned based on the ID list.
3. On pin/unpin: optimistic UI update + PATCH preferences.
4. Prune: remove any IDs in `pinnedChats` that don't match a loaded session (stale cleanup).

---

## Settings & Configuration

No new user-facing settings. Pin state is implicit per-workspace data, not a "setting."

---

## Discoverability

- **Hover affordance:** The pin icon appears on hover — users discover it naturally while browsing chats.
- **Context menu:** Right-click on any card reveals "Pin Chat" — aligns with standard UI conventions.
- **Zero learning curve:** The 📌 icon and "Pinned" section are universally recognized patterns (Slack, Discord, VS Code, etc.).

---

## Out of Scope

- Drag-and-drop reordering of pinned chats
- Pin count limits or warnings
- Keyboard shortcuts for pin/unpin
- Bulk pin/unpin operations
- Pin annotations or labels
