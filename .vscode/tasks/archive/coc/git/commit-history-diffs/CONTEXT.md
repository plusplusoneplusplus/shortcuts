# Context: Commit History & Diffs for CoC Dashboard

## User Story
Add commit history browsing and diff viewing to the CoC web dashboard so developers can review recent changes, inspect file diffs, and understand what happened in a workspace — without leaving CoC or switching to a separate git client.

## Goal
Close Gap #2 from the git feature gap analysis: wire pipeline-core's existing `GitLogService` into coc-server REST endpoints and build a React-based "History" sub-tab in the workspace detail view with commit list, detail expansion, and diff rendering.

## Commit Sequence
1. Add git history & diff API endpoints
2. Add History sub-tab with commit list
3. Add commit detail expansion
4. Add diff viewer

## Key Decisions
- Dashboard-only (no CLI support)
- History is a workspace-scoped sub-tab (not a top-level tab)
- API endpoints are thin wrappers around pipeline-core's `GitLogService`
- Unpushed commits (ahead of remote) grouped separately at top of list
- Unified diff only (no side-by-side) for initial release
- Large diffs truncated at 500 lines with expand option

## Conventions
- API routes follow existing `/api/workspaces/:id/git/*` pattern
- React components in `packages/coc/src/server/spa/client/react/repos/`
- Reuse existing SPA patterns: `fetchApi()`, `useToast()`, `expandedId` state, Tailwind CSS
- Diff CSS reuses existing `.diff-*` classes from `tailwind.css`
