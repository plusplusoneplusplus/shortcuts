# Context: Branch Management (CoC Dashboard)

## User Story
The CoC server has a complete `BranchService` in pipeline-core but no API endpoints or dashboard UI to expose it. Users need branch management capabilities — listing, creating, switching, deleting, renaming, push/pull/fetch, merge, and stash — directly from the CoC dashboard without touching the command line. This is Gap 2 from the git feature gap analysis.

## Goal
Wire pipeline-core's `BranchService` into coc-server as REST API endpoints and build a dashboard SPA page for full branch management with search, pagination, and interactive operations.

## Commit Sequence
1. Branch listing & status API endpoints + tests
2. Branch CRUD API endpoints + tests (create, switch, delete, rename)
3. Remote, merge & stash API endpoints + tests (push, pull, fetch, merge, stash, pop)
4. Dashboard UI — Branch list & status page (table, pagination, search, tabs)
5. Dashboard UI — Branch actions & operations (dialogs, toasts, all interactive ops)

## Key Decisions
- Use `BranchService` from pipeline-core (not raw `execGitSync`) per gap analysis recommendation
- BranchService is a no-arg singleton instantiated once in `registerApiRoutes`
- All mutation endpoints return HTTP 200 with `GitOperationResult`; only malformed requests yield 4xx
- Workspace ID must be threaded into SPA config (`__WIKI_CONFIG__`) for API calls
- BranchService has `stashChanges`/`popStash` but no `listStash` — listing deferred to future work

## Conventions
- Route patterns follow existing regex convention: `/^\/api\/workspaces\/([^/]+)\/git\/...$/`
- SPA page follows admin-page pattern: hidden div, show/hide, lazy init, history.pushState
- Tests use real HTTP server on port 0 with mocked BranchService at the module level
