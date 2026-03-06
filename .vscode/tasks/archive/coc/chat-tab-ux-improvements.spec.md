# CoC Chat Tab UX Improvements — Spec

## User Story

As a CoC dashboard user managing multiple chat conversations across repositories, I need conversations with recent activity to surface to the top and a clear indicator for unread messages, so I can quickly find and resume active conversations without manually scanning the entire list.

---

## Problem Statement

Today, the chat sidebar in `RepoChatTab` sorts conversations by **creation time** (`createdAt` descending). This means:

1. **Follow-up messages don't re-rank**: When a queued follow-up completes on an older conversation, it stays buried at its original position. The user must scroll to find it.
2. **No unread indicators**: After a chat response arrives, there's no visual signal distinguishing "new response I haven't seen" from "conversation I already read." The only cue is the tab-level `chatPending` badge, which just counts running/queued chats — not per-conversation unread state.

---

## Proposal 1 — Sort by Last Activity

### Concept

Replace `createdAt` sort with `lastActivityAt` sort. Every time a conversation gets a new turn (user message or AI response), update a timestamp. The sidebar always shows most-recently-active conversations first.

### Behavior

| State | Sort Key |
|-------|----------|
| **Running / Queued** | Always at top (existing behavior), sub-sorted by `lastActivityAt` |
| **Completed** | Sorted by `lastActivityAt` descending |
| **Pinned** | Separate section, sorted by `lastActivityAt` descending (pin order is less useful than recency) |

### Where `lastActivityAt` Comes From

- **Option A — Derive from process store**: The last turn's timestamp in `conversationTurns` becomes `lastActivityAt`. Zero new storage — computed during `enrichChatTasks()`.
- **Option B — Explicit field on the queue task**: Set `updatedAt` on the task whenever a follow-up is queued. Slightly faster (no turn inspection) but requires a write.

**Recommendation**: Option A — derived. No schema change, no migration, works retroactively for existing conversations.

### User Flow

1. User opens the Chat tab → sees conversations sorted by most-recently-active first.
2. User queues a follow-up on an old conversation → that conversation jumps to the top once the follow-up starts processing.
3. After response completes, the conversation remains at the top as the most recently active.

### Edge Cases

- **Conversations with identical timestamps**: Secondary sort by `createdAt` descending (newer conversations first).
- **Conversations with no turns** (e.g., failed before any response): Use `createdAt` as fallback.

---

## Proposal 2 — Unread Message Indicators

### Concept

Track which conversations have new turns the user hasn't seen. Show a visual badge on unseen conversations in the sidebar.

### Design Options

#### Option A — "Bold + Dot" (Recommended)

Inspired by Slack/Discord/iMessage:

```
┌──────────────────────────────────┐
│ 🔵 What is the auth flow?    3↩ │  ← blue dot + bold title
│    2 min ago                     │
├──────────────────────────────────┤
│   How does caching work?     5↩ │  ← normal (read)
│   1 hour ago                     │
├──────────────────────────────────┤
│ 🔵 Explain the pipeline...   2↩ │  ← blue dot + bold title
│    Just now                      │
└──────────────────────────────────┘
```

- **Blue dot (●)** before the conversation title for unread conversations.
- **Bold text** on the first-message preview line.
- Dot disappears when the user **selects/opens** that conversation.

#### Option B — "Numeric Badge"

Show the count of new (unseen) turns:

```
│ What is the auth flow?   [2] 3↩ │
```

More informative but noisier. Could combine with Option A (dot + count).

#### Option C — "New Responses" Divider

Insert a visual divider in the sidebar list:

```
── 2 new responses ──────────────
  What is the auth flow?
  Explain the pipeline...
─────────────────────────────────
  How does caching work?
```

Groups unread at the top. Clear separation, but can feel jarring if only 1 unread.

**Recommendation**: Option A ("Bold + Dot") — it's the most universally understood pattern, minimal visual noise, and scales well from 1 to many unread conversations.

### "Read" State Tracking

**Where to store read state:**

| Approach | Pros | Cons |
|----------|------|------|
| **Client-only (localStorage)** | Zero server changes, instant | Lost on browser clear, not cross-device |
| **Server preferences** | Persists, cross-device via `PATCH /api/preferences` | Extra API calls, more complexity |
| **Hybrid** | localStorage for instant UX, preferences for durability | More code, but best experience |

**Recommendation**: Start with **client-only localStorage**. Most users access the dashboard from one browser. Upgrade to hybrid later if needed.

**Data shape (localStorage):**
```json
{
  "coc:readState": {
    "<workspaceId>": {
      "<sessionId>": {
        "lastSeenTurnCount": 5,
        "lastSeenAt": "2026-03-01T..."
      }
    }
  }
}
```

### User Flow

1. User opens Chat tab → conversations with new turns since last viewed show a **blue dot** and **bold title**.
2. User clicks a conversation → the dot disappears, `lastSeenTurnCount` updates to current turn count.
3. While viewing conversation A, conversation B gets a new response → B shows a blue dot in the sidebar (live update via existing SSE/WebSocket).
4. User refreshes page → read state persists from localStorage. Unread dots re-appear only for conversations with turns beyond `lastSeenTurnCount`.

### Edge Cases

- **First visit / cleared storage**: All conversations appear as "read" (no dots). Only new activity after this point triggers unread.
- **Multiple tabs**: localStorage is shared, so opening a chat in one tab marks it read in others on next render.
- **Conversation deleted/cancelled**: Remove its entry from read state on next cleanup pass.

---

## Visual Design Considerations

| Element | Design |
|---------|--------|
| **Unread dot** | `●` in accent blue (`var(--vscode-charts-blue)` or `#3794ff`), 8px, left of title |
| **Unread title** | `font-weight: 600` (semi-bold) |
| **Read title** | `font-weight: 400` (normal, current style) |
| **Sort indicator** | Optional subtle "Sorted by recent activity" tooltip on list header |
| **Tab badge** | Existing `chatPending` badge stays. Optionally add unread count: `Chat (2)` |

### Animations (Optional Polish)

- When a conversation moves to the top due to new activity: subtle slide-up animation (150ms ease).
- Blue dot appears with a gentle fade-in (200ms).

---

## Settings & Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `sortBy` | `"lastActivity"` | Sort chat list by `"lastActivity"` or `"created"` |
| `showUnreadIndicators` | `true` | Show/hide blue dots and bold styling |

These could live in the existing preferences API or be local UI toggles (simpler).

---

## Discoverability

- **Sort change**: No explicit discovery needed — it "just works" correctly. Users will notice follow-ups now surface to the top.
- **Unread dots**: Self-explanatory visual. No onboarding tooltip needed.
- **First-time experience**: If all chats initially show as "read" (no dots), the first new response will introduce the pattern naturally.

---

## Summary of Recommendations

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Sort key | `lastActivityAt` derived from last turn | Zero schema change, retroactive |
| Unread style | Blue dot + bold (Option A) | Universal pattern, minimal noise |
| Read state storage | Client localStorage | Simplest, sufficient for single-browser use |
| Settings | Local UI toggles | Low complexity, fast iteration |
