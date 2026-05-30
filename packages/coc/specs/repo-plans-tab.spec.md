# Repository Plans/Tasks Tab — UI/UX Specification

**Document type:** Formal UX Specification  
**Scope:** CoC Dashboard → Repository Detail → Plans/Tasks Tab (deprecated)  
**Purpose:** Authoritative reference for validating any future UI/UX changes to the Plans/Tasks tab.  
**Version:** 2.0.0

---

> ⚠️ **Status: deprecated.** The tab is still rendered in both UI layout modes but its label is suffixed with `(Dep.)` (`"Plans (Dep.)"` in classic layout, `"Tasks (Dep.)"` in dev-workflow layout). New work should be tracked via the **Work Items** tab and per-repo **Notes**, not the Plans/Tasks tree. Existing tasks remain editable; this spec documents what continues to be supported.

## 1. Overview

The **Repository Plans/Tasks Tab** is a deprecated surface for hierarchical task and document management that still ships in the dashboard for backward compatibility. Its rendering depends on the active UI layout mode:

- **Classic layout** — renders `TasksPanel`, the original Miller-column markdown task tree described in this spec. Supports creating, organizing, previewing, and editing markdown task documents grouped by type suffix (plan, spec, test, notes, todo, design, impl, review, checklist, requirements, analysis), with inline comments, AI skills, and cross-repo moves.
- **Dev-workflow layout** — renders `RepoChatTab` in `mode="tasks"`, a chat-style task surface that reuses the chats UI (history, queue, follow-ups). The Miller-column tree is **not** shown in this mode.

Both modes share the same underlying `tasks` REST API and the same `tasks-changed` WebSocket events.

### 1.1 Tab Identity

| Property | Value |
|---|---|
| Tab key | `tasks` |
| Tab label (classic) | `Plans (Dep.)` |
| Tab label (dev-workflow) | `Tasks (Dep.)` |
| Tab position | Listed after Pull Requests; appears between Pull Requests and Notes by default |
| Default tab | No |
| Keyboard shortcut | `Alt+T` |
| URL fragment | `#repos/<workspaceId>/tasks` |
| Deep-link URL | `#repos/<workspaceId>/tasks/<encodedPath>` |
| Deep-link with mode | `#repos/<workspaceId>/tasks/<encodedPath>?mode=source` |
| Implementing component (classic) | `TasksPanel` (`tasks/TasksPanel.tsx`) |
| Implementing component (dev-workflow) | `RepoChatTab mode="tasks"` (chat-based UI; see chat-tab spec) |

---

## 2. User Personas

| Persona | Description | Primary Goal |
|---|---|---|
| **Planner** | Engineers creating and organizing project plans | Create task documents, organize into folders, track status |
| **Reviewer** | Team members reviewing plans and specs | Read documents, add inline comments, request AI review |
| **AI operator** | Users leveraging AI to generate and update documents | Generate plans with AI, run skills on documents, bulk operations |

---

## 3. User Stories

### 3.1 Navigation & Browsing

**US-01 — Browse task hierarchy**
> As a planner, I want to navigate a folder tree of task documents so I can find and organize my work.

- **Given** the Plans tab is open and tasks exist
- **When** the user clicks a folder
- **Then** a new Miller column appears showing the folder's contents (subfolders, document groups, single documents)
- **Then** only the last two columns are visible; deeper navigation shows a "‹ N" back control

---

**US-02 — Search tasks**
> As a planner, I want to search tasks by name so I can find documents quickly.

- **Given** the Plans tab is open
- **When** the user types in the search input (or presses Ctrl/Cmd+F)
- **Then** after a 150ms debounce, the tree is replaced by flat search results matching base name, file name, or path (case-insensitive)

---

**US-03 — Filter by status**
> As a planner, I want to filter tasks by status so I can focus on active work.

- **Given** tasks with various statuses exist
- **When** the user selects status pills (pending / in-progress / done / future)
- **Then** only tasks matching the selected statuses are shown; the archive subtree is hidden when filtering

---

**US-04 — Deep-link to a task**
> As a reviewer sharing a link, I want a URL that opens a specific document.

- **Given** a URL of the form `#repos/<workspaceId>/tasks/<encodedPath>`
- **When** the user navigates to that URL
- **Then** the Plans tab opens with the folder hierarchy expanded to the document, and the document preview is shown

---

### 3.2 Document Preview & Editing

**US-05 — Preview a document**
> As a reviewer, I want to read a task document with rendered markdown.

- **Given** a document is selected in the tree
- **When** the user clicks the document
- **Then** the right pane shows a `MarkdownReviewEditor` in review mode with rendered markdown, syntax highlighting, and Mermaid diagrams

---

**US-06 — Edit a document in source mode**
> As a planner, I want to edit the raw markdown of a document.

- **Given** a document preview is open
- **When** the user switches to source mode
- **Then** a `SourceEditor` appears with the raw markdown; Ctrl+S saves; a dirty-state indicator (●) shows unsaved changes

---

**US-07 — Change task status**
> As a planner, I want to change a task's status from the preview toolbar.

- **Given** a document preview is open
- **When** the user selects a new status from the status dropdown
- **Then** `PATCH /api/workspaces/:id/tasks` is called with `{ path, status }` and the tree refreshes

---

### 3.3 CRUD Operations

**US-08 — Create a task document**
> As a planner, I want to create a new task document with a specific type.

- **Given** a folder is selected
- **When** the user selects "Create Task" from the folder context menu
- **Then** a dialog appears with name input and document type dropdown (plan, spec, test, notes, todo, design, impl, review, or none)
- **When** the user confirms
- **Then** `POST /api/workspaces/:id/tasks` creates the file with frontmatter `status: pending` and a title heading

---

**US-09 — Create a subfolder**
> As a planner, I want to create subfolders to organize tasks.

- **Given** a folder is selected
- **When** the user selects "Create Subfolder" from the context menu
- **Then** a dialog appears for the folder name; on confirm, `POST /api/workspaces/:id/tasks` creates the folder

---

**US-10 — Rename a task or folder**
> As a planner, I want to rename tasks and folders.

- **Given** a task or folder exists
- **When** the user selects "Rename" from the context menu
- **Then** a rename dialog appears; on confirm, `PATCH /api/workspaces/:id/tasks` is called with `{ newName }`; document groups are renamed together

---

**US-11 — Delete a task or folder**
> As a planner, I want to delete tasks and folders I no longer need.

- **Given** a task or folder exists
- **When** the user selects "Delete" from the context menu and confirms
- **Then** `DELETE /api/workspaces/:id/tasks` removes the file or folder recursively

---

**US-12 — Move a task or folder**
> As a planner, I want to move tasks between folders or repositories.

- **Given** a task or folder exists
- **When** the user selects "Move" from the context menu
- **Then** a `FileMoveDialog` or `FolderMoveDialog` opens for selecting the destination
- **When** the user selects "Move to other repo"
- **Then** sibling repositories with the same normalized remote URL are listed as destinations

---

**US-13 — Archive and unarchive**
> As a planner, I want to archive completed tasks and restore them if needed.

- **Given** a task or folder exists
- **When** the user selects "Archive" from the context menu
- **Then** `POST /api/workspaces/:id/tasks/archive` moves the item to the archive
- **When** the user clicks "Undo" in the toolbar
- **Then** `POST /api/workspaces/:id/tasks/undo-archive` restores the last archived item

---

### 3.4 Inline Comments

**US-14 — Add an inline comment**
> As a reviewer, I want to add comments on specific text in a document.

- **Given** a document is open in review mode
- **When** the user selects text
- **Then** a `SelectionToolbar` appears with "Add comment"
- **When** the user clicks "Add comment" and enters text with a category
- **Then** `POST /api/comments/:wsId/:taskPath` creates the comment and it appears in the sidebar

---

**US-15 — Manage comments**
> As a reviewer, I want to resolve, edit, delete, and reply to comments.

- **Given** comments exist on a document
- **When** the user opens the `CommentSidebar`
- **Then** comments are listed with filters (All / Open / Resolved) and category chips
- **Then** each comment supports resolve/unresolve, edit, delete, reply, Ask AI, and copy-as-prompt actions

---

**US-16 — Batch resolve comments with AI**
> As a reviewer, I want AI to resolve all open comments at once.

- **Given** open comments exist on a document
- **When** the user clicks "Resolve all with AI"
- **Then** `POST /api/comments/:wsId/:taskPath/batch-resolve` enqueues a task with the `resolve-comments` tool

---

### 3.5 AI Integration

**US-17 — Generate a task with AI**
> As an AI operator, I want AI to generate a new task document from a prompt.

- **Given** a folder is selected
- **When** the user selects "Generate Task with AI" from the context menu
- **Then** a `GenerateTaskDialog` opens with prompt, name, folder picker, context options, effort/model settings, and image upload
- **When** the user submits
- **Then** a task is enqueued via the queue system

---

**US-18 — Run a skill on a document**
> As an AI operator, I want to run an AI skill on a specific document.

- **Given** a document is open
- **When** the user clicks "Run Skill" in the toolbar
- **Then** a `FollowPromptDialog` opens for selecting and configuring the skill

---

**US-19 — Bulk run a skill on a folder**
> As an AI operator, I want to run a skill on all documents in a folder.

- **Given** a folder is selected
- **When** the user selects "Bulk Run Skill" from the context menu
- **Then** a `BulkFollowPromptDialog` opens for configuring the bulk operation

---

### 3.6 Drag and Drop

**US-20 — Drag files and folders**
> As a planner, I want to drag documents and folders to reorganize them.

- **Given** the tree is visible
- **When** the user drags a file or folder onto a folder
- **Then** the target folder highlights; on drop, the item is moved to the target folder

---

## 4. Feature Inventory & Acceptance Criteria

### 4.1 Toolbar

| Feature | Acceptance Criteria |
|---|---|
| Search input | 150ms debounce; Ctrl/Cmd+F focuses (disabled when preview open); Escape clears |
| Status pills | All / pending / in-progress / done / future; multi-toggle; banner shows active filters with "Clear filter" |
| Undo archive | Button visible when undo is available |
| Context files toggle | Checkbox to show/hide context files (README, context.md) in the tree |
| Multi-select actions | "N selected", Clear |

### 4.2 Miller Columns

| Feature | Acceptance Criteria |
|---|---|
| Column navigation | Click folder appends column; max 2 visible; "‹ N" back control for deeper levels |
| Tree items | Checkbox (non-context files), icon, status emoji, name, "in progress" badge, comment count badge, folder .md count, chevron |
| Document groups | Files sharing a base name are grouped; group shows all suffix types |
| Context documents | Dimmed styling; can be hidden via toolbar toggle |
| Archived items | Sorted after non-archived in search results |
| Empty folder | Column shows "Empty folder" |

### 4.3 Preview Pane

| Feature | Acceptance Criteria |
|---|---|
| Review mode | Rendered markdown with highlight.js, Mermaid, code-block actions |
| Source mode | Raw markdown editor; Ctrl+S save; dirty indicator (●) |
| Status dropdown | Changes task status via PATCH; dispatches `tasks-changed` event |
| AI buttons | Run Skill, Update Document |
| Inline comments | Text selection → SelectionToolbar → InlineCommentPopup |
| Comment sidebar | Filters, resolve/unresolve, edit, delete, reply, Ask AI, batch resolve, copy prompt |
| Close button | Desktop: ✕ to close preview |
| Mobile | Tree hidden when preview open; "← Tasks" back bar |

---

## 5. Behavioral Invariants

| ID | Invariant |
|---|---|
| INV-01 | At most two Miller columns are visible at any time |
| INV-02 | Document groups are always renamed together; renaming one file in a group renames all |
| INV-03 | Archive subtree is hidden when any status filter is active |
| INV-04 | Drag-and-drop only targets folders; files cannot be drop targets |
| INV-05 | The search input is disabled (native find takes over) when the preview pane is open |
| INV-06 | Status changes via the dropdown always dispatch a `tasks-changed` window event |
| INV-07 | Cross-repo move is only available to repositories with the same normalized remote URL |
| INV-08 | Context files (README, context.md) are never selectable via checkbox |
| INV-09 | Shift+right-click always opens the native browser context menu |
| INV-10 | WebSocket `tasks-changed` events trigger a tree refetch |

---

## 6. Context Menu Specification

### File Context Menu

| Action | Description |
|---|---|
| Reveal in Panel | Scrolls to and highlights the file in the tree |
| Copy path | Copies relative path to clipboard |
| Copy absolute path | Copies full path to clipboard |
| Archive / Unarchive | Moves to/from archive |
| Rename | Opens rename dialog |
| Move | Opens move dialog |
| Move to other repo | Lists sibling repos with same remote |
| Change status | Submenu: pending, in-progress, done, future |
| Run Skill | Opens skill dialog |
| Update Document | Opens update dialog |
| Delete | Confirmation required |

### Folder Context Menu

| Action | Description |
|---|---|
| Copy path / absolute path | Copies path to clipboard |
| Queue All Tasks | Enqueues all tasks in folder |
| Archive / Unarchive folder | Moves entire folder to/from archive |
| Rename | Opens rename dialog |
| Create Subfolder | Opens create folder dialog |
| Create Task | Opens create task dialog with doc type |
| Move | Opens move dialog |
| Move to other repo | Lists sibling repos |
| Generate Task with AI | Opens AI generation dialog |
| Bulk Run Skill | Opens bulk skill dialog |
| Delete | Confirmation required; recursive |

### Empty Space Context Menu

| Action | Description |
|---|---|
| Create Folder | Opens create folder dialog |

---

## 7. UI Layout Specification

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Repo Name]   Activity │ Git │ Plans* │ Workflows │ ...            │
├─────────────────────────────────────────────────────────────────────┤
│  [🔍 Search…] [All|●|▶|✓|◇] [↩ Undo] [☐ Context files] [N sel]  │
├──────────────┬──────────────┬───────────────────────────────────────┤
│  ‹ 2         │              │                                       │
│  📁 features │  📁 auth     │  # Auth Implementation Plan           │
│  📁 backend  │  📄 auth.plan│  ─────────────────────────            │
│  📁 frontend │  📄 auth.spec│  Status: [in-progress ▼]             │
│  📄 README   │  📄 auth.test│                                       │
│              │  📁 api      │  ## Overview                          │
│              │              │  This plan covers the authentication  │
│              │              │  module refactoring…                   │
│              │              │                                       │
│              │              │  [Review | Source]                     │
│              │              │  [Run Skill] [Update Document]        │
│              │              │                                       │
│  (column 1)  │  (column 2)  │  (preview pane)              [✕]     │
└──────────────┴──────────────┴───────────────────────────────────────┘
```

---

## 8. Error Handling Specification

| Error Scenario | Expected Behavior |
|---|---|
| Task tree load failure | Red error message (`data-testid="tasks-error"`) |
| No tasks folder | "No tasks folder found. Create a `.vscode/tasks/` directory…" |
| File save failure | Error notification; source editor retains dirty state |
| Status change failure | Toast notification with error |
| Delete failure | Toast notification with error |
| Move failure | Toast notification with error |
| Comment API failure | Inline error in comment sidebar |
| AI generation failure | Error shown in generation dialog |

---

## 9. Empty State Specification

| State | Display |
|---|---|
| No tasks folder | Prompt to create `.vscode/tasks/` directory |
| Empty folder | "Empty folder" in column |
| Search with no results | "No tasks match '…'" (`data-testid="search-empty-state"`) |
| No task selected | Preview pane not shown; full width for columns |

---

## 10. API Dependencies

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/workspaces/:id/tasks` | Tree data | US-01 |
| `GET /api/workspaces/:id/tasks/settings` | Task root path | Settings |
| `GET /api/workspaces/:id/tasks/content` | File content | US-05, US-06 |
| `POST /api/workspaces/:id/tasks` | Create file/folder | US-08, US-09 |
| `PATCH /api/workspaces/:id/tasks` | Rename, status change | US-07, US-10 |
| `PATCH /api/workspaces/:id/tasks/content` | Save file content | US-06 |
| `DELETE /api/workspaces/:id/tasks` | Delete file/folder | US-11 |
| `POST /api/workspaces/:id/tasks/move` | Move within/across repos | US-12 |
| `POST /api/workspaces/:id/tasks/archive` | Archive/unarchive | US-13 |
| `GET/POST /api/workspaces/:id/tasks/undo-archive` | Undo archive | US-13 |
| `GET /api/comment-counts/:wsId` | Comment count badges | US-14 |
| `GET/POST /api/comments/:wsId/:taskPath` | List/create comments | US-14, US-15 |
| `PATCH/DELETE /api/comments/:wsId/:taskPath/:uuid` | Edit/delete comments | US-15 |
| `POST /api/comments/:wsId/:taskPath/:uuid/replies` | Reply to comment | US-15 |
| `POST /api/comments/:wsId/:taskPath/:uuid/ask-ai` | AI on comment | US-15 |
| `POST /api/comments/:wsId/:taskPath/batch-resolve` | Batch resolve | US-16 |

---

## 11. Layout Mode Behavior (added in v2.0.0)

| Property | `classic` | `dev-workflow` |
|---|---|---|
| Component | `TasksPanel` | `RepoChatTab mode="tasks"` |
| Tab label | `Plans (Dep.)` | `Tasks (Dep.)` |
| Surface | Miller-column markdown tree (this spec) | Chat-style queue UI (see chat-tab spec) |
| Sections 2–10 of this spec apply | Yes | No (refer to chat-tab spec) |
| Deep-links | Honored — open the document in the preview pane | Best-effort — the chat UI does not understand `<encodedPath>` deep-links |

The deprecation banner ("(Dep.)" suffix) appears in the desktop tab strip and the mobile tab bar. The internal `tasks` key, URL fragment, REST endpoints, and WebSocket events are unchanged from v1.0.0.

---

## Revision History

| Version | Date | Summary |
|---|---|---|
| 1.0.0 | 2026-03-25 | Initial specification |
| 2.0.0 | 2026-05-29 | Marked tab as deprecated (`(Dep.)` label suffix); documented dual rendering — classic mode keeps the `TasksPanel` Miller-column tree, dev-workflow mode renders `RepoChatTab` in `mode="tasks"`. Recommended new work move to Work Items + Notes |
