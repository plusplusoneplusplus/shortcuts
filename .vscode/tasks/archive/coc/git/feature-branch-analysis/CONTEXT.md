# Context: Feature Branch Analysis (CoC Dashboard)

## User Story
Developers using the CoC dashboard on feature branches want to see what files they've changed relative to the default branch, aggregate diff stats, and browse per-file diffs — all common tasks before opening a PR or running an AI review pipeline. This closes Gap #4 from the git-feature-gap-analysis.

## Goal
Add a "Branch Changes" section to the CoC dashboard's Git tab that uses `GitRangeService` from pipeline-core to auto-detect the current feature branch vs default branch, then surfaces changed files, diff stats, and per-file diffs.

## Commit Sequence
1. Add branch range API endpoints
2. Add BranchChanges section to Git tab
3. Add per-file diff viewing in branch changes

## Key Decisions
- Dashboard only — no new CLI command
- Section hidden when on default branch (no "you're on main" message)
- Section placed at top of Git tab, collapsed by default
- API endpoints follow existing `/api/workspaces/:id/git/*` pattern
- GitRangeService lazily instantiated as singleton (default config: maxFiles=100)
- Graceful degradation: all endpoints return 200 with fallback on errors, never 500
- Per-file diff truncated at 500 lines with "Show All" option

## Conventions
- Route registration via `routes.push()` with regex patterns in `api-handler.ts`
- React components in `packages/coc/src/server/spa/client/react/repos/`
- Status badges: M=blue, A=green, D=red, R=purple (matching CommitDetail palette)
- `fetchApi()` for all API calls; `Spinner` from shared components
- Single-expand accordion pattern (one item open at a time)
- Tailwind CSS with dark mode support via `dark:` prefix
