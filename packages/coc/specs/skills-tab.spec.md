# Skills Tab — UI/UX Specification

**Document type:** Formal UX Specification  
**Scope:** CoC Dashboard → Skills (Top-Level Tab)  
**Purpose:** Authoritative reference for validating any future UI/UX changes to the Skills tab.  
**Version:** 1.0.0

---

## 1. Overview

The **Skills Tab** is a top-level dashboard tab for managing global AI agent skills. It provides three sub-tabs: Installed (view, toggle, expand, delete installed skills), Bundled (install from built-in, GitHub, ClawHub, or local sources), and Config (global skills directory and disabled skills management). Skills installed here are available globally across all repositories.

### 1.1 Tab Identity

| Property | Value |
|---|---|
| Tab label | `Skills` |
| Tab position | Top-level tab |
| Default tab | No |
| URL fragment | `#skills` |
| Deep-link URL | `#skills/<subTab>` (installed, bundled, config) |

---

## 2. User Personas

| Persona | Description | Primary Goal |
|---|---|---|
| **AI operator** | Engineers configuring AI capabilities | Install, enable, and manage skills |
| **Skill author** | Developers creating custom skills | Test skills from local paths or GitHub repos |
| **Administrator** | Users managing global skill configuration | Disable skills globally, manage directories |

---

## 3. User Stories

### 3.1 Installed Sub-Tab

**US-01 — Browse installed skills**
> As an AI operator, I want to see all globally installed skills.

- **Given** the Installed sub-tab is active
- **When** skills are installed
- **Then** a list shows each skill with name, optional version badge, description, expand chevron, enable toggle, and delete button

---

**US-02 — View skill detail**
> As an AI operator, I want to see the full details of an installed skill.

- **Given** a skill is listed
- **When** the user clicks the expand chevron
- **Then** `GET /api/skills/:name` fetches the detail; a `SkillDetailPanel` shows references, scripts, and prompt body

---

**US-03 — Toggle skill enabled state**
> As an administrator, I want to enable or disable a skill globally.

- **Given** a skill is listed
- **When** the user toggles the enable switch
- **Then** `PUT /api/skills/config` updates the `globalDisabledSkills` list

---

**US-04 — Delete an installed skill**
> As an administrator, I want to remove an installed skill.

- **Given** a skill is listed
- **When** the user clicks Delete and confirms (Yes/No)
- **Then** `DELETE /api/skills/:name` removes the skill

---

### 3.2 Bundled Sub-Tab

**US-05 — Install built-in skills**
> As an AI operator, I want to install skills from the built-in collection.

- **Given** the Bundled sub-tab is active with "Built-in Skills" selected
- **When** bundled skills are loaded
- **Then** a list shows skills with checkboxes and "installed" badges; "Install All" and "Install Selected (N)" buttons are available
- **When** the user clicks Install All
- **Then** `POST /api/skills/install` with `{ source: 'bundled', replace: true }` installs all bundled skills

---

**US-06 — Install from GitHub URL**
> As a skill author, I want to install skills from a GitHub repository.

- **Given** the Bundled sub-tab is active with "GitHub URL" selected
- **When** the user enters a URL and clicks Scan
- **Then** `POST /api/skills/scan` with `{ url }` returns available skills
- **When** the user clicks "Install All"
- **Then** `POST /api/skills/install` with `{ url, skillsToInstall, replace: true }` installs the skills

---

**US-07 — Install from ClawHub**
> As an AI operator, I want to browse and install skills from ClawHub.

- **Given** the Bundled sub-tab is active with "ClawHub" selected
- **When** the user enters a ClawHub URL and scans
- **Then** available skills are listed for installation

---

**US-08 — Install from local path**
> As a skill author, I want to install skills from a local directory.

- **Given** the Bundled sub-tab is active with "Local Path" selected
- **When** the user enters a local path and clicks Scan
- **Then** `POST /api/skills/scan` with `{ url: <localPath> }` returns available skills for installation

---

### 3.3 Config Sub-Tab

**US-09 — View global skills directory**
> As an administrator, I want to see where global skills are stored.

- **Given** the Config sub-tab is active
- **When** config is loaded
- **Then** the global skills directory is displayed (from `GET /api/skills/config`, fallback `~/.coc/skills/`)

---

**US-10 — Manage globally disabled skills**
> As an administrator, I want to disable specific skills globally.

- **Given** the Config sub-tab is active
- **When** disabled skills exist
- **Then** chips are shown with ✕ to remove; an input + "Disable" button allows adding skill names
- **When** the user adds or removes a disabled skill
- **Then** `PUT /api/skills/config` updates the full `globalDisabledSkills` array

---

## 4. Feature Inventory & Acceptance Criteria

### 4.1 Installed Sub-Tab

| Feature | Acceptance Criteria |
|---|---|
| Skill list | Name, optional version badge, description, expand chevron, enable toggle, delete |
| Expand detail | `GET /api/skills/:name` → references, scripts, prompt body |
| Enable toggle | Updates `globalDisabledSkills` via `PUT /api/skills/config` |
| Delete | Confirm Yes/No; `DELETE /api/skills/:name` |
| Empty state | Pointer to Bundled tab / GitHub |

### 4.2 Bundled Sub-Tab

| Feature | Acceptance Criteria |
|---|---|
| Source modes | Built-in Skills, GitHub URL, ClawHub, Local Path |
| Built-in | Checkboxes, "installed" badge, Install All, Install Selected (N) |
| Remote/local | URL input + Scan → skill list → Install All |
| Scan errors | `scanResult.error` or "Scan failed" |
| Install errors | Silently caught |

### 4.3 Config Sub-Tab

| Feature | Acceptance Criteria |
|---|---|
| Skills directory | Read-only display; fallback `~/.coc/skills/` |
| Disabled skills | Chips with ✕; input + Disable button; `PUT /api/skills/config` on each change |
| Note | Per-repo disabled skills are in Copilot settings, not here |

### 4.4 Layout

| Feature | Acceptance Criteria |
|---|---|
| Sidebar | Fixed `w-36` with vertical sub-tab buttons |
| Main content | Fills remaining width |

---

## 5. Behavioral Invariants

| ID | Invariant |
|---|---|
| INV-01 | The Skills tab manages global skills only; per-repo skills are managed in the repo Settings tab |
| INV-02 | Skill install with `replace: true` overwrites existing skills of the same name |
| INV-03 | Fetch failures for skill list and config are silently caught |
| INV-04 | Each disabled skill chip removal or addition immediately triggers a `PUT /api/skills/config` |
| INV-05 | The "installed" badge on bundled skills reflects current installation state |

---

## 6. UI Layout Specification

```
┌─────────────────────────────────────────────────────────────────────┐
│  CoC │ Processes │ Wiki │ Memory │ Skills* │ …                      │
├──────────┬──────────────────────────────────────────────────────────┤
│          │                                                          │
│ Installed│  Installed Skills                                       │
│ Bundled  │  ─────────────────────────────────────                  │
│ Config   │                                                          │
│          │  ┌───────────────────────────────────────────────────┐  │
│          │  │ code-review  v1.2.0                               │  │
│          │  │ Review code against custom rules        [▼] [🔘] │  │
│          │  │                                          [Delete] │  │
│          │  ├───────────────────────────────────────────────────┤  │
│          │  │ deep-plan  v2.0.0                                 │  │
│          │  │ Generate detailed implementation plans   [▼] [🔘] │  │
│          │  │                                          [Delete] │  │
│          │  ├───────────────────────────────────────────────────┤  │
│          │  │ go-deep                                           │  │
│          │  │ Advanced research methodologies          [▼] [🔘] │  │
│          │  │                                          [Delete] │  │
│          │  └───────────────────────────────────────────────────┘  │
│          │                                                          │
└──────────┴──────────────────────────────────────────────────────────┘
```

---

## 7. Error Handling Specification

| Error Scenario | Expected Behavior |
|---|---|
| Skill list fetch failure | Silent (empty list) |
| Skill config fetch failure | Silent |
| Skill detail fetch failure | Silent |
| Skill delete failure | Toast with JSON error body |
| Scan failure | `scanResult.error` or "Scan failed" message |
| Install failure | Silently caught |
| Config save failure | Silent (no explicit error UI) |

---

## 8. Empty State Specification

| State | Display |
|---|---|
| No installed skills | Pointer to Bundled tab / GitHub (`data-testid="skills-installed-empty"`) |
| No bundled skills | Empty list after source selection |
| Scan returns no skills | Empty skill list after scan |
| No disabled skills | Empty chip area; input available |

---

## 9. API Dependencies

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/skills` | Installed skill list | US-01 |
| `GET /api/skills/config` | Config (disabled list, directory) | US-03, US-09, US-10 |
| `GET /api/skills/:name` | Skill detail | US-02 |
| `DELETE /api/skills/:name` | Delete skill | US-04 |
| `PUT /api/skills/config` | Toggle/disable skills | US-03, US-10 |
| `GET /api/skills/bundled` | Bundled skill list | US-05 |
| `POST /api/skills/scan` | Scan remote/local | US-06, US-07, US-08 |
| `POST /api/skills/install` | Install skills | US-05, US-06, US-07, US-08 |

---

## Revision History

| Version | Date | Summary |
|---|---|---|
| 1.0.0 | 2026-03-25 | Initial specification |
