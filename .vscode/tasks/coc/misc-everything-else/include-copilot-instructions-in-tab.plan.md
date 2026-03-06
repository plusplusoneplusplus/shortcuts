---
status: future
---
# Include `.copilot-instructions.md` in the Copilot Tab

## Problem

The CoC SPA's **Copilot Tab** (`RepoCopilotTab.tsx`) currently shows two sections:
- MCP Servers (toggle integrations)
- Agent Skills (`.github/skills/`)

If a workspace has a `.github/copilot-instructions.md` file, it is not surfaced anywhere in the UI. Users have no way to view or verify the active copilot instructions from the dashboard.

## Proposed Approach

Add a third collapsible section to `RepoCopilotTab` that reads and displays the content of `.github/copilot-instructions.md` (if present). The file is fetched via a new lightweight backend API endpoint; if the file is absent the section is hidden.

---

## Acceptance Criteria

- [ ] When `.github/copilot-instructions.md` exists in the workspace root, a **"Copilot Instructions"** section is visible in the Copilot Tab.
- [ ] The section renders the markdown content of the file (read-only).
- [ ] When the file is absent, the section is **not** rendered (no empty state / no error).
- [ ] A new backend route `GET /api/workspaces/:id/copilot-instructions` returns `{ content: string }` when the file exists, or `404` when it does not.
- [ ] The section is **collapsible** (consistent with existing MCP Servers and Agent Skills panels).
- [ ] No changes are required to the file itself — the tab is read-only.

---

## Subtasks

### 1. Backend – API endpoint (`coc-server`)
- **File:** `packages/coc-server/src/skill-handler.ts` (or a new `copilot-tab-handler.ts`)
- Add route `GET /api/workspaces/:id/copilot-instructions`
  - Resolve path: `path.join(ws.rootPath, '.github', 'copilot-instructions.md')`
  - If file exists: respond `200` with `{ content: <utf-8 string> }`
  - If file missing: respond `404`
- Register the route in `packages/coc-server/src/index.ts` (or wherever routes are registered).

### 2. Frontend – data fetching (`RepoCopilotTab.tsx`)
- **File:** `packages/coc/src/server/spa/client/react/repos/RepoCopilotTab.tsx`
- Add a `useEffect` that fetches `GET /api/workspaces/:id/copilot-instructions` on mount.
- Store result in local state: `copilotInstructions: string | null`.
- On `404` or error, leave state as `null`.

### 3. Frontend – render the section (`RepoCopilotTab.tsx`)
- Below the Agent Skills panel, conditionally render a **"Copilot Instructions"** collapsible panel when `copilotInstructions !== null`.
- Render the markdown content using the existing `ReactMarkdown` component (already used elsewhere in the SPA) or a `<pre>` block if markdown rendering is not needed.
- Keep styling consistent with other panels (use existing CSS classes / components).

### 4. Tests
- **Backend unit test** (`packages/coc-server/src/`): mock `fs.readFile` / `existsSync`, verify `200` with content and `404` when missing.
- **Frontend snapshot/unit test** (if test infra exists): verify section renders when content provided, hidden when `null`.

---

## Notes

- The conventional location is `.github/copilot-instructions.md` (VS Code Copilot standard). Some repos may use `.github/agents/copilot-instructions.md` — out of scope for now; can be a follow-up.
- File is displayed **read-only**. Editing is out of scope.
- If the file is large, consider truncating at ~10 KB in the API response and showing a "view full file" link.
- Existing skill-handler pattern (`packages/coc-server/src/skill-handler.ts`) is the best reference for how to add a workspace-scoped route.
