---
status: future
---
# New Chat Landing Page — UX Redesign Spec

## User Story

**As a** developer using the CoC dashboard to interact with a repository,
**I want** the "new chat" screen to surface useful starting points — templates, skills, recent prompts, and quick actions —
**so that** I can start productive conversations faster instead of staring at a blank textarea.

---

## Current State

The new chat screen is minimal:
- Title: "Chat with this repository"
- A 3-row textarea with placeholder "Ask anything about this repository…"
- Image paste support
- A "Start Chat" button

**Problem:** No guidance, no discoverability, no shortcuts. Users must already know what to ask.

---

## Proposed Design

The redesigned landing page transforms the blank canvas into a **launchpad** with four zones:

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│              💬  Chat with this repository               │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Ask anything about this repository…         📎 🖼 │  │
│  │                                                   │  │
│  │                                        Start Chat │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ── Quick Actions ─────────────────────────────────── ▾ │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │🔍 Explain│ │📝 Review │ │🐛 Find   │ │📊 Analyze│   │
│  │  Code   │ │  Changes │ │   Bugs   │ │  Deps    │   │
│  └─────────┘ └──────────┘ └──────────┘ └──────────┘   │
│                                                         │
│  ── Skills ────────────────────────────── See All ▸    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │⚡ impl    │ │🔬 go-deep│ │📐 draft  │ │🔧 pipe-  │  │
│  │Implement │ │Deep      │ │UX Spec   │ │ line-gen │  │
│  │& test    │ │Research  │ │Draft     │ │Generator │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
│                                                         │
│  ── Templates ─────────────────────────── See All ▸    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │🐛 Bug    │ │✅ Code   │ │📖 Doc    │ │🔎 Multi- │  │
│  │ Triage   │ │ Review   │ │Generator │ │Agent     │  │
│  │Pipeline  │ │Checklist │ │Pipeline  │ │Research  │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
│                                                         │
│  ── Prompts ──────────────────────────── See All ▸    │
│  ┌──────────────────────────────────────────────────┐  │
│  │  📄 draft-ux.prompt.md                           │  │
│  │  📄 impl.prompt.md                               │  │
│  │  📄 fix-github-workflow.prompt.md                │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Zone 1: Input Area (Enhanced)

**What it is:** The existing textarea, enhanced with inline affordances.

### Changes from current:
- **Larger input area** — 4 rows minimum, auto-grows
- **Attachment row** below the textarea showing image previews + an "Attach" button (📎)
- **Model selector** — small dropdown or pill showing current model, click to change
- **Keyboard hint** — subtle text: `Enter to send · Shift+Enter for new line`
- **Start Chat button** stays, but is also a split-button with dropdown: "Start Chat" | "Start with Skill ▾"

### "Start with Skill" dropdown
When the user has typed a prompt and clicks the dropdown arrow on Start Chat:
- Shows a list of available skills (fetched from `GET /api/workspaces/:id/skills`)
- Selecting a skill tags the chat task with `skill: <name>`, which prepends the skill's system prompt
- The selected skill appears as a pill/badge above the textarea: `Using: impl ✕`

---

## Zone 2: Quick Actions

**What it is:** A horizontal row of 4–6 action chips for the most common repo-level questions.

### Hardcoded quick actions:
| Action | Pre-filled prompt |
|--------|------------------|
| 🔍 Explain Code | "Explain the architecture and key components of this repository" |
| 📝 Review Changes | "Review the recent git changes and suggest improvements" |
| 🐛 Find Bugs | "Analyze this codebase for potential bugs and code smells" |
| 📊 Analyze Dependencies | "Analyze the dependency graph and identify outdated or risky packages" |
| 🧪 Test Coverage | "Identify areas with insufficient test coverage and suggest tests" |
| 📖 Generate Docs | "Generate documentation for the key modules and APIs" |

### Behavior:
- Clicking a chip **fills the textarea** with the pre-filled prompt and focuses it
- User can edit the prompt before sending, or just hit Enter
- Show only first 4 by default; overflow into a "+2 more" chip that expands
- Quick actions are stored in preferences so users can pin/reorder (future enhancement)

---

## Zone 3: Skills

**What it is:** Cards for each available skill from `.github/skills/`.

### Data source:
- `GET /api/workspaces/:id/skills` — returns skill name, description, and path

### Card design:
```
┌──────────────┐
│ ⚡ impl       │  ← Icon + name (bold)
│              │
│ Implement &  │  ← First line of description (truncated)
│ test code    │
│              │
│ [Use] [Info] │  ← Action buttons
└──────────────┘
```

### Behavior:
- **[Use]** — Sets the skill as active for the next chat (shows pill above textarea), focuses textarea
- **[Info]** — Opens a modal/panel showing the full SKILL.md content rendered as markdown
- If no skills are found, this section is hidden
- "See All ▸" link opens a full skill browser modal (list view with search)

---

## Zone 4: Pipeline Templates

**What it is:** Cards for bundled + user-created pipeline templates.

### Data source:
- Bundled: `resources/bundled-pipelines/` (bug-triage, code-review-checklist, doc-generator, multi-agent-research)
- User pipelines: `GET /api/workspaces/:id/pipelines`

### Card design:
```
┌──────────────────┐
│ 🐛 Bug Triage    │  ← Icon + name
│                  │
│ Classify bugs    │  ← Description (truncated)
│ by severity      │
│                  │
│ [Run] [View]     │  ← Action buttons
└──────────────────┘
```

### Behavior:
- **[Run]** — Navigates to the Pipelines tab with this pipeline selected, ready to execute. OR opens a mini-dialog asking for input parameters (CSV path, etc.) and queues execution directly.
- **[View]** — Shows the pipeline YAML in a read-only modal with syntax highlighting
- Bundled pipelines have a "Bundled" badge; user pipelines don't
- "See All ▸" link navigates to the Pipelines tab

---

## Zone 5: Prompt Files

**What it is:** A compact list of `.prompt.md` files discovered in the workspace.

### Data source:
- `GET /api/workspaces/:id/prompts` — returns prompt file paths and metadata

### Design:
- Simple list items (not cards) — each row shows icon + filename + path hint
- Recently used prompts (from `GET /api/preferences → recentFollowPrompts`) appear first with a "Recent" badge

### Behavior:
- Clicking a prompt **reads its content and fills the textarea** with the prompt text
- User can then edit and send
- If no prompts found, this section is hidden

---

## Responsive Behavior

### Narrow viewport (< 800px):
- Cards collapse to 2-per-row grid
- Quick actions wrap to 2 rows
- Prompt list remains full-width

### Wide viewport (> 1200px):
- Up to 6 cards per row
- Quick actions in single row
- Prompt list remains full-width

---

## Empty States

| Section | Empty Condition | Display |
|---------|----------------|---------|
| Skills | No `.github/skills/` folder | Section hidden entirely |
| Templates | No pipelines found | Show only bundled templates (always available) |
| Prompts | No `.prompt.md` files | Section hidden entirely |
| Quick Actions | Always shown | N/A (hardcoded) |

---

## Data Fetching Strategy

On mount, fetch in parallel:
1. `GET /api/workspaces/:id/skills` — for Skills section
2. `GET /api/workspaces/:id/pipelines` — for Templates section
3. `GET /api/workspaces/:id/prompts` — for Prompts section
4. `GET /api/preferences` — for recent prompts, last model, etc.

Show skeleton loading cards while fetching. Each section loads independently (no waterfall).

---

## Interaction Summary

| User Action | Result |
|-------------|--------|
| Type + Enter | Start chat (same as today) |
| Click Quick Action chip | Pre-fill textarea, focus it |
| Click Skill [Use] | Set skill as active, focus textarea |
| Click Skill [Info] | Show skill details modal |
| Click Template [Run] | Navigate to pipeline execution |
| Click Template [View] | Show pipeline YAML modal |
| Click Prompt item | Fill textarea with prompt content |
| Change model dropdown | Update preference, persist |
| Paste image | Show preview in attachment row |

---

## Settings & Configuration

- **Quick actions** — hardcoded v1, configurable in v2 (stored in preferences)
- **Default model** — persisted via `PATCH /api/preferences` 
- **Recently used skills/prompts** — tracked in preferences (max 10)
- **Section collapse state** — persisted in localStorage per workspace

---

## Discoverability

1. The landing page itself IS the discoverability surface — users see skills/templates/prompts without seeking them out
2. Each card has [Info] or [View] for deeper exploration
3. "See All ▸" links encourage browsing
4. Quick actions teach by example — users learn what kinds of questions work well

---

## Future Enhancements (Out of Scope for v1)

- **Pinned chats** — Pin important conversations to the sidebar top
- **Chat templates** — User-defined reusable prompt templates (beyond .prompt.md files)
- **Skill marketplace** — Browse and install skills from a registry
- **Suggested follow-ups** — After a chat, suggest related skills/templates
- **Workspace-specific quick actions** — Auto-generate based on repo contents (e.g., if repo has Dockerfile, add "Review Docker setup" action)
- **Context attachments** — Attach specific files/folders/branches as context before starting chat
