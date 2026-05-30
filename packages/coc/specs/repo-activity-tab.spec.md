# Repository Activity Tab — UI/UX Specification

**Document type:** Formal UX Specification  
**Scope:** CoC Dashboard → Repository Detail → Activity Tab  
**Purpose:** Authoritative reference for validating any future UI/UX changes to the Activity tab.  
**Version:** 1.2.0

---

## 1. Overview

The **Repository Activity Tab** is the primary workspace for monitoring and interacting with AI tasks associated with a specific repository. It is the first tab shown in the `RepoDetail` tab bar. The default tab for a new repo is `settings`; tab state is persisted per-repo, so Activity is shown on return if it was last used. It provides a unified interface to: enqueue new tasks, observe running and queued work, review completed conversations, send follow-up messages, and manage the execution queue.

### 1.1 Tab Identity

| Property | Value |
|---|---|
| Tab key (classic layout) | `activity` |
| Tab key (dev-workflow layout) | `chats` |
| Tab label (classic layout) | `Activity` |
| Tab label (dev-workflow layout) | `Chats` |
| Tab position | First (leftmost) tab in `RepoDetail` |
| Default tab | No — default is `settings`; tab state is persisted per-repo, so Activity/Chats is shown on return if last used |
| Keyboard shortcut | `Alt+A` |
| URL fragment (classic) | `#repos/<workspaceId>/activity` |
| URL fragment (dev-workflow) | `#repos/<workspaceId>/chats` |
| Deep-link URL (classic) | `#repos/<workspaceId>/activity/<taskId>` |
| Deep-link URL (dev-workflow) | `#repos/<workspaceId>/chats/<taskId>` |
| Implementing component | `RepoChatTab` (with `mode="chats"` in dev-workflow, no mode prop in classic) |

> The `Activity` and `Chats` tabs are the **same surface** rendered under two labels. The dashboard accepts both URL keys as aliases regardless of the active layout mode (classic users opening a `…/chats/<id>` deep-link, or dev-workflow users opening `…/activity/<id>`, both succeed). Layout mode switching is a label/URL preference only — the underlying data, history, and queue are unchanged.

---

## 2. User Personas

| Persona | Description | Primary Goal |
|---|---|---|
| **Developer (active user)** | Engineers running AI tasks interactively in a known repo | Monitor progress of running tasks, send follow-ups, review results |
| **Team lead (observer)** | Reviews past AI-generated plans, code reviews, and autopilot sessions | Browse history, audit conversations |
| **Power user (queue manager)** | Manages a backlog of AI tasks across complex workflows | Reorder, freeze, bulk-enqueue, and control queue execution |
| **Multitasker** | Runs AI tasks in the background while coding | Pop-out or float the chat window; use unseen-activity indicators |

---

## 3. User Stories

Each story uses the **Given / When / Then** format to enable formal verification.

### 3.1 View Task Activity

**US-01 — View running tasks**
> As a developer, I want to see all currently executing AI tasks so that I can monitor ongoing work.

- **Given** the Activity tab is open for a repo  
- **When** one or more tasks are in `running` state  
- **Then** a "Running" section is visible in the left pane, listing each task with its type icon, display name, and a live elapsed-time counter that increments every second

---

**US-02 — View queued tasks**
> As a developer, I want to see tasks waiting to execute so I can understand the backlog.

- **Given** the Activity tab is open  
- **When** one or more tasks are in `queued` state  
- **Then** a "Queued" section appears below "Running", listing tasks in order of execution priority

---

**US-03 — View task history**
> As a team lead, I want to browse completed tasks so I can audit prior AI activity.

- **Given** the Activity tab is open  
- **When** completed tasks exist  
- **Then** a "Completed Tasks" section appears below "Queued" (or below "Pinned" if pinned tasks exist), listing completed tasks in reverse-chronological order

---

**US-03a — View archived tasks**
> As a team lead, I want to browse archived tasks so I can review AI activity that has been moved to long-term storage.

- **Given** the Activity tab is open  
- **When** archived tasks exist  
- **Then** an "📦 Archived" section appears below "Completed Tasks", collapsed by default, listing archived tasks in reverse-chronological order. Archive is a client-side grouping (stored as a set of task IDs); there is no server-side archive state.

---

**US-04 — Open a task conversation**
> As a developer, I want to read the full AI conversation for any task so I can understand what was done.

- **Given** the Activity tab is open  
- **When** the user clicks a task in any section (Running / Queued / Pinned / Completed Tasks / Archived)  
- **Then** the right pane shows the full conversation thread for that task, including all turns (user prompt, AI response, tool calls)

---

**US-05 — Deep-link to a specific task**
> As a team lead sharing a link, I want a URL that opens a specific task conversation.

- **Given** a URL of the form `#repos/<workspaceId>/activity/<taskId>`  
- **When** the user navigates to that URL  
- **Then** the Activity tab opens and the specified task is selected and shown in the detail pane

---

**US-05a — Pin a task to the top**
> As a developer, I want to pin important tasks so they stay visible at the top of my completed list.

- **Given** a completed or running task exists
- **When** the user selects "Pin to top" from the context menu
- **Then** the task appears in the "📌 Pinned" section (between Queued and Completed Tasks); pinned running tasks show in Pinned instead of Running

---

**US-05b — Archive a task via swipe (mobile)**
> As a developer on mobile, I want to swipe a completed task to archive it quickly.

- **Given** the Activity tab is open on a mobile/touch viewport
- **When** the user swipes a completed task card horizontally
- **Then** the task moves to the "📦 Archived" section with an undo toast

---

### 3.2 Task Input & Enqueue

**US-06 — Send a follow-up message**
> As a developer, I want to send a follow-up message to an active or completed task so I can continue the conversation.

- **Given** a task is selected in the detail pane  
- **When** the user types a message in the follow-up input and submits  
- **Then** the message is enqueued as a follow-up task linked to the current conversation, and the conversation area updates to reflect the new turn

---

**US-07 — Use slash commands**
> As a power user, I want to invoke pre-defined skills via slash commands.

- **Given** the follow-up input is focused  
- **When** the user types `/`  
- **Then** a slash-command menu appears listing available skills from `GET /api/workspaces/:id/skills/all`

- **When** the user selects a skill and submits  
- **Then** the task is enqueued with the selected skill applied

---

**US-08 — Paste an image into the input**
> As a developer, I want to paste an image (screenshot, diagram) into the follow-up input so that the AI can reason about visual content.

- **Given** the follow-up input is focused  
- **When** the user pastes an image from the clipboard  
- **Then** an image preview appears inline in the input area, and the image is attached to the outgoing message

---

**US-09 — Choose a task mode**
> As a developer, I want to select whether my message is an Ask, Plan, or Autopilot task.

- **Given** the follow-up input is active  
- **When** the user selects a mode (Ask / Plan / Autopilot)  
- **Then** the follow-up is enqueued with the corresponding task type, and the task card in the list shows the correct type icon

---

### 3.3 Queue Management

**US-10 — Reorder the queue**
> As a power user, I want to change the order of queued tasks so high-priority work runs first.

- **Given** two or more tasks are queued  
- **When** the user drags a task card to a new position (mouse or touch)  
- **Then** the queue order updates immediately in the UI and the server is notified via `POST /api/queue/:id/move-to-top`, `/move-up`, `/move-down`, or `/move-to/:pos`

- **When** the user selects "Move to Top" from the context menu  
- **Then** the task is immediately moved to the first position in the queue

---

**US-11 — Freeze a task**
> As a power user, I want to freeze a queued task so it does not execute until I unfreeze it.

- **Given** a task is queued  
- **When** the user selects "Freeze" from the context menu  
- **Then** the task card shows a frozen indicator and the task is skipped during queue execution until unfrozen

---

**US-12 — Cancel a running task**
> As a developer, I want to cancel a running task so I can stop work that is no longer needed.

- **Given** a task is in `running` state  
- **When** the user clicks the Cancel button in the detail pane header  
- **Then** a `DELETE /api/queue/:id` request is sent; the task transitions to `cancelled` state and moves to Completed Tasks

---

**US-13 — Pause and resume the queue**
> As a developer, I want to pause the entire queue so no new tasks start while I work on something sensitive.

- **Given** the queue is running  
- **When** the user triggers Pause (via `POST /api/queue/pause`)  
- **Then** all currently queued tasks remain queued but do not start executing; the UI shows a "Paused" indicator

- **When** the user triggers Resume  
- **Then** the queue resumes normal execution

---

**US-14 — Delete history entries**
> As a developer, I want to delete one or all history entries to clean up the list.

- **Given** items exist in the Completed Tasks section  
- **When** the user selects "Delete" from a task's context menu  
- **Then** `DELETE /api/queue/history/:taskId` is called and the entry is removed from the list

- **When** the user selects "Clear All History"  
- **Then** `DELETE /api/queue/history` is called and the Completed Tasks section becomes empty

---

### 3.4 Filtering & Search

**US-15 — Filter by task type**
> As a developer, I want to filter the task list by type so I can focus on relevant tasks.

- **Given** tasks of multiple types exist in the list  
- **When** the user selects one or more types in the Filter dropdown (Chat / Ask / Plan / Autopilot / Run Workflow / Run Script)  
- **Then** only tasks matching the selected types are shown; sections with no matching tasks collapse

---

**US-16 — Search tasks by name or prompt**
> As a team lead, I want to search tasks by keyword so I can find a specific conversation quickly.

- **Given** the search box is visible  
- **When** the user types a keyword  
- **Then** the list is filtered in real-time to show only tasks whose `displayName`, `title`, or `prompt` contains the keyword (case-insensitive)

---

### 3.5 Streaming & Live Updates

**US-17 — View streaming AI output**
> As a developer, I want to see AI response tokens appear in real time so I can follow progress without waiting for completion.

- **Given** a running task is selected  
- **When** the AI is generating a response  
- **Then** tokens appear incrementally in the conversation area via SSE streaming; the elapsed-time counter in the task card continues to tick

---

**US-18 — See unseen activity indicators**
> As a multitasker, I want to know when a task I have not viewed has completed so I can review it.

- **Given** a task completes while another task is selected  
- **When** the user has not yet viewed the completed task  
- **Then** the task card shows a bold title and an unseen-activity dot; the sidebar repo badge reflects the unseen count

- **When** the user clicks the task  
- **Then** the unseen indicator is cleared for that task

---

### 3.6 Window Management

**US-19 — Pop out the chat into a separate window**
> As a multitasker, I want to detach the conversation into a separate browser window so I can view it alongside my editor.

- **Given** a task is selected  
- **When** the user clicks the Pop-out button  
- **Then** a new window/tab opens at `/?workspace=<id>#popout/activity/<taskId>` showing the full conversation; the main pane shows a "Chat is open in a separate window" placeholder

---

**US-20 — Float the chat as an overlay**
> As a developer, I want to view the chat as a floating overlay without leaving the current view.

- **Given** a task is selected  
- **When** the user clicks the Float button  
- **Then** a `FloatingChatContent` overlay appears on top of the current view; the detail pane shows a "Chat is floating" placeholder

---

**US-21 — Resume a task in terminal**
> As a developer, I want to continue an AI task in my local terminal for advanced interaction.

- **Given** a task has an associated process  
- **When** the user clicks the "Resume in Terminal" button  
- **Then** `POST /api/processes/:pid/resume-cli` is called and the task is attached to the user's local terminal session

---

## 4. Feature Inventory & Acceptance Criteria

### 4.1 Left Pane — Activity List

| Feature | Acceptance Criteria |
|---|---|
| Five-section layout | Running Tasks → Queued Tasks → 📌 Pinned → Completed Tasks → 📦 Archived; each section hidden when empty; Archived collapsed by default |
| Task type icons | Every task card shows the correct icon for its type: 🤖 autopilot, 💡 ask, 📋 plan, ▶️ run-workflow, 🛠️ run-script, 📅 scheduled. Additional state overlays: ❄️ frozen, 🚀 admitted (schedule-immediately), 🤖⏸ held (autopilot paused) |
| Display name truncation | Task display name is truncated to ≤ 60 characters with ellipsis when longer |
| Live elapsed timer | Running tasks show an elapsed timer; it increments every 1 second while the task is in `running` state; it stops when the task leaves `running` |
| Unseen activity dot | Completed tasks not yet viewed by the user show a bold title and a visual dot indicator |
| Filter dropdown | Multi-select filter by task type; filtered sections collapse when empty |
| Search input | Real-time filter by displayName / title / prompt; case-insensitive |
| Context menu | Available on each task card; contains actions relevant to the task's current state |
| Drag-and-drop reorder | Mouse and touch dragging reorders queued tasks; running, pinned, completed, and archived items are not reorderable |
| Pin/Unpin | Running and completed tasks can be pinned; pinned tasks appear in the dedicated Pinned section |
| Swipe-to-archive | On mobile/touch viewports, horizontal swipe on a completed task card archives it with an undo toast |
| Draft badge | Task cards show a ✏️ indicator when an unsent draft exists for that task |

### 4.2 Right Pane — Detail / Chat

| Feature | Acceptance Criteria |
|---|---|
| Conversation display | All turns shown in chronological order (user prompt → AI response → tool calls) |
| SSE streaming | New tokens appear incrementally; no full-page reload required |
| Follow-up input | Text input with mode selector (Ask / Plan / Autopilot); supports slash commands and image paste |
| Draft persistence | Unsent draft text survives page refresh (stored in localStorage per task) |
| Token-limit bar | Shows remaining context window; updates via SSE; visible but non-blocking |
| Pop-out button | Opens conversation in new window; main pane shows placeholder |
| Float button | Shows conversation as overlay; main pane shows placeholder |
| Cancel button | Visible for running tasks; triggers cancellation immediately |
| Move-to-top button | Visible for queued tasks; available in header and context menu |
| Resume in Terminal | Available when task has an associated process |
| MiniMap | Scroll thumbnail for long conversations; visible on desktop only |
| Placeholder state | When no task is selected, the right pane shows an empty/prompt state |

### 4.3 Pop-out Shell

| Feature | Acceptance Criteria |
|---|---|
| Independent window | Loads at `/?workspace=<id>#popout/activity/<taskId>` |
| Full conversation view | All chat features available (streaming, follow-up, cancel) |
| Synchronized state | State changes in the pop-out are reflected in the main window and vice versa |

---

## 5. Behavioral Invariants

These properties **must hold at all times**. Any change that violates an invariant is a regression.

| ID | Invariant |
|---|---|
| INV-01 | The Activity tab is always the first tab in `RepoDetail`; its position never changes |
| INV-02 | Task selection is always scoped to the current repository; selecting a task in Repo A never affects the selected task state of Repo B |
| INV-03 | Sections always appear in order: Running Tasks → Queued Tasks → 📌 Pinned → Completed Tasks → 📦 Archived |
| INV-04 | A frozen task never transitions to `running` until explicitly unfrozen |
| INV-05 | A paused queue never starts a new task until explicitly resumed |
| INV-06 | The elapsed-time counter on a running task only increments; it never decrements or resets while the task is running |
| INV-07 | The unseen-activity dot for a task disappears exactly once the task is viewed; it does not reappear unless a new event arrives for that task |
| INV-08 | Drag-and-drop reordering only applies to queued tasks; running, pinned, completed, and archived items are not reorderable via drag |
| INV-09 | Deleting a completed task only removes it from the Completed Tasks or Archived section; it does not affect running or queued tasks |
| INV-10 | A cancelled task always moves to Completed Tasks; it never remains in Running or Queued |
| INV-11 | Draft text is scoped to the individual task; drafts for different tasks are fully isolated |
| INV-12 | The token-limit bar never causes input to be blocked; it is informational only |
| INV-13 | When the pop-out window is open for a task, the main pane shows the placeholder — not a duplicate of the conversation |
| INV-14 | The Activity tab renders correctly with zero tasks in all five sections (empty state) |
| INV-15 | Switching workspace (repo) mounts a completely fresh Activity tab (`key={ws.id}`); no state leaks across repos |
| INV-16 | A pinned task always appears in the Pinned section regardless of its original state; unpinning returns it to its natural section |
| INV-17 | Archiving a task is a client-side-only operation; it does not change the task's server state or queue status |

---

## 6. Task Lifecycle State Machine

```
                   ┌───────────┐
        enqueue    │  QUEUED   │
  ──────────────►  │  (frozen) │◄──── freeze
                   └─────┬─────┘
                         │ unfreeze / queue advances
                         ▼
                   ┌───────────┐
                   │  RUNNING  │──── cancel ──►  CANCELLED ──► HISTORY
                   └─────┬─────┘
                         │ complete
                         ▼
                   ┌───────────┐
                   │ COMPLETED │──────────────────────────►  HISTORY
                   └───────────┘
                                        ▲
                          error ────────┘
```

**State visibility rules:**
- `QUEUED` (including frozen) → shown in Queued Tasks section
- `RUNNING` → shown in Running Tasks section (unless pinned → Pinned section)
- `COMPLETED`, `CANCELLED`, error states → shown in Completed Tasks section (or Archived if archived, or Pinned if pinned)

---

## 7. UI Layout Specification

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Repo Name]   Activity* │ Git │ Wiki │ Schedules │ ...             │
├────────────────────────┬────────────────────────────────────────────┤
│                        │                                            │
│  [🔍 Search...  ] [▼]  │  [Task Title]           [↗] [⬜] [✕]     │
│                        │  ─────────────────────────────────────    │
│  ▶ RUNNING TASKS (N)   │  Turn 1: User prompt text…               │
│  ┌──────────────────┐  │                                            │
│  │ 🤖 Task name  2m │  │  Turn 1: AI response text…               │
│  └──────────────────┘  │  [tool calls collapsed/expanded]          │
│                        │                                            │
│  ⏳ QUEUED TASKS (N)   │  Turn 2: Follow-up text…                 │
│  ┌──────────────────┐  │                                            │
│  │ 📋 Plan: refac…  │  │  Turn 2: AI response (streaming…)        │
│  └──────────────────┘  │                                            │
│                        │  [───── token limit bar ─────]            │
│  📌 PINNED (N)         │                                            │
│  ┌──────────────────┐  │  ┌─────────────────────────────────────┐  │
│  │ 💡 Ask: impor…   │  │  │ [mode ▼] Type a follow-up…    [▶]  │  │
│  └──────────────────┘  │  └─────────────────────────────────────┘  │
│                        │                                            │
│  ✅ COMPLETED TASKS (N)│                        [MiniMap] (desktop) │
│  ┌──────────────────┐  │                                            │
│  │ 💡 Ask: how do…  │  │                                            │
│  └──────────────────┘  │                                            │
│                        │                                            │
│  📦 ARCHIVED (N) ▶     │  (collapsed by default)                   │
│                        │                                            │
│  (scrollable)          │                                            │
└────────────────────────┴────────────────────────────────────────────┘
```

**Layout rules:**
- Left pane: fixed width, vertically scrollable, contains all five sections
- Right pane: fills remaining width, contains header + conversation + input
- The split is fixed (no resizable divider is specified; if one is added it must default to the original proportions)
- MiniMap appears only on desktop viewports
- Tab bar is sticky and always visible when scrolling within a section

---

## 8. Task Card Specification

Each task card in the list must display:

| Element | When shown | Notes |
|---|---|---|
| Type icon | Always | Maps 1:1 to task type |
| Display name | Always | Truncated to 60 chars |
| Elapsed time | Running only | Live counter, 1s tick |
| Unseen dot | When task completed and not viewed | Adjacent to title |
| Bold title | When task has unseen activity | Same condition as dot |
| Context menu trigger | On hover or right-click | See Section 9 |
| Draft badge (✏️) | When an unsent draft exists for this task | Adjacent to title |

---

## 9. Context Menu Specification

Context menu items vary by task state. Completed tasks support bulk context menu via shift-click multi-select.

**Running tasks:**

| Action | Available |
|---|---|
| 📌 Pin / Unpin | ✓ |
| 📋 Copy metadata | ✓ |
| ✕ Cancel | ✓ |

**Queued tasks:**

| Action | Available |
|---|---|
| ▲ Move Up | ✓ (if not first) |
| ⏬ Move to Top | ✓ |
| 🚀 Schedule Immediately | ✓ (only when held: autopilot paused + not admitted) |
| 🚫 Cancel Scheduling | ✓ (only when admitted) |
| 📋 Copy metadata | ✓ |
| ❄️ Freeze / ▶ Unfreeze | ✓ (toggle) |
| ✕ Cancel | ✓ |

**Completed tasks (supports multi-select):**

| Action | Available |
|---|---|
| ✓ Mark as Read | ✓ (if any unseen) |
| ● Mark as Unread | ✓ (if any seen) |
| 📌 Pin / Unpin | ✓ |
| 📦 Archive / 📤 Unarchive | ✓ |
| 📝 Summarize chat(s) | ✓ (≤ 20 selected) |
| 📋 Copy metadata | ✓ |
| 🗑 Delete | ✓ |

---

## 10. Follow-Up Input Area Specification

| Property | Specification |
|---|---|
| Mode selector | Dropdown with options: Ask, Plan, Autopilot |
| Default mode | Autopilot |
| Slash commands | Triggered by `/` as first character; menu populated from skills API |
| Image paste | Clipboard paste of image creates an inline preview; image is attached to the message |
| Draft persistence | Draft survives page reload; scoped to individual task ID |
| Submit trigger | Enter key or submit button |
| Disabled state | Input is disabled while a follow-up is being processed for the same task |

---

## 11. Error Handling Specification

| Error Scenario | Expected Behavior |
|---|---|
| Task fails (AI error) | Task moves to History with an error state indicator; conversation shows the error turn |
| SSE stream disconnects | UI shows a reconnecting indicator; re-establishes connection automatically |
| Follow-up submission fails | Input restores the typed text; an error notification is shown |
| Queue API unreachable | List sections show a loading/error state; no silent failure |
| Pop-out window blocked | Falls back to the float overlay mode or shows a browser permission hint |
| Deep-link to non-existent task | Activity tab opens with no task selected and shows the empty-state placeholder |
| Image paste of unsupported format | Input ignores the paste and shows a brief inline warning |

---

## 12. Empty State Specification

| State | Display |
|---|---|
| No tasks at all | All five sections absent; a prompt/CTA is shown encouraging the user to start a task |
| Running section empty | Section header hidden |
| Queued section empty | Section header hidden |
| Pinned section empty | Section header hidden |
| Completed Tasks section empty | Section header hidden |
| Archived section empty | Section header hidden |
| No task selected | Right pane shows a neutral placeholder ("Select a task to view its conversation") |
| Search returns no results | "No tasks match your search" message; sections collapse |

---

## 13. Cross-Repo Isolation Requirements

These are non-negotiable constraints that must be preserved in all future implementations:

1. **Selected task state is per-repo.** The data structure tracking which task is selected must be keyed by `workspaceId`, not global.
2. **Tab remounts on repo change.** When the user switches to a different repo, the Activity tab component must remount with `key={workspaceId}` — state must not persist across repos.
3. **All API calls include `repoId`.** Every queue-related API call must include a `repoId` parameter or path segment scoped to the correct workspace.
4. **Unseen activity tracking is per-repo.** The `localStorage` seen-map must be keyed by `workspaceId`.

---

## 14. Accessibility Requirements

| Requirement | Specification |
|---|---|
| Keyboard navigation | All task cards reachable via Tab; context menu openable via keyboard shortcut |
| Focus management | On task selection, focus moves to the detail pane header |
| Screen reader labels | Task cards announce: type, name, elapsed time (if running), unseen status |
| Live region | Streaming AI output is announced via an `aria-live` region |
| Contrast | All text and icons meet WCAG AA contrast requirements |
| Touch drag-and-drop | Touch-based drag must be available on mobile viewports as an alternative to mouse drag |

---

## 15. Configuration & Settings

| Configuration | Default | Description |
|---|---|---|
| Auto-open Activity tab | No | Activity tab is the first tab; default tab is `settings`; Activity is shown on return if last used |
| Draft auto-save | Yes (localStorage) | Unsent drafts are saved automatically |
| MiniMap visibility | Desktop only | Shown on wide viewports; hidden on narrow/mobile |

---

## 16. API Dependencies

The Activity tab depends on the following server endpoints. Any change to these contracts must be validated against the user stories above:

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/queue?repoId=` | List pane (Running + Queued) | US-01, US-02 |
| `GET /api/queue/history?repoId=` | List pane (History) | US-03 |
| `GET /api/queue/stats` | Pause/resume state | US-13 |
| `GET /api/queue/:id` | Detail pane | US-04 |
| `GET /api/processes/:pid` | Conversation turns | US-04, US-17 |
| `POST /api/queue` | Follow-up enqueue | US-06, US-09 |
| `DELETE /api/queue/:id` | Cancel | US-12 |
| `POST /api/queue/:id/move-to-top` | Reorder | US-10 |
| `POST /api/queue/:id/move-up/down` | Reorder | US-10 |
| `POST /api/queue/:id/freeze` | Freeze | US-11 |
| `POST /api/queue/pause` / `/resume` | Queue control | US-13 |
| `DELETE /api/queue/history/:id` | Delete history | US-14 |
| `DELETE /api/queue/history` | Clear all history | US-14 |
| `GET /api/workspaces/:id/skills/all` | Slash command menu | US-07 |
| `GET /api/models` | Token-limit bar | (detail pane) |
| `POST /api/processes/:pid/resume-cli` | Resume in terminal | US-21 |
| SSE stream | Streaming tokens | US-17 |

---

## Revision History

| Version | Date | Summary |
|---|---|---|
| 1.0.0 | 2026-03-24 | Initial golden state specification |
| 1.1.0 | 2026-04-05 | Fix default tab (settings, not activity), five-section layout (Running→Queued→Pinned→Completed→Archived), default follow-up mode (autopilot), rewrite context menu per codebase, add pin/unpin and swipe-to-archive features, add draft badge |
| 1.2.0 | 2026-05-29 | Document dual labeling: tab key is `activity` in classic layout and `chats` in dev-workflow layout (same surface, both URL keys are accepted as aliases) |
