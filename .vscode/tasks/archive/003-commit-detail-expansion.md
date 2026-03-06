---
status: pending
---

# 003: Add Commit Detail Expansion

## Summary

Add expandable commit rows that display full metadata, file change list with colored status badges, and action buttons. Introduces `CommitDetail` and `FileChangeList` components, and wires expansion state into `CommitList`.

## Motivation

After commit 002 provides the collapsed commit list, users need to click a commit to see its details. This is a self-contained UI addition that introduces no new API endpoints (it consumes the `/git/commits/:hash/files` endpoint from commit 001) and keeps diff rendering for commit 004.

## Changes

### Files to Create

- `packages/coc/src/server/spa/client/react/repos/CommitDetail.tsx` — Expanded view for a single commit: full metadata, file summary, file list, and action buttons.
- `packages/coc/src/server/spa/client/react/repos/FileChangeList.tsx` — Reusable list of changed files with status badges, additions/deletions, and click handlers.

### Files to Modify

- `packages/coc/src/server/spa/client/react/repos/CommitList.tsx` — Add `expandedHash` state, toggle expansion on row click, render `CommitDetail` below expanded rows.

## Implementation Notes

### Correct file paths

The SPA React components live at `packages/coc/src/server/spa/client/react/repos/`, **not** `packages/coc-server/src/spa/client/react/repos/`. The `coc-server` package hosts the wiki SPA (`packages/coc-server/src/wiki/spa/`), while the dashboard SPA is in the `coc` package.

### CommitDetail component

**Props:**
```typescript
interface CommitDetailProps {
    commit: GitCommit;
    workspaceId: string;
    onViewFullDiff?: (hash: string) => void;
    onViewFileDiff?: (hash: string, filePath: string) => void;
}
```

The component receives the full `GitCommit` object from the parent (already available from the commit list response) plus the `workspaceId` for API calls. The `onViewFullDiff` and `onViewFileDiff` callbacks are optional — they'll be wired in commit 004 (diff viewer). Until then, the buttons render but do nothing.

**Data fetching on mount:**
```typescript
const [files, setFiles] = useState<GitCommitFile[]>([]);
const [loadingFiles, setLoadingFiles] = useState(true);

useEffect(() => {
    setLoadingFiles(true);
    fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${commit.hash}/files`)
        .then(data => setFiles(data?.files || []))
        .catch(() => setFiles([]))
        .finally(() => setLoadingFiles(false));
}, [workspaceId, commit.hash]);
```

This mirrors the pattern in `RepoSchedulesTab` where `handleToggleExpand` fetches history on expansion. The difference is that here we fetch inside the detail component's `useEffect` rather than the parent, keeping the parent simpler.

**Layout (top to bottom):**

1. **Metadata block** — Author, email, date, parent hash(es), refs (branches/tags)
   ```
   Author: Jane Doe <jane@example.com>
   Date:   2026-02-28T15:30:00Z
   Parent: x9y8z7w
   Refs:   main, origin/main
   ```
   Uses the existing detail styling pattern from `RepoSchedulesTab`:
   ```typescript
   <div className="text-xs text-[#616161] dark:text-[#999] space-y-1 mb-2.5">
   ```

2. **Full commit message** — Subject is already shown in the row; the body (multi-line message after the first blank line) should also appear. **Caveat:** `GitCommit.subject` captures only the first line (`%s` format). The full body is not available from `getCommit()` — see "GitCommit body limitation" below.

3. **File change summary** — `N files changed` line
   ```typescript
   <div className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc] mb-1.5">
       {files.length} file{files.length !== 1 ? 's' : ''} changed
   </div>
   ```
   Note: Per-file addition/deletion counts are not available from `GitCommitFile` — see "No per-file stats" below.

4. **File list** — Renders `<FileChangeList files={files} onFileClick={onViewFileDiff ? (path) => onViewFileDiff(commit.hash, path) : undefined} />`

5. **Action buttons** — "View Full Diff" and "Copy Hash"
   ```typescript
   <div className="flex gap-1.5 mt-2.5">
       <Button variant="secondary" size="sm"
           onClick={() => onViewFullDiff?.(commit.hash)}
           disabled={!onViewFullDiff}>
           View Full Diff
       </Button>
       <Button variant="secondary" size="sm"
           onClick={() => copyToClipboard(commit.hash)}>
           Copy Hash
       </Button>
   </div>
   ```
   `copyToClipboard` is imported from `'../utils/format'` (already exists).

### FileChangeList component

**Props:**
```typescript
interface FileChangeListProps {
    files: GitCommitFileItem[];
    workspaceId: string;
    commitHash: string;
    onFileClick?: (filePath: string) => void;
    onViewFile?: (filePath: string) => void;
}
```

**Status badge rendering:**

Use inline colored spans (matching the UX spec's status badge colors and the `Badge` component's color palette):

```typescript
const STATUS_CONFIG: Record<string, { label: string; color: string; darkColor: string }> = {
    modified:  { label: 'M', color: '#0078d4', darkColor: '#3794ff' },
    added:     { label: 'A', color: '#16825d', darkColor: '#89d185' },
    deleted:   { label: 'D', color: '#f14c4c', darkColor: '#f48771' },
    renamed:   { label: 'R', color: '#8b5cf6', darkColor: '#a78bfa' },
    copied:    { label: 'C', color: '#8b5cf6', darkColor: '#a78bfa' },
    untracked: { label: '?', color: '#848484', darkColor: '#848484' },
};
```

Each file row:
```typescript
<button
    className={cn(
        'w-full flex items-center gap-2 px-2 py-1 text-left text-xs rounded',
        onFileClick && 'hover:bg-[#f3f3f3] dark:hover:bg-[#2a2a2a] cursor-pointer',
        !onFileClick && 'cursor-default'
    )}
    onClick={() => onFileClick?.(file.path)}
    disabled={!onFileClick}
>
    <span className="font-mono font-bold w-4 text-center text-[10px]"
          style={{ color: STATUS_CONFIG[file.status]?.color }}>
        {STATUS_CONFIG[file.status]?.label || '?'}
    </span>
    <span className="flex-1 font-mono text-[11px] text-[#1e1e1e] dark:text-[#cccccc] truncate">
        {file.status === 'renamed' && file.originalPath
            ? `${file.originalPath} → ${file.path}`
            : file.path}
    </span>
</button>
```

**Dark mode badge colors:** The status badge uses inline `style` with a light-mode color. For dark mode support, use a CSS class approach or check `window.matchMedia('(prefers-color-scheme: dark)')`. However, the simpler approach (matching existing codebase patterns like `RepoSchedulesTab`'s `StatusDot`) is to use a single color that works on both backgrounds. The blue/green/red chosen above have sufficient contrast on both light (`#ffffff`) and dark (`#1e1e1e`) backgrounds.

### CommitList modifications

**State addition:**
```typescript
const [expandedHash, setExpandedHash] = useState<string | null>(null);
```

This follows the exact `expandedId` pattern from `RepoSchedulesTab` (line 45).

**Toggle handler:**
```typescript
const handleToggleExpand = (hash: string) => {
    setExpandedHash(prev => prev === hash ? null : hash);
};
```

**Row rendering changes:**

Each commit row (assumed to be a `<button>` or `<div>` from commit 002) gets:

1. An expand arrow prepended:
   ```typescript
   <span className="text-[10px] text-[#848484]">
       {expandedHash === commit.hash ? '▼' : '▶'}
   </span>
   ```

2. An `onClick` handler: `onClick={() => handleToggleExpand(commit.hash)}`

3. Conditional detail rendering below the row:
   ```typescript
   {expandedHash === commit.hash && (
       <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] px-3 py-2.5">
           <CommitDetail
               commit={commit}
               workspaceId={workspaceId}
               onViewFullDiff={onViewFullDiff}
               onViewFileDiff={onViewFileDiff}
           />
       </div>
   )}
   ```

The `onViewFullDiff` and `onViewFileDiff` props are threaded from `CommitList`'s own props (added in commit 004).

### GitCommit body limitation

The `GitCommit` interface only has `subject` (first line, from `%s`). The full commit body (multi-line message) is not captured. Two options:

**Option A (preferred, minimal):** Accept the limitation for this commit. Show only the subject in the detail view. The subject is already visible in the collapsed row, so the detail view's value comes from the metadata + file list. The full body can be added later by extending `GitLogService.getCommit()` to include `%b` in the format string and adding a `body?: string` field to `GitCommit`.

**Option B (if full message is desired):** In this commit, also modify `packages/pipeline-core/src/git/types.ts` to add `body?: string` to `GitCommit`, and modify `packages/pipeline-core/src/git/git-log-service.ts` to include `%b` in the format string for `getCommit()`. This is a small change but crosses package boundaries.

**Decision:** Go with Option A. The commit subject is sufficient for the initial expansion. Full body support can be added as a follow-up since it requires pipeline-core changes.

### No per-file addition/deletion stats

`GitCommitFile` has `path`, `originalPath`, `status`, `commitHash`, `parentHash`, `repositoryRoot` — but **no** `additions`/`deletions` counts. The UX spec shows `+30 −5` next to each file, but that data isn't available from `getCommitFiles()` (which uses `git diff-tree --name-status`).

**Workaround:** Omit per-file stats in this commit. The file change summary shows only file count (`N files changed`), not line counts. Per-file stats can be added later by extending `getCommitFiles()` to use `--numstat` alongside `--name-status`, or by adding a separate method.

The "N files changed, +X −Y" summary from the UX spec is also omitted since total additions/deletions require `--stat` output. This is acceptable for the initial implementation.

### Imports needed in CommitDetail.tsx

```typescript
import { useState, useEffect } from 'react';
import { Button, cn } from '../shared';
import { fetchApi } from '../hooks/useApi';
import { copyToClipboard, formatRelativeTime } from '../utils/format';
import { FileChangeList } from './FileChangeList';
import type { GitCommit, GitCommitFile } from './types';
```

Note: `GitCommit` and `GitCommitFile` types need to be available client-side. Commit 002 should define these as local TypeScript interfaces mirroring the API response shapes (the pipeline-core types aren't importable in browser code). If commit 002 doesn't define them, this commit should add a `types.ts` file in the repos directory.

### Loading state while fetching files

Show a brief loading indicator inside the expanded section while the file list is loading:
```typescript
{loadingFiles ? (
    <div className="text-xs text-[#848484] py-2">Loading files…</div>
) : (
    <>
        <div className="text-xs font-medium ...">
            {files.length} file{files.length !== 1 ? 's' : ''} changed
        </div>
        <FileChangeList files={files} onFileClick={...} />
    </>
)}
```

This matches the loading pattern seen in `RepoSchedulesTab` and the SPA's general approach of inline text indicators for quick-loading data.

## Tests

Test file: `packages/coc/src/server/spa/client/react/repos/__tests__/CommitDetail.test.tsx` (or co-located in an existing test directory matching coc's test patterns).

Since the SPA uses Vitest, tests should follow the existing component test patterns.

1. **CommitDetail renders commit metadata** — Mount `CommitDetail` with a mock `GitCommit`, verify author name, email, date, parent hashes, and refs render.

2. **CommitDetail fetches file list on mount** — Mock `fetchApi`, mount `CommitDetail`, verify fetch called with correct URL including workspace ID and commit hash.

3. **CommitDetail shows loading state while fetching** — Mount component, verify "Loading files…" text appears before fetch resolves.

4. **CommitDetail renders file list after fetch** — Resolve fetch mock with file data, verify `FileChangeList` receives correct files.

5. **Copy Hash copies to clipboard** — Click "Copy Hash" button, verify `navigator.clipboard.writeText` called with full commit hash.

6. **View Full Diff button calls handler** — Pass `onViewFullDiff` prop, click button, verify called with commit hash.

7. **View Full Diff button disabled when no handler** — Omit `onViewFullDiff` prop, verify button is disabled.

8. **FileChangeList renders correct status badges** — Mount with files of each status type (M/A/D/R/C), verify each badge letter and color.

9. **FileChangeList shows rename with arrow** — Mount with a renamed file (`status: 'renamed'`, `originalPath: 'old.ts'`, `path: 'new.ts'`), verify `old.ts → new.ts` rendered.

10. **FileChangeList file click calls handler** — Pass `onFileClick`, click a file row, verify called with file path.

11. **CommitList row click expands/collapses** — Mount `CommitList` with commits, click a row, verify `CommitDetail` renders; click same row, verify it collapses.

12. **CommitList expands only one at a time** — Expand commit A, then click commit B, verify A collapses and B expands.

13. **CommitList shows toggle arrows** — Verify `▶` for collapsed and `▼` for expanded rows.

## Acceptance Criteria

- [ ] Clicking a commit row in `CommitList` expands it to show `CommitDetail`
- [ ] Only one commit can be expanded at a time (clicking another collapses the previous)
- [ ] Toggle arrow changes from `▶` (collapsed) to `▼` (expanded)
- [ ] Expanded view shows: author name + email, date, parent hash(es), refs
- [ ] File list fetched from `/api/workspaces/:id/git/commits/:hash/files` on expansion
- [ ] Loading indicator shown while file list is fetching
- [ ] Changed files displayed with colored status badges: M=blue, A=green, D=red, R/C=purple
- [ ] Renamed files show `old-path → new-path` format
- [ ] "Copy Hash" button copies full hash to clipboard via `copyToClipboard()` utility
- [ ] "View Full Diff" button renders (disabled until commit 004 wires the handler)
- [ ] File rows are clickable (handler optional, used by commit 004)
- [ ] Empty file list shows `0 files changed` (not an error)
- [ ] All tests pass: `npm run test:run` in `packages/coc/`
- [ ] No changes to `pipeline-core` (per-file stats and commit body deferred)

## Dependencies

- Depends on: 001, 002

## Assumed Prior State

Commit 001 provides the `GET /api/workspaces/:id/git/commits/:hash/files` endpoint returning `{ files: GitCommitFile[] }`. Commit 002 provides `CommitList.tsx` with collapsed commit rows (short hash, subject, relative date, author), `RepoHistoryTab.tsx` as the tab container, and local TypeScript interfaces for `GitCommit` and `GitCommitFile` mirroring the API response shapes. The `fetchApi` utility, `copyToClipboard` function, `Button`/`Card`/`cn` shared components, and the `▶`/`▼` expand/collapse pattern (from `RepoSchedulesTab`) all exist in the codebase.
