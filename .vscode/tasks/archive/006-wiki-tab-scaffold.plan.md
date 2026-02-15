---
status: done
---

# 006: Add Wiki Tab Scaffold to CoC SPA Dashboard

## Summary
Add a "Wiki" tab to the CoC dashboard with wiki list sidebar, "Add Wiki" dialog, and basic component browser. This establishes the UI structure that subsequent commits fill with rich features.

## Motivation
The Wiki tab is the user-facing entry point for wiki features. Users need to register wikis (like repos) and browse components. This commit establishes the tab structure and basic CRUD flow.

## Changes

### Files to Create
- `packages/coc/src/server/spa/client/wiki.ts` — Wiki tab: list, selector, content area, Add Wiki dialog
- `packages/coc/src/server/spa/client/wiki-components.ts` — Component tree sidebar (port of deep-wiki `sidebar.ts` domain/category tree building)
- `packages/coc/src/server/spa/client/wiki-types.ts` — Client-side wiki type definitions (WikiData, ComponentGraph, ComponentNode, Domain, etc.)

### Files to Modify
- `packages/coc/src/server/spa/client/state.ts` — Add `'wiki'` to `DashboardTab` union type; add `selectedWikiId: string | null` to `AppState`
- `packages/coc/src/server/spa/client/core.ts` — Add hash routes: `#wiki`, `#wiki/{id}`, `#wiki/{id}/component/{compId}`
- `packages/coc/src/server/spa/client/repos.ts` — Add `'view-wiki'` to the `viewIds` array in `switchTab()`; add `if (tab === 'wiki') fetchWikisData()` refresh
- `packages/coc/src/server/spa/client/index.ts` — Import `'./wiki'` and `'./wiki-components'` (as step 11/12 after tasks, before websocket)
- `packages/coc/src/server/spa/html-template.ts` — Add `#view-wiki` div, wiki tab button, Add Wiki dialog overlay HTML
- `packages/coc/src/server/spa/client/styles.css` — Wiki-specific styles (wiki grid, wiki cards, component tree sidebar)

### Files to Delete
- (none)

## Implementation Notes

### Tab System (from `repos.ts` `switchTab()`)
- `switchTab(tab: DashboardTab)` toggles `.active` on `.tab-btn` elements by matching `btn.getAttribute('data-tab') === tab`.
- It shows/hides views by iterating a hardcoded `viewIds` array: `['view-processes', 'view-repos', 'view-reports', 'view-tasks']` and toggling `.hidden` on each, showing only `view-${tab}`.
- **Modification**: add `'view-wiki'` to this array so the wiki panel toggles correctly.
- Tab bar click handler (lines 44-56 of `repos.ts`) reads `data-tab` from the clicked `.tab-btn` and sets `location.hash = '#' + tab`, which triggers `handleHashChange`.
- On switch to repos it calls `fetchReposData()`; mirror this pattern for wiki: on switch to wiki call `fetchWikisData()`.

### Hash Routing (from `core.ts` `handleHashChange()`)
- Routes are matched with regex in priority order inside `handleHashChange()`.
- Current patterns: `#process/{id}`, `#session/{id}`, `#repos/{id}`, then bare `#tasks`, `#repos`, `#reports`, default `#processes`.
- **Add three new routes** (before the bare-tab fallbacks):
  - `#wiki/{wikiId}/component/{compId}` → `switchTab('wiki')` then `showWikiComponent(wikiId, compId)`
  - `#wiki/{wikiId}` → `switchTab('wiki')` then `showWikiDetail(wikiId)`
  - `#wiki` → `switchTab('wiki')`
- Use `setHashSilent()` (the guard-based hash setter from core.ts lines 84-89) when navigating within the wiki tab programmatically to avoid recursive `handleHashChange` calls.

### HTML Structure (from `html-template.ts`)
- Each tab's content is a top-level `<div>` child of `<body>`:
  - `#view-processes` uses class `app-layout` (sidebar+detail grid).
  - `#view-repos`, `#view-tasks`, `#view-reports` use class `app-view hidden`.
- **Add to tab bar** (after the "Tasks" button, before "Reports"):
  ```html
  <button class="tab-btn" data-tab="wiki">Wiki</button>
  ```
- **Add wiki view div** (after `#view-tasks`, before `#view-reports`):
  ```html
  <div class="app-view hidden" id="view-wiki">
    <div class="wiki-layout">
      <aside class="wiki-sidebar" id="wiki-sidebar">
        <div class="wiki-selector" id="wiki-selector">
          <select id="wiki-select" class="workspace-select">
            <option value="">Select wiki...</option>
          </select>
          <button class="enqueue-btn-primary" id="add-wiki-btn">+ Add Wiki</button>
        </div>
        <div class="wiki-component-tree" id="wiki-component-tree"></div>
      </aside>
      <main class="wiki-content" id="wiki-content">
        <div class="empty-state" id="wiki-empty">
          <div class="empty-state-icon">📖</div>
          <div class="empty-state-title">Select a wiki</div>
          <div class="empty-state-text">Choose a wiki from the sidebar or add a new one.</div>
        </div>
        <div class="wiki-component-detail hidden" id="wiki-component-detail"></div>
      </main>
    </div>
  </div>
  ```
  The `wiki-layout` mirrors `app-layout` (CSS grid: sidebar 280px + 1fr content), matching the Processes tab's sidebar/detail pattern but with a component tree instead of a process list.

### Add Wiki Dialog (mirroring Add Repo dialog)
- The Add Repo dialog uses an overlay pattern: `#add-repo-overlay` div with class `enqueue-overlay hidden`, containing a `.enqueue-dialog` form.
- Fields: path input + Browse button (reuses `openPathBrowser()`/`navigateToDir()` directory browser), alias input, color select.
- Submit POSTs to `/api/workspaces` with `{ id, name, rootPath, color }`.
- **Add Wiki dialog** follows the identical pattern:
  ```html
  <div id="add-wiki-overlay" class="enqueue-overlay hidden">
    <div class="enqueue-dialog" style="width: 480px;">
      <div class="enqueue-dialog-header">
        <h2>Add Wiki</h2>
        <button class="enqueue-close-btn" id="add-wiki-cancel">&times;</button>
      </div>
      <form id="add-wiki-form" class="enqueue-form">
        <!-- Path field with Browse button (reuse path-browser pattern) -->
        <!-- Name field (auto-detected from dir name) -->
        <!-- Color select (same options as repo) -->
        <!-- "Generate with AI" toggle checkbox -->
        <div class="enqueue-actions">
          <button type="button" class="enqueue-btn-secondary" id="add-wiki-cancel-btn">Cancel</button>
          <button type="submit" class="enqueue-btn-primary" id="add-wiki-submit">Add Wiki</button>
        </div>
      </form>
    </div>
  </div>
  ```
- Submit POSTs to `/api/wikis` with `{ id, name, repoPath, color, generateWithAI }`.
- `showAddWikiDialog()` / `hideAddWikiDialog()` toggle `.hidden` on `#add-wiki-overlay`, mirror `showAddRepoDialog()` (repos.ts lines 482-498).
- Path browser can be reused — the existing `openPathBrowser()` reads from `#repo-path`. We need to parameterize it or create a wiki-specific path input `#wiki-path` with its own browse button that sets `browserCurrentPath` into the wiki input.

### Wiki List Fetching
- `fetchWikisData()` calls `GET /api/wikis` (provided by commit 004 wiki routes).
- Populates `#wiki-select` dropdown with wiki entries.
- Optionally renders a card grid (like repos) or just populates the selector — start with selector for simplicity.
- On wiki selection, fetch component graph: `GET /api/wikis/{wikiId}/graph` → populate component tree.

### Component Tree (ported from deep-wiki `sidebar.ts`)
- Deep-wiki's `initializeSidebar()` reads from a global `componentGraph` and builds a DOM tree into `#nav-container`.
- It groups components by domains (if present) or categories, creating `.nav-area-group` > `.nav-area-item` + `.nav-area-children` > `.nav-area-component` elements.
- Each component item has `data-id` attribute and `onclick → loadComponent(id)`.
- **Port this as `buildComponentTree(graph, container)`** in `wiki-components.ts`:
  - Accept a ComponentGraph object and a container element.
  - Build domain-grouped or category-grouped tree (same logic as deep-wiki `buildDomainSidebar` / `buildCategorySidebar`).
  - On component click, set hash to `#wiki/{wikiId}/component/{compId}` which triggers routing.
  - Use CoC-style CSS class names (`.wiki-tree-group`, `.wiki-tree-item`, `.wiki-tree-children`) to avoid collision with deep-wiki styles.

### Component Content Loading (from deep-wiki `content.ts`)
- `loadComponent(componentId)` fetches `/api/components/{id}`, gets `{ markdown }`, renders via `marked.parse()`.
- **In CoC wiki tab**: `showWikiComponent(wikiId, compId)` fetches `GET /api/wikis/{wikiId}/components/{compId}` → renders markdown into `#wiki-component-detail`.
- Start with a simple markdown render (no mermaid, no ToC, no Ask AI) — those come in later commits.

### State Changes
- `DashboardTab` in `state.ts` (line 6) is `'processes' | 'repos' | 'reports' | 'tasks'` — add `| 'wiki'`.
- `AppState` gets `selectedWikiId: string | null` (initialized to `null`), paralleling `selectedRepoId`.

### Module Initialization (from `index.ts`)
- Modules are imported in dependency order; side effects (event listeners) run at import time.
- `wiki.ts` should be imported after `repos.ts` (step 8) since it reuses `switchTab` patterns, and before `websocket.ts` (step 10).
- Add:
  ```ts
  // 10. Wiki (wiki list, component browser, add wiki dialog)
  import './wiki';
  import './wiki-components';
  ```
  (Renumber websocket to step 12, adjust comments.)

### CSS Additions
- `.wiki-layout`: CSS grid `grid-template-columns: 280px 1fr`, same height as `.app-layout` (`calc(100vh - 48px - 37px)`).
- `.wiki-sidebar`: Same background/border as `.sidebar` (`var(--bg-sidebar)`, `border-right: 1px solid var(--border-color)`).
- `.wiki-selector`: Flex row, padding 12px, gap 8px.
- `.wiki-component-tree`: Overflow-y auto, flex-grow 1, padding 8px.
- `.wiki-tree-group`, `.wiki-tree-item`, `.wiki-tree-children`, `.wiki-tree-component`: Mirror deep-wiki's `.nav-area-*` classes but scoped for CoC.
- `.wiki-content`: Padding 24px, overflow-y auto.
- `.wiki-component-detail .markdown-body`: Basic markdown styling (reuse existing or add minimal).

## Tests
- Test Wiki tab button renders in tab bar
- Test `switchTab('wiki')` shows `#view-wiki` and hides other views
- Test tab switching to/from Wiki preserves state
- Test Add Wiki dialog opens on `#add-wiki-btn` click and closes on cancel
- Test Add Wiki form submits POST to `/api/wikis`
- Test wiki list fetches `GET /api/wikis` and populates `#wiki-select`
- Test selecting a wiki fetches component graph and renders tree
- Test component tree renders domain groups and component items
- Test clicking a component item navigates to `#wiki/{id}/component/{compId}`
- Test hash routing: `#wiki` → wiki tab, `#wiki/{id}` → wiki detail, `#wiki/{id}/component/{compId}` → component view

## Acceptance Criteria
- [x] Wiki tab visible in dashboard tab bar (between Tasks and Reports)
- [x] Clicking Wiki tab shows wiki view, hides other tabs
- [x] Add Wiki dialog with path browser, name, color, AI toggle
- [x] Selecting a wiki loads component tree in sidebar
- [x] Component tree shows domain-grouped or category-grouped components
- [x] Clicking a component shows its content in the detail area
- [x] Hash routing works (`#wiki`, `#wiki/:id`, `#wiki/:id/component/:compId`)
- [x] `DashboardTab` type updated, no TypeScript errors
- [x] CoC build succeeds (`npm run build` in `packages/coc/`)

## Dependencies
- Depends on: 004 (wiki API routes: `GET /api/wikis`, `GET /api/wikis/:id/graph`, `GET /api/wikis/:id/components/:compId`)
