# CoC Skill Management — Plan & UX Specification

## Problem Statement

The VS Code extension supports installing Agent Skills from two sources:
- **Bundled skills** (3 built-in: `pipeline-generator`, `skill-for-skills`, `go-deep`)
- **GitHub URL** (any public/authenticated GitHub path)

The CoC (Copilot of Copilot) web dashboard and CLI have no way to manage skills at all. This plan adds full skill management to the CoC web UI and CLI, including both install sources.

---

## 1. User Story

> As a developer using the CoC dashboard or CLI (outside VS Code), I want to install Agent Skills into my workspace's `.github/skills/` directory — either from the curated built-in set or from any GitHub URL — so that AI pipelines and chat sessions can invoke specialized skill prompts.

---

## 2. Architecture Overview

### 2a. Shared Logic → `pipeline-core`

The VS Code extension's skill logic (`src/shortcuts/skills/`) has VS Code imports only in one file (`bundled-skills-provider.ts` uses `vscode.ExtensionContext` to locate the extension path). Everything else is pure Node.js.

**New package**: `packages/pipeline-core/src/skills/`

Extract and adapt:
- `types.ts` — move as-is (no VS Code deps)
- `source-detector.ts` — move as-is (pure string/path logic)
- `skill-installer.ts` — move as-is (uses `fs`, `https`, child_process for `gh` CLI)
- `bundled-skills-provider.ts` — rewrite without VS Code context; source path = `path.join(__dirname, '../../resources/bundled-skills')` (bundled skills copied to pipeline-core package resources)

**Bundled skills** (the 3 skill directories from `resources/bundled-skills/`) must be copied/symlinked into `packages/pipeline-core/resources/bundled-skills/` so the CLI can access them at runtime.

### 2b. Server API → `coc-server`

New route group: `/api/workspaces/:id/skills/`

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/workspaces/:id/skills` | List installed skills (scan `.github/skills/`) |
| `GET` | `/api/workspaces/:id/skills/bundled` | List bundled skills with `alreadyExists` flag |
| `POST` | `/api/workspaces/:id/skills/scan` | Scan a GitHub URL; returns discovered skills |
| `POST` | `/api/workspaces/:id/skills/install` | Install selected skills from a source |
| `DELETE` | `/api/workspaces/:id/skills/:name` | Delete an installed skill |

### 2c. SPA UI → new `RepoSkillsTab`

New sub-tab `skills` added to `SUB_TABS` in `RepoDetail.tsx`.

### 2d. CLI → `coc skills` subcommand

New `skills` command group under the `coc` CLI.

---

## 3. Entry Points & User Experience

### 3a. Web Dashboard — Primary Entry Point

**Location**: `#repos/:id/skills` — a new "Skills" sub-tab in the repo detail panel (placed between "Tasks" and "Queue" in the tab strip).

**Initial state — Skills tab opens:**
```
┌─────────────────────────────────────────────────────┐
│  Skills                              [+ Install]     │
│─────────────────────────────────────────────────────│
│  Installed (2)                                       │
│  ┌──────────────────────────────────────────────┐   │
│  │ 📄 go-deep                              [🗑] │   │
│  │    Advanced research via multi-phase agents  │   │
│  ├──────────────────────────────────────────────┤   │
│  │ 📄 pipeline-generator                   [🗑] │   │
│  │    Generate YAML pipelines from natural lang │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  No skills? Click [+ Install] to get started.        │
└─────────────────────────────────────────────────────┘
```

**[+ Install] opens an Install Skills dialog/sheet:**
```
┌─────────────────────────────────────────┐
│  Install Skills                     [×] │
│─────────────────────────────────────────│
│  Source                                 │
│  ○ Built-in skills                      │
│  ● GitHub URL                           │
│                                         │
│  [Built-in tab selected]                │
│  ┌────────────────────────────────────┐ │
│  │ ☑ pipeline-generator  (installed) │ │
│  │   Generate YAML pipelines…        │ │
│  ├────────────────────────────────────┤ │
│  │ ☑ skill-for-skills                │ │
│  │   Create Agent Skills…            │ │
│  ├────────────────────────────────────┤ │
│  │ ☑ go-deep             (installed) │ │
│  │   Advanced research…              │ │
│  └────────────────────────────────────┘ │
│                                         │
│  [Cancel]              [Install (2)]    │
└─────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────┐
│  Install Skills                     [×] │
│─────────────────────────────────────────│
│  Source                                 │
│  ○ Built-in skills                      │
│  ● GitHub URL                           │
│                                         │
│  GitHub URL                             │
│  [https://github.com/owner/repo/... ] ← input
│                                  [Scan] │
│                                         │
│  ── After scan ──                       │
│  ☑ my-skill-1   Some description       │
│  ☑ my-skill-2   Another skill          │
│                                         │
│  [Cancel]              [Install (2)]    │
└─────────────────────────────────────────┘
```

### 3b. Web Dashboard — User Flow

1. User navigates to a repo → clicks "Skills" sub-tab
2. System lists installed skills (reads `.github/skills/` via API)
3. User clicks **[+ Install]** button → Install dialog opens
4. **Source: Built-in** (default):
   - Dialog shows all 3 bundled skills with checkboxes; already-installed ones are checked + labeled "(installed)"
   - User selects desired skills → clicks **[Install]**
   - System installs; toast: "2 skills installed successfully"
5. **Source: GitHub URL**:
   - User pastes a GitHub URL (repo root or subdirectory)
   - Clicks **[Scan]** → system calls `/scan` API → spinner
   - Skills list populates with checkboxes (all pre-checked)
   - User adjusts selection → clicks **[Install]**
   - Per-skill progress shown (optional); toast on completion
6. **Conflict handling**: If a skill already exists, a small inline badge "(will replace)" appears next to its checkbox. No separate dialog — replace is implicit when the skill is selected.
7. **Delete**: Trash icon on each installed skill row → confirm inline ("Delete `go-deep`? [Yes] [No]") → removed

### 3c. CLI — Secondary Entry Point

```
coc skills list [--workspace <path>]
coc skills install-bundled [<name>...] [--workspace <path>] [--replace]
coc skills install <github-url> [--workspace <path>] [--replace] [--select <name,...>]
coc skills delete <name> [--workspace <path>]
```

**`coc skills list`** (default: cwd):
```
Installed skills in .github/skills/

  go-deep           Advanced research via multi-phase agents
  pipeline-generator  Generate YAML pipeline configurations

2 skill(s) installed.
```

**`coc skills install-bundled`** (no args = interactive):
```
? Select bundled skills to install (Space to toggle, Enter to confirm)
❯ ◉  pipeline-generator   Generate YAML pipelines…
  ◯  skill-for-skills     Create Agent Skills…
  ◉  go-deep              Advanced research…

✔ Installed: go-deep
✔ Installed: pipeline-generator
  Skipped:   skill-for-skills (already exists, use --replace to overwrite)
```

**`coc skills install <url>`**:
```
Scanning https://github.com/acme/skills/tree/main/skills…
Found 3 skills: my-skill-1, my-skill-2, my-skill-3

? Select skills to install (all pre-selected)
❯ ◉  my-skill-1   ...
  ◉  my-skill-2   ...
  ◉  my-skill-3   ...

✔ Installed: my-skill-1, my-skill-2, my-skill-3
```

---

## 4. Edge Cases & Error Handling

| Scenario | Behavior |
|----------|----------|
| GitHub URL is not a valid GitHub path | Inline error below URL input: "Invalid GitHub URL. Expected: `https://github.com/owner/repo/tree/branch/path`" |
| GitHub API rate limit (no `gh` CLI auth) | Error toast: "GitHub rate limit reached. Install the `gh` CLI and run `gh auth login` for authenticated access." |
| No skills found at scanned URL | Dialog shows: "No skills found at this path. Skills are directories containing a `SKILL.md` file." |
| Network failure during install | Toast: "Failed to install `<name>`: \<error>". Other skills in batch still installed. |
| `.github/skills/` doesn't exist | Server creates it automatically on first install. |
| Workspace not registered | CLI: "Workspace not found. Register it first with `coc serve`." |
| Skill name collision with replace=false | Label badge "(already installed)" on checkbox; if user keeps it checked, implicit replace (web) or skip with warning (CLI without `--replace`) |
| Delete non-existent skill | 404 from API; toast: "Skill not found." |

---

## 5. Visual Design Considerations (Web Dashboard)

- **Tab badge**: No numeric badge needed on the Skills tab (unlike Queue/Chat which show counts)
- **Skill card**: Two-line layout — bold skill name + description; trash icon appears on hover
- **Install dialog**: Modal sheet (same pattern as `AddRepoDialog.tsx` / `AddPipelineDialog.tsx`)
- **Scan state**: Inline spinner next to the Scan button; URL input disabled during scan
- **Progress during install**: Indeterminate progress bar at the bottom of the dialog; per-skill status revealed after completion
- **Empty state**: Friendly empty state with a single CTA button (matches other tabs in the SPA)
- **Already-installed badge**: Muted gray pill "(installed)" next to skill name in Built-in tab

---

## 6. Settings & Configuration

- **Install path**: defaults to `.github/skills` relative to workspace root. Configurable via workspace preferences (reuse the existing preferences API in coc-server).
- **Replace on conflict**: default `false` (skip); explicit opt-in via UI checkbox or `--replace` CLI flag

---

## 7. Discoverability

- The "Skills" tab appears in the repo tab strip — visible to all users who browse a repo
- CLI: `coc --help` will list `skills` as a command group; `coc skills --help` lists subcommands
- Empty-state copy in the tab includes a short explanation: "Skills are AI prompt modules stored in `.github/skills/`. They extend Copilot's capabilities for specific tasks."

---

## 8. Implementation Todos

1. **Extract skill logic to pipeline-core**
   - Copy `types.ts`, `source-detector.ts`, `skill-installer.ts` (pure Node)
   - Rewrite `bundled-skills-provider.ts` for non-VS Code context
   - Copy bundled skill assets to `packages/pipeline-core/resources/bundled-skills/`

2. **Add skill API endpoints to coc-server**
   - New `skill-handler.ts` in `packages/coc-server/src/`
   - Register routes in `api-handler.ts`

3. **Add `RepoSkillsTab` to SPA**
   - New file: `packages/coc/.../react/repos/RepoSkillsTab.tsx`
   - Update `RepoDetail.tsx` SUB_TABS array + tab switch render
   - Add `RepoSubTab` type update (`types/dashboard.ts`)

4. **Add `coc skills` CLI command group**
   - New `packages/coc/src/commands/skills.ts`
   - Register in `packages/coc/src/cli.ts`

5. **Tests**
   - Unit tests for pipeline-core skill logic (Vitest)
   - API handler tests for skill endpoints
   - CLI command smoke tests
