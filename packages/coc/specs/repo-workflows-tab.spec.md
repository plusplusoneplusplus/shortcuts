# Repository Workflows Tab — UI/UX Specification

**Document type:** Formal UX Specification  
**Scope:** CoC Dashboard → Repository Detail → Workflows Tab  
**Purpose:** Authoritative reference for validating any future UI/UX changes to the Workflows tab.  
**Version:** 2.0.0

---

## 1. Overview

The **Repository Workflows Tab** is a unified two-panel surface for managing all reusable, automation-related artifacts in a repository:

1. **Workflows** — YAML-based AI workflows under `.vscode/workflows/` (run via the workflow engine).
2. **Templates** — commit replication templates (capture a commit + hints, replicate via AI).
3. **AI Chat Templates** — saved (model, mode, skills) presets used by the AI chat dialog.
4. **Prompt & Script Templates** — saved scripts/commands used by the Prompt & Script dialog.

A fixed-width left sidebar contains four collapsible sections (one per artifact kind, each with its own count and `+ New`/refresh actions). The right pane shows a contextual detail or editor view for the currently selected item, or an empty-state hint.

The tab keeps the legacy `Workflows` label and `#repos/<workspaceId>/workflows` URL, but its underlying React component is `TemplatesTab` (in `packages/coc/src/server/spa/client/react/features/templates/TemplatesTab.tsx`) — a single component drives all four sections.

### 1.1 Tab Identity

| Property | Value |
|---|---|
| Tab label | `Workflows` |
| Tab position | Configurable; appears in `RepoDetail`'s tab bar when `workflowsEnabled` is true |
| Default tab | No |
| Keyboard shortcut | `Alt+W` |
| Canonical URL fragment | `#repos/<workspaceId>/workflows` |
| Workflow deep-link | `#repos/<workspaceId>/workflows/<workflowName>` |
| Workflow run deep-link | `#repos/<workspaceId>/workflows/<workflowName>/run/<processId>` |
| AI chat template deep-link | `#repos/<workspaceId>/workflows/chat-template/<templateId>` |
| Script template deep-link | `#repos/<workspaceId>/workflows/script-template/<templateId>` |
| Implementing component | `TemplatesTab` (`features/templates/TemplatesTab.tsx`) |
| Workflow detail subcomponent | `WorkflowDetail` (`features/workflow/WorkflowDetail.tsx`) |
| Feature flag | `workflowsEnabled` (`useWorkflowsEnabled` hook) — when disabled, the tab is hidden and any `#…/workflows` deep-link is redirected away |

### 1.2 Legacy URL Redirects

The router (`layout/Router.tsx`) preserves backward compatibility:

| Legacy hash | Redirected to |
|---|---|
| `#repos/<id>/templates` | `#repos/<id>/workflows` |
| `#repos/<id>/templates/<name>` | `#repos/<id>/workflows/<name>` |
| `#repos/<id>/templates/chat-template/<id>` | `#repos/<id>/workflows/chat-template/<id>` |
| `#repos/<id>/settings/run-script-template` | `#repos/<id>/workflows` |

`location.replace` is used so legacy URLs do not pollute browser history.

---

## 2. User Personas

| Persona | Description | Primary Goal |
|---|---|---|
| **Workflow author** | Engineers creating and maintaining AI workflows | Create, edit, and test YAML workflows; generate/refine via AI |
| **Operator** | Users running workflows and reviewing results | Run workflows, view run history, inspect DAG, drill into a single run |
| **Template user** | Engineers replicating commit patterns | Create commit templates, replicate changes against new instructions |
| **AI chat user** | Engineers reusing AI chat presets | Pick a saved (model, mode, skills) preset for a one-shot AI chat |
| **Script user** | Engineers running canned scripts/prompts | Maintain saved script + args + working dir; enqueue them as run-script tasks |

---

## 3. User Stories

### 3.1 Workflow Management

**US-01 — Browse workflows**
> As a workflow author, I want to see all workflows in my repository.

- **Given** the Workflows tab is open
- **When** workflows exist under `.vscode/workflows/`
- **Then** the Workflows section lists all workflows with a `View` button each, an emoji prefix, and a highlight for the active selection

---

**US-02 — View workflow detail**
> As an operator, I want to view a workflow's YAML and DAG visualization.

- **Given** a workflow is selected
- **When** the Workflow tab is active in the detail pane
- **Then** the YAML content is displayed in a `<pre>` block alongside a `WorkflowDAGPreview` visualization
- **And** if the workflow is invalid, a `⚠️ Invalid` badge and an expandable "Validation errors" `<details>` block appear; if valid, a `✅ Valid` badge

---

**US-03 — Edit a workflow**
> As a workflow author, I want to edit a workflow's YAML.

- **Given** a workflow is selected
- **When** the user clicks Edit
- **Then** the tab bar disappears, a `<textarea>` editor replaces the YAML preview, and Cancel/Save buttons appear; Cancel discards changes; Save calls `PATCH .../workflows/:name/content` and returns to view mode
- **And** an empty Save is rejected inline ("Workflow content cannot be empty")

---

**US-04 — Edit a workflow with AI**
> As a workflow author, I want AI to help refine my workflow.

- **Given** a workflow is selected in view mode
- **When** the user clicks "Edit with AI ✨"
- **Then** a 400px `WorkflowAIRefinePanel` sidebar opens on the right of the YAML view
- **And** the user provides an instruction; `POST .../workflows/refine` returns refined YAML the user can preview and apply
- **When** the user applies the refined YAML
- **Then** it is saved via `PATCH .../workflows/:name/content` and the editor view updates in place

---

**US-05 — Run a workflow**
> As an operator, I want to run a workflow.

- **Given** a workflow is selected and is valid
- **When** the user clicks `▶ Run`
- **Then** `POST .../workflows/:name/run` enqueues the workflow; a toast confirms with the queued task id (first 8 chars)
- **And** the Run History tab badge increments to reflect active tasks for this workflow

Invalid workflows have the Run button disabled with the tooltip "Fix validation errors before running".

---

**US-06 — View run history**
> As an operator, I want to see past runs of a workflow.

- **Given** a workflow is selected
- **When** the Run History tab is active
- **Then** a `WorkflowRunHistory` list shows past runs; the tab label carries a green badge with the count of running/queued tasks for this workflow (derived from `repoQueueMap`)
- **When** the user selects a run
- **Then** a third `Run Detail` tab appears and is automatically activated; the right pane shows `WorkflowDetailView` for the selected `processId`
- **And** the URL hash updates to `#repos/<id>/workflows/<name>/run/<processId>`

---

**US-07 — Create a workflow**
> As a workflow author, I want to create a new workflow.

- **Given** the Workflows section is visible
- **When** the user clicks "+ New" on the Workflows section header
- **Then** an `AddWorkflowDialog` opens with template options: custom, data-fanout, model-fanout, and AI-generated
- **When** the user selects AI-generated
- **Then** a description input generates YAML via `POST .../workflows/generate`; the user can preview before saving
- **When** the workflow is created
- **Then** it is auto-selected and the URL hash updates to `#repos/<id>/workflows/<name>`

---

**US-08 — Delete a workflow**
> As a workflow author, I want to delete a workflow I no longer need.

- **Given** a workflow is selected in view mode
- **When** the user clicks Delete and confirms in the modal
- **Then** `DELETE .../workflows/:name` removes the workflow; the selection is cleared and the URL returns to `#repos/<id>/workflows`

---

### 3.2 Template Management (commit replication)

**US-09 — Browse templates**
> As a template user, I want to see all commit templates.

- **Given** the Workflows tab is open
- **When** templates exist
- **Then** the Templates section lists templates with click-to-select and a context menu (Replicate…, Edit, Delete)

---

**US-10 — Create a commit template**
> As a template user, I want to create a template from a commit.

- **Given** the Templates section is visible
- **When** the user clicks "+ New" on the Templates section header
- **Then** a `CreateTemplateForm` appears with fields: name (kebab-case, ≤64 chars), kind (locked to `commit`), commit hash (validated on blur), description, and hints (one per line)
- **When** the user submits with a valid name and a validated commit hash
- **Then** `POST .../templates` creates the template and the right pane closes the form

---

**US-11 — View template detail**
> As a template user, I want to see a template's details.

- **Given** a template is selected
- **When** the detail pane shows the template
- **Then** it displays: kind badge, commit hash with a Copy button, description, hints, a Changed Files table (path + status + ±additions/deletions, color-coded by status), and a relative-time footer ("Created … · Updated …")

---

**US-12 — Replicate a template**
> As a template user, I want to replicate a commit pattern to a new context.

- **Given** a template is selected
- **When** the user clicks `Replicate…`
- **Then** a `ReplicateDialog` opens with an instruction textarea (required, autoFocus) and an optional model field
- **When** the user submits
- **Then** `POST .../templates/:name/replicate` initiates the replication and the dialog closes

---

**US-13 — Edit a template**
> As a template user, I want to update a template's description and hints.

- **Given** a template is selected (via context menu Edit, or detail-view Edit button)
- **When** the user clicks Edit
- **Then** the `CreateTemplateForm` appears in edit mode (name, kind, and commit hash are read-only); only description and hints are editable
- **When** the user saves
- **Then** `PATCH .../templates/:name` updates the template

---

**US-14 — Delete a template**
> As a template user, I want to delete a template.

- **Given** a template is selected
- **When** the user selects Delete from the context menu, or clicks Delete in the detail view, and confirms via `confirm("Delete template …")`
- **Then** `DELETE .../templates/:name` removes the template; if it was selected, the right pane reverts to the empty state

---

### 3.3 AI Chat Templates

**US-15 — Browse AI chat templates**
> As an AI chat user, I want to see my saved chat presets.

- **Given** the Workflows tab is open
- **When** the AI Chat Templates section is expanded
- **Then** each saved template renders with its display name (or generated id), a mode chip (`ask` / `task`), and the model id (or `default`)

---

**US-16 — View an AI chat template**
> As an AI chat user, I want to see a preset's full configuration.

- **Given** a chat template is selected
- **When** the right pane is active
- **Then** `SkillTemplateDetailView` shows: copyable id, mode chip, model name, and the list of attached skills as chips

---

**US-17 — Delete an AI chat template**
> As an AI chat user, I want to remove a preset I no longer use.

- **Given** a chat template is selected
- **When** the user clicks Delete (header button) or chooses Delete from the row's context menu and confirms
- **Then** the template is removed from `skillTemplates` and persisted via per-repo (or global) preferences (`PATCH /api/workspaces/:id/preferences` or `PATCH /api/preferences`); if it was selected, the right pane reverts to the empty state

> Creation of AI chat templates happens elsewhere (the AI chat dialog's "Save as template" action). The Workflows tab does not expose a `+ New` button for this section.

---

### 3.4 Prompt & Script Templates

**US-18 — Browse script templates**
> As a script user, I want to see my saved script templates.

- **Given** the Workflows tab is open
- **When** the Prompt & Script Templates section is expanded
- **Then** each template renders with: 📜 emoji, name, scriptPath (mono), optional args (mono), optional model chip, and an optional `pause on failure` chip

---

**US-19 — View a script template**
> As a script user, I want to inspect a script template.

- **Given** a script template is selected
- **When** the right pane is active
- **Then** `ScriptTemplateDetailView` shows: name, script/command, args, working directory, model, and pause-on-failure badge

---

**US-20 — Edit a script template**
> As a script user, I want to update fields of a script template.

- **Given** a script template is selected
- **When** the user clicks ✏ Edit
- **Then** the detail view becomes editable (name, script path, args, working directory, model, pause-on-failure checkbox)
- **When** the user clicks 💾 Save
- **Then** `updateScriptTemplate` persists changes via per-repo (or global) preferences and the view returns to read-only mode

---

**US-21 — Enqueue a script template**
> As a script user, I want to run a saved script.

- **Given** a script template is selected
- **When** the user clicks `▶ Enqueue`
- **Then** the SPA calls `getSpaCocClient().queue.enqueue({ type: 'run-script', displayName, payload, config, repoId })`, refreshes the queue, and shows a toast "Enqueued \"<name>\""

---

**US-22 — Delete a script template**
> As a script user, I want to remove a script template.

- **Given** a script template is selected
- **When** the user clicks Delete (header or context menu) and confirms via `confirm("Delete this prompt & script template?")`
- **Then** the template is removed and persisted; if it was selected, the right pane reverts to the empty state

> Creation of script templates happens elsewhere (the Prompt & Script dialog's save action). The Workflows tab does not expose a `+ New` button for this section.

---

## 4. Feature Inventory & Acceptance Criteria

### 4.1 Left Sidebar (`w-72`, four collapsible sections)

| Feature | Acceptance Criteria |
|---|---|
| Section header | Chevron (`▾`/`▸`), label, count in parentheses, optional action buttons (refresh / + New) |
| Workflows section | Refresh ↻ button; `+ New` opens `AddWorkflowDialog`; list of workflow rows with View action; emoji-based empty state |
| Templates section | Refresh ↻ button; `+ New` opens `CreateTemplateForm` in right pane; list of `TemplateListItem`s; spinner while loading; emoji-based empty state |
| AI Chat Templates section | No `+ New` button; list of `SkillTemplateListItem`s with mode chip + model; spinner while loading; emoji-based empty state |
| Prompt & Script Templates section | No `+ New` button; list of `ScriptTemplateListItem`s with model + pause-on-failure chips; spinner while loading; emoji-based empty state |
| Selection highlight | Selected row gets a left border (`border-l-2 border-l-[#0078d4]`) and a tinted background |
| Context menu | Right-click on a row opens a portal-rendered menu; Shift+right-click opens the OS native menu; menu auto-closes on document click |
| Single-selection invariant | Selecting any item in any section clears all other section selections (workflows, templates, skill templates, script templates are mutually exclusive) |

### 4.2 Right Pane — Workflow Detail

| Feature | Acceptance Criteria |
|---|---|
| Header | Workflow name, file path (mono), validity badge (✅ Valid / ⚠️ Invalid), action buttons |
| View-mode tabs | `Workflow` (YAML + DAG preview), `Run History` (with active task badge), `Run Detail` (only when a run is selected; auto-activated) |
| Edit mode | Tab bar hidden; full-height textarea YAML editor; Cancel/Save buttons replace the action row |
| AI refine sidebar | 400px right-side panel; instruction input, refined YAML preview, apply button; opened by `Edit with AI ✨` toggle |
| Action buttons (view) | `▶ Run` (loading state, disabled if invalid), `Close`, `Edit`, `Edit with AI ✨` (toggle), `Delete` |
| Delete confirmation | Modal `Dialog` with Cancel/Confirm; only on Confirm is the workflow deleted |
| Active task badge | Green pill on Run History tab showing count of running+queued `runWorkflow` tasks for this pipeline |

### 4.3 Right Pane — Template Detail (commit)

| Feature | Acceptance Criteria |
|---|---|
| Detail view | Name, kind chip, commit hash code block + Copy button, description, hints list, changed files table (path + status + ±additions/deletions, color-coded), relative-time footer |
| Action buttons | `Replicate…` (primary), `Edit`, `Delete` (danger) |
| Replicate dialog | Instruction (required, autoFocus), optional model id; submit posts `templates/:name/replicate`; close on success |
| Create/Edit form | Name (kebab-case validation, max 64), kind locked to `commit`, commit hash (blur-validated against `git/commits/:hash`), description, hints; in edit mode, name/kind/hash are read-only |
| Loading | Spinner while fetching detail; in-form spinner during submit |

### 4.4 Right Pane — AI Chat Template Detail

| Feature | Acceptance Criteria |
|---|---|
| Detail view | Name (or id), copyable id with `📋 Copy` / `✓ Copied` feedback, mode chip, model, skills chips |
| Action buttons | `Delete` only (creation is done in the AI chat dialog) |

### 4.5 Right Pane — Prompt & Script Template Detail

| Feature | Acceptance Criteria |
|---|---|
| Read-only view | Name, script/command, args (if present), working directory (if present), model (or `default`), pause-on-failure badge |
| Edit form | Name *, script *, args, working directory, model, pause-on-failure checkbox; trimmed values are persisted; empty optional fields are stored as `undefined` |
| Action buttons (read) | `▶ Enqueue` (primary, with `Enqueuing…` loading state), `✏ Edit`, `Delete` |
| Action buttons (edit) | `💾 Save`, `Cancel` (resets form fields to original values) |
| Enqueue toast | Success: `Enqueued "<name>"`; error: surfaces SDK error message |

### 4.6 Right Pane — Empty / Loading

| State | Display |
|---|---|
| Nothing selected | `Select a workflow or template` centered text |
| Template loading | Spinner |

### 4.7 Layout

| Feature | Acceptance Criteria |
|---|---|
| Container | `flex h-full overflow-hidden` |
| Sidebar width | Fixed `w-72`; vertically scrollable when sections overflow |
| Right pane | `flex-1 min-w-0`; overflow-y auto for detail variants |

---

## 5. Behavioral Invariants

| ID | Invariant |
|---|---|
| INV-01 | Selecting an item in any of the four sections clears the selection in the other three (single-selection across the entire tab) |
| INV-02 | Template names must match `^[a-z0-9]+(-[a-z0-9]+)*$` (kebab-case, ≤64 chars); enforced in `CreateTemplateForm` |
| INV-03 | Commit hash is validated on blur via `GET .../git/commits/:hash`; submission is blocked until validation succeeds |
| INV-04 | In template edit mode, `name`, `kind`, and `commitHash` are read-only |
| INV-05 | The `templates-changed` window event (emitted on WebSocket updates) triggers a fresh `templates.list(workspaceId)` fetch |
| INV-06 | Selecting a workflow updates the URL hash; selecting a template clears it back to `…/workflows`; selecting a chat/script template updates the URL to the corresponding deep-link form |
| INV-07 | AI-generated workflows require a preview step before saving |
| INV-08 | Run Detail tab is auto-activated whenever `selectedWorkflowRunProcessId` is non-null; clicking another tab while a run is selected clears the run process id and updates the URL |
| INV-09 | The Run button is disabled when `pipeline.isValid === false`; the tooltip explains why |
| INV-10 | AI Chat Templates and Prompt & Script Templates persist via per-repo preferences (`/api/workspaces/:id/preferences`) when a workspace id is available; otherwise via global preferences (`/api/preferences`) — failures are silently swallowed |
| INV-11 | Toggling the `Edit with AI ✨` button is mutually exclusive with edit mode (entering edit mode closes the AI sidebar) |
| INV-12 | When `workflowsEnabled` transitions from true to false (feature-flag toggle), the active tab is redirected away from `workflows` |

---

## 6. UI Layout Specification

```
┌────────────────────────────────────────────────────────────────────────────┐
│  [Repo Name]   Activity │ Git │ … │ Workflows* │ Schedules │ Settings     │
├────────────────────────┬───────────────────────────────────────────────────┤
│                        │                                                   │
│  ▾ Workflows (3)  ↻ + │  my-workflow   .vscode/workflows/my-workflow.yaml │
│  ┌──────────────────┐  │  ✅ Valid                                         │
│  │ 📋 my-wf  [View] │  │            [▶ Run] [Close] [Edit] [✨ AI] [Del] │
│  │ 📋 data-fan…     │  │  ─────────────────────────────────────────────── │
│  └──────────────────┘  │  [Workflow*] [Run History (2)] [Run Detail]      │
│                        │                                                   │
│  ▾ Templates (5)  ↻ + │  name: my-workflow                                │
│  ┌──────────────────┐  │  steps:                                           │
│  │ fix-parser       │  │    - name: analyze                                │
│  │   commit · a1b2c3│  │      prompt: "Analyze the codebase"              │
│  │ refactor-…       │  │    - name: report                                 │
│  └──────────────────┘  │      prompt: "Generate report"                   │
│                        │      depends_on: [analyze]                        │
│  ▾ AI Chat Templates  │                                                   │
│    (2)                 │  [DAG Preview]                                    │
│  ┌──────────────────┐  │                                                   │
│  │ task · sonnet-4  │  │                                                   │
│  └──────────────────┘  │                                                   │
│                        │                                                   │
│  ▾ Prompt & Script    │                                                   │
│    Templates (1)       │                                                   │
│  ┌──────────────────┐  │                                                   │
│  │ 📜 lint-all      │  │                                                   │
│  │   pnpm run lint  │  │                                                   │
│  └──────────────────┘  │                                                   │
└────────────────────────┴───────────────────────────────────────────────────┘
```

When `Edit with AI ✨` is toggled on, a 400px right-side AI sidebar is appended to the right pane, splitting the YAML/DAG view from the refine panel.

---

## 7. Error Handling Specification

| Error Scenario | Expected Behavior |
|---|---|
| Workflow list fetch failure | Empty list displayed |
| Template list fetch failure | Empty list (silent catch) |
| Preferences fetch failure (chat/script templates) | Empty section, silent failure (preferences are optional) |
| Workflow content fetch failure | Toast: `Failed to load workflow: <message>` |
| Workflow save failure | Inline error in editor (`Failed to save`); toast on AI apply failure |
| Workflow run failure | Toast: `Failed to run workflow: <message>` |
| Workflow delete failure | Toast: `Failed to delete workflow: <message>` |
| Template create/edit failure | Inline error block above form actions |
| Template delete failure | Browser `confirm` flow; failure is currently silent (caught and ignored) |
| Commit hash validation failure | Inline `✗ Commit not found or not reachable` under hash input |
| AI generation failure | Error shown in `AddWorkflowDialog` |
| AI refine failure | Error shown in `WorkflowAIRefinePanel` |
| Script template enqueue failure | Toast: `Failed to enqueue script` (or SDK-provided message) |
| Preferences persistence failure | Silent (caught) — UI optimistically updates and stays |

---

## 8. Empty State Specification

| State | Display |
|---|---|
| No workflows | `📋` + "No workflows found" + hint "Add YAML files to .vscode/workflows/ or create one below." |
| No templates | `📋` + "No templates yet" + hint "Create a template from a commit to replicate patterns" |
| No AI chat templates | `🤖` + "No AI chat templates" + hint "Save templates from the AI chat dialog" |
| No script templates | `📜` + "No prompt & script templates" + hint "Save templates from the Prompt & Script dialog" |
| No selection (right pane) | `Select a workflow or template` |
| Loading (right pane) | Spinner |

---

## 9. API Dependencies

### 9.1 Workflows (REST)

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/workspaces/:id/workflows` | Workflow list (via repo grouping) | US-01 |
| `GET /api/workspaces/:id/workflows/:name/content` | Workflow detail | US-02 |
| `PATCH /api/workspaces/:id/workflows/:name/content` | Save workflow | US-03, US-04 |
| `POST /api/workspaces/:id/workflows/refine` | AI refine | US-04 |
| `POST /api/workspaces/:id/workflows/:name/run` | Run workflow | US-05 |
| `DELETE /api/workspaces/:id/workflows/:name` | Delete workflow | US-08 |
| `POST /api/workspaces/:id/workflows` | Create workflow | US-07 |
| `POST /api/workspaces/:id/workflows/generate` | AI generate | US-07 |

### 9.2 Templates — commit (REST)

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/workspaces/:id/templates` | Template list | US-09 |
| `POST /api/workspaces/:id/templates` | Create template | US-10 |
| `GET /api/workspaces/:id/templates/:name` | Template detail | US-11 |
| `POST /api/workspaces/:id/templates/:name/replicate` | Replicate | US-12 |
| `PATCH /api/workspaces/:id/templates/:name` | Edit template | US-13 |
| `DELETE /api/workspaces/:id/templates/:name` | Delete template | US-14 |
| `GET /api/workspaces/:id/git/commits/:hash` | Commit hash validation | US-10 |

### 9.3 Preferences (chat & script templates)

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/workspaces/:id/preferences` | Load chat/script templates (per-repo) | US-15, US-18 |
| `PATCH /api/workspaces/:id/preferences` | Persist `skillTemplates` and `scriptTemplates` (per-repo) | US-17, US-20, US-22 |
| `GET /api/preferences` | Fallback when no workspace id | US-15, US-18 |
| `PATCH /api/preferences` | Fallback when no workspace id | US-17, US-20, US-22 |

### 9.4 Queue (script enqueue)

| Endpoint | Used by | Critical for |
|---|---|---|
| `POST /api/queue/enqueue` (via SDK `queue.enqueue`) | Enqueue `run-script` task from a script template | US-21 |
| `GET /api/queue` (via SDK `queue.list`) | Refresh queue after enqueue | US-21 |

---

## Revision History

| Version | Date | Summary |
|---|---|---|
| 1.0.0 | 2026-03-25 | Initial specification (workflows + commit templates only) |
| 2.0.0 | 2026-05-29 | Major rewrite: tab is now four sections (Workflows, Templates, AI Chat Templates, Prompt & Script Templates) implemented by `TemplatesTab`; documented script-template enqueue, AI sidebar, run-detail tab, deep-links for chat/script templates, legacy `/templates` redirects, validity badges, preferences-backed persistence, and feature-flag (`workflowsEnabled`) behavior |
