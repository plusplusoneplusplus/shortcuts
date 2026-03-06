# Plan: Feature Branch Analysis (Gap 4)

> Closes Gap #4 from [git-feature-gap-analysis.md](./git-feature-gap-analysis.md)

## Problem

CoC dashboard shows commit history but has no feature-branch awareness. Developers on feature branches can't see what files they've changed relative to the default branch, aggregate diff stats, or browse per-file diffs — all common tasks before opening a PR or running an AI review pipeline.

## Approach

Add a **"Branch Changes"** section to the existing Git tab in the workspace detail view. The section uses `GitRangeService` from pipeline-core (already fully implemented) to auto-detect the current feature branch vs the default branch, then surfaces changed files, diff stats, and per-file diffs.

The dashboard only — no CLI command.

## Key Decisions

- Section placed at the **top** of the Git tab (above Unpushed and History), since branch context is the first thing a developer wants to see
- Section is **hidden** when on the default branch (`showOnDefaultBranch: false` is the GitRangeService default)
- Section is **collapsed by default** with a summary header showing branch name, commit count, and +/- stats
- Reuse the existing file-list and diff-viewer patterns from CommitDetail
- API endpoints follow the existing `/api/workspaces/:id/git/*` pattern from commit history
- GitRangeService lazily instantiated alongside the existing GitLogService singleton

## API Endpoints (New)

| Method | Endpoint | Description | Response |
|--------|----------|-------------|----------|
| `GET` | `/api/workspaces/:id/git/branch-range` | Auto-detect feature branch range | `GitCommitRange \| { onDefaultBranch: true }` |
| `GET` | `/api/workspaces/:id/git/branch-range/files` | Changed files in the range | `{ files: GitCommitRangeFile[] }` |
| `GET` | `/api/workspaces/:id/git/branch-range/diff` | Full range diff | `{ diff: string }` |
| `GET` | `/api/workspaces/:id/git/branch-range/files/*/diff` | Per-file diff in range | `{ diff: string, path: string }` |

All endpoints derive `baseRef` and `headRef` from `GitRangeService.detectCommitRange()` — no client-supplied refs needed.

## UI Design

```
┌─────────────────────────────────────────────────────────────┐
│  Git tab                                                    │
│                                                             │
│  ┌─ Branch Changes: feature/retry-logic ──────────────────┐ │
│  │  7 commits ahead of main  ·  +145 −32  ·  12 files     │ │
│  │                                                    [▼]  │ │
│  │  ┌────────────────────────────────────────────────────┐ │ │
│  │  │ M  src/pipeline/executor.ts            +90  −15   │ │ │
│  │  │ M  src/pipeline/types.ts               +20  −5    │ │ │
│  │  │ A  src/pipeline/retry-policy.ts        +30  −0    │ │ │
│  │  │ D  src/pipeline/old-handler.ts          +0  −12   │ │ │
│  │  │ R  src/utils/helper.ts → src/utils/helpers.ts     │ │ │
│  │  │ ...8 more files                                   │ │ │
│  │  └────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─ Unpushed (2) ─────────────────────────────────────────┐ │
│  │  ...                                                    │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌─ History ──────────────────────────────────────────────┐ │
│  │  ...                                                    │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Expanded file row** → shows per-file diff (same diff viewer as commit detail).

**Hidden when on default branch** → the entire section disappears. No "you're on main" message (users know what branch they're on from the git status badge).

## Commit Sequence

### Commit 1: Add branch range API endpoints
- Import `GitRangeService` in `coc-server/src/api-handler.ts`, lazy singleton
- Add 4 endpoints (`branch-range`, `branch-range/files`, `branch-range/diff`, `branch-range/files/*/diff`)
- Add integration tests in `coc-server/test/api-handler-git-range.test.ts`
- No UI changes

### Commit 2: Add Branch Changes section to Git tab
- New `BranchChanges.tsx` component in the repos React directory
- Fetches `/git/branch-range` on mount; hides itself if `onDefaultBranch: true`
- Shows collapsed summary: branch name, commit count, +/- stats, file count
- Expand to see file list with status badges (M/A/D/R) and +/- per file
- Mount at top of `RepoGitTab.tsx` (above Unpushed section)

### Commit 3: Add per-file diff viewing in branch changes
- Click a file row → expand to show inline diff (reuse diff viewer from CommitDetail)
- Fetches `/git/branch-range/files/:path/diff` on expand
- Single-expand accordion (same pattern as commit detail)
- Large diff truncation (500 lines with expand)

## Conventions

- API routes follow existing `/api/workspaces/:id/git/*` pattern
- React components in `packages/coc/src/server/spa/client/react/repos/`
- Reuse: `fetchApi()`, status badges, diff viewer, accordion pattern, Tailwind CSS
- GitRangeService singleton created lazily inside `registerApiRoutes()`
- Match error handling pattern: non-git repos return 200 with fallback, not 500

## Notes

- `GitRangeService.detectCommitRange()` returns `null` when on the default branch or when no remote is configured — the API endpoint translates this to `{ onDefaultBranch: true }`
- The `GitRangeConfig.maxFiles` default is 100 — sufficient for most feature branches; no config override needed initially
- All GitRangeService methods are synchronous (execSync internally), same as GitLogService
- `GitCommitRangeFile` already has `path`, `status`, `additions`, `deletions`, `oldPath` — perfect for the file list UI
