# Context: Template Commit

## User Story

Users make repetitive, structurally similar commits (e.g., adding a config field, an API endpoint, a test suite). They want to save a commit as a named template in the CoC dashboard, then right-click it to "Replicate" — providing a short instruction for what should differ — and have AI generate the analogous changes. Templates are a general concept (`kind` discriminator) with commit-based templates as the first instance. The dashboard Templates tab is the primary UX; no CLI or Git tab coupling.

## Goal

Add a dedicated "Templates" repo sub-tab to the CoC dashboard where users manage named templates stored in `.vscode/templates/*.yaml`, and replicate them via an AI-powered queue task.

## Commit Sequence

1. pipeline-core: add template types and replication service
2. pipeline-core: export templates module
3. coc server: add template CRUD handler and watcher
4. coc server: add replicate task type to queue executor
5. coc server: wire template routes and watcher in index.ts
6. coc dashboard: add Templates sub-tab with list/detail UI
7. tests: add template test coverage

## Key Decisions

- Templates are a general concept with `kind` discriminator; `'commit'` is the first kind
- Source of truth is `.vscode/templates/*.yaml` (version-controlled, per-repo)
- Core replication logic lives in `pipeline-core/src/templates/` (reusable, no server deps)
- Replication enqueues into the existing task queue system (not a custom execution path)
- Dashboard follows existing patterns: `RepoSchedulesTab`-style component, `PipelineWatcher`-style file watcher
- Results appear in the queue/process viewer; "Apply" writes files to working tree

## Conventions

- Server handlers: `registerXxxRoutes(routes, store, ...)` pattern pushed into shared `Route[]`
- Watcher: clone `PipelineWatcher` pattern (fs.watch, 300ms debounce, graceful missing dir)
- Dashboard tabs: add to `RepoSubTab` type, `VALID_REPO_SUB_TABS`, `SUB_TABS` array, render case in `RepoDetail.tsx`
- Task types: payload interface + `isXxxPayload()` type guard + branch in `executeByType()`
- Tests: Vitest, no git mocking in pipeline-core (use real repo), mock filesystem in server tests
