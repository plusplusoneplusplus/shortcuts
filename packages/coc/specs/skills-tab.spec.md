# Skills Tab — UI/UX Specification

**Document type:** Formal UX Specification  
**Scope:** CoC Dashboard → Skills (embedded in Admin Shell · Knowledge Group)  
**Purpose:** Authoritative reference for validating any future UI/UX changes to the Skills tab.  
**Version:** 2.0.0

---

## 1. Overview

The **Skills route** manages global AI agent skills. It is reached at the top-level URL `#skills` but is rendered embedded inside the Admin shell's left sidebar **Knowledge** group — `SkillsView` is mounted in the right pane while the admin sidebar stays visible.

The view exposes three sub-tabs in a left rail:

- **Installed** — list, expand, toggle, and uninstall installed global skills
- **Gallery** — install skills from Built-in / GitHub URL / ClawHub / Local Path (formerly named "Bundled"; the legacy `#skills/bundled` URL is back-compat redirected to `#skills/gallery`)
- **Config** — configure the global skills directory and globally disabled skills

Skills installed here live under `~/.coc/skills/` and are available globally across all repositories. At server startup they are also mirrored for Codex (`~/.codex/skills`) and Claude (`~/.claude/commands/<name>.md`) when the corresponding `codex.enabled` / `claude.enabled` flags are true; the mirroring is invisible to the SPA.

### 1.1 Tab Identity

| Property | Value |
|---|---|
| Route label | `Skills` |
| Sidebar group | `Knowledge` (inside `AdminPanel`) |
| Default tab | No |
| URL fragment | `#skills` |
| Deep-link URL | `#skills/<subTab>` where `<subTab>` ∈ `installed` (default), `gallery`, `config` |
| Back-compat | `#skills/bundled` → redirects to `#skills/gallery` (see `Router.tsx`) |
| Embedded view | `SkillsView` (`features/skills/SkillsView.tsx`) |
| Panel root id | `view-skills` |

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
- **When** skills are loaded via `skills.listGlobal()`
- **Then** a list shows each skill via `SkillListItem` with name, optional version badge, description, expand chevron, enable toggle, and delete button
- **And** the panel header shows "<n> global skill(s) installed" plus a refresh button (`skills-installed-refresh-btn`)

---

**US-02 — View skill detail**
> As an AI operator, I want to see the full body of an installed skill.

- **Given** a skill is listed
- **When** the user clicks the expand chevron
- **Then** `skills.detailGlobal(name)` (`GET /api/skills/<name>`) fetches details; the expanded `SkillListItem` shows the resolved skill (`detail`) with references, scripts, and prompt body
- **And** clicking the chevron again collapses and clears the detail state

---

**US-03 — Toggle skill enabled state**
> As an administrator, I want to enable or disable a skill globally.

- **Given** a skill is listed
- **When** the user toggles the enable switch
- **Then** the panel updates `globalDisabledSkills` locally (add/remove) and calls `skills.updateGlobalConfig({ globalDisabledSkills })` (`PUT /api/skills/config`)
- **And** save failures are silently swallowed (no toast)

---

**US-04 — Uninstall a skill**
> As an administrator, I want to remove an installed skill.

- **Given** a skill is listed
- **When** the user clicks Delete and confirms (`SkillListItem` two-step)
- **Then** `skills.deleteGlobal(name)` (`DELETE /api/skills/<name>`) removes the skill; on success the local list and any expanded detail state for that skill are cleared

---

### 3.2 Gallery Sub-Tab

**US-05 — Install built-in skills**
> As an AI operator, I want to install skills from the bundled collection.

- **Given** the Gallery sub-tab is active with **Built-in Skills** selected
- **When** bundled skills load via `skills.listBundledGlobal()`
- **Then** rows show name, optional description, an `installed` badge when `alreadyExists`, and a checkbox; the header shows "<n> skill(s) available" + **Install All**
- **When** the user clicks **Install All**
- **Then** `skills.installGlobal({ source: 'bundled', replace: true })` installs all bundled skills and the list reloads
- **When** the user selects checkboxes and clicks **Install Selected (N)**
- **Then** `skills.installGlobal({ source: 'bundled', skills: names, replace: true })` installs only the selected skills and the list reloads

---

**US-06 — Install from GitHub URL**
> As a skill author, I want to install skills from a GitHub repository.

- **Given** the Gallery sub-tab is active with **GitHub URL** selected
- **When** the user enters `https://github.com/user/repo` and clicks **Scan**
- **Then** `skills.scanGlobal({ url })` returns `{ success, skills[], error? }`
- **And** when `success`, "Found <n> skill(s):" is shown plus an **Install All** button which calls `skills.installGlobal({ url, skillsToInstall, replace: true })`
- **And** when `success === false`, the error string (or "Scan failed") is rendered in red

---

**US-07 — Install from ClawHub**
> As an AI operator, I want to install skills from a ClawHub URL.

- **Given** the Gallery sub-tab is active with **ClawHub** selected
- **When** the user enters `clawhub.ai/owner/skill-name` and clicks **Scan**
- **Then** the same scan/install flow as GitHub is used (`skills.scanGlobal` → `skills.installGlobal`)

---

**US-08 — Install from local path**
> As a skill author, I want to install skills from a local directory.

- **Given** the Gallery sub-tab is active with **Local Path** selected
- **When** the user enters `/path/to/skills` (or `./my-skill`) and clicks **Scan**
- **Then** the same scan/install flow as GitHub is used; the input placeholder reflects the local-path format

---

### 3.3 Config Sub-Tab

**US-09 — View global skills directory**
> As an administrator, I want to see where global skills are stored on disk.

- **Given** the Config sub-tab is active
- **When** config is loaded via `skills.getGlobalConfig()`
- **Then** the global skills directory is shown in a monospace read-only field; falls back to `~/.coc/skills/` when the server response has no `globalSkillsDir`

---

**US-10 — Manage globally disabled skills**
> As an administrator, I want to disable specific skills globally.

- **Given** the Config sub-tab is active
- **Then** disabled skill names appear as red chips with `✕` to re-enable
- **When** the user types a skill name and clicks **Disable** (or presses Enter)
- **Then** `skills.updateGlobalConfig({ globalDisabledSkills: [...current, name] })` persists the change
- **When** the user clicks `✕` on a chip
- **Then** `skills.updateGlobalConfig({ globalDisabledSkills: <without name> })` persists the change
- **And** an inline note explains: "Per-repo disabled skills are managed in each repo's Copilot settings"

---

## 4. Feature Inventory & Acceptance Criteria

### 4.1 Layout

| Feature | Acceptance Criteria |
|---|---|
| Embedded shell | `SkillsView` renders inside the Admin shell's right pane (Knowledge group) |
| Panel root | `id="view-skills"` |
| Left rail | Fixed `w-36`, vertical sub-tab buttons (Installed / Gallery / Config), border-left active indicator (`border-[#0078d4]`) |
| Right content | `flex-1 min-w-0 overflow-auto` |
| FeatureTip | `tipId="skills-intro"` (mounted in `SkillsView`) |
| Sub-tab attribute | `data-subtab="<id>"` for each tab button |

### 4.2 Installed Sub-Tab

| Feature | Acceptance Criteria |
|---|---|
| Skill list | One `SkillListItem` per skill with name, optional version badge, description, expand chevron, enable toggle, Delete (two-step) |
| Expand detail | Single-skill expansion (toggle); calls `skills.detailGlobal(name)` |
| Toggle enable | Updates `globalDisabledSkills` via `skills.updateGlobalConfig` |
| Delete | Two-step `SkillListItem` confirmation; success removes from list + clears detail if expanded |
| Refresh | `skills-installed-refresh-btn` reloads both `listGlobal` and `getGlobalConfig` |
| Empty state | "No global skills installed. Install from the **Bundled** tab or from a GitHub URL." (`data-testid="skills-installed-empty"`) |

### 4.3 Gallery Sub-Tab

| Feature | Acceptance Criteria |
|---|---|
| Source toggle | 4 buttons: Built-in Skills, GitHub URL, ClawHub, Local Path; active source uses `bg-[#0078d4]` |
| Built-in list | Checkboxes, "installed" badge, Install All, Install Selected (N) |
| Remote/local | URL input + Scan; on success: "Found <n> skill(s):" + Install All |
| Scan error | `scanResult.error` or "Scan failed" |
| Install errors | Silently caught |
| Refresh | `skills-gallery-refresh-btn` reloads bundled list |
| Item testid | `skills-bundled-item-<name>` |

### 4.4 Config Sub-Tab

| Feature | Acceptance Criteria |
|---|---|
| Skills directory | Read-only monospace; fallback `~/.coc/skills/` |
| Disabled chips | Red chips with `✕` to remove |
| Add disabled | Input + Disable button; Enter key also adds; deduped against current list |
| Save | `skills.updateGlobalConfig` on every add/remove (no batch) |
| Note | "Per-repo disabled skills are managed in each repo's Copilot settings" |

### 4.5 Server-Side Mirroring (background, no UI surface)

| Feature | Acceptance Criteria |
|---|---|
| Codex mirror | `syncInstalledSkillsToCodex` runs once at server startup when `codex.enabled === true`; copies `~/.coc/skills/*` to `~/.codex/skills` |
| Claude mirror | `syncInstalledSkillsToClaude` runs once at server startup when `claude.enabled === true`; copies each skill's `SKILL.md` to `~/.claude/commands/<name>.md` with sidecar `.coc-<name>.json` marker |
| User skills | Both mirrors leave non-CoC user skills untouched (sidecar marker distinguishes CoC-managed) |

---

## 5. Behavioral Invariants

| ID | Invariant |
|---|---|
| INV-01 | The Skills route renders inside `AdminPanel`'s right pane; the admin sidebar (Configure / Knowledge / Connections / Operations / Developer) remains mounted |
| INV-02 | Sub-tab values are `installed` \| `gallery` \| `config`. The legacy `bundled` value is back-compat redirected to `gallery` in `Router.tsx` |
| INV-03 | The Skills tab manages global skills only; per-repo skills are managed in the repo Settings → Skills section |
| INV-04 | Skill install with `replace: true` overwrites existing skills of the same name |
| INV-05 | Fetch failures for skill list and config are silently caught (no toast) |
| INV-06 | Each disabled-skill chip removal or addition immediately triggers a `skills.updateGlobalConfig` PUT |
| INV-07 | The `installed` badge on bundled skills reflects the live `alreadyExists` flag from the server |
| INV-08 | Codex / Claude skill mirroring runs once at server startup, not per-install; the SPA does not surface any sync UI |
| INV-09 | The Skills tab is lazy-loaded inside `AdminPanel` (`SkillsView` is a `lazy()` import) |

---

## 6. UI Layout Specification

```
┌── AdminPanel (admin-redesign) ────────────────────────────────────────┐
│ ┌──────────────┐  ┌──────────────────────────────────────────────────┐│
│ │ Configure    │  │ SkillsView (id="view-skills")                    ││
│ │ Knowledge    │  │ ┌────────┐ ┌──────────────────────────────────┐ ││
│ │  ◈ Memory    │  │ │Installed│ │ Installed Skills                 │ ││
│ │  ⚡ Skills*  │  │ │Gallery  │ │ ────────────────────────────     │ ││
│ │ Connections  │  │ │Config   │ │ ┌────────────────────────────┐  │ ││
│ │ Operations   │  │ └────────┘ │ │ code-review v1.2 [▼] [🔘]   │  │ ││
│ │ Developer    │  │            │ │ Review code…    [Delete]    │  │ ││
│ └──────────────┘  └──────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────┘
```

---

## 7. Error Handling Specification

| Error Scenario | Expected Behavior |
|---|---|
| Skill list fetch failure | Silent (empty list / loading text resolves to empty) |
| Skill config fetch failure | Silent |
| Skill detail fetch failure | Silent (detail panel stays empty) |
| Skill delete failure | Silent (item remains in list) |
| Scan failure | `scanResult.error` or "Scan failed" red text |
| Install failure | Silent (no error UI) |
| Config save failure | Silent (no explicit error UI) |

---

## 8. Empty State Specification

| State | Display |
|---|---|
| No installed skills | "No global skills installed. Install from the **Bundled** tab or from a GitHub URL." (`data-testid="skills-installed-empty"`) |
| No bundled skills | Empty list under "<n> skill(s) available" |
| Scan returns no skills | Result area is empty (no Install All button) |
| No disabled skills | "No globally disabled skills." text; input remains available |
| Loading | "Loading global skills…", "Loading gallery…", or "Loading config…" |

---

## 9. API Dependencies

All routes are rooted at `/api/skills/*` and surfaced through `getSpaCocClient().skills.*`.

| Endpoint / Client method | Used by | Critical for |
|---|---|---|
| `skills.listGlobal()` (`GET /api/skills`) | Installed list | US-01 |
| `skills.getGlobalConfig()` (`GET /api/skills/config`) | Config tab + installed enable state | US-03, US-09, US-10 |
| `skills.detailGlobal(name)` (`GET /api/skills/<name>`) | Skill detail expand | US-02 |
| `skills.deleteGlobal(name)` (`DELETE /api/skills/<name>`) | Uninstall | US-04 |
| `skills.updateGlobalConfig({ globalDisabledSkills })` (`PUT /api/skills/config`) | Toggle / disable | US-03, US-10 |
| `skills.listBundledGlobal()` (`GET /api/skills/bundled`) | Built-in gallery list | US-05 |
| `skills.scanGlobal({ url })` (`POST /api/skills/scan`) | Scan remote/local | US-06, US-07, US-08 |
| `skills.installGlobal({ source\|url, skills\|skillsToInstall, replace })` (`POST /api/skills/install`) | Install | US-05, US-06, US-07, US-08 |

---

## Revision History

| Version | Date | Summary |
|---|---|---|
| 1.0.0 | 2026-03-25 | Initial specification (top-level Skills tab; sub-tabs Installed / Bundled / Config) |
| 2.0.0 | 2026-05-29 | Embedded inside Admin shell's Knowledge group; sub-tab `bundled` renamed to `gallery` (with back-compat redirect from `#skills/bundled`); 4-source Gallery toggle (Built-in / GitHub / ClawHub / Local Path); documented Codex/Claude server-side skill mirroring as background context. |
