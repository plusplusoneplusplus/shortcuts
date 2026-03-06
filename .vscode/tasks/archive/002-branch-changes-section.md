---
status: pending
---

# 002: Add BranchChanges Section to Git Tab

## Summary

Create a `BranchChanges` React component that surfaces branch-range analysis data (commit count, additions/deletions, changed files) and integrate it at the top of the `RepoGitTab`, hidden when on the default branch.

## Motivation

The branch-range API endpoints from commit 001 are useless without a UI. This commit adds the visual section that calls those endpoints, shows a collapsible summary header, and lists changed files with status badges and diff stats. It is a separate commit because it is a pure client-side React change with no server-side modifications.

## Changes

### Files to Create

- `packages/coc/src/server/spa/client/react/repos/BranchChanges.tsx` — New React component rendering the "Branch Changes" collapsible section. Fetches from the commit-001 API endpoints and renders a summary header and expandable file list.

### Files to Modify

- `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx` — Import and render `<BranchChanges>` at the top of the tab (before the Unpushed and History sections). Pass `workspaceId` as a prop.
- `packages/coc/src/server/spa/client/react/repos/index.ts` — Add `BranchChanges` to the barrel exports.

### Files to Delete

- (none)

## Implementation Notes

### BranchChanges.tsx Component Structure

**Props interface:**
```ts
interface BranchChangesProps {
    workspaceId: string;
}
```

**Internal types (mirroring server response shapes — not importing from pipeline-core since this is a browser bundle):**
```ts
interface BranchRangeInfo {
    baseRef: string;
    headRef: string;
    commitCount: number;
    additions: number;
    deletions: number;
    mergeBase: string;
    branchName?: string;
}

interface BranchRangeFile {
    path: string;
    status: string;       // 'modified' | 'added' | 'deleted' | 'renamed' | 'copied'
    additions: number;
    deletions: number;
    oldPath?: string;
}
```

**State variables:**
- `rangeInfo: BranchRangeInfo | null` — null = still loading or on default branch
- `files: BranchRangeFile[]` — populated when expanded
- `loading: boolean` — true during initial range fetch
- `filesLoading: boolean` — true during file list fetch
- `expanded: boolean` — collapsed by default (`false`)
- `hidden: boolean` — true when API returns `{ onDefaultBranch: true }` or on any error

**Fetch pattern (matches existing `fetchApi` usage):**

1. On mount (via `useEffect([workspaceId])`), call:
   ```
   GET /workspaces/${encodeURIComponent(workspaceId)}/git/branch-range
   ```
   - If response has `onDefaultBranch: true` → set `hidden = true`, return.
   - Otherwise → set `rangeInfo` from response.
   - On error → set `hidden = true` (silent failure; this section is non-critical).

2. When user expands the section (`expanded` transitions to `true`) and `files` is empty, fetch:
   ```
   GET /workspaces/${encodeURIComponent(workspaceId)}/git/branch-range/files
   ```
   - Set `files` from `data.files`.
   - On error → show inline error text inside the expanded area.

Use `fetchApi()` imported from `../hooks/useApi` (same pattern as `CommitDetail` and `RepoGitTab`).

**Rendering — collapsed state:**
```
┌─ Branch Changes: feature/retry-logic ──────────────────┐
│  7 commits ahead of main  ·  +145 −32  ·  12 files  [▶]│
└────────────────────────────────────────────────────────┘
```

- Outer `div` with class pattern: `branch-changes` (component root) with standard border-b like CommitList headers.
- Header bar is a `<button>` (clickable to toggle expand), styled like CommitList's `<h3>` header but with more info:
  - Left: `"Branch Changes: {branchName}"` — bold, `text-xs font-semibold uppercase tracking-wide` matching CommitList header style.
  - Below or inline: `"{commitCount} commits ahead of {baseRef short name} · +{additions} −{deletions} · {files.length} files"` — lighter text, `text-xs text-[#616161] dark:text-[#999]`.
  - Right: expand indicator `▶` / `▼` — `text-[10px] text-[#848484]` matching CommitList expand arrows.
- Background: `bg-[#f5f5f5] dark:bg-[#252526]` (matches CommitList header).

**Rendering — expanded state:**

Show a file list below the header. Style each file row identically to CommitDetail's file rows:

```tsx
<div className="flex items-center gap-2 text-xs py-0.5">
    <span className={`font-mono font-bold w-4 text-center ${statusColor}`} title={statusLabel}>
        {statusChar}
    </span>
    <span className="font-mono text-[#1e1e1e] dark:text-[#ccc] break-all flex-1">
        {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
    </span>
    <span className="text-[#16825d] text-xs flex-shrink-0">+{file.additions}</span>
    <span className="text-[#d32f2f] text-xs flex-shrink-0">−{file.deletions}</span>
</div>
```

**Status mapping (matching CommitDetail's STATUS_COLORS and extending for Renamed):**
```ts
const STATUS_CHARS: Record<string, string> = {
    added: 'A',
    modified: 'M',
    deleted: 'D',
    renamed: 'R',
    copied: 'C',
};

const STATUS_COLORS: Record<string, string> = {
    added:    'text-[#16825d]',   // green (matches CommitDetail 'A')
    modified: 'text-[#0078d4]',   // blue (matches CommitDetail 'M')
    deleted:  'text-[#d32f2f]',   // red (matches CommitDetail 'D')
    renamed:  'text-[#9c27b0]',   // purple (new, for renames)
    copied:   'text-[#848484]',   // gray fallback
};

const STATUS_LABELS: Record<string, string> = {
    added: 'Added',
    modified: 'Modified',
    deleted: 'Deleted',
    renamed: 'Renamed',
    copied: 'Copied',
};
```

Note: CommitDetail uses single-char keys (`A`, `M`, `D`) because the git commit file API returns single-char statuses. The branch-range API returns full word statuses (`modified`, `added`, etc.) from `GitChangeStatus`, so the maps must use full words as keys.

**Loading states:**
- While `loading` is true (initial range fetch): render nothing (don't show spinner — the whole section is optional and should not delay the page).
- While `filesLoading` is true (file list fetch after expand): show `<Spinner size="sm" />` and "Loading files..." inside the expanded area, same pattern as CommitDetail's `files-loading`.

**Error handling:**
- Range fetch error → set `hidden = true` (section disappears silently).
- File list fetch error → show inline error text `text-xs text-[#d32f2f] dark:text-[#f48771]` inside expanded area.

**Data test IDs:**
- `data-testid="branch-changes"` — outer container
- `data-testid="branch-changes-header"` — clickable header button
- `data-testid="branch-changes-summary"` — summary text line
- `data-testid="branch-changes-files"` — file list container
- `data-testid="branch-changes-files-loading"` — loading indicator
- `data-testid="branch-changes-files-error"` — error message

**baseRef short name extraction:**
Extract the short name from `rangeInfo.baseRef` for display (e.g., `origin/main` → `main`):
```ts
const baseShort = rangeInfo.baseRef.replace(/^origin\//, '');
```

### RepoGitTab.tsx Modifications

Minimal changes:
1. Add import: `import { BranchChanges } from './BranchChanges';`
2. Insert `<BranchChanges workspaceId={workspaceId} />` as the first child inside the `repo-git-tab` div, before the unpushed `<CommitList>`.

The BranchChanges component self-manages its visibility (renders `null` when hidden/loading), so RepoGitTab does not need any conditional logic.

### index.ts Modifications

Add one export line:
```ts
export { BranchChanges } from './BranchChanges';
```

## Tests

Tests should be placed in a test file alongside the component or in the existing test directory structure for the SPA.

- **Renders nothing when on default branch** — Mock `fetchApi` to return `{ onDefaultBranch: true }`. Assert the component renders `null` (no DOM output).
- **Renders nothing on range fetch error** — Mock `fetchApi` to reject. Assert component renders `null`.
- **Renders collapsed summary on feature branch** — Mock `fetchApi` to return a valid `GitCommitRange`-like object. Assert header shows branch name, commit count, +/- stats. Assert file list is NOT rendered.
- **Expands to show file list on click** — Mock range fetch, then mock files fetch. Click the header button. Assert `filesLoading` spinner appears, then file rows render with correct status badges, paths, and +/- numbers.
- **Shows renamed file with old → new path** — Include a file with `status: 'renamed'` and `oldPath` set. Assert the rendered text contains `oldPath → path`.
- **Shows error inline when file fetch fails** — Mock range fetch to succeed, mock files fetch to reject. Click expand. Assert error message is visible inside expanded area.
- **Integration: BranchChanges appears in RepoGitTab** — Render `<RepoGitTab>` with mocked API. Assert `branch-changes` testid appears before commit lists.

## Acceptance Criteria

- [ ] `BranchChanges` component renders a collapsible section at the top of the Git tab
- [ ] Section is hidden (renders null) when on the default branch
- [ ] Section is hidden (renders null) on any range-fetch error
- [ ] Collapsed state shows: branch name, commit count, additions/deletions, file count
- [ ] Clicking header expands the section and fetches the file list
- [ ] File rows show status badge (A/M/D/R/C) with correct colors matching CommitDetail palette
- [ ] Renamed files display `oldPath → newPath`
- [ ] Each file row shows +additions and −deletions counts
- [ ] Loading spinner shown during file fetch
- [ ] Inline error shown if file fetch fails
- [ ] RepoGitTab renders BranchChanges before Unpushed and History sections
- [ ] BranchChanges exported from repos/index.ts barrel
- [ ] All data-testid attributes present for testability

## Dependencies

- Depends on: 001 (branch-range API endpoints in coc-server)

## Assumed Prior State

From commit 001, these API endpoints exist and are functional:
- `GET /api/workspaces/:id/git/branch-range` — returns `GitCommitRange` (with `baseRef`, `headRef`, `commitCount`, `additions`, `deletions`, `branchName`, `files`, `mergeBase`, `repositoryRoot`, `repositoryName`) or `{ onDefaultBranch: true }`
- `GET /api/workspaces/:id/git/branch-range/files` — returns `{ files: GitCommitRangeFile[] }` where each file has `path`, `status` (full word: `modified`, `added`, etc.), `additions`, `deletions`, optional `oldPath`, and `repositoryRoot`
- `GitRangeService` is instantiated as a lazy singleton in `api-handler.ts`
- `fetchApi()` from `../hooks/useApi` is available and throws on non-ok responses
- `Spinner` component from `../shared` is available
- CommitDetail, CommitList, and RepoGitTab exist with patterns described in the implementation notes above
