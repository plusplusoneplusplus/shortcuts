---
status: pending
---

# 008: Add Task Panel UI to Repo Detail Page

## Summary

Add a "Tasks" section to the CoC dashboard repo detail page that renders the workspace's task folder hierarchy with expand/collapse, document groups, status badges, markdown preview on click, and a collapsible archive section — all fetched from `GET /api/workspaces/:id/tasks`.

## Motivation

The repo detail page currently shows Pipelines and Recent Processes but has no visibility into the Tasks Viewer data. Adding a task panel gives users a complete picture of project work items directly in the dashboard, without needing VS Code open. This is a self-contained UI commit that depends on the tasks API endpoint (007) already existing.

## Changes

### Files to Create

- `packages/coc/src/server/spa/client/tasks-panel.ts` — New client module containing:
  - `fetchAndRenderTasks(wsId: string)` — Fetches `GET /api/workspaces/${wsId}/tasks` via `fetchApi()`, calls render functions, attaches event listeners.
  - `renderTaskTree(folder: TaskFolderDTO, depth: number): string` — Recursively builds HTML for the folder tree. Each folder is a collapsible `<div class="task-folder">` with a toggle chevron. Document groups render as sub-items with their child documents indented. Single documents render as clickable items.
  - `renderTaskItem(doc: TaskDocumentDTO): string` — Renders a single task/document row with a status badge and clickable name.
  - `renderStatusBadge(status: string): string` — Returns a `<span class="task-status-badge task-status-{status}">` with the status label.
  - `renderTaskPreview(content: string, name: string): string` — Renders a markdown content preview area (raw text or minimal formatting).
  - Local interfaces: `TaskFolderDTO`, `TaskDocumentGroupDTO`, `TaskDocumentDTO` mirroring the API response shape (subset of `TaskFolder`/`TaskDocumentGroup`/`TaskDocument` from `src/shortcuts/tasks-viewer/types.ts`, but only the fields the API serializes: `name`, `relativePath`, `isArchived`, `children`, `documentGroups`, `singleDocuments`, `status`, `baseName`, `docType`, `fileName`).

### Files to Modify

- `packages/coc/src/server/spa/client/repos.ts` — In `showRepoDetail()`:
  - After the Pipelines `</ul>` block (line ~249) and before the "Recent Processes" `<h2>` (line ~252), insert a new section header: `<h2>` "Tasks" `</h2>` and a container `<div id="repo-tasks-panel">Loading...</div>`.
  - After wiring the edit button event listener (line ~275), add a call to `fetchAndRenderTasks(wsId)` imported from `tasks-panel.ts`.
  - Add import: `import { fetchAndRenderTasks } from './tasks-panel';`

- `packages/coc/src/server/spa/client/styles.css` — Append new CSS rules at the end (after the existing repo/path-browser styles) for task panel styling:
  - `.task-section-header` — Section header matching existing `h2` pattern (`font-size:14px; font-weight:600; text-transform:uppercase; color:var(--text-secondary); letter-spacing:0.3px`).
  - `.task-folder` — Folder container with left-border indent indicator.
  - `.task-folder-header` — Clickable row with chevron toggle (`cursor:pointer; display:flex; align-items:center; gap:6px; padding:4px 0; font-size:13px; font-weight:500`). Chevron rotates 90° on expand.
  - `.task-folder-children` — Collapsible child container (`padding-left:16px`). Hidden by default (`.collapsed .task-folder-children { display:none }`).
  - `.task-item` — Individual task/document row (`display:flex; align-items:center; gap:8px; padding:4px 8px; font-size:13px; border-radius:4px; cursor:pointer`). Hover uses `var(--hover-bg)`.
  - `.task-item.active` — Highlighted state using `var(--active-bg)`.
  - `.task-doc-group` — Group wrapper with slight indent and group icon.
  - `.task-doc-group-header` — Expandable group header row.
  - `.task-doc-group-children` — Collapsible children for document groups.
  - `.task-status-badge` — Inline badge (`display:inline-block; padding:1px 6px; border-radius:3px; font-size:11px; font-weight:500; line-height:1.4`).
  - `.task-status-pending` — `background:rgba(0,120,212,0.1); color:var(--status-running)`.
  - `.task-status-in-progress` — `background:rgba(232,145,45,0.1); color:var(--status-cancelled)` (orange tones).
  - `.task-status-done` — `background:rgba(22,130,93,0.1); color:var(--status-completed)`.
  - `.task-status-future` — `background:rgba(132,132,132,0.1); color:var(--status-queued)`.
  - `.task-preview` — Preview area (`background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:6px; padding:16px; margin-top:12px; font-size:13px; line-height:1.6; white-space:pre-wrap; max-height:400px; overflow-y:auto`).
  - `.task-preview-header` — Preview title bar with close button.
  - `.task-archive-section` — Archive collapsible section with muted styling (`opacity:0.7` when collapsed).
  - `.task-empty` — Empty state message (`color:var(--text-secondary); font-size:13px`).
  - `.task-chevron` — Chevron indicator (`transition:transform 0.15s; display:inline-block; font-size:10px`). `.expanded > .task-folder-header .task-chevron { transform:rotate(90deg) }`.

- `packages/coc/src/server/spa/client/index.ts` — Add import for the new module between the repos and websocket imports:
  ```typescript
  // 8.5. Tasks panel (repo detail sub-panel)
  import './tasks-panel';
  ```

### Files to Delete

(none)

## Implementation Notes

### Patterns to follow

- **HTML string building**: Follow the exact pattern from `repos.ts` — concatenate HTML strings, set via `innerHTML`, then attach event listeners with `addEventListener` on queried elements. No JSX, no template literals with tagged functions.
- **API calls**: Use `fetchApi()` from `core.ts` (handles base path, error to null). Never use raw `fetch()` for API calls in client modules.
- **Escaping**: Always use `escapeHtmlClient()` from `utils.ts` for any dynamic text inserted into HTML.
- **Theming**: Reuse existing CSS variables (`--bg-secondary`, `--border-color`, `--text-secondary`, `--hover-bg`, `--active-bg`, `--status-*`). Do not introduce new CSS custom properties.
- **State**: No new global state in `state.ts`. Task panel state (expanded folders, selected task) is local to `tasks-panel.ts` using module-scoped variables, matching how `repos.ts` uses `reposData` and `browserCurrentPath`.

### Key decisions

1. **Expand/collapse**: Use CSS class toggling (`.collapsed` / `.expanded` on folder divs) rather than JS show/hide, to match the sidebar's `expandedGroups` pattern. Default: root folders expanded, nested folders collapsed.
2. **Task click → preview**: Clicking a task item fetches `GET /api/workspaces/:id/tasks/:relativePath/content` (the task's markdown content) and renders it in a `task-preview` div below the tree. Only one preview visible at a time.
3. **Archive section**: Render archived folders/tasks in a separate collapsible section at the bottom, styled with reduced opacity. Collapsed by default.
4. **Document groups**: Render group header showing the base name (e.g., "task1") with a badge count of documents. Expand to show individual documents (e.g., "task1.plan.md", "task1.spec.md").
5. **Status badges**: Parse `status` field from each `TaskDocument`/`Task` object. Map to 4 colors: pending (blue), in-progress (orange), done (green), future (gray). Default to pending if missing.
6. **Error handling**: If the tasks API returns null/error, show "Tasks not available" message in the container. Do not break the rest of the repo detail page.
7. **No markdown rendering library**: Display task content as pre-formatted text with `white-space: pre-wrap`. Full markdown rendering can be added in a follow-up commit.

### Gotchas

- The `fetchAndRenderTasks()` call is async and should not block the rest of `showRepoDetail()` — call it without `await`, same pattern as `fetchRepoProcesses(wsId)`.
- Folder recursion must handle arbitrary depth but should cap visual indent at ~5 levels to prevent layout overflow.
- Archive items may have deeply nested paths — ensure `relativePath` is used correctly when constructing the content-fetch URL.
- The esbuild bundler will automatically pick up the new `.ts` file via the `index.ts` import — no build config changes needed.

## Tests

- **`packages/coc/test/spa-tasks-panel.test.ts`** — New Vitest test file:
  - `renderTaskTree()` renders correct nested HTML for a mock `TaskFolderDTO` with 2 levels of folders, document groups, and single documents.
  - `renderStatusBadge()` returns correct CSS class for each of the 4 statuses plus unknown/undefined fallback.
  - `renderTaskItem()` escapes special characters in task names.
  - Folder expand/collapse: simulates click on folder header, verifies `.expanded` / `.collapsed` class toggle.
  - Archive section renders separately and is collapsed by default.
  - Empty state: when API returns empty folder tree, shows "No tasks found" message.
  - Error state: when `fetchApi` returns null, shows "Tasks not available" message.
  - Document group rendering: group with 3 documents shows correct count badge and child items.

- **`packages/coc/test/spa-repos.test.ts`** (existing, if present) — Add or verify:
  - `showRepoDetail()` HTML output contains the `repo-tasks-panel` container div.
  - Tasks section header appears between Pipelines and Recent Processes sections.

## Acceptance Criteria

- [ ] Repo detail page shows a "Tasks" section between Pipelines and Recent Processes
- [ ] Task folder tree renders with expand/collapse chevrons
- [ ] Document groups display with base name header and expandable child documents
- [ ] Status badges show with correct color coding (pending=blue, in-progress=orange, done=green, future=gray)
- [ ] Clicking a task item fetches and displays its markdown content in a preview area
- [ ] Archive section renders at the bottom, collapsed by default
- [ ] Empty state ("No tasks found") shows when workspace has no tasks
- [ ] Error state ("Tasks not available") shows when API endpoint fails
- [ ] All new CSS uses existing CSS variables — no new custom properties
- [ ] Light and dark themes both render correctly
- [ ] New `tasks-panel.ts` module is imported in `index.ts` and bundled by esbuild
- [ ] All new and existing tests pass (`npm run test:run` in `packages/coc/`)

## Dependencies

- Depends on: 007 (Tasks API endpoint `GET /api/workspaces/:id/tasks` and `GET /api/workspaces/:id/tasks/:path/content`)
