# Git Tab: Commit Detail UX Redesign

## Problem

Currently in the COC dashboard Git tab, when a user clicks a commit in the left panel, the right panel shows **everything**: commit metadata (author, date, parents, description), the changed file list, and the full unified diff. This overloads the right panel and makes it harder to focus on the actual code changes.

## Proposed Approach

Redistribute information across the two panels so each has a clear, focused role:

| Panel | Current | Proposed |
|-------|---------|----------|
| **Left (commit list)** | Commit rows only (hash, subject, time, author) | Commit rows + **expandable file list** on click + **hover tooltip** with commit metadata |
| **Right (detail)** | Metadata + file list + full diff | **Diff only** (per-file or full commit diff) |

### Visual Description

**Left panel — commit row hover tooltip:**
```
┌─────────────────────────────────────────┐
│ feat: add file path hover preview...    │
│                                         │
│ Author: Yiheng Tao                      │
│ Date:   3/1/2026, 11:52:32 PM          │
│ Hash:   392ba345                        │
│ Parents: 42ce57d                        │
│                                         │
│ Add interactive behaviors for           │
│ .file-path-link spans in the markdown   │
│ review webview...                       │
└─────────────────────────────────────────┘
```

**Left panel — commit row expanded (after click):**
```
● 392ba345  feat: add file path hover an...
  4h ago · Yiheng Tao
  ├─ M  media/styles/components.css
  ├─ M  src/shortcuts/markdown-comments/editor-host.ts
  ├─ M  src/shortcuts/markdown-comments/editor-message-router.ts
  └─ ...  (9 files changed)
```

**Right panel — diff only (no header metadata, no file list):**
Shows the unified diff for the selected commit (or per-file diff if a file is clicked in the left panel file list).

## Files to Modify

### 1. `CommitList.tsx` — Add hover tooltip + expandable file list
**Path:** `packages/coc/src/server/spa/client/react/repos/CommitList.tsx`

Changes:
- Add a **hover tooltip** on each commit row that shows: full subject, author, date, hash, parents, and body (commit description). Use a 250ms hover delay to avoid flicker.
- Add **expand/collapse** behavior: clicking a commit expands it to show the list of changed files beneath the commit row in the left panel. The file list is fetched from the existing `/git/commits/:hash/files` API endpoint.
- Add a new `onFileSelect` callback prop so clicking a file in the expanded list can trigger showing that file's diff in the right panel.
- Add a new `workspaceId` prop (needed to fetch the file list).
- Each file entry shows the status badge (A/M/D/R/C/T) and file path, reusing the same styling currently in `CommitDetail.tsx`.

### 2. `CommitDetail.tsx` — Strip down to diff-only view
**Path:** `packages/coc/src/server/spa/client/react/repos/CommitDetail.tsx`

Changes:
- **Remove** the header bar section (`commit-detail-header`): subject, hash pill, copy hash button, author, date, parents.
- **Remove** the commit body/description section (`commit-body`).
- **Remove** the files list section (`file-change-list`).
- Keep **only** the diff section (loading, error, retry, `UnifiedDiffViewer`).
- Update `CommitDetailProps` to only require `workspaceId` and `hash` (remove `subject`, `author`, `date`, `parentHashes`, `body`).
- Add support for an optional `filePath` prop — when provided, fetch the per-file diff instead of the full commit diff (use `/git/commits/:hash/files/:filePath/diff` or filter the existing diff).

### 3. `RepoGitTab.tsx` — Wire up new interactions
**Path:** `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx`

Changes:
- Update `RightPanelView` type to include a new variant for per-file commit diff: `{ type: 'commit-file'; hash: string; filePath: string }`.
- Pass `workspaceId` and `onFileSelect` to `CommitList` components.
- When a file is clicked in the expanded commit file list, set `rightPanelView` to `{ type: 'commit-file', hash, filePath }`.
- When a commit is selected (but no specific file), show the full commit diff in the right panel.
- Update the `detailPanel` rendering to handle the new simplified `CommitDetail` props.
- Move the "Copy Hash" button into the left-panel tooltip or the expanded section (so it's not lost entirely).

### 4. New component: `CommitTooltip.tsx` (optional — could be inline in CommitList)
**Path:** `packages/coc/src/server/spa/client/react/repos/CommitTooltip.tsx`

A small presentational component for the hover tooltip that shows:
- Full commit subject (not truncated)
- Author, date (formatted), hash, parents
- Commit body/description (if any, truncated to ~10 lines with scroll)
- Copy Hash button

### 5. Test files to update
- `packages/coc/test/spa/react/CommitList.test.ts` — Add tests for hover tooltip presence, file list expansion, `workspaceId` and `onFileSelect` props.
- `packages/coc/test/spa/react/CommitDetail.test.ts` — Update tests: remove assertions for header/metadata/file-list sections; add assertions for diff-only rendering and optional `filePath` prop.
- `packages/coc/test/spa/react/RepoGitTab.test.ts` — Update tests for new `RightPanelView` variant, file selection flow, and simplified `CommitDetail` props.

## Implementation Todos

1. **Create `CommitTooltip` component** — Presentational tooltip with commit metadata (subject, author, date, hash, parents, body).
2. **Update `CommitList`** — Add hover tooltip (with 250ms delay), expandable file list per commit, `workspaceId` prop, `onFileSelect` callback, file list fetching from API.
3. **Simplify `CommitDetail`** — Remove metadata header, body, and file list sections. Keep diff-only. Support optional `filePath` for per-file diffs.
4. **Update `RepoGitTab`** — Wire new props/callbacks, add `commit-file` right panel variant, adjust `detailPanel` rendering.
5. **Update tests** — Adjust all three test files for the new structure.

## Notes

- The hover tooltip should use CSS positioning (absolute/fixed) relative to the hovered row, similar to the existing file-path-preview pattern in the codebase.
- The file list in the left panel should be lazy-loaded (fetched on first expand, cached for subsequent toggles).
- The left panel width (320px) may need a slight increase or the file paths should truncate with ellipsis to fit.
- Keyboard accessibility: expanded file lists should be navigable with arrow keys.
- The "Copy Hash" action should remain accessible — either in the tooltip or as a right-click context menu option.
- No backend API changes needed — all required endpoints already exist.
