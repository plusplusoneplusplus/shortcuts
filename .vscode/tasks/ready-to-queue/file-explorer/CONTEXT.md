# Context: Git Clone File Explorer

## User Story
The user wants a simple file explorer in the CoC dashboard to browse cloned git repos — "just as simple as a miller column used in the tasks panel." The goal is to let users inspect repo file structure without leaving the browser.

## Goal
Add a read-only file tree panel to the CoC dashboard SPA that lazily browses any registered workspace's directory structure, with file preview and search/filter.

## Commit Sequence
1. Types & repo tree service — interfaces + fs-based directory listing logic
2. API routes for repo tree & blob — HTTP endpoints wired into coc-server router
3. FileTree SPA component & panel wiring — React tree with expand/collapse, icons, keyboard nav
4. File preview pane — syntax-highlighted read-only blob viewer on file select
5. Search, filter & polish — substring filter, breadcrumbs, keyboard shortcut

## Key Decisions
- Reuses existing `workspaces.json` as repo registry — no new clone/registration mechanism
- .gitignore filtering via `git check-ignore --stdin` (no new npm dependencies)
- Lazy-load children on expand (one API call per directory)
- Syntax highlighting reuses existing highlight.js infrastructure from wiki/git views
- SPA wiring: new "explorer" sub-tab under existing repos view (not a top-level tab)

## Conventions
- API routes follow `registerXxxRoutes(routes, ...)` push-array pattern (raw Node.js http, no framework)
- React components use Tailwind utility classes with `cn()` helper; dark mode via `dark:` variants
- Tests use Vitest with tmpDir fixtures for filesystem tests, mock fetch for SPA tests
- File paths: `packages/coc-server/src/repos/` for server logic, `packages/coc/src/server/spa/client/react/repos/explorer/` for UI
- `TreeEntry.type` uses `'file' | 'dir'` (not `'directory'`); `RepoInfo` uses `localPath` (not `rootPath`)
- Integration points (deep-wiki, pipelines, wiki-ask) are deferred to a follow-up — not in scope for these 5 commits
