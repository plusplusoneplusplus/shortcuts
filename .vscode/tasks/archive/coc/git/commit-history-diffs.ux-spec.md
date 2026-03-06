# UX Spec: Commit History & Diffs for CoC

> Gap #2 from [git-feature-gap-analysis.md](./git-feature-gap-analysis.md)

## 1. User Story

**As a** developer using the CoC dashboard,
**I want to** browse commit history, view file changes, and read diffs for any workspace,
**so that** I can understand recent changes, review what happened, and provide context to AI pipelines — without leaving CoC or opening a separate git client.

### Target Users
- Developers running AI pipelines via `coc serve` who need git context alongside their work
- Team leads reviewing what changed in a workspace before triggering pipeline runs

---

## 2. Entry Points

### 2a. Dashboard (Web UI)

**Workspace Detail → Git History Tab**

The git history lives inside a workspace's detail view, not as a global admin tab. Each workspace is a git repo, so history is workspace-scoped.

- **Location**: When a workspace is selected in the dashboard, a new **"History"** tab appears alongside any existing workspace tabs.
- **Trigger**: Click the "History" tab header.
- **Prerequisite**: Workspace must be a git repo (`isGitRepo: true` from `/git-info`). Tab is hidden for non-git workspaces.

**Quick Access from Git Status Badge**

The existing git-info display (branch name, ahead/behind) becomes clickable:
- Clicking the **branch name** opens the History tab filtered to that branch.
- Clicking the **ahead count** (e.g., "↑3") scrolls to the unpushed commits section.

---

## 3. User Flow

### Flow A: Dashboard — Browse Commit History

```
┌─────────────────────────────────────────────────────────┐
│  Workspace: my-project   [main ↑2 ↓0]                  │
│  ┌──────────┬──────────┬───────────┐                    │
│  │ Processes │ History  │ Settings  │                    │
│  └──────────┴──────────┴───────────┘                    │
│                                                         │
│  ┌─ Unpushed (2) ─────────────────────────────────────┐ │
│  │ ▶ a1b2c3d  Add retry logic to pipeline    2h ago   │ │
│  │ ▶ e4f5g6h  Fix timeout in queue executor  3h ago   │ │
│  └────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ History ──────────────────────────────────────────┐ │
│  │ ▶ i7j8k9l  Merge PR #42: new filter ops  1d ago   │ │
│  │ ▶ m0n1o2p  Update dependencies           2d ago   │ │
│  │ ▶ q3r4s5t  Initial pipeline scaffolding   3d ago   │ │
│  │                                                    │ │
│  │         [ Load More (20) ]                         │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**Step 1 — Open History Tab**
- User clicks "History" tab in a workspace view.
- System loads the first 20 commits via `GET /api/workspaces/:id/git/commits?limit=20`.
- Commits render as collapsed rows: `short hash | subject | relative date | author`.
- Unpushed commits (ahead of remote) are grouped in a separate **"Unpushed"** section at the top, visually distinct with a highlight.

**Step 2 — Expand a Commit**
- User clicks a commit row (or the ▶ arrow).
- Row expands to show:
  - Full commit message (subject + body)
  - Author name + email + date
  - Parent hash(es)
  - File change summary: `3 files changed, +45 −12`
  - List of changed files with status badges (M/A/D/R)

```
┌─────────────────────────────────────────────────────────┐
│ ▼ a1b2c3d  Add retry logic to pipeline       2h ago    │
│                                                         │
│   Author: Jane Doe <jane@example.com>                   │
│   Date:   2026-02-28T15:30:00Z                          │
│   Parent: x9y8z7w                                       │
│                                                         │
│   Add configurable retry with exponential backoff       │
│   for transient AI provider failures.                   │
│                                                         │
│   3 files changed, +45 −12                              │
│   ┌──────────────────────────────────────────────────┐  │
│   │ M  src/pipeline/executor.ts            +30  −5   │  │
│   │ M  src/pipeline/types.ts               +10  −2   │  │
│   │ A  src/pipeline/retry-policy.ts        +5   −0   │  │
│   └──────────────────────────────────────────────────┘  │
│                                                         │
│   [ View Full Diff ]    [ Copy Hash ]                   │
└─────────────────────────────────────────────────────────┘
```

**Step 3 — View File Diff**
- User clicks a file row (e.g., `M src/pipeline/executor.ts`).
- A **diff panel** slides in (or expands below the file row) showing the unified diff with syntax highlighting.
- Added lines highlighted green, removed lines highlighted red.
- Collapsible unchanged context regions (show 3 lines of context by default).

**Step 4 — View Full Commit Diff**
- User clicks "View Full Diff" button.
- Shows the complete diff for all files in the commit, concatenated with file headers.
- Same syntax-highlighted diff rendering.

**Step 5 — Load More**
- User clicks "Load More (20)" at the bottom.
- Next 20 commits append below existing ones.
- Button updates or disappears when no more commits exist.

### Flow B: Dashboard — View File at Revision

- In the expanded commit's file list, a **"View File"** icon/button appears next to each file.
- Clicking it opens a **read-only panel** showing the file content at that commit, with syntax highlighting.
- File header shows: `filename @ short-hash`.
- For deleted files, the button shows the file at the parent commit instead.

---

## 4. Edge Cases & Error Handling

| Scenario | Behavior |
|----------|----------|
| **Workspace is not a git repo** | History tab hidden in dashboard |
| **Empty repository (no commits)** | Show empty state: "No commits yet" with a muted icon |
| **Detached HEAD** | Show commit hash instead of branch name; "Unpushed" section hidden |
| **No upstream tracking branch** | "Unpushed" section hidden; ahead/behind counts show as 0 |
| **Binary files in commit** | File row shows "Binary file" instead of diff; no syntax highlighting |
| **Very large diffs (>500 lines)** | Truncate with "Diff too large — showing first 500 lines. [Show All]" |
| **Deleted files** | "View File" shows content at parent commit; badge shows `D` in red |
| **Renamed files** | Show `R old-path → new-path` with rename detection |
| **Git command fails** | Dashboard: toast notification "Failed to load git history" |
| **Slow repository (many commits)** | Loading spinner in dashboard |
| **Merge commits** | Show all parent hashes; file list shows combined diff |

---

## 5. Visual Design Considerations

### Dashboard

**Commit Row (collapsed)**
```
[▶] [short-hash in monospace, muted color]  [subject, truncated at ~80 chars]  [relative-date, muted]  [author avatar or initials]
```

**Status Badges** — Reuse pipeline-core constants:
- `M` Modified — blue
- `A` Added — green
- `D` Deleted — red
- `R` Renamed — purple
- `C` Copied — purple

**Unpushed Section** — Subtle top-border or background tint to distinguish from pushed commits. Uses existing `--accent-*` CSS variables.

**Diff Rendering** — Use `highlight.js` (already in SPA dependencies) for syntax highlighting. Diff-specific styling:
- Line numbers in gutter (muted)
- `+` lines: green background
- `-` lines: red background
- `@@` hunk headers: blue, bold
- File headers: sticky/pinned during scroll

**Loading States**
- Initial load: skeleton rows (3-4 placeholder rows with pulse animation)
- Load more: spinner replaces button text
- Expand commit: brief spinner inside the row

**Responsive**
- On narrow screens, hide author column; show only hash + subject + date
- Diff panel takes full width below the file list (no side-by-side on small screens)

---

## 6. API Endpoints (New)

All endpoints are workspace-scoped, consistent with existing `/api/workspaces/:id/*` pattern.

| Method | Endpoint | Description | Query Params |
|--------|----------|-------------|--------------|
| `GET` | `/api/workspaces/:id/git/commits` | Paginated commit list | `limit` (default 20), `skip` (default 0) |
| `GET` | `/api/workspaces/:id/git/commits/:hash` | Single commit details | - |
| `GET` | `/api/workspaces/:id/git/commits/:hash/files` | Files changed in commit | - |
| `GET` | `/api/workspaces/:id/git/commits/:hash/diff` | Full diff for commit | - |
| `GET` | `/api/workspaces/:id/git/commits/:hash/files/:path/content` | File content at commit | - |
| `GET` | `/api/workspaces/:id/git/commits/:hash/files/:path/diff` | Diff for single file | - |
| `GET` | `/api/workspaces/:id/git/diff` | Pending changes diff | `staged` (boolean) |

**Response schemas** match pipeline-core types directly:
- Commits → `CommitLoadResult` shape (`{ commits: GitCommit[], hasMore: boolean }`)
- Files → `GitCommitFile[]`
- Diffs → `{ diff: string }` (raw unified diff text)
- File content → `{ content: string, path: string, commitHash: string }`

---

## 7. Settings & Configuration

No new configuration needed for the initial release. Sensible defaults:

| Setting | Default | Notes |
|---------|---------|-------|
| Commits per page | 20 | Matches VS Code extension pattern |
| Initial load | 20 | First batch on tab open |
| Max diff size (dashboard) | 500 lines | Truncate with expand option |
| Diff context lines | 3 | Standard git default |

Future consideration: allow `~/.coc/config.yaml` to override `git.commitsPerPage` and `git.maxDiffLines`.

---

## 8. Discoverability

- **Dashboard**: The "History" tab is always visible for git-backed workspaces — no opt-in needed.
- **Git status badge**: The existing branch/ahead/behind display becomes a link to the history view, providing a natural discovery path.

---

## 9. Implementation Scope

### What's IN scope
- Commit list with pagination (dashboard)
- Commit detail expansion (metadata, file list, stats)
- Per-file and full-commit diff viewing
- File content at revision
- Unpushed commits grouping

### What's OUT of scope (future work)
- Branch switching/management (Gap #3)
- Staging/unstaging/committing (Gap #4)
- Commit search/filtering by date range in dashboard
- Side-by-side diff view (start with unified only)
- Git blame / line-level history
- WebSocket live-update when new commits arrive
