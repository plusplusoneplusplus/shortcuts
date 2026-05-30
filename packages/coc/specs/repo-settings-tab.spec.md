# Repository Settings Tab — UI/UX Specification

**Document type:** Formal UX Specification  
**Scope:** CoC Dashboard → Repository Detail → Settings Tab  
**Purpose:** Authoritative reference for validating any future UI/UX changes to the Settings tab.  
**Version:** 2.0.0

---

## 1. Overview

The **Repository Settings Tab** provides a centralized configuration interface for a repository. The sidebar splits sections into two groups:

- **Repository** — `Info`, `Preferences`, `Plans Folder`, `Notes` (or `Sync` for virtual workspaces)
- **Agent** — `MCP Servers`, `Agent Skills`, `LLM Tools`, `Custom Instructions`, `Memory`

A client-side filter narrows the navigation list. Each section renders a header (title + description + optional save/refresh affordances) followed by the section content inside a `SectionCard`.

### 1.1 Tab Identity

| Property | Value |
|---|---|
| Tab key | `settings` |
| Tab label | `Settings` |
| Tab position | Listed after Notes; default tab for newly-opened repos |
| Default tab | Yes — `settings` is the default for a fresh repo selection |
| Keyboard shortcut | `Alt+C` |
| URL fragment | `#repos/<workspaceId>/settings` |
| Deep-link URL | `#repos/<workspaceId>/settings/<section>` |
| Implementing component | `RepoSettingsTab` (`features/repo-settings/RepoSettingsTab.tsx`) |
| Section keys | `info`, `preferences`, `mcp`, `skills`, `llm-tools`, `instructions`, `memory`, `tasks`, `notes` |
| Legacy redirect | `#repos/<id>/settings/run-script-template` → `#repos/<id>/workflows` |

---

## 2. User Personas

| Persona | Description | Primary Goal |
|---|---|---|
| **Developer** | Engineers configuring their repository | Set preferences, manage skills, configure MCP |
| **Team lead** | Managers reviewing repository configuration | Audit settings, review custom instructions |
| **AI operator** | Users tuning AI behavior per repository | Configure models, skills, memory, instructions |

---

## 3. User Stories

### 3.1 Info Section

**US-01 — View repository info**
> As a developer, I want to see my repository's metadata at a glance.

- **Given** the Settings tab is open on the Info section
- **When** the info loads
- **Then** a meta grid shows: path, tasks folder, branch + dirty state, sync (ahead/behind), remote URL, color swatch, workflow count, plan count, and completed/failed/running process stats

---

**US-02 — Edit repository description**
> As a developer, I want to add or edit a description for my repository.

- **Given** the Info section is visible
- **When** the user types in the description textarea and blurs
- **Then** `PATCH /api/workspaces/:id` saves the description

---

**US-03 — View recent processes**
> As a developer, I want to see recent AI processes for this repository.

- **Given** the Info section is visible
- **When** recent processes exist
- **Then** a list shows up to 10 processes with status icon, truncated title, and relative time

---

### 3.2 Preferences Section

**US-04 — Edit repository preferences**
> As an AI operator, I want to configure AI models, depth, effort, skills, and linked repos from the Preferences page.

- **Given** the Preferences section is selected
- **When** preferences are loaded
- **Then** editable form controls show: Task/Ask/Plan model dropdowns, depth dropdown, effort dropdown, skill pickers per mode, and linked repo tags
- **When** the user changes any field
- **Then** `PATCH /api/workspaces/:id/preferences` auto-saves the change; a footer note reads "Changes are saved automatically."

---

### 3.3 MCP Servers Section

**US-05 — Manage MCP server configuration**
> As a developer, I want to enable or disable MCP servers for this repository.

- **Given** the MCP Servers section is selected
- **When** the configuration loads
- **Then** global and workspace MCP server sources are shown as separate cards with toggle switches for effective servers
- **When** the user toggles a server
- **Then** `PUT .../mcp-config` updates the enabled set; `null` means all enabled
- **When** the user clicks Refresh
- **Then** `GET .../mcp-config?forceReload=true` reloads both MCP config files without a file watcher

---

### 3.4 Agent Skills Section

**US-06 — Manage agent skills**
> As an AI operator, I want to configure which skills are available for this repository.

- **Given** the Agent Skills section is selected
- **When** skills are loaded
- **Then** a list shows installed skills with expand/collapse, enable toggle, and delete (with confirmation)
- **Then** extra skill folders can be configured
- **Then** linked repositories (for skill sharing) can be managed

---

### 3.5 Custom Instructions Section

**US-07 — Configure custom AI instructions**
> As an AI operator, I want to set custom instructions for different AI modes.

- **Given** the Custom Instructions section is selected
- **When** instructions are loaded
- **Then** editors are available for modes: base, ask, plan, autopilot
- **When** the user saves instructions
- **Then** `PUT .../instructions/:mode` persists the content

---

### 3.6 Memory Section

**US-08 — Configure repository memory**
> As an AI operator, I want to manage memory settings for this repository.

- **Given** the Memory section is selected
- **When** the section loads
- **Then** a `RepoMemorySection` shows repository-scoped memory configuration

---

### 3.7 LLM Tools Section

**US-09 — Toggle LLM tools**
> As an AI operator, I want to enable or disable individual tools available to the agent.

- **Given** the LLM Tools section is selected
- **When** the section loads
- **Then** an `LlmToolsPanel` lists every available tool with a toggle, grouped by category
- **When** the user toggles a tool
- **Then** the change is auto-saved per workspace and survives page reloads

---

### 3.8 Plans Folder Section (`tasks`)

**US-10 — Configure plans folder**
> As a planner, I want to configure where AI-generated plans/tasks are stored for this repository.

- **Given** the Plans Folder section is selected
- **When** the section loads
- **Then** `TasksSettingsSection` shows the current tasks folder path with edit/move affordances and validation errors

---

### 3.9 Notes / Sync Section

**US-11 — Configure notes auto-commit (regular workspace)**
> As a developer, I want to configure notebook auto-commit and git settings.

- **Given** the Notes section is selected on a regular workspace
- **When** the section loads
- **Then** `NotesSettingsSection` shows auto-commit cadence, branch, and commit-message template controls

**US-12 — Configure sync (virtual workspace)**
> As a user of a virtual workspace (`my_work`, `my_life`), I want to configure cross-device sync for my notes/work-items.

- **Given** the Notes section is selected on a virtual workspace (`my_work` or `my_life`)
- **When** the section loads
- **Then** `SyncSettingsSection` is shown instead of `NotesSettingsSection` (the menu label remains "Notes" but the body covers cross-device sync)

---

## 4. Feature Inventory & Acceptance Criteria

### 4.1 Sidebar Navigation

| Feature | Acceptance Criteria |
|---|---|
| Nav groups | Two groups with labels: **Repository** (Info, Preferences, Plans Folder, Notes) and **Agent** (MCP Servers, Agent Skills, LLM Tools, Custom Instructions, Memory) |
| Search filter | Text input filters nav items client-side; non-matching items are hidden, group headers stay |
| Badges | MCP: count of enabled servers; Skills: installed count; Instructions: blue dot if any mode has content |
| Section routing | Hash updates to `#repos/<workspaceId>/settings/<section>` |
| Sidebar width | Fixed `w-52` |
| Section header | Title + description rendered above the content card; optional save/refresh affordances |
| Content surface | Each section's body is wrapped in a `SectionCard` |
| Virtual-workspace handling | `notes` section automatically swaps `NotesSettingsSection` ↔ `SyncSettingsSection` based on `isVirtualWorkspaceId(workspaceId)` |

### 4.2 Info Section

| Feature | Acceptance Criteria |
|---|---|
| Meta grid | Path, tasks folder, branch + dirty, sync, remote URL, color, workflow count, plan count, process stats |
| Description | Textarea; auto-saves on blur via PATCH |
| Recent processes | Up to 10; status icon, truncated title, relative time; loading and empty states |

### 4.3 Preferences Section

| Feature | Acceptance Criteria |
|---|---|
| Model dropdowns | Task/Ask/Plan model `<select>` populated from `/api/models` (enabled only); "default" as first option; auto-saves via `PATCH /api/workspaces/:id/preferences` with `{ lastModels: { [mode]: value } }` |
| Depth dropdown | Options: "default", "normal", "deep"; auto-saves via `{ lastDepth: value }` |
| Effort dropdown | Options: "default", "low", "medium", "high"; auto-saves via `{ lastEffort: value }` |
| Skill pickers | Task/Ask/Plan skills shown as searchable multi-select (SkillPicker); populated from `/api/workspaces/:id/skills/all`; auto-saves via `{ lastSkills: { [mode]: [...] } }` |
| Linked repos | Removable tags with "+ Add" button; dropdown to add from available workspaces; auto-saves via `{ linkedRepoIds: [...] }` |
| Empty defaults | Form shows all fields at "default" when no preferences exist |
| Loading state | Spinner while preferences and models load |
| Auto-save note | Muted footer reads "Changes are saved automatically." |
| Error handling | Linked repo save failure reverts + toast |

### 4.4 MCP Servers Section

| Feature | Acceptance Criteria |
|---|---|
| Source cards | Two stacked cards: "Global MCP servers" for `~/.copilot/mcp-config.json` and "Workspace MCP servers" for `.vscode/mcp.json` |
| Server rows | Each configured server row shows name, type, optional URL or command summary, and an enable toggle |
| Empty states | Global card shows "No global MCP servers configured."; workspace card shows "No workspace MCP servers configured in .vscode/mcp.json." |
| Override handling | Workspace servers replace global servers with the same name; overridden global rows show "Overridden by workspace" and have disabled toggles |
| Toggle behavior | `null` enabled set means all enabled; specific set means only those |
| Sidebar badge | MCP badge shows the enabled effective server count, excluding overridden global rows |
| Refresh | Refresh button force-reloads global and workspace MCP sources |
| Error handling | Overall load failure shows on panel; source-specific load errors appear in that source card without hiding valid sources; save reverts enabled list on failure |

### 4.5 Agent Skills Section

| Feature | Acceptance Criteria |
|---|---|
| Skill list | Installed skills with expand, toggle, delete |
| Expand detail | `GET .../skills/:name` shows references, scripts, prompt body |
| Delete | Confirmation (Yes/No); `DELETE .../skills/:name` |
| Extra folders | Configurable additional skill directories |
| Linked repos | Multi-repo skill linking via `PATCH .../preferences` with `linkedRepoIds` |
| Error handling | Delete shows toast + JSON error; toggles revert on failure |

### 4.6 LLM Tools Section

| Feature | Acceptance Criteria |
|---|---|
| Tool list | Every available tool is rendered as a row with name, description, and toggle |
| Persistence | Toggle state is auto-saved per workspace via `PATCH /api/workspaces/:id/preferences` (`disabledLlmTools` set) |
| Empty state | "No LLM tools available" if the catalog is empty |

### 4.7 Custom Instructions Section

| Feature | Acceptance Criteria |
|---|---|
| Mode editors | base, ask, plan, autopilot |
| Save | `PUT .../instructions/:mode` |
| Delete | `DELETE .../instructions/:mode` |
| Error handling | Toast on save/delete failure |

### 4.8 Plans Folder Section (`tasks`)

| Feature | Acceptance Criteria |
|---|---|
| Path input | Shows current tasks folder; edit triggers a Save call to `tasks/settings` |
| Validation | Inline errors for non-existent or non-writable paths |

### 4.9 Notes / Sync Section

| Feature | Acceptance Criteria |
|---|---|
| Notes settings (regular workspace) | Auto-commit cadence selector, branch input, commit-message template, save button |
| Sync settings (virtual workspace) | Replaces the notes UI with cross-device sync configuration when `workspaceId ∈ { 'my_work', 'my_life' }` |

---

## 5. Behavioral Invariants

| ID | Invariant |
|---|---|
| INV-01 | Description auto-saves on blur; there is no explicit Save button for the description |
| INV-02 | MCP server toggle with `null` means all servers are enabled (default) |
| INV-03 | Skill toggles and linked repo changes revert on API failure |
| INV-04 | Custom instructions blue dot in nav reflects whether any mode has content |
| INV-05 | The `notes` section transparently swaps to `SyncSettingsSection` when the workspace is virtual (`my_work` / `my_life`); the menu label stays "Notes" |
| INV-06 | Legacy `#repos/<id>/settings/run-script-template` deep-links are redirected to `#repos/<id>/workflows` (handled in Router); script templates no longer live in Settings |
| INV-07 | The settings sidebar is grouped (`Repository`, `Agent`); all navigation items are filterable via a search input |

---

## 6. UI Layout Specification

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Repo Name]   Activity │ Git │ … │ Settings* │ …                   │
├──────────────┬──────────────────────────────────────────────────────┤
│              │                                                      │
│  Info        │  Preferences                                        │
│  Preferences*│  ─────────────────────────────────────              │
│  MCP (3)     │                                                      │
│  Skills (5)  │  ── Models ────────────────────────                  │
│  Instructions│  Task Model   [ claude-sonnet-4  ▾ ]                │
│  Memory      │  Ask Model    [ default          ▾ ]                │
│  Scripts     │  Plan Model   [ default          ▾ ]                │
│              │                                                      │
│              │  ── Execution ─────────────────────                  │
│              │  Depth        [ normal ▾ ]                           │
│              │  Effort       [ medium ▾ ]                           │
│              │                                                      │
│              │  ── Skills ────────────────────────                  │
│              │  Task Skill   [impl ✕] [+ Add…]                     │
│              │  Ask Skill    [+ Add…]                               │
│              │  Plan Skill   [+ Add…]                               │
│              │                                                      │
│              │  ── Advanced ──────────────────────                  │
│              │  Linked Repos [ repo-b ✕ ] [+ Add]                  │
│              │                                                      │
│              │  Changes are saved automatically.                    │
└──────────────┴──────────────────────────────────────────────────────┘
```

---

## 7. Error Handling Specification

| Error Scenario | Expected Behavior |
|---|---|
| Preferences load failure | Red error text |
| MCP config load failure | Error on panel |
| MCP save failure | Reverts enabled list |
| Skill delete failure | Toast with JSON error body |
| Skill toggle failure | Reverts toggle state |
| Instructions save/delete failure | Toast notification |
| Linked repos save failure | Reverts + toast |
| Description save failure | Silent (try/finally only) |

---

## 8. Empty State Specification

| State | Display |
|---|---|
| No meaningful preferences | Form shows all fields at default values |
| No recent processes | "No processes yet" |
| No skills installed | Empty skill list |
| No custom instructions | No blue dot in nav; empty editors |
| No script templates | Empty state message |

---

## 9. API Dependencies

| Endpoint | Used by | Critical for |
|---|---|---|
| `PATCH /api/workspaces/:id` | Description save | US-02 |
| `GET /api/processes` | Recent processes | US-03 |
| `GET /api/workspaces/:id/preferences` | Preferences form, linked repos | US-04 |
| `PATCH /api/workspaces/:id/preferences` | Preferences auto-save, linked repos | US-04, US-06 |
| `GET /api/models` | Model dropdowns in preferences | US-04 |
| `GET /api/workspaces/:id/skills/all` | Skill pickers in preferences | US-04 |
| `GET/PUT /api/workspaces/:id/mcp-config` | MCP servers | US-05 |
| `GET /api/workspaces/:id/skills` | Skill list | US-06 |
| `GET /api/workspaces/:id/skills-config` | Skill config | US-06 |
| `GET /api/workspaces/:id/skills/:name` | Skill detail | US-06 |
| `DELETE /api/workspaces/:id/skills/:name` | Delete skill | US-06 |
| `PUT /api/workspaces/:id/skills-config` | Skill config update | US-06 |
| `GET /api/workspaces/:id/instructions` | Instructions list | US-07 |
| `PUT /api/workspaces/:id/instructions/:mode` | Save instructions | US-07 |
| `DELETE /api/workspaces/:id/instructions/:mode` | Delete instructions | US-07 |
| `GET /api/workspaces/:id/tasks/settings` | Tasks folder info | US-01, US-10 |
| `PATCH /api/workspaces/:id/tasks/settings` | Update tasks folder | US-10 |
| `GET /api/workspaces/:id/llm-tools` | LLM Tools catalog | US-09 |
| `PATCH /api/workspaces/:id/preferences` (disabledLlmTools) | Toggle LLM tools | US-09 |
| `GET/PATCH /api/workspaces/:id/notes/settings` | Notes auto-commit settings | US-11 |
| `GET/PATCH /api/workspaces/:id/sync/settings` | Cross-device sync settings (virtual workspaces only) | US-12 |

---

## Revision History

| Version | Date | Summary |
|---|---|---|
| 1.0.0 | 2026-03-25 | Initial specification |
| 1.1.0 | 2026-04-05 | Preferences section is now editable (models, depth, effort, skills, linked repos); removed INV-05 |
| 2.0.0 | 2026-05-29 | Sidebar is now grouped (`Repository`, `Agent`) with a client-side filter; removed `Run Script Templates` (now lives in Workflows tab — legacy URL redirects); added `LLM Tools`, `Plans Folder`, and `Notes` sections (with virtual-workspace `Sync` swap); documented `settings` as the default tab for new repos and added implementation-component reference |
