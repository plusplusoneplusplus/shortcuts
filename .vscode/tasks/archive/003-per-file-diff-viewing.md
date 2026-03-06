---
status: pending
---

# 003: Add Per-File Diff Viewing in Branch Changes

## Summary

Add interactive per-file diff viewing to the BranchChanges component, allowing users to click any file row in the expanded file list to fetch and display its inline diff using a single-expand accordion pattern.

## Motivation

Commits 001 and 002 established the API endpoints and the file-listing UI. This final commit completes the UX by enabling users to drill into individual file diffs without leaving the branch changes section. It is isolated as its own commit because it adds fetch-on-demand logic, truncation handling, and new state management on top of the already-working file list.

## Changes

### Files to Create
- (none)

### Files to Modify
- `packages/coc/src/server/spa/client/react/repos/BranchChanges.tsx` — Add per-file diff expand/collapse, diff fetching, truncation, loading/error states

### Files to Delete
- (none)

## Implementation Notes

### State Management

Add three state variables to `BranchChanges`:

```ts
const [expandedFile, setExpandedFile] = useState<string | null>(null);
const [fileDiff, setFileDiff] = useState<string | null>(null);
const [fileDiffLoading, setFileDiffLoading] = useState(false);
const [fileDiffError, setFileDiffError] = useState<string | null>(null);
const [showFullDiff, setShowFullDiff] = useState(false);
```

- `expandedFile` — path of the currently expanded file (null = none). Mirrors the `expandedHash` pattern from `CommitList.tsx` line 29.
- `fileDiff` — raw diff string returned from the API (null = not yet loaded).
- `fileDiffLoading` / `fileDiffError` — loading and error states, matching the pattern from `CommitDetail.tsx` lines 45-46.
- `showFullDiff` — whether truncation is bypassed for the current file (reset on file change).

### Single-Expand Accordion (toggle handler)

```ts
const toggleFileDiff = (path: string) => {
    if (expandedFile === path) {
        // Collapse current
        setExpandedFile(null);
        setFileDiff(null);
        setFileDiffError(null);
        setShowFullDiff(false);
        return;
    }
    // Expand new file — reset state and fetch
    setExpandedFile(path);
    setFileDiff(null);
    setFileDiffError(null);
    setFileDiffLoading(true);
    setShowFullDiff(false);

    fetchApi(
        `/workspaces/${encodeURIComponent(workspaceId)}/git/branch-range/files/${encodeURIComponent(path)}/diff`
    )
        .then(data => setFileDiff(data.diff ?? ''))
        .catch(err => setFileDiffError(err.message || 'Failed to load diff'))
        .finally(() => setFileDiffLoading(false));
};
```

Key decisions:
- On switching files, immediately null out `fileDiff` so the old diff doesn't flash while the new one loads.
- Uses `fetchApi` directly (same as `CommitDetail.tsx` line 52, 72), not `useEffect`, because the fetch is triggered by user interaction.
- The `path` parameter is double-encoded via `encodeURIComponent` to handle paths with `/` in them for the URL segment.

### File Row — Make Clickable

The existing file rows from commit 002 are `<div>` elements. Wrap each file row as a `<button>` (like `CommitList.tsx` line 48-58) to make it keyboard-accessible and clickable:

```tsx
{files.map(f => (
    <div key={f.path}>
        <button
            className="w-full flex items-center gap-2 text-xs py-1 px-1 rounded
                       hover:bg-[#f0f0f0] dark:hover:bg-[#2a2d2e] transition-colors text-left"
            onClick={() => toggleFileDiff(f.path)}
            data-testid={`branch-file-row-${f.path}`}
        >
            <span className="text-[10px] text-[#848484]">
                {expandedFile === f.path ? '▼' : '▶'}
            </span>
            <span className={`font-mono font-bold w-4 text-center ${STATUS_COLORS[f.status] || 'text-[#848484]'}`}
                  title={STATUS_LABELS[f.status] || f.status}>
                {f.status}
            </span>
            <span className="font-mono text-[#1e1e1e] dark:text-[#ccc] flex-1 truncate">{f.path}</span>
            {/* Keep existing +/- stats spans from commit 002 */}
        </button>

        {/* Inline diff panel */}
        {expandedFile === f.path && (
            <div className="pl-6 pr-2 py-2" data-testid={`branch-file-diff-${f.path}`}>
                {fileDiffLoading ? (
                    <div className="flex items-center gap-2 text-xs text-[#848484]">
                        <Spinner size="sm" /> Loading diff...
                    </div>
                ) : fileDiffError ? (
                    <div className="text-xs text-[#d32f2f] dark:text-[#f48771]">
                        Failed to load diff
                    </div>
                ) : (
                    renderDiffContent()
                )}
            </div>
        )}
    </div>
))}
```

### Diff Rendering with Truncation

Constant and helper at the top of the component (or module-level):

```ts
const DIFF_LINE_LIMIT = 500;
```

Render function:

```tsx
const renderDiffContent = () => {
    if (fileDiff === null) return null;
    if (fileDiff === '') {
        return <div className="text-xs text-[#848484] italic">(empty diff)</div>;
    }

    const lines = fileDiff.split('\n');
    const isTruncated = lines.length > DIFF_LINE_LIMIT && !showFullDiff;
    const displayLines = isTruncated ? lines.slice(0, DIFF_LINE_LIMIT) : lines;

    return (
        <>
            <pre
                className="p-3 text-xs font-mono bg-[#f5f5f5] dark:bg-[#2d2d2d]
                           border border-[#e0e0e0] dark:border-[#3c3c3c] rounded
                           overflow-x-auto max-h-[500px] overflow-y-auto whitespace-pre"
                data-testid="branch-file-diff-content"
            >
                {displayLines.join('\n')}
            </pre>
            {isTruncated && (
                <button
                    className="mt-1 text-xs text-[#0078d4] dark:text-[#3794ff] hover:underline"
                    onClick={(e) => { e.stopPropagation(); setShowFullDiff(true); }}
                    data-testid="branch-file-diff-show-all"
                >
                    Diff too large — showing first {DIFF_LINE_LIMIT} lines. Show All
                </button>
            )}
        </>
    );
};
```

CSS classes match `CommitDetail.tsx` line 134 exactly:
- `p-3 text-xs font-mono bg-[#f5f5f5] dark:bg-[#2d2d2d] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded overflow-x-auto max-h-[500px] overflow-y-auto whitespace-pre`

The `e.stopPropagation()` on the "Show All" button prevents the click from bubbling up to the file row button and collapsing the accordion.

### Imports

Add to existing imports in `BranchChanges.tsx`:

```ts
import { Spinner } from '../shared';
import { fetchApi } from '../hooks/useApi';
```

These should already be imported from commit 002 (the component fetches branch-range on mount). Verify and add `Spinner` if missing.

### Reset on Re-mount / Branch Change

When `BranchChanges` re-fetches the branch range data (e.g., due to `workspaceId` change), reset the diff-related state in the same `useEffect` that fetches the file list:

```ts
// Inside the existing useEffect that fetches branch-range
setExpandedFile(null);
setFileDiff(null);
setFileDiffError(null);
setShowFullDiff(false);
```

### STATUS_COLORS / STATUS_LABELS

These constants are already defined in `CommitDetail.tsx` (lines 25-38). Commit 002 likely duplicated them in `BranchChanges.tsx`. No change needed — just use the existing local copies.

## Tests

### Unit Tests (Vitest, in `packages/coc/src/server/spa/client/react/repos/__tests__/BranchChanges.test.tsx`)

Extend the existing test file from commit 002:

1. **File row click fetches diff** — Mock `fetchApi` to resolve with `{ diff: '...' }`. Click a file row button. Assert `fetchApi` was called with the correct per-file diff URL. Assert the `<pre>` element appears with the diff content.

2. **Single-expand accordion** — Expand file A, then click file B. Assert file A's diff panel is no longer in the DOM. Assert file B's diff panel is present and loading.

3. **Collapse on re-click** — Expand file A, click file A again. Assert no diff panel is rendered.

4. **Loading state** — Click a file row. Before fetch resolves, assert `<Spinner>` and "Loading diff..." text are visible.

5. **Error state** — Mock `fetchApi` to reject. Click a file row. Assert "Failed to load diff" message appears. Assert the panel remains open (not collapsed).

6. **Large diff truncation** — Mock `fetchApi` to return a diff with 600 lines. Assert only 500 lines are shown. Assert the "Diff too large — showing first 500 lines. Show All" link is visible.

7. **Show All link reveals full diff** — After truncation, click "Show All". Assert all 600 lines are now rendered. Assert the truncation link is gone.

8. **Empty diff** — Mock `fetchApi` to return `{ diff: '' }`. Assert "(empty diff)" message appears.

## Acceptance Criteria

- [ ] Clicking a file row in the branch changes file list expands an inline diff panel below that row
- [ ] Only one file diff is expanded at a time (single-expand accordion)
- [ ] Clicking the same file row again collapses it
- [ ] A loading spinner is shown while the diff is being fetched
- [ ] If the fetch fails, "Failed to load diff" is shown inline without collapsing the panel
- [ ] Diffs exceeding 500 lines are truncated with a "Show All" link
- [ ] Clicking "Show All" reveals the complete diff
- [ ] Empty diffs show "(empty diff)" in italics
- [ ] Diff `<pre>` block uses the same styling as `CommitDetail` (monospace, scrollable, max-h-[500px])
- [ ] File rows have expand/collapse chevron indicators (▶/▼)
- [ ] File rows are keyboard-accessible (`<button>` elements)
- [ ] Switching workspaces or re-fetching branch data resets all diff state
- [ ] All new behavior is covered by unit tests

## Dependencies
- Depends on: 002 (BranchChanges component with file list rendering and branch-range API fetch)

## Assumed Prior State

From **commit 001**:
- API endpoint `GET /api/workspaces/:id/git/branch-range/files/:path/diff` exists and returns `{ diff: string }`
- Other branch-range endpoints (`branch-range`, `branch-range/files`, `branch-range/diff`) are functional

From **commit 002**:
- `BranchChanges.tsx` exists in `packages/coc/src/server/spa/client/react/repos/`
- Component accepts `workspaceId` prop and fetches `/git/branch-range` on mount
- File list is rendered with `files.map(f => ...)` showing status badge (M/A/D/R), path, and +/- stats
- `STATUS_COLORS` and `STATUS_LABELS` constants are defined locally
- `fetchApi` and `Spinner` are imported
- `BranchChanges` is mounted in `RepoGitTab.tsx` above the Unpushed section
- Test file `BranchChanges.test.tsx` exists with tests for the summary/file list from commit 002
