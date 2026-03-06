# UX Spec: Repo Queue Tab — Interactive Task Detail

## User Story

As a user viewing a repo's Queue tab, I want to click on any task (running, queued, or completed) and see its full detail — conversation turns, streaming output, metadata, and actions — without leaving the repo context. Today the Queue tab only shows a flat list of items with no drill-down, forcing me to navigate to the separate Processes page to inspect a task.

---

## Current State

The Queue tab at `#repos/{workspaceId}/queue` renders three sections:

| Section | Content shown per item |
|---------|----------------------|
| **Running Tasks** | 🔄 icon, display name (35 chars), elapsed time, cancel button |
| **Queued Tasks** | ⏳ icon, display name, created time, move-up/move-to-top/cancel |
| **Completed Tasks** | ✅/❌/🚫 icon, display name, relative completion time, error preview |

Clicking a task dispatches `SELECT_QUEUE_TASK` to QueueContext, but no detail panel is rendered in the repo view — the selection is only consumed by `ProcessesView`.

---

## Proposed Experience

### Layout: Split-Panel (matches PipelinesTab pattern)

Adopt the same vertical split-panel pattern already used by the Pipelines tab:

```
RepoQueueTab (flex h-full)
├── Left Panel (w-80, flex-shrink-0, border-r, overflow-y-auto)
│   ├── Toolbar: Pause/Resume toggle, Clear queue button
│   ├── Running Tasks section
│   ├── Queued Tasks section
│   └── Completed Tasks section (collapsible, as today)
│
└── Right Panel (flex-1, min-w-0, overflow-hidden)
    ├── [Nothing selected] → Placeholder: "Select a task to view details"
    ├── [Pending task selected] → PendingTaskInfoPanel (metadata + payload)
    └── [Running/Completed task selected] → Conversation detail view
```

### Left Panel (Task List)

Identical to today's list, plus:

- **Selected state**: Highlight the selected card with `ring-2 ring-[#0078d4]` (same as Processes tab).
- **Click behavior**: Sets local `selectedTaskId` state and renders the corresponding detail in the right panel.
- **Keyboard**: Arrow keys navigate the list; Enter selects.

### Right Panel — Pending Task Detail

When a **queued** (not-yet-started) task is selected:

| Field | Value |
|-------|-------|
| Task ID | `task.id` |
| Type | Badge with type label (follow-prompt, chat, code-review, etc.) |
| Priority | Icon: 🔥 high / ➖ normal / 🔽 low |
| Created | Formatted timestamp |
| Model | From `task.config.model` |
| Working Directory | `task.folderPath` |
| Prompt / Payload | Full prompt content, rendered as markdown |

**Actions**:
- **Cancel Task** — DELETE `/queue/{taskId}`, remove from list
- **Move to Top** — POST `/queue/{taskId}/move-to-top`, re-sort list

### Right Panel — Running / Completed Task Detail

Reuse the existing `QueueTaskDetail` component (already built for the Processes view). It provides:

**Header**:
- Status badge + duration
- Resume CLI button (if session available)
- Metadata popover (model, timing, token usage)

**Conversation Area**:
- User turns (prompt bubbles)
- Assistant turns (markdown-rendered response + tool call timeline)
- Tool calls: collapsible with args, result, error, and status
- Nested tool indentation for sub-tasks

**Streaming** (for running tasks):
- SSE connection to `/api/processes/{processId}/stream`
- Real-time content chunks and tool lifecycle events
- Auto-scroll with "scroll to bottom" button when scrolled up

**Follow-up Input** (for running/completed tasks with active sessions):
- Text input at the bottom of the detail panel
- Send follow-up message via POST `/processes/{processId}/message`

### Empty State

When no task is selected, show centered placeholder:

```
📋
Select a task to view details
```

Light gray text, centered vertically and horizontally in the right panel (same pattern as PipelinesTab empty state).

---

## Entry Points

| Entry Point | Behavior |
|-------------|----------|
| **Click task in list** | Select task, show detail in right panel |
| **Arrow keys in list** | Navigate between tasks (highlight follows) |
| **Enter on highlighted task** | Select task |
| **Escape in detail panel** | Deselect task, return to empty state |

No new commands, context menus, or keyboard shortcuts needed beyond the above.

---

## User Flow

### Primary Flow: Inspect a Running Task

1. User navigates to `#repos/{workspaceId}/queue`
2. Queue tab shows split panel: task list (left) + empty placeholder (right)
3. User clicks a running task card in "Running Tasks" section
4. Card highlights with blue ring
5. Right panel shows conversation detail with live streaming output
6. User scrolls through tool calls and assistant responses in real-time
7. User optionally sends a follow-up message via the input at the bottom

### Secondary Flow: Inspect a Completed Task

1. User expands "Completed Tasks" section (▼ toggle)
2. User clicks a completed task
3. Right panel shows full conversation history with all turns and tool calls
4. User can use Resume CLI button to re-enter an interactive session

### Tertiary Flow: Review a Queued Task Before Execution

1. User clicks a queued task
2. Right panel shows the pending info panel: task metadata, full prompt, priority
3. User decides to cancel or reprioritize using the action buttons in the detail panel

---

## Edge Cases & Error Handling

| Scenario | Behavior |
|----------|----------|
| **Task has no processId** (e.g., queued task never ran) | Show PendingTaskInfoPanel with metadata only |
| **Process data fetch fails** | Show inline error: "Failed to load task details. [Retry]" |
| **SSE stream disconnects** | Auto-reconnect with exponential backoff (existing behavior in QueueTaskDetail) |
| **Selected task is cancelled externally** | WebSocket update removes it from list; if selected, clear detail panel and show placeholder |
| **Selected task completes while viewing** | Status badge updates in-place; streaming stops; conversation finalizes |
| **Very long conversation** | Scroll within the right panel; "scroll to bottom" FAB appears |
| **Narrow viewport (< 768px)** | Hide left panel, show full-width list; tapping a task navigates to full-screen detail with a back button |

---

## Visual Design Considerations

### Reuse Existing Components

| Component | Source | Reuse in |
|-----------|--------|----------|
| `QueueTaskDetail` | `queue/QueueTaskDetail.tsx` | Right panel for running/completed |
| `PendingTaskInfoPanel` | Inside `QueueTaskDetail.tsx` | Right panel for queued tasks |
| `QueueTaskItem` / `QueueTaskCard` | `RepoQueueTab.tsx` / `ProcessesSidebar.tsx` | Left panel list items |
| `ConversationTurnBubble` | `ProcessDetail.tsx` | Already used by QueueTaskDetail |
| `StatusBadge` | Shared UI | Headers |

### New UI Needed

- **Empty-state placeholder** for right panel (text + icon, ~5 lines of JSX)
- **Selected highlight** on task cards (add conditional `ring-2` class)
- **Responsive breakpoint** for narrow viewport (optional, follow-up)

### No New Icons Needed

All status icons (✅, ❌, 🚫, 🔄, ⏳, 🔥, ➖, 🔽) are already in use.

---

## Settings & Configuration

No new settings required. The Queue tab inherits all existing configuration:

- Queue pause/resume state (per-repo, persisted server-side)
- Model selection (from task config)
- SSE streaming (existing infrastructure)

---

## Scope Exclusions

The following are explicitly **out of scope** (matching user request to exclude workspace filtering):

- ❌ Workspace filter dropdown (already scoped to single repo)
- ❌ Search/filter bar in the task list (can be a follow-up)
- ❌ Enqueue new task from Queue tab (existing "Chat" tab handles this)
- ❌ Drag-and-drop reordering (existing move-up/move-to-top buttons suffice)

---

## Implementation Notes (for reference, not part of UX)

- The key change is converting `RepoQueueTab` from a single-column list to a `flex h-full` split layout matching `PipelinesTab`.
- `QueueTaskDetail` already exists and handles all detail rendering, streaming, and follow-up input. It reads from `QueueContext.selectedTaskId`.
- The `selectedTaskId` state can remain in QueueContext (already dispatched on click), but the detail panel now renders *inside* RepoQueueTab instead of only in ProcessesView.
- No new API endpoints needed — all data fetching and streaming endpoints are already in place.

---

## Discoverability

- **Immediate**: Users will see the split panel as soon as they visit the Queue tab — the empty-state placeholder invites interaction ("Select a task to view details").
- **Visual affordance**: Task cards already look clickable (Card component with hover styles). Adding the selected ring reinforces that clicking does something.
- **Consistency**: The split-panel pattern is already established in the Pipelines tab, so users familiar with that tab will immediately understand the Queue tab layout.
