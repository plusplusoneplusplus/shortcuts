# UX Spec: Unify Queue & Chats into a Single "Activity" Tab

## Problem Statement

The CoC dashboard currently has two separate sub-tabs under each repo — **Queue** and **Chat** — that are architecturally the same thing. Both display queue tasks, stream SSE conversation turns, support follow-up messages, and render with the same `ConversationTurnBubble` component. The codebase confirms this: chats are literally `type: 'chat'` queue tasks fetched via `/queue/history?type=chat`. This split forces users to mentally map "where do I find this thing?" and duplicates significant rendering/streaming logic across `QueueTaskDetail.tsx` (~700 lines) and `RepoChatTab.tsx` (~1000 lines).

**Goal:** Merge Queue and Chat into a single **"Activity"** tab that presents all task types — including chats — in one unified list with smart filtering, while preserving the interactive chat experience for conversational tasks.

---

## 1. User Story

> As a developer using the CoC dashboard, I want a single place to see all my AI activity — chats, pipeline runs, code reviews, follow-prompts — so I don't have to switch between tabs to find what I'm looking for or remember which tab holds which type of work.

---

## 2. Entry Points

| Entry Point | Current | Proposed |
|-------------|---------|----------|
| Repo sub-tab: "Queue" | Separate tab | **Removed** — replaced by "Activity" |
| Repo sub-tab: "Chat" | Separate tab | **Removed** — replaced by "Activity" |
| Repo sub-tab: "Activity" | N/A | **New** — single unified tab |
| Keyboard shortcut `C` | Opens Chat tab | Opens Activity tab (focused on chat filter) |
| Top-level "Processes" tab | Shows all processes + queue tasks | Unchanged (global cross-repo view) |
| "New Chat" button | In Chat tab header | In Activity tab header (always visible) |
| Enqueue dialog | In Queue tab | In Activity tab |

---

## 3. Visual Design: The Unified Activity Tab

### 3.1 Layout: Split Panel (Sidebar + Detail)

```
┌─────────────────────────────────────────────────────────────┐
│  Activity                            [+ New Chat] [⊕ Task]  │
├──────────────────┬──────────────────────────────────────────┤
│ ┌──────────────┐ │                                          │
│ │🔍 Search...  │ │                                          │
│ ├──────────────┤ │       Detail / Conversation View         │
│ │ Filter chips:│ │                                          │
│ │ [All] [Chat] │ │   (same as today's QueueTaskDetail /     │
│ │ [Pipeline]   │ │    RepoChatTab conversation view,        │
│ │ [Review] ... │ │    unified into one component)           │
│ ├──────────────┤ │                                          │
│ │              │ │                                          │
│ │  RUNNING (2) │ │                                          │
│ │  ● Chat: ... │ │                                          │
│ │  ● Pipeline..│ │                                          │
│ │              │ │                                          │
│ │  QUEUED (1)  │ │                                          │
│ │  ○ Review:...│ │                                          │
│ │              │ │                                          │
│ │  RECENT      │ │                                          │
│ │  ✓ Chat: ... │ │                                          │
│ │  ✗ Pipeline..│ │                                          │
│ │  ✓ Chat: ... │ │                                          │
│ │              │ │                                          │
│ └──────────────┘ │                                          │
├──────────────────┴──────────────────────────────────────────┤
│ Stats bar: 2 running · 1 queued · 47 completed  [Pause ⏸]  │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Sidebar Item Design

Each item in the sidebar is a **task card** with a consistent design regardless of type:

```
┌─────────────────────────────┐
│ 💬 Fix login page styling    │  ← Icon per type + title/displayName
│ chat · running · 3 turns     │  ← Type badge · status · metadata
│ 2 min ago                    │  ← Relative timestamp
└─────────────────────────────┘
```

**Type icons:**
| Type | Icon | Label |
|------|------|-------|
| `chat` | 💬 | Chat |
| `run-pipeline` | ▶️ | Pipeline |
| `code-review` | 🔍 | Review |
| `follow-prompt` | 📝 | Prompt |
| `task-generation` | 📋 | Tasks |
| `resolve-comments` | 💭 | Comments |
| `ai-clarification` | ❓ | Clarify |
| `run-script` | ⚡ | Script |
| `custom` | ⚙️ | Custom |

**Status indicators** (left border or dot color):
- 🟢 Running (green pulse)
- 🟡 Queued (yellow)
- ✅ Completed (green checkmark)
- ❌ Failed (red)
- ⊘ Cancelled (gray)

### 3.3 Filter Chips

Horizontal scrollable row of filter chips at the top of the sidebar:

- **All** (default) — shows everything
- **Chat** — only `type: 'chat'`
- **Pipeline** — only `type: 'run-pipeline'`
- **Review** — only `type: 'code-review'`
- **Other** — everything else (`follow-prompt`, `task-generation`, `resolve-comments`, etc.)

Chips show counts: `Chat (12)`, `Pipeline (3)`.

Multiple chips can be active simultaneously (union filter). Clicking a selected chip deselects it.

### 3.4 Sidebar Sections (Grouped by Status)

Within the filtered list, items are grouped:

1. **Running** — sorted by `startedAt` (newest first). Green left-border accent.
2. **Queued** — sorted by priority (high → normal → low), then `createdAt`. Yellow left-border accent.
3. **Recent** — completed/failed/cancelled, sorted by `completedAt` (newest first). Shows last 50 by default with "Load more" at bottom.

Sections are collapsible. Empty sections are hidden.

---

## 4. User Flows

### 4.1 Start a New Chat (Primary Flow)

1. User clicks **[+ New Chat]** button in Activity header
2. New Chat dialog appears (same as today's `NewChatDialog`)
3. User types message, optionally attaches images/skills
4. System creates `type: 'chat'` queue task → appears in Running section
5. Detail pane shows streaming conversation with SSE
6. User can send follow-up messages in the detail pane input
7. When complete, item moves to Recent section with ✅ status

### 4.2 Enqueue a Non-Chat Task

1. User clicks **[⊕ Task]** button in Activity header
2. Enqueue dialog appears (same as today's `EnqueueDialog`)
3. User selects task type, configures parameters
4. Task appears in Queued section
5. When execution starts → moves to Running
6. User can click to view conversation/progress in detail pane
7. When complete → moves to Recent

### 4.3 Browse and Filter Activity

1. User opens Activity tab → sees all items grouped by status
2. User clicks **Chat** filter chip → sidebar shows only chat sessions
3. User clicks on a completed chat → detail pane shows full conversation history
4. User clicks **All** to reset → sees everything again
5. User types in search box → filters by title/displayName/firstMessage

### 4.4 Resume a Chat Conversation

1. User clicks a completed chat in the Recent section
2. Detail pane loads conversation history
3. If session is still alive: input box says "Continue this conversation..."
4. If session expired: banner shows "Session expired" with option to start a new chat pre-filled with context
5. User types follow-up → new SSE stream begins → item moves back to Running

### 4.5 Chat-Specific Sidebar Features (Preserved from Current Chat Tab)

These features from the current Chat tab carry over to chat-type items only:

- **Pin/Unpin**: Right-click → Pin. Pinned chats appear at the top of the Recent section with a 📌 indicator, regardless of timestamp. Pinned state persists in localStorage.
- **Archive**: Right-click → Archive. Archived chats are hidden from the default view. A toggle "Show archived" at the bottom of the sidebar reveals them.
- **Unread badge**: Blue dot on sidebar items with new turns since last viewed. Tracked via localStorage (same as current `useChatReadState`).

These features are **not shown** for non-chat task types (they don't make sense for one-shot pipeline runs).

---

## 5. Detail Pane Behavior

The detail pane is the **unified conversation viewer** that replaces both `QueueTaskDetail` and `RepoChatTab`'s conversation area. It adapts based on task type and status:

### 5.1 For Chat Tasks
- Full conversation with `ConversationTurnBubble`
- "Resumed from previous session" separators for historical turns
- Follow-up input with image paste, `/skills` support
- Suggestions chips after assistant responses
- Session expired banner when applicable

### 5.2 For Non-Chat Tasks (Pipeline, Review, etc.)
- **Queued state**: Show `PendingTaskInfoPanel` with resolved prompt, metadata, cancel/priority buttons
- **Running state**: Stream conversation turns via SSE (same as today)
- **Completed state**: Show conversation turns + result summary
- **Failed state**: Show error message prominently with conversation context
- Follow-up input available if the process session is still alive

### 5.3 Header Bar (in detail pane)
```
┌──────────────────────────────────────────────────────────┐
│ 💬 Fix login page styling          Running ● 3 turns     │
│ chat · model: sonnet-4 · started 2 min ago               │
│ [Cancel] [Open in new window]                             │
└──────────────────────────────────────────────────────────┘
```

Shows: type icon, title, status badge, turn count, model, timestamps, action buttons.

---

## 6. Edge Cases & Error Handling

| Scenario | Behavior |
|----------|----------|
| No activity yet | Empty state: "No activity yet. Start a chat or enqueue a task." with prominent [+ New Chat] button |
| SSE connection drops | Auto-reconnect with exponential backoff (existing behavior). Show subtle "Reconnecting..." indicator in detail pane |
| Task fails | Item shows ❌ in sidebar. Detail pane shows error message with full conversation context. Retry button for applicable types |
| Session expired on follow-up | HTTP 410 → show "Session expired" banner. For chats, offer "Start new chat with context" |
| Queue paused | Stats bar shows "⏸ Paused" prominently. Queued items show tooltip "Queue is paused" |
| Filter returns no results | Show "No {type} tasks found" with suggestion to clear filter |
| Very long history (500+) | Paginate Recent section. Load 50 initially, "Load more" button at bottom |
| Concurrent streaming | Multiple running tasks can stream simultaneously. Active detail pane shows the selected one; others update in background |

---

## 7. Settings & Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Default filter | `All` | Which filter chip is selected by default when opening Activity |
| History page size | `50` | How many completed items to load initially |
| Auto-select running | `true` | Automatically select a task when it starts running |
| Show archived | `false` | Whether archived chats appear in the sidebar |

These could be stored in the existing preferences system (`~/.coc/preferences.json`).

---

## 8. Migration & Backward Compatibility

### 8.1 URL Hash Routes

| Current | New | Redirect |
|---------|-----|----------|
| `#repos/:id/queue` | `#repos/:id/activity` | Auto-redirect old hash |
| `#repos/:id/chat` | `#repos/:id/activity?filter=chat` | Auto-redirect with filter |
| `#repos/:id/activity` | — | New canonical route |

### 8.2 Keyboard Shortcut

- `C` shortcut currently opens Chat → now opens Activity with Chat filter pre-selected (feels the same to the user)

### 8.3 Data Model

**No backend changes required.** The unification is purely a frontend concern:
- Queue API already serves all task types including chats
- Chat metadata enrichment (`chatMeta`) already works via the existing `/queue/history?type=chat` enrichment
- The same enrichment logic should apply when `type` filter is not specified (minor backend tweak)

---

## 9. Implementation Approach (High Level)

### 9.1 New Unified Components

| Component | Replaces | Purpose |
|-----------|----------|---------|
| `ActivityTab.tsx` | `RepoQueueTab.tsx` + `RepoChatTab.tsx` | Top-level tab with sidebar + detail |
| `ActivitySidebar.tsx` | Queue task list + `ChatSessionSidebar.tsx` | Unified sidebar with filters, sections, search |
| `ActivityDetail.tsx` | `QueueTaskDetail.tsx` + RepoChatTab's conversation area | Unified detail/conversation viewer |
| `useActivityStream.ts` | Duplicated SSE logic in both files | Shared SSE streaming hook |
| `useConversationTurns.ts` | Duplicated `getConversationTurns()` | Shared turn loading logic |

### 9.2 Reused As-Is

- `ConversationTurnBubble` — already shared
- `EnqueueDialog` — already shared
- `NewChatDialog` — reused from chat
- `PendingTaskInfoPanel` — reused from queue
- `QueueContext` — reused (already global)

### 9.3 Removed

- `RepoQueueTab.tsx` (~200 lines)
- `RepoChatTab.tsx` (~1000 lines)
- `ChatSessionSidebar.tsx` (~300 lines)
- `useChatSessions.ts` (~80 lines)
- Duplicated `getConversationTurns()`, SSE setup in both files

**Estimated net code reduction:** ~800–1000 lines removed, ~400–500 lines in new unified components.

---

## 10. Discoverability

- The **"Activity"** sub-tab name is self-explanatory and broader than either "Queue" or "Chat"
- Filter chips make it immediately obvious what types of tasks exist
- Running tasks are always at the top — users see live activity first
- `C` keyboard shortcut still works and pre-filters to Chat for muscle-memory compatibility
- Stats bar at the bottom gives at-a-glance queue health
