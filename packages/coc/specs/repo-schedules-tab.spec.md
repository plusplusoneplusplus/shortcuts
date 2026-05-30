# Repository Schedules Tab — UI/UX Specification

**Document type:** Formal UX Specification  
**Scope:** CoC Dashboard → Repository Detail → Schedules Tab  
**Purpose:** Authoritative reference for validating any future UI/UX changes to the Schedules tab.  
**Version:** 1.1.0

---

## 1. Overview

The **Repository Schedules Tab** provides an interface for creating, managing, and monitoring scheduled AI tasks. Schedules can be user-defined or repository-defined (from `.github/schedules/`). The tab features a resizable split-panel layout with a schedule list (organized into "My Schedules" and "Repo Schedules" sections) on the left and a detail/create/edit pane on the right. Schedules support cron expressions, manual runs, pause/resume, drag-and-drop between user and repo ownership, and run history.

### 1.1 Tab Identity

| Property | Value |
|---|---|
| Tab key | `schedules` |
| Tab label (classic layout) | `Schedules` |
| Tab label (dev-workflow layout) | `Jobs` |
| Tab position | Position depends on layout mode (`classic` keeps the historical position; `dev-workflow` places it in its custom-ordered tab strip after Work Items) |
| Default tab | No |
| Keyboard shortcut | `Alt+S` |
| URL fragment | `#repos/<workspaceId>/schedules` |
| Deep-link URL | `#repos/<workspaceId>/schedules/<scheduleId>` |
| Implementing component | `RepoSchedulesTab` |

---

## 2. User Personas

| Persona | Description | Primary Goal |
|---|---|---|
| **Automator** | Engineers setting up recurring AI tasks | Create and configure scheduled workflows |
| **Operator** | Users monitoring scheduled task execution | View run history, pause/resume, run manually |
| **Repo maintainer** | Engineers managing repo-level schedules | Move schedules between user and repo ownership |

---

## 3. User Stories

### 3.1 Schedule Browsing

**US-01 — Browse schedules**
> As an operator, I want to see all schedules for this repository organized by ownership.

- **Given** the Schedules tab is open
- **When** schedules exist
- **Then** two collapsible sections are shown: "MY SCHEDULES" (user) and "REPO SCHEDULES" (from `.github/schedules/`), each with counts and expand/collapse chevrons

---

**US-02 — View schedule detail**
> As an operator, I want to see a schedule's configuration and status.

- **Given** a schedule is selected
- **When** the detail pane is shown
- **Then** it displays: name with type emoji, status badge (active/paused/stopped), mode badge (ask/plan/autopilot), target path, cron expression with human-readable description, parameters as pills, on-failure behavior, optional output folder and model, created time, and next run time

---

**US-03 — Auto-select first schedule**
> As an operator, I want the first schedule to be selected automatically when I open the tab.

- **Given** the Schedules tab opens with schedules available
- **When** no schedule is currently selected
- **Then** the first schedule in the list is auto-selected and its detail is shown

---

### 3.2 Schedule Management

**US-04 — Create a schedule**
> As an automator, I want to create a new scheduled task.

- **Given** the schedule list is visible
- **When** the user clicks "+ New"
- **Then** a `CreateScheduleForm` appears in the detail pane with templates, cron/interval configuration, workflow selection (for `run-workflow` type), model selection, and validation

---

**US-05 — Edit a schedule**
> As an automator, I want to modify a user schedule's configuration.

- **Given** a user schedule is selected
- **When** the user clicks Edit
- **Then** the `CreateScheduleForm` appears in edit mode with current values pre-filled

---

**US-06 — Duplicate a schedule**
> As an automator, I want to create a copy of an existing schedule.

- **Given** a user schedule is selected
- **When** the user clicks Duplicate
- **Then** a `CreateScheduleForm` appears pre-filled with the schedule's values but requiring a new name

---

**US-07 — Delete a schedule**
> As an automator, I want to delete a user schedule.

- **Given** a user schedule is selected
- **When** the user clicks Delete and confirms (native `confirm`)
- **Then** `DELETE .../schedules/:scheduleId` removes the schedule

---

**US-08 — Pause and resume a schedule**
> As an operator, I want to pause a schedule to temporarily stop execution.

- **Given** a schedule is selected
- **When** the user clicks Pause
- **Then** `PATCH .../schedules/:scheduleId` sets status to paused; the detail shows "Paused"
- **When** the user clicks Resume
- **Then** the schedule resumes and shows the next run time

---

**US-09 — Run a schedule manually**
> As an operator, I want to trigger a schedule immediately without waiting for the cron.

- **Given** a schedule is selected
- **When** the user clicks "Run Now"
- **Then** `POST .../schedules/:scheduleId/run` triggers immediate execution

---

**US-10 — View run history**
> As an operator, I want to see past executions of a schedule.

- **Given** a schedule is selected
- **When** the detail pane is shown
- **Then** a `RunHistoryList` shows past runs with status and timestamps

---

### 3.3 Schedule Ownership

**US-11 — Move schedule between user and repo**
> As a repo maintainer, I want to move a schedule between user and repo ownership.

- **Given** schedules exist in either section
- **When** the user drags a schedule from "My Schedules" to "Repo Schedules" (or vice versa)
- **Then** `POST .../schedules/:scheduleId/move` is called with `{ destination: 'user' | 'repo' }`; the schedule moves to the target section

---

**US-12 — Repo schedule restrictions**
> As a repo maintainer, I understand that repo schedules have limited editability.

- **Given** a repo schedule is selected
- **When** the detail pane is shown
- **Then** Edit, Duplicate, and Delete buttons are not available; only status (pause/resume) and Run Now are available

---

## 4. Feature Inventory & Acceptance Criteria

### 4.1 Left Pane — Schedule List

| Feature | Acceptance Criteria |
|---|---|
| Two sections | "MY SCHEDULES" and "REPO SCHEDULES" with collapsible headers and counts |
| Schedule rows | Status dot, name, type badges ([Repo] teal, [Script] blue, [Prompt] gray), mode badge for non-default, cron description (hidden below xl), next run relative time |
| "+ New" button | Opens create form in detail pane |
| Drag-and-drop | User schedules draggable to repo section and vice versa; drop zones highlight on drag |
| Empty user section | Clock emoji + "No schedules yet…" with drop zone |
| Empty repo section | Hint path `.github/schedules/`; "No repo schedules found." with drop zone |
| Auto-select | First schedule auto-selected on load when none selected |

### 4.2 Right Pane — Detail

| Feature | Acceptance Criteria |
|---|---|
| Header | Name with type emoji, running spinner, status badge, mode badge, repo-source badge |
| Status display | Next run time, "Running now…", or "Paused" |
| Toolbar (user schedules) | Run Now, Pause/Resume, Edit, Duplicate, Delete |
| Toolbar (repo schedules) | Run Now, Pause/Resume only |
| Info section | Target path, cron + raw expression, params as pills, on-failure label, output folder, model, created time |
| Run history | `RunHistoryList` with past executions |

### 4.3 Create/Edit Form

| Feature | Acceptance Criteria |
|---|---|
| Templates | Pre-defined schedule templates |
| Cron/interval | Cron expression input or interval configuration |
| Workflow selection | Fetches workflows for `run-workflow` type |
| Model selection | Fetches from `GET /api/models` |
| Validation | Errors shown on submit |

### 4.4 Resize Behavior

| Feature | Acceptance Criteria |
|---|---|
| Left panel resize | Drag handle; width range 160–600px; default ~288px |
| Mobile layout | Single column; selecting a schedule opens detail stack with "← Schedules" back |

---

## 5. Behavioral Invariants

| ID | Invariant |
|---|---|
| INV-01 | Repo schedules cannot be edited, duplicated, or deleted via the UI; only status changes and manual runs are allowed |
| INV-02 | The server enforces 403 for edit/delete attempts on repo schedules |
| INV-03 | Schedule timers use overlap skip: a new run does not start if the previous run is still active |
| INV-04 | Run history is capped at 100 runs per schedule |
| INV-05 | `schedule-changed` window events trigger a list refetch |
| INV-06 | On-failure "stop" sets the schedule to stopped status and cancels the timer |
| INV-07 | Moving a schedule from user to repo writes a YAML file to `.github/schedules/` and reloads |
| INV-08 | Moving a schedule from repo to user copies to user store and deletes the YAML file |

---

## 6. UI Layout Specification

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Repo Name]   Activity │ Git │ … │ Workflows │ Schedules* │ …     │
├────────────────────────┬────────────────────────────────────────────┤
│                        │                                            │
│  [+ New]               │  🕐 daily-review                          │
│                        │  ─────────────────────────────────────     │
│  ▶ MY SCHEDULES (2)    │  Status: ● Active    Mode: autopilot     │
│  ┌──────────────────┐  │  Next run: in 4 hours                     │
│  │ ● daily-review   │  │                                            │
│  │   [Prompt] 0 8 * │  │  Target: review-workflow.yaml             │
│  │   in 4h          │  │  Cron: 0 8 * * * (Every day at 8:00 AM) │
│  ├──────────────────┤  │  Params: depth=deep, model=gpt-4         │
│  │ ● weekly-report  │  │  On failure: notify                       │
│  │   [Prompt] 0 9 * │  │  Created: 2 days ago                     │
│  └──────────────────┘  │                                            │
│                        │  [Run Now] [Pause] [Edit] [Dup] [Delete] │
│  ▶ REPO SCHEDULES (1)  │                                            │
│  ┌──────────────────┐  │  ▶ Run History                            │
│  │ ● ci-check       │  │  ┌──────────────────────────────────┐    │
│  │   [Repo][Script]  │  │  │ ✓ 2h ago  │ ✓ 1d ago  │ ✗ 2d  │    │
│  └──────────────────┘  │  └──────────────────────────────────┘    │
└────────────────────────┴────────────────────────────────────────────┘
```

---

## 7. Error Handling Specification

| Error Scenario | Expected Behavior |
|---|---|
| Schedule list fetch failure | List set to empty (silent) |
| Create/edit validation failure | Inline validation errors on form fields |
| Delete failure | Error in confirm flow |
| Run Now failure | Toast or inline error |
| Move failure | Error notification |
| Repo schedule edit attempt | 403 from server; UI does not show edit controls |

---

## 8. Empty State Specification

| State | Display |
|---|---|
| No schedules at all, no selection | "Create your first schedule with '+ New'" |
| Schedules exist, no selection | "Select a schedule to view details" |
| Empty user section | Clock emoji + "No schedules yet…" |
| Empty repo section | "No repo schedules found." with `.github/schedules/` hint |

---

## 9. API Dependencies

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/workspaces/:id/schedules` | Schedule list | US-01 |
| `POST /api/workspaces/:id/schedules` | Create schedule | US-04 |
| `PATCH /api/workspaces/:id/schedules/:scheduleId` | Edit/pause/resume | US-05, US-08 |
| `DELETE /api/workspaces/:id/schedules/:scheduleId` | Delete schedule | US-07 |
| `POST /api/workspaces/:id/schedules/:scheduleId/run` | Manual run | US-09 |
| `GET /api/workspaces/:id/schedules/:scheduleId/history` | Run history | US-10 |
| `POST /api/workspaces/:id/schedules/:scheduleId/move` | Move ownership | US-11 |
| `GET /api/models` | Model selection in create form | US-04 |
| `GET /api/workspaces/:id/workflows` | Workflow selection in create form | US-04 |

---

## Revision History

| Version | Date | Summary |
|---|---|---|
| 1.0.0 | 2026-03-25 | Initial specification |
| 1.1.0 | 2026-05-29 | Document `Jobs` label in dev-workflow layout (key/URL/component unchanged), add keyboard shortcut and implementing-component reference |
