# Repository Workflows Tab — UI/UX Specification

**Document type:** Formal UX Specification  
**Scope:** CoC Dashboard → Repository Detail → Workflows Tab  
**Purpose:** Authoritative reference for validating any future UI/UX changes to the Workflows tab.  
**Version:** 1.0.0

---

## 1. Overview

The **Repository Workflows Tab** provides an interface for managing YAML-based AI workflows and commit templates. It features a fixed-width left sidebar with collapsible Workflows and Templates sections, and a right detail pane for viewing, editing, running, and creating workflows and templates. Workflows can be generated and refined by AI, and templates support commit replication.

### 1.1 Tab Identity

| Property | Value |
|---|---|
| Tab label | `Workflows` |
| Tab position | Seventh tab in `RepoDetail` |
| Default tab | No |
| URL fragment | `#repos/<workspaceId>/workflows` |
| Deep-link URL | `#repos/<workspaceId>/workflows/<workflowName>` |

---

## 2. User Personas

| Persona | Description | Primary Goal |
|---|---|---|
| **Workflow author** | Engineers creating and maintaining AI workflows | Create, edit, and test YAML workflows |
| **Operator** | Users running workflows and reviewing results | Run workflows, view run history, inspect DAG |
| **Template user** | Engineers replicating commit patterns | Create commit templates, replicate changes |

---

## 3. User Stories

### 3.1 Workflow Management

**US-01 — Browse workflows**
> As a workflow author, I want to see all workflows in my repository.

- **Given** the Workflows tab is open
- **When** workflows exist under `.vscode/workflows/`
- **Then** the Workflows section lists all workflows with View buttons

---

**US-02 — View workflow detail**
> As an operator, I want to view a workflow's YAML and DAG visualization.

- **Given** a workflow is selected
- **When** the Workflow tab is active in the detail pane
- **Then** the YAML content is displayed in a `<pre>` block alongside a `WorkflowDAGPreview` visualization

---

**US-03 — Edit a workflow**
> As a workflow author, I want to edit a workflow's YAML.

- **Given** a workflow is selected
- **When** the user clicks Edit
- **Then** a textarea editor appears with the YAML content; Cancel discards changes; Save calls `PATCH .../workflows/:name/content`

---

**US-04 — Edit a workflow with AI**
> As a workflow author, I want AI to help refine my workflow.

- **Given** a workflow is selected in edit mode
- **When** the user clicks "Edit with AI"
- **Then** a `WorkflowAIRefinePanel` sidebar opens; the user provides an instruction; `POST .../workflows/refine` returns refined YAML

---

**US-05 — Run a workflow**
> As an operator, I want to run a workflow.

- **Given** a workflow is selected
- **When** the user clicks Run
- **Then** `POST .../workflows/:name/run` enqueues the workflow for execution

---

**US-06 — View run history**
> As an operator, I want to see past runs of a workflow.

- **Given** a workflow is selected
- **When** the Run History tab is active
- **Then** a `WorkflowRunHistory` list shows past runs with a badge for active tasks
- **When** the user selects a run
- **Then** a `WorkflowDetailView` shows the DAG execution detail for that process

---

**US-07 — Create a workflow**
> As a workflow author, I want to create a new workflow.

- **Given** the Workflows section is visible
- **When** the user clicks "+ New"
- **Then** an `AddWorkflowDialog` opens with template options: custom, data-fanout, model-fanout, and AI-generated
- **When** the user selects AI-generated
- **Then** a description input generates YAML via `POST .../workflows/generate`; the user can preview before saving

---

**US-08 — Delete a workflow**
> As a workflow author, I want to delete a workflow I no longer need.

- **Given** a workflow is selected
- **When** the user clicks Delete and confirms
- **Then** `DELETE .../workflows/:name` removes the workflow

---

### 3.2 Template Management

**US-09 — Browse templates**
> As a template user, I want to see all commit templates.

- **Given** the Workflows tab is open
- **When** templates exist
- **Then** the Templates section lists templates with click-to-select and context menu

---

**US-10 — Create a commit template**
> As a template user, I want to create a template from a commit.

- **Given** the Templates section is visible
- **When** the user clicks "+ New"
- **Then** a `CreateTemplateForm` appears with fields: name (kebab-case), kind (commit), commit hash (validated on blur), description, and hints
- **When** the user submits
- **Then** `POST .../templates` creates the template

---

**US-11 — View template detail**
> As a template user, I want to see a template's details.

- **Given** a template is selected
- **When** the detail pane shows the template
- **Then** it displays the commit hash (copyable), description, hints, changed files table, and relative timestamps

---

**US-12 — Replicate a template**
> As a template user, I want to replicate a commit pattern to a new context.

- **Given** a template is selected
- **When** the user clicks Replicate
- **Then** a `ReplicateDialog` opens with instruction (required) and optional model fields
- **When** the user submits
- **Then** `POST .../templates/:name/replicate` initiates the replication

---

**US-13 — Edit a template**
> As a template user, I want to update a template's description and hints.

- **Given** a template is selected
- **When** the user clicks Edit
- **Then** the `CreateTemplateForm` appears in edit mode (name disabled); only description and hints are editable
- **When** the user saves
- **Then** `PATCH .../templates/:name` updates the template

---

**US-14 — Delete a template**
> As a template user, I want to delete a template.

- **Given** a template is selected
- **When** the user selects Delete from the context menu and confirms
- **Then** `DELETE .../templates/:name` removes the template

---

## 4. Feature Inventory & Acceptance Criteria

### 4.1 Left Sidebar

| Feature | Acceptance Criteria |
|---|---|
| Workflows section | Collapsible header with count; "+ New" button; list items with View action |
| Templates section | Collapsible header with count; "+ New" button; list items with click-to-select |
| Template context menu | Replicate, Edit, Delete; Shift+right-click opens native menu |
| Empty workflows | Emoji + "No workflows found" + hint about `.vscode/workflows/` |
| Empty templates | "No templates yet" |
| Template count footer | Shows count when templates exist |

### 4.2 Right Pane — Workflow Detail

| Feature | Acceptance Criteria |
|---|---|
| View mode tabs | Workflow (YAML + DAG preview), Run History (with badge), Run Detail (when selected) |
| Edit mode | Textarea YAML editor; Cancel/Save buttons |
| AI refine | Sidebar panel; instruction input; refined YAML preview |
| Action buttons | Run, Close, Edit, Edit with AI, Delete (with confirmation dialog) |

### 4.3 Right Pane — Template Detail

| Feature | Acceptance Criteria |
|---|---|
| Detail view | Commit hash (copyable), description, hints, changed files table, timestamps |
| Action buttons | Replicate, Edit, Delete |
| Replicate dialog | Instruction (required), optional model; POST on submit |
| Edit form | Name disabled; description and hints editable |

### 4.4 Layout

| Feature | Acceptance Criteria |
|---|---|
| Sidebar width | Fixed `w-72` |
| Right pane | Fills remaining width; shows workflow detail, template detail, create form, or empty state |
| Empty state | "Select a workflow or template" when nothing selected |

---

## 5. Behavioral Invariants

| ID | Invariant |
|---|---|
| INV-01 | Selecting a workflow clears the template selection and vice versa |
| INV-02 | Template names must be kebab-case; validation is enforced on create |
| INV-03 | Commit hash is validated on blur via `GET .../git/commits/:hash` |
| INV-04 | Template edit mode does not allow changing the name |
| INV-05 | `templates-changed` window events (from WebSocket) trigger a template list refetch |
| INV-06 | Workflow selection updates the URL hash; template selection does not include template ID in hash |
| INV-07 | AI-generated workflows require a preview step before saving |

---

## 6. UI Layout Specification

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Repo Name]   Activity │ Git │ … │ Workflows* │ Schedules │ …     │
├──────────────┬──────────────────────────────────────────────────────┤
│              │                                                      │
│  WORKFLOWS   │  my-workflow                                        │
│  [+ New]     │  ─────────────────────────────────────              │
│  ┌──────────┐│  [Workflow*] [Run History (2)] [Run Detail]         │
│  │ my-wf [→]││                                                      │
│  │ data-fan…││  name: my-workflow                                  │
│  └──────────┘│  steps:                                             │
│              │    - name: analyze                                   │
│  TEMPLATES   │      prompt: "Analyze the codebase"                 │
│  [+ New]     │    - name: report                                   │
│  ┌──────────┐│      prompt: "Generate report"                      │
│  │ fix-patt…││      depends_on: [analyze]                          │
│  │ refactor…││                                                      │
│  └──────────┘│  [DAG Preview]                                      │
│  2 templates │                                                      │
│              │  [Run] [Edit] [Edit with AI] [Delete]               │
└──────────────┴──────────────────────────────────────────────────────┘
```

---

## 7. Error Handling Specification

| Error Scenario | Expected Behavior |
|---|---|
| Workflow list fetch failure | Empty list displayed |
| Template list fetch failure | Empty list (silent catch) |
| Workflow save failure | Toast notification with error |
| Workflow run failure | Toast notification with error |
| Workflow delete failure | Toast notification with error |
| Template create/edit failure | Inline validation errors or submit error |
| Template delete failure | Error in confirm dialog |
| Commit hash validation failure | Inline error on hash input |
| AI generation failure | Error shown in dialog |
| AI refine failure | Error shown in refine panel |

---

## 8. Empty State Specification

| State | Display |
|---|---|
| No workflows | Emoji + "No workflows found" + hint |
| No templates | "No templates yet" |
| No selection | "Select a workflow or template" in right pane |
| Loading | Spinner in right pane |

---

## 9. API Dependencies

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/workspaces/:id/workflows` | Workflow list | US-01 |
| `GET /api/workspaces/:id/workflows/:name/content` | Workflow detail | US-02 |
| `PATCH /api/workspaces/:id/workflows/:name/content` | Save workflow | US-03 |
| `POST /api/workspaces/:id/workflows/refine` | AI refine | US-04 |
| `POST /api/workspaces/:id/workflows/:name/run` | Run workflow | US-05 |
| `DELETE /api/workspaces/:id/workflows/:name` | Delete workflow | US-08 |
| `POST /api/workspaces/:id/workflows` | Create workflow | US-07 |
| `POST /api/workspaces/:id/workflows/generate` | AI generate | US-07 |
| `GET /api/workspaces/:id/templates` | Template list | US-09 |
| `POST /api/workspaces/:id/templates` | Create template | US-10 |
| `GET /api/workspaces/:id/templates/:name` | Template detail | US-11 |
| `POST /api/workspaces/:id/templates/:name/replicate` | Replicate | US-12 |
| `PATCH /api/workspaces/:id/templates/:name` | Edit template | US-13 |
| `DELETE /api/workspaces/:id/templates/:name` | Delete template | US-14 |
| `GET /api/workspaces/:id/git/commits/:hash` | Commit hash validation | US-10 |

---

## Revision History

| Version | Date | Summary |
|---|---|---|
| 1.0.0 | 2026-03-25 | Initial specification |
