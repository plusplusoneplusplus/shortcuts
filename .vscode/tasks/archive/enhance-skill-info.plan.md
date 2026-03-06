# Enhance Agent Skills Information Display

## Problem

The Agent Skills section in the CoC dashboard (Copilot tab) currently shows only two fields per skill: **name** and **description**. This is insufficient for users to understand what a skill does in depth — its structure, inputs/outputs, version, prompt content, references, and scripts. The SKILL.md files and their directories contain much richer metadata that is never surfaced.

## Current State

From the screenshot, each skill card renders:
- 📄 icon + **name** (bold)
- **description** (single line, truncated)
- Delete button (trash icon)

The underlying data model already has more fields available:
- `version` — from SKILL.md frontmatter
- `variables` — input variables the skill expects
- `output` — output fields the skill produces
- `absolutePath` / `relativePath` — location on disk
- `sourceFolder` — base skills directory
- SKILL.md body content (the actual prompt instructions)
- `references/` subdirectory (sub-prompts, supporting docs)
- `scripts/` subdirectory (helper scripts)

## Proposed Approach

Add an expandable detail panel or a detail modal when users click on a skill card, showing the full skill metadata and content. Keep the current card list as the summary view.

## Acceptance Criteria

1. **Skill detail view** — Clicking a skill card opens an expanded/detail view showing:
   - Name, description (already shown)
   - Version (if present in frontmatter)
   - Variables / inputs (if declared)
   - Output fields (if declared)
   - Source location (relative path to skill directory)
2. **Prompt content preview** — The detail view shows the SKILL.md body content (the actual prompt) rendered as markdown or in a code block.
3. **References listing** — If the skill has a `references/` directory, list the reference files with their names. Optionally show content on click.
4. **Scripts listing** — If the skill has a `scripts/` directory, list the script files.
5. **Non-breaking** — The existing card list view remains as the default; detail is accessed via interaction (click/expand).
6. **API enrichment** — The skills API endpoint returns the additional metadata (version, variables, output, prompt body, file listings for references/scripts).
7. **Tests** — Server-side handler tests and UI component tests cover the new data flow.

## Subtasks

### 1. Enrich the skills API response
- **File:** `packages/coc-server/src/skill-handler.ts`
- Modify the GET `/api/workspaces/:id/skills` handler to return enriched skill data:
  - Parse full SKILL.md frontmatter (version, variables, output)
  - Include the SKILL.md body content (prompt text)
  - List files in `references/` and `scripts/` subdirectories
- Update or extend the skill types in `packages/pipeline-core/src/skills/types.ts` if needed

### 2. Add a skill detail API endpoint (optional)
- **File:** `packages/coc-server/src/skill-handler.ts`
- Add `GET /api/workspaces/:id/skills/:name` to return full detail for a single skill
- This avoids loading all prompt bodies in the list endpoint (performance)

### 3. Update the dashboard UI — expandable skill cards
- **File:** `packages/coc/src/server/spa/client/react/repos/RepoCopilotTab.tsx` (or extract a new `SkillCard` component)
- Add click-to-expand or click-to-open-modal behavior on each skill card
- Render the detail view with:
  - Metadata badges/chips (version, variable count, output fields)
  - Prompt body in a scrollable, syntax-highlighted or markdown-rendered block
  - References list with file names
  - Scripts list with file names
- Keep the collapsed card showing name + description as today

### 4. Add tests
- Server handler tests for enriched API response
- UI component tests for the detail view rendering

## Notes

- The `agentskills.io` specification defines the canonical SKILL.md format; we should align with it.
- Some skills have extensive prompt bodies (e.g., `impl`, `go-deep`); the detail view should handle long content gracefully (scrollable area, max-height).
- Consider lazy-loading prompt content only when the detail view is opened to keep the list endpoint fast.
- Bundled skills (served from `bundled` endpoint) should also support the enriched view.
- The VS Code extension's skills tree view (`src/shortcuts/skills/`) is out of scope for this task.

## Key Files

| File | Role |
|------|------|
| `packages/pipeline-core/src/skills/types.ts` | Skill type definitions |
| `packages/pipeline-core/src/skills/skill-scanner.ts` | Skill discovery & parsing |
| `packages/pipeline-core/src/pipeline/skill-resolver.ts` | Skill resolution & metadata |
| `packages/coc-server/src/skill-handler.ts` | API endpoints for skills |
| `packages/coc/src/server/spa/client/react/repos/RepoCopilotTab.tsx` | Dashboard UI |
| `.github/skills/*/SKILL.md` | Skill definitions |
