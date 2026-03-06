---
status: pending
---

# 004: Dashboard UI — Branch List & Status Page

## Summary

Add a read-only "Git Branches" page to the DeepWiki/CoC dashboard SPA. The page shows the branch list (local/remote, with pagination and search) and a status banner (current branch, ahead/behind counts, tracking branch, dirty indicator). No mutation actions are included — those come in commit 005.

## Motivation

The branch API endpoints from commits 001–003 are only useful once there is a UI to drive them. This commit adds the branch list page as a pure read-only view so it can be reviewed independently before the interactive (checkout, create, delete, push/pull) actions are layered on top in the next commit. Separating read from write also makes the history bisectable if a regression is introduced by the mutation actions.

## Changes

### Files to Create

- `packages/coc-server/src/wiki/spa/client/git-branches.ts` — New client module implementing the full branch list page:
  - `showGitBranches(skipHistory?: boolean)` — Shows the page, pushes browser history, and kicks off initial data loads.
  - `setupGitBranchesListeners()` — Registers event listeners for the back button, Local/Remote tabs, debounced search input, and prev/next pagination buttons.
  - `loadBranches(type, limit, offset, search)` — Fetches `GET /api/workspaces/:id/git/branches?type=…&limit=…&offset=…&search=…` and renders the result.
  - `loadBranchStatus()` — Fetches `GET /api/workspaces/:id/git/branch-status` and renders the status banner.
  - `renderBranchTable(branches, totalCount, hasMore)` — Builds the branch table rows (name, current-star, last commit subject, relative date). Current branch row gets a highlighted class.
  - `renderPagination(totalCount, limit, offset, hasMore)` — Renders "Showing X–Y of Z" text and enables/disables prev/next buttons.
  - Module-level private state: `currentType` (`'local'|'remote'`), `currentOffset` (number), `currentSearch` (string), `currentLimit` (number, default 25), `branchesInitialized` (boolean guard for one-time listener setup).

### Files to Modify

- `packages/coc-server/src/wiki/spa/html-template.ts` — Three changes:
  1. Add `workspaceId?: string` to the destructured options from `SpaTemplateOptions`.
  2. Inject `workspaceId: ${JSON.stringify(workspaceId ?? null)}` into the `window.__WIKI_CONFIG__` script block.
  3. Insert a new `<div id="git-branches-page" class="admin-page hidden">` block inside `<main>` (after the existing `#admin-page` div and before `</main>`). Structure:
     ```html
     <div class="admin-page hidden" id="git-branches-page">
       <div class="admin-page-header">
         <div class="admin-page-title-row">
           <h1 class="admin-page-title">Git Branches</h1>
           <button class="admin-btn admin-btn-back" id="git-branches-back">&larr; Back to Wiki</button>
         </div>
       </div>
       <!-- Status banner -->
       <div class="git-branch-status-banner" id="git-branch-status-banner"></div>
       <!-- Tab bar -->
       <div class="admin-tabs" id="git-branches-tabs">
         <button class="admin-tab active" data-tab="local" id="git-branches-tab-local">Local</button>
         <button class="admin-tab" data-tab="remote" id="git-branches-tab-remote">Remote</button>
       </div>
       <!-- Search -->
       <div class="git-branches-search-row">
         <input type="text" id="git-branches-search" placeholder="Search branches..." aria-label="Search branches">
       </div>
       <!-- Table -->
       <div class="admin-body" id="git-branches-body">
         <div id="git-branches-table-container"></div>
         <div id="git-branches-pagination"></div>
       </div>
     </div>
     ```

- `packages/coc-server/src/wiki/spa/types.ts` — Add optional field to `SpaTemplateOptions`:
  ```ts
  /** Workspace ID for git branch API calls (optional) */
  workspaceId?: string;
  ```

- `packages/coc-server/src/wiki/spa/client/globals.d.ts` — Add `workspaceId: string | null` to the `WikiConfig` interface.

- `packages/coc-server/src/wiki/spa/client/sidebar.ts` — Two changes:
  1. Add a "Git Branches" nav item in `initializeSidebar()` inside the `homeSection.innerHTML` block (after the Graph item):
     ```ts
     '<div class="nav-item" data-id="__git-branches" onclick="showGitBranches()">' +
     '<span class="nav-item-name">Git Branches</span></div>'
     ```
     Wrap in `config.workspaceId ? ... : ''` so the item only appears when a workspace ID is available.
  2. Add and export `showGitBranchesPageContent()` alongside the existing `showAdminContent()`:
     ```ts
     export function showGitBranchesPageContent(): void {
         const contentScroll = document.getElementById('content-scroll');
         if (contentScroll) contentScroll.style.display = 'none';
         const adminPage = document.getElementById('admin-page');
         if (adminPage) adminPage.classList.add('hidden');
         const gitBranchesPage = document.getElementById('git-branches-page');
         if (gitBranchesPage) gitBranchesPage.classList.remove('hidden');
         const sidebar = document.getElementById('sidebar');
         if (sidebar) sidebar.style.display = 'none';
         const askWidget = document.getElementById('ask-widget');
         if (askWidget) askWidget.style.display = 'none';
     }
     ```
     Also update `showWikiContent()` and `showAdminContent()` to hide `#git-branches-page` (add the symmetric `.classList.add('hidden')` call on `gitBranchesPage`).

- `packages/coc-server/src/wiki/spa/client/core.ts` — In `setupPopstateHandler()`, add a branch for the new history state type (after the existing `admin` branch):
  ```ts
  else if (state.type === 'git-branches') {
      if (typeof (window as any).showGitBranches === 'function') (window as any).showGitBranches(true);
      else (window as any).showHome(true);
  }
  ```

- `packages/coc-server/src/wiki/spa/client/index.ts` — Three changes:
  1. Add import: `import { showGitBranches, setupGitBranchesListeners } from './git-branches';`
  2. Expose on window: `(window as any).showGitBranches = showGitBranches;`
  3. Call `setupGitBranchesListeners();` alongside the other `setup*` calls in the init section.

### Files to Delete

- (none)

## Implementation Notes

### Workspace ID Discovery

The wiki SPA currently has no workspace concept. The admin page uses only `/api/admin/` endpoints. For the git branch endpoints (`/api/workspaces/:id/git/…`) the workspace ID must be injected at serve time. The approach:

1. Add `workspaceId?: string` to `SpaTemplateOptions` in `types.ts`.
2. Inject it into `__WIKI_CONFIG__` in `html-template.ts` so the client bundle can read it as `config.workspaceId`.
3. Wherever the wiki is served for a specific workspace (via `wiki-routes.ts` or `create-server.ts`), the caller passes the workspace ID in the options.
4. In `git-branches.ts`, read `(window as any).__WIKI_CONFIG__.workspaceId` at the top of the module. If null/undefined, render a message: "No workspace selected. Open this wiki from a workspace to manage branches."

This is the minimal change — no URL parsing, no dynamic workspace picker.

### git-branches.ts Module Structure

```ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { setCurrentComponentId } from './core';
import { showGitBranchesPageContent } from './sidebar';

const config = (window as any).__WIKI_CONFIG__;
const PAGE_SIZE = 25;

let currentType: 'local' | 'remote' = 'local';
let currentOffset = 0;
let currentSearch = '';
let currentLimit = PAGE_SIZE;
let branchesInitialized = false;
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export function showGitBranches(skipHistory?: boolean): void {
    setCurrentComponentId(null);
    showGitBranchesPageContent();
    if (!skipHistory) {
        history.pushState({ type: 'git-branches' }, '', location.pathname + '#git-branches');
    }
    if (!branchesInitialized) {
        initGitBranchesEvents();
        branchesInitialized = true;
    }
    // Reset to defaults on each open
    currentType = 'local';
    currentOffset = 0;
    currentSearch = '';
    resetTabUI();
    loadBranchStatus();
    loadBranches(currentType, currentLimit, currentOffset, currentSearch);
}

export function setupGitBranchesListeners(): void {
    const backBtn = document.getElementById('git-branches-back');
    if (backBtn) {
        backBtn.addEventListener('click', function () {
            (window as any).showHome(false);
        });
    }
}
```

- `initGitBranchesEvents()` (private, called lazily once): wires up the tab buttons, search input with debounce, and pagination buttons.
- Tab click: update `currentType`, `currentOffset = 0`, call `loadBranches(...)`.
- Search input: debounce 300 ms, then update `currentSearch`, `currentOffset = 0`, call `loadBranches(...)`.
- Prev button: decrement `currentOffset` by `currentLimit` (clamped to 0), call `loadBranches(...)`.
- Next button: increment `currentOffset` by `currentLimit`, call `loadBranches(...)`.

### loadBranches

```ts
async function loadBranches(type: string, limit: number, offset: number, search: string): Promise<void> {
    const workspaceId = config?.workspaceId;
    const container = document.getElementById('git-branches-table-container');
    if (!workspaceId) {
        if (container) container.innerHTML = '<p class="admin-page-desc">No workspace selected.</p>';
        return;
    }
    if (container) container.innerHTML = '<div class="loading">Loading branches...</div>';
    try {
        const params = new URLSearchParams({ type, limit: String(limit), offset: String(offset) });
        if (search) params.set('search', search);
        const res = await fetch('/api/workspaces/' + encodeURIComponent(workspaceId) + '/git/branches?' + params.toString());
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load branches');
        // API returns { local?: PaginatedBranchResult, remote?: PaginatedBranchResult }
        const result = type === 'remote' ? data.remote : data.local;
        const branches = result?.branches ?? [];
        const totalCount = result?.totalCount ?? 0;
        const hasMore = result?.hasMore ?? false;
        renderBranchTable(branches, totalCount, hasMore);
        renderPagination(totalCount, limit, offset, hasMore);
    } catch (err: any) {
        if (container) container.innerHTML = '<p class="error">Error: ' + escapeHtml(err.message) + '</p>';
    }
}
```

### loadBranchStatus

```ts
async function loadBranchStatus(): Promise<void> {
    const workspaceId = config?.workspaceId;
    const banner = document.getElementById('git-branch-status-banner');
    if (!workspaceId || !banner) return;
    banner.innerHTML = '<span class="loading-inline">Loading status...</span>';
    try {
        const res = await fetch('/api/workspaces/' + encodeURIComponent(workspaceId) + '/git/branch-status');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load status');
        // BranchStatus fields: name, isDetached, detachedHash?, ahead, behind, trackingBranch?, hasUncommittedChanges
        let html = '<span class="branch-status-current">&#x2387; ' + escapeHtml(data.name ?? 'unknown') + '</span>';
        if (data.trackingBranch) html += ' &rarr; <span class="branch-status-tracking">' + escapeHtml(data.trackingBranch) + '</span>';
        if (data.ahead || data.behind) {
            html += ' <span class="branch-status-sync">';
            if (data.ahead) html += '&uarr;' + data.ahead + ' ';
            if (data.behind) html += '&darr;' + data.behind;
            html += '</span>';
        }
        if (data.hasUncommittedChanges) html += ' <span class="branch-status-dirty">&#x25CF; dirty</span>';
        banner.innerHTML = html;
    } catch (_err) {
        banner.innerHTML = '';
    }
}
```

### renderBranchTable

Rows include:
- Name cell: full branch name; if `isCurrent`, prepend `&#9733;` (star) and add class `branch-row-current` to the row; for remote branches, optionally render the remote prefix (e.g., `origin`) as a `<span class="branch-remote-badge">` badge.
- Commit subject cell: `escapeHtml(branch.lastCommitSubject ?? '')`.
- Date cell: format `branch.lastCommitDate` as a relative string (e.g., "3 days ago") using a simple inline helper.

If `branches` is empty, render:
```html
<p class="admin-page-desc">No branches found.</p>
```

Otherwise render a `<table class="git-branches-table">` with `<thead>` (Name / Last Commit / Updated) and `<tbody>`.

### renderPagination

Shows `"Showing {offset+1}–{min(offset+limit, totalCount)} of {totalCount}"` and enables/disables prev/next `<button>` elements with ids `git-branches-prev` and `git-branches-next`.

### CSS

Reuse existing classes: `.admin-page`, `.admin-page-header`, `.admin-page-title`, `.admin-tabs`, `.admin-tab`, `.admin-btn`, `.admin-btn-back`, `.admin-body`, `.loading`, `.error`. Add minimal new classes in `styles.css`:
- `.git-branch-status-banner` — flex row, padding, background similar to a muted info bar.
- `.branch-status-current` — bold, uses the accent color.
- `.branch-status-dirty` — warning color (amber/orange).
- `.branch-remote-badge` — small pill badge, muted color.
- `.branch-row-current` — subtle highlight (background tint) on the current branch row.
- `.git-branches-search-row` — padding + input width.
- `.git-branches-table` — full-width table, border-collapse, standard cell padding.

### escapeHtml in git-branches.ts

Import `escapeHtml` from `'./core'` (already exported there).

### No-workspace Fallback

If `config.workspaceId` is falsy, `showGitBranches` still shows the page (so the nav item works) but renders a descriptive message in the table container and leaves the status banner empty.

## Tests

The SPA client is a browser bundle and has no dedicated unit test harness. Validation happens at:

1. **Build-time TypeScript check** — `npm run build` compiles the client via esbuild + tsc. Any type errors in `git-branches.ts`, the modified `globals.d.ts`, or the updated `types.ts` will fail the build.
2. **HTML template output** — The `html-template.ts` file is covered by existing server tests. Verify the new `#git-branches-page` div is present in the generated HTML:
   - Find the test file that calls `generateSpaHtml` and assert the string `id="git-branches-page"` appears in the output.
   - If no such test exists, add a minimal assertion to the nearest `html-template` test.
3. **Module export shape** — Optionally add a Vitest import-only test to `packages/coc-server` that imports `showGitBranches` and `setupGitBranchesListeners` from the source file and asserts they are functions (catches obvious export mistakes without a DOM).

## Acceptance Criteria

- [ ] "Git Branches" nav item appears in the sidebar when `workspaceId` is set in `__WIKI_CONFIG__`
- [ ] Clicking the nav item shows `#git-branches-page` and hides `#content-scroll` and `#admin-page`
- [ ] Status banner renders current branch name, tracking branch, ahead/behind counts, and dirty flag
- [ ] "Local" tab is selected by default; clicking "Remote" switches `currentType` and reloads the list
- [ ] Search input with 300 ms debounce filters branches on the server via the `search` query param
- [ ] Branch table shows name, star icon for current branch, last commit subject, and relative date
- [ ] Current branch row is visually highlighted
- [ ] Remote branches render with a remote-prefix badge (e.g., `origin`)
- [ ] Pagination controls show "Showing X–Y of Z" and enable/disable prev/next correctly
- [ ] Back button calls `showHome(false)` and returns to the wiki content view
- [ ] Browser back/forward (popstate) navigates correctly via `state.type === 'git-branches'`
- [ ] If `workspaceId` is null, the table area shows a descriptive "no workspace" message
- [ ] `npm run build` succeeds with the new module

## Dependencies

- Depends on commits 001–003 (branch list API `GET /api/workspaces/:id/git/branches` with `type`, `limit`, `offset`, `search` params; branch status API `GET /api/workspaces/:id/git/branch-status`).

## Assumed Prior State

From commits 001–003, these API endpoints exist and are functional in `packages/coc-server/src/api-handler.ts`:

- `GET /api/workspaces/:id/git/branches` — query params: `type` (`local`|`remote`|`all`), `limit`, `offset`, `search`. Returns `{ local?: PaginatedBranchResult, remote?: PaginatedBranchResult }` where `PaginatedBranchResult = { branches: GitBranch[], totalCount: number, hasMore: boolean }` and `GitBranch` has at least: `name`, `isCurrent`, `isRemote`, `remoteName?`, `lastCommitSubject?`, `lastCommitDate?`.
- `GET /api/workspaces/:id/git/branch-status` — Returns `BranchStatus | null` where `BranchStatus = { name, isDetached, detachedHash?, ahead, behind, trackingBranch?, hasUncommittedChanges }`.
- All other branch mutation endpoints (checkout, create, delete, push, pull, stash) also exist but are not called by this commit.
