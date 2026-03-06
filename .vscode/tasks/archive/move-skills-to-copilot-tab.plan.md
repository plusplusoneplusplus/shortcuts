# Plan: Move Skills Tab into the Copilot Tab (COC Web Dashboard)

## Problem

In the COC web dashboard, the **Skills** tab and the **Copilot** tab are both sibling sub-tabs inside `RepoDetail`. They are separate tabs, making the connection between skills (AI prompt modules) and Copilot (MCP server config) non-obvious. The request is to merge the Skills content into the Copilot tab so users manage all Copilot-related configuration in one place.

## Current State

- **`RepoDetail.tsx`** — defines 10 sub-tabs: `info, git, pipelines, tasks, skills, queue, schedules, chat, wiki, copilot`
- **`RepoSkillsTab.tsx`** — standalone component; API endpoints: `GET/DELETE /workspaces/{id}/skills`, `GET /workspaces/{id}/skills/bundled`, `POST /workspaces/{id}/skills/scan`, `POST /workspaces/{id}/skills/install`
- **`RepoCopilotTab.tsx`** — standalone component; API endpoints: `GET/PUT /workspaces/{workspaceId}/mcp-config`

All files live under `packages/coc/src/server/spa/client/react/repos/`.

## Approach

1. Extend `RepoCopilotTab` to include the skills section below the existing MCP servers section (or use an internal sub-section with a heading).
2. Remove the standalone `skills` entry from the `SUB_TABS` array in `RepoDetail.tsx` and remove the `RepoSkillsTab` import and its render branch.
3. Keep `RepoSkillsTab.tsx` intact (or inline its JSX into `RepoCopilotTab`) — prefer inlining to avoid a dead file.

## Key Facts

- `RepoSkillsTab` accepts `{ workspaceId: string }` — the same prop `RepoCopilotTab` already receives.
- No backend API changes are needed; all endpoints remain the same.
- The `SUB_TABS` constant in `RepoDetail.tsx` drives both desktop tab headers and the mobile `MobileTabBar`.

## Out of Scope

- Changes to any backend API handlers.
- Changes to the `RepoSkillsTab.tsx` API logic itself if it is kept as a helper component.
- Any VS Code extension changes.

---

## Todos

### 1. `copilot-tab-add-skills` — Embed skills UI in `RepoCopilotTab`

**File:** `packages/coc/src/server/spa/client/react/repos/RepoCopilotTab.tsx`

- Copy (or import) the full skills section from `RepoSkillsTab.tsx` into `RepoCopilotTab`.
- Add a visual separator/heading (e.g. `<h3>Agent Skills</h3>`) between the MCP servers section and the skills section.
- Ensure all state, handlers, and API calls from `RepoSkillsTab` are present in the merged component.

---

### 2. `repo-detail-remove-skills-tab` — Remove standalone Skills tab from `RepoDetail`

**File:** `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx`

- Remove `'skills'` from the `SUB_TABS` array.
- Remove the `import RepoSkillsTab` statement.
- Remove the render branch that returns `<RepoSkillsTab ... />`.

---

### 3. `delete-skills-tab-file` — Delete (or deprecate) `RepoSkillsTab.tsx`

**File:** `packages/coc/src/server/spa/client/react/repos/RepoSkillsTab.tsx`

- If skills logic was inlined into `RepoCopilotTab`, delete this file.
- If it is kept as a sub-component imported by `RepoCopilotTab`, update the export to reflect its new role as an internal helper.

---

### 4. `skills-in-copilot-tab-tests` — Update/add tests

Update or add Vitest tests (look for existing test files under `packages/coc/src/`) to cover:
- The merged `RepoCopilotTab` renders the skills section.
- The skills install/delete interactions work correctly within the merged tab.
- `RepoDetail` no longer renders a standalone `skills` tab.

---

## Dependency Order

```
copilot-tab-add-skills  →  repo-detail-remove-skills-tab  →  delete-skills-tab-file  →  skills-in-copilot-tab-tests
```

## Notes

- The mobile tab bar (`MobileTabBar.tsx`) may also reference the `skills` tab label — check and update if needed.
- Confirm that no other component imports `RepoSkillsTab` before deleting the file.
- Keep the Copilot tab's MCP section at the top; skills section below it.
