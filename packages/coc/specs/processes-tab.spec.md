# Processes Tab — UI/UX Specification

**Document type:** Formal UX Specification  
**Scope:** CoC Dashboard → Processes (Top-Level Tab)  
**Purpose:** Authoritative reference for validating any future UI/UX changes to the Processes tab.  
**Version:** 1.0.0

---

## 1. Overview

The **Processes Tab** is a top-level dashboard tab providing a global view of all AI task queue activity across all repositories. It reuses the same `ActivityListPane` + `ActivityDetailPane` pattern as the per-repo Activity tab but operates at the global scope. It shows running, queued, and historical tasks with full conversation detail, SSE streaming, follow-up messaging, queue management (pause/resume/reorder/freeze/cancel), and process detail with workflow DAG visualization.

### 1.1 Tab Identity

| Property | Value |
|---|---|
| Tab label | `Processes` (icon in top bar) |
| Tab position | Top-level tab |
| Default tab | No |
| URL fragment | `#processes` |
| Deep-link URL | `#process/queue_<taskId>` or `#processes/<taskId>` |

---

## 2. User Personas

| Persona | Description | Primary Goal |
|---|---|---|
| **Operator** | Engineers monitoring global AI task execution | View all running/queued tasks across repos, manage queue |
| **Developer** | Engineers interacting with AI tasks | Send follow-ups, review conversations, cancel tasks |
| **Power user** | Advanced users managing task execution | Pause/resume queue, reorder tasks, freeze items |

---

## 3. User Stories

### 3.1 Global Queue View

**US-01 — View all running tasks**
> As an operator, I want to see all currently executing AI tasks across all repositories.

- **Given** the Processes tab is open
- **When** tasks are running
- **Then** a "Running" section lists all running tasks globally with type icon, display name, and live elapsed-time counter

---

**US-02 — View all queued tasks**
> As an operator, I want to see all tasks waiting to execute.

- **Given** the Processes tab is open
- **When** tasks are queued
- **Then** a "Queued" section lists all queued tasks in execution priority order

---

**US-03 — View task history**
> As an operator, I want to browse completed tasks across all repositories.

- **Given** the Processes tab is open
- **When** completed tasks exist
- **Then** a "History" section lists completed tasks in reverse-chronological order

---

**US-04 — Pause and resume the global queue**
> As a power user, I want to pause the entire queue so no new tasks start.

- **Given** the queue is running
- **When** the user triggers Pause (`POST /api/queue/pause`)
- **Then** all queued tasks remain queued but do not start; a "Paused" indicator is shown
- **When** the user triggers Resume (`POST /api/queue/resume`)
- **Then** the queue resumes normal execution

---

### 3.2 Task Interaction

**US-05 — View task conversation**
> As a developer, I want to read the full AI conversation for any task.

- **Given** a task is selected
- **When** the detail pane loads
- **Then** `GET /api/queue/:taskId` and `GET /api/processes/:processId` fetch the conversation; all turns are shown (user prompt, AI response, tool calls)

---

**US-06 — Send a follow-up message**
> As a developer, I want to send a follow-up message to continue a conversation.

- **Given** a task is selected in the detail pane
- **When** the user types a message and submits
- **Then** the follow-up is enqueued or delivered immediately based on `deliveryMode`

---

**US-07 — Stream AI output in real time**
> As a developer, I want to see AI response tokens appear incrementally.

- **Given** a running task is selected
- **When** the AI is generating a response
- **Then** tokens appear via SSE streaming (`GET /api/processes/:id/stream`)

---

**US-08 — Navigate to workflow DAG**
> As an operator, I want to view the DAG visualization for workflow tasks.

- **Given** a `run-workflow` task with repo info is selected
- **When** the user clicks the task
- **Then** the view navigates to `#repos/<repoId>/workflow/<processId>` for the full DAG view

---

### 3.3 Queue Management

**US-09 — Reorder queued tasks**
> As a power user, I want to change the order of queued tasks.

- **Given** two or more tasks are queued
- **When** the user drags a task or uses context menu actions (Move to Top, Move Up, Move Down)
- **Then** the queue order updates and the server is notified

---

**US-10 — Cancel a task**
> As a developer, I want to cancel a running or queued task.

- **Given** a task is running or queued
- **When** the user clicks Cancel
- **Then** `DELETE /api/queue/:id` cancels the task; it moves to History

---

**US-11 — Freeze a queued task**
> As a power user, I want to freeze a task so it does not execute until unfrozen.

- **Given** a task is queued
- **When** the user selects Freeze from the context menu
- **Then** the task shows a frozen indicator and is skipped during execution

---

### 3.4 Process Detail

**US-12 — View process detail**
> As an operator, I want to see the full process record for a task.

- **Given** a task is selected
- **When** the detail loads
- **Then** `GET /api/processes/:id` returns the process with conversation turns, metadata, and status

---

**US-13 — Resume a task in terminal**
> As a developer, I want to continue a task in my local terminal.

- **Given** a task has an associated process
- **When** the user clicks "Resume in Terminal"
- **Then** `POST /api/processes/:pid/resume-cli` attaches the task to the terminal

---

## 4. Feature Inventory & Acceptance Criteria

### 4.1 List Pane (ActivityListPane)

| Feature | Acceptance Criteria |
|---|---|
| Three-section layout | Running → Queued → History; sections hidden when empty |
| Task type icons | Correct icon per type (autopilot, ask, plan, run-workflow, run-script, scheduled) |
| Live elapsed timer | Running tasks show timer incrementing every 1s |
| Filter dropdown | Multi-select by task type |
| Search | Real-time filter by displayName / title / prompt |
| Context menu | State-appropriate actions per task |
| Drag-and-drop | Reorder queued tasks only |
| Pause indicator | Shown when queue is paused |

### 4.2 Detail Pane (ActivityDetailPane → ActivityChatDetail)

| Feature | Acceptance Criteria |
|---|---|
| Conversation display | All turns in chronological order |
| SSE streaming | Incremental token display |
| Follow-up input | Text input with mode selector and slash commands |
| Cancel button | Visible for running tasks |
| Resume in Terminal | Available when process exists |
| Workflow DAG navigation | `run-workflow` tasks navigate to DAG view |

### 4.3 Layout

| Feature | Acceptance Criteria |
|---|---|
| Desktop | Split pane: ~`w-64` (tablet) / `w-80` (desktop) list + detail |
| Mobile | List or detail with back navigation |
| Loading | "Loading queue…" until first fetch |

---

## 5. Behavioral Invariants

| ID | Invariant |
|---|---|
| INV-01 | The Processes tab shows tasks from all repositories, not scoped to a single repo |
| INV-02 | Selecting a `run-workflow` task with repo info navigates to the repo's workflow DAG view |
| INV-03 | If the selected task ID vanishes from lists, `GET /api/queue/:id` verifies existence; on failure, selection is cleared |
| INV-04 | Queue pause/resume affects all repositories globally |
| INV-05 | History fetch failure results in empty history, not an error state |
| INV-06 | The `ChatPreferencesProvider` wraps content with `workspaceId` from `selectedRepoId` (may be empty for global) |

---

## 6. UI Layout Specification

```
┌─────────────────────────────────────────────────────────────────────┐
│  CoC │ Processes* │ Wiki │ Memory │ Skills │ …                      │
├────────────────────────┬────────────────────────────────────────────┤
│                        │                                            │
│  [🔍 Search…  ] [▼]   │  [Task Title]           [↗] [⬜] [✕]     │
│  [⏸ Pause Queue]      │  ─────────────────────────────────────     │
│                        │  Turn 1: User prompt text…                │
│  ▶ RUNNING (N)         │                                            │
│  ┌──────────────────┐  │  Turn 1: AI response text…                │
│  │ 🤖 Task name  2m │  │  [tool calls collapsed/expanded]          │
│  └──────────────────┘  │                                            │
│                        │  Turn 2: Follow-up text…                  │
│  ⏳ QUEUED (N)         │                                            │
│  ┌──────────────────┐  │  Turn 2: AI response (streaming…)         │
│  │ 📋 Plan: refac…  │  │                                            │
│  └──────────────────┘  │  ┌─────────────────────────────────────┐  │
│                        │  │ [mode ▼] Type a follow-up…    [▶]  │  │
│  🕐 HISTORY (N)        │  └─────────────────────────────────────┘  │
│  ┌──────────────────┐  │                                            │
│  │ 💡 Ask: how do…  │  │                                            │
│  └──────────────────┘  │                                            │
└────────────────────────┴────────────────────────────────────────────┘
```

---

## 7. Error Handling Specification

| Error Scenario | Expected Behavior |
|---|---|
| Queue fetch failure | Error state in list pane |
| History fetch failure | Empty history (silent) |
| Task detail fetch failure | Error in detail pane |
| Follow-up submission failure | Input restores typed text; error notification |
| SSE stream disconnect | Reconnecting indicator; auto-reconnect |
| Cancel failure | Error notification |
| Process not found (stale selection) | Selection cleared; hash reset to `#processes` |

---

## 8. Empty State Specification

| State | Display |
|---|---|
| No tasks at all | All sections absent; prompt to start a task |
| Running section empty | Section hidden |
| Queued section empty | Section hidden |
| History section empty | Section hidden |
| No task selected | Detail pane shows placeholder |
| Loading | "Loading queue…" |

---

## 9. API Dependencies

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/queue` | List pane (Running + Queued) | US-01, US-02 |
| `GET /api/queue/history` | List pane (History) | US-03 |
| `POST /api/queue/pause` | Pause queue | US-04 |
| `POST /api/queue/resume` | Resume queue | US-04 |
| `GET /api/queue/:id` | Task detail / stale check | US-05 |
| `POST /api/queue` | Follow-up enqueue | US-06 |
| `DELETE /api/queue/:id` | Cancel task | US-10 |
| `POST /api/queue/:id/move-to-top` | Reorder | US-09 |
| `POST /api/queue/:id/freeze` | Freeze | US-11 |
| `GET /api/processes/:id` | Process detail | US-12 |
| `GET /api/processes/:id/stream` | SSE streaming | US-07 |
| `POST /api/processes/:pid/resume-cli` | Resume in terminal | US-13 |
| `GET /api/processes/summaries` | Process index | US-12 |
| `POST /api/processes/:id/message` | Follow-up message | US-06 |
| `POST /api/processes/:id/cancel` | Cancel process | US-10 |
| `GET /api/models` | Token-limit bar | Detail pane |
| `GET /api/workspaces/:id/skills/all` | Slash commands | Detail pane |

---

## Revision History

| Version | Date | Summary |
|---|---|---|
| 1.0.0 | 2026-03-25 | Initial specification |
