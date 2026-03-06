# Unify Commit & Branch Diff Panel Layout

## Problem

The CoC dashboard git panel has **inconsistent UX** between two views:

| View | Current Behavior |
|------|------------------|
| **Commit click** | Right panel shows _everything_: title, metadata, file list (non-interactive), and full unified diff — all in one scrollable pane. |
| **Branch diff file click** | Left panel shows file list (`BranchChanges`); clicking a file shows its diff in the right panel (`BranchFileDiff`). |

The user expects a **consistent two-panel master–detail pattern** for both: left panel always shows the file list, right panel always shows a single file's diff.

## Proposed Approach

Refactor the commit detail view to mirror the branch diff pattern: when a commit is selected, display its changed files in the left panel (below the commit list or as a sub-section), and show a per-file diff in the right panel when a file is clicked.

### Target UX (both views)

```
┌──────────────────────┬────────────────────────────────────┐
│  LEFT PANEL          │  RIGHT PANEL                       │
│                      │                                    │
│  [GitPanelHeader]    │  File: src/foo.ts                  │
│  [BranchChanges]     │  Commit: abc1234 (or Branch diff)  │
│  ─────────────────   │                                    │
│  UNPUSHED (2)        │  @@ -10,6 +10,8 @@                │
│    ● abc1234 feat..  │  - old line                        │
│      ▸ src/foo.ts    │  + new line                        │
│      ▸ src/bar.ts    │    context line                    │
│    ● def5678 fix..   │                                    │
│  ─────────────────   │                                    │
│  HISTORY (48)        │                                    │
│    ○ 11112222 ...    │                                    │
│    ○ 33334444 ...    │                                    │
└──────────────────────┴────────────────────────────────────┘
```

When a commit is selected:
1. The commit row expands (or a sub-list appears) showing changed files with status badges (A/M/D/R).
2. Clicking a file sets the right panel to show that file's diff within the commit.
3. The commit metadata (subject, author, date, hash) is shown as a compact header above the diff in the right panel.

## Detailed Changes

### 1. New API Endpoint — Per-file commit diff

**File:** `packages/coc-server/src/api-handler.ts`

Add `GET /api/workspaces/:id/git/commits/:hash/files/:path/diff` that returns the diff for a single file within a commit.

Implementation:
```
git diff <parent>...<hash> -- <filePath>
```
For merge commits (multiple parents), use the first parent: `git diff <parent1> <hash> -- <filePath>`.

Use caching with key `commit-file-diff:<hash>:<filePath>` (immutable, same as other commit-keyed caches).

Add a helper in `pipeline-core/src/git/git-log-service.ts`:
```ts
getCommitFileDiff(repoRoot: string, commitHash: string, filePath: string): string
```

### 2. New Component — `CommitFileDiff`

**File:** `packages/coc/src/server/spa/client/react/repos/CommitFileDiff.tsx`

A new right-panel component, analogous to `BranchFileDiff.tsx`, that:
- Receives `workspaceId`, `hash`, `filePath`, and optional commit metadata (subject, author, date).
- Fetches `GET /api/workspaces/:id/git/commits/:hash/files/:filePath/diff`.
- Renders: compact commit header (subject + hash + author/date) → `UnifiedDiffViewer`.
- Handles loading, error, and retry states (same pattern as `BranchFileDiff`).

### 3. Refactor `CommitList` — Expandable file sub-list

**File:** `packages/coc/src/server/spa/client/react/repos/CommitList.tsx`

Currently `CommitList` renders flat commit rows. Changes:
- When a commit is selected, fetch its files via `GET /git/commits/:hash/files` and display them as an indented sub-list under the commit row.
- Each file row shows: status badge (A/M/D/R/C) + file path + optional +/- line counts.
- Clicking a file row calls a new `onFileSelect(hash, filePath, commit)` callback (prop from parent).
- Highlight the currently-selected file row.
- Collapse the file sub-list when a different commit is selected.
- The file list should be lazy-loaded (only fetch when commit is expanded).

### 4. Refactor `CommitDetail` → Remove from right panel (or repurpose)

**File:** `packages/coc/src/server/spa/client/react/repos/CommitDetail.tsx`

Two options:

**Option A (Recommended): Repurpose as compact commit header**
- Strip out the files list and full diff viewer.
- Keep only: subject, hash (copyable), author, date, parent hashes, body.
- Render this as a compact header _above_ the `CommitFileDiff` in the right panel.
- This preserves commit context while showing per-file diff.

**Option B: Remove entirely**
- Merge the metadata display into `CommitFileDiff` directly.
- Simpler but slightly less modular.

### 5. Update `RepoGitTab` — Wire up the new flow

**File:** `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx`

Update the `rightPanelView` state to support a new view type:

```ts
type RightPanelView =
  | { type: 'commit-file'; hash: string; filePath: string; commit: Commit }
  | { type: 'branch-file'; filePath: string }
  | { type: 'empty' }
  // Remove or deprecate: { type: 'commit'; commit: Commit }
```

Changes:
- When a commit is selected in `CommitList`, auto-select the first file (or show an empty state prompting "Select a file to view its diff").
- Pass `onFileSelect` callback to `CommitList` that sets `rightPanelView` to `{ type: 'commit-file', hash, filePath, commit }`.
- Render `CommitFileDiff` (with compact commit header) when `rightPanelView.type === 'commit-file'`.
- Optionally auto-select the first changed file when a commit is clicked for immediate feedback.

### 6. Tests

**Backend tests:**
- `packages/coc-server/src/__tests__/api-handler-git.test.ts` — Add test for the new per-file commit diff endpoint.
- `packages/pipeline-core/src/git/__tests__/git-log-service.test.ts` — Add test for `getCommitFileDiff()`.

**Frontend tests:**
- `CommitFileDiff` component tests (loading, error, retry, render).
- `CommitList` expandable file sub-list tests (expand/collapse, file selection, lazy loading).
- `RepoGitTab` integration tests (commit → file → diff flow).

## File Inventory

| File | Action | Description |
|------|--------|-------------|
| `packages/pipeline-core/src/git/git-log-service.ts` | Edit | Add `getCommitFileDiff()` method |
| `packages/coc-server/src/api-handler.ts` | Edit | Add `GET .../commits/:hash/files/:path/diff` route |
| `packages/coc-server/src/git-cache.ts` | Edit | Add `commit-file-diff:` to immutable prefixes |
| `packages/coc/src/server/spa/client/react/repos/CommitFileDiff.tsx` | **Create** | New right-panel component for per-file commit diff |
| `packages/coc/src/server/spa/client/react/repos/CommitList.tsx` | Edit | Add expandable file sub-list under selected commit |
| `packages/coc/src/server/spa/client/react/repos/CommitDetail.tsx` | Edit | Strip to compact header (remove file list + full diff) |
| `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx` | Edit | New `commit-file` view type, wire `onFileSelect`, update right panel rendering |

## Task Order

1. **Backend: per-file commit diff** — `git-log-service.ts` + `api-handler.ts` + `git-cache.ts`
2. **Component: `CommitFileDiff`** — New component, modeled after `BranchFileDiff`
3. **Component: `CommitList` expansion** — Expandable file sub-list with file selection callback
4. **Component: `CommitDetail` slim-down** — Strip to compact header only
5. **Orchestrator: `RepoGitTab` wiring** — New view type, callbacks, right-panel rendering
6. **Tests** — Backend + frontend tests for all changes

## Edge Cases

- **Merge commits** with multiple parents: use first parent for diff (`git diff <parent1> <hash> -- <file>`).
- **Binary files**: show "Binary file changed" placeholder (same as `UnifiedDiffViewer` already handles).
- **Renamed/copied files** (R/C status): the file path from the API may include `old → new` format; handle display gracefully.
- **Empty commit** (no changed files): show "No files changed" in the expanded sub-list area.
- **Large commits** (100+ files): the file list should be scrollable within the left panel; no pagination needed since git already returns all files.
- **Responsive layout**: On small screens (stacked layout), the expandable file list and right panel should stack vertically, same as current behavior.
