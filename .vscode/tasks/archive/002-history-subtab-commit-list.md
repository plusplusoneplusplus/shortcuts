---
status: pending
---

# 002: Add History Sub-Tab with Commit List

## Summary

Add a "History" sub-tab to the workspace detail view that displays a paginated commit list, grouping unpushed commits separately at the top.

## Motivation

This is separated from the API commit (001) because it introduces pure UI concerns — React component hierarchy, sub-tab registration, fetch/state/render lifecycle, and pagination UX — that are independently reviewable and testable against the already-available API.

## Changes

### Files to Create

- `packages/coc/src/server/spa/client/react/repos/RepoHistoryTab.tsx` — Top-level container component for the History sub-tab. Owns the fetch lifecycle, pagination state, and unpushed/history grouping logic. Renders `CommitList` for each section.
- `packages/coc/src/server/spa/client/react/repos/CommitList.tsx` — Presentational component that renders a list of commit rows. Receives commits as props and exposes an `onCommitClick` callback for future expansion (commit 003). Handles loading skeleton, empty state, and error display.

### Files to Modify

- `packages/coc/src/server/spa/client/react/types/dashboard.ts` — Add `'history'` to the `RepoSubTab` union type (line 6).
- `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx` — Import `RepoHistoryTab`, add `{ key: 'history', label: 'History' }` to `SUB_TABS` array, add render branch for the history tab in the sub-tab content area.

## Implementation Notes

### 1. Type Change (`dashboard.ts`)

```ts
// Before
export type RepoSubTab = 'info' | 'pipelines' | 'tasks' | 'queue' | 'schedules' | 'chat';

// After
export type RepoSubTab = 'info' | 'pipelines' | 'tasks' | 'queue' | 'schedules' | 'chat' | 'history';
```

### 2. Sub-Tab Registration (`RepoDetail.tsx`)

Add to `SUB_TABS` array (after `'chat'`):

```ts
{ key: 'history', label: 'History' },
```

Add import:

```ts
import { RepoHistoryTab } from './RepoHistoryTab';
```

Add render branch inside the `<div className="h-full overflow-y-auto min-w-0">` block alongside the other non-tasks tabs (around line 145):

```tsx
{activeSubTab === 'history' && <RepoHistoryTab workspaceId={ws.id} />}
```

This follows the exact same pattern as `RepoQueueTab`, `RepoSchedulesTab`, and `RepoChatTab`, which all receive `workspaceId` as a prop and render inside the scrollable overflow div.

### 3. `RepoHistoryTab.tsx` — Container Component

**Props:**
```ts
interface RepoHistoryTabProps {
    workspaceId: string;
}
```

**State:**
```ts
const [commits, setCommits] = useState<GitCommitItem[]>([]);
const [loading, setLoading] = useState(true);
const [loadingMore, setLoadingMore] = useState(false);
const [error, setError] = useState<string | null>(null);
const [hasMore, setHasMore] = useState(false);
```

**Commit type (local to file or in a shared types location):**
```ts
interface GitCommitItem {
    hash: string;
    shortHash: string;
    subject: string;
    body: string;
    authorName: string;
    authorEmail: string;
    date: string;           // ISO 8601
    parentHashes: string[];
    isAheadOfRemote?: boolean;
}
```

This matches the shape returned by the `GET /api/workspaces/:id/git/commits` endpoint from commit 001. The `isAheadOfRemote` flag is set server-side by comparing against the tracking branch.

**Fetch lifecycle:**
- On mount (and when `workspaceId` changes), call `fetchCommits(0)`.
- `fetchCommits(skip: number)` calls `fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/commits?limit=20&skip=${skip}`)`.
- On success: if `skip === 0`, replace `commits`; otherwise append. Set `hasMore` from response.
- On error: set `error` message, show toast via `useGlobalToast` from `../context/ToastContext`.
- Reset all state when `workspaceId` changes (use `useEffect` cleanup or key-based reset).

**Grouping logic:**
```ts
const unpushed = commits.filter(c => c.isAheadOfRemote === true);
const pushed = commits.filter(c => c.isAheadOfRemote !== true);
```

Unpushed section only renders when `unpushed.length > 0`.

**Render structure:**
```tsx
<div className="p-4 flex flex-col gap-4">
    {/* Unpushed section - only when unpushed commits exist */}
    {unpushed.length > 0 && (
        <div>
            <h3 className="text-[11px] uppercase text-[#848484] mb-1 font-medium">
                Unpushed <span className="text-[10px]">({unpushed.length})</span>
            </h3>
            <div className="border-l-2 border-[#0078d4] dark:border-[#3794ff] pl-3">
                <CommitList commits={unpushed} onCommitClick={handleCommitClick} />
            </div>
        </div>
    )}

    {/* History section */}
    <div>
        <h3 className="text-[11px] uppercase text-[#848484] mb-1 font-medium">
            History
        </h3>
        <CommitList
            commits={pushed}
            loading={loading}
            onCommitClick={handleCommitClick}
        />
    </div>

    {/* Load More */}
    {hasMore && !loading && (
        <div className="flex justify-center">
            <Button
                variant="ghost"
                size="sm"
                disabled={loadingMore}
                onClick={handleLoadMore}
                data-testid="history-load-more"
            >
                {loadingMore ? 'Loading...' : 'Load More'}
            </Button>
        </div>
    )}
</div>
```

**`handleCommitClick`:** A no-op callback in this commit (`(hash: string) => {}`). Commit 003 will wire it up to expand commit detail.

**`handleLoadMore`:**
```ts
const handleLoadMore = async () => {
    setLoadingMore(true);
    await fetchCommits(commits.length);
    setLoadingMore(false);
};
```

**Imports:**
```ts
import { useState, useEffect } from 'react';
import { fetchApi } from '../hooks/useApi';
import { Button } from '../shared';
import { useGlobalToast } from '../context/ToastContext';
import { CommitList } from './CommitList';
```

### 4. `CommitList.tsx` — Presentational Component

**Props:**
```ts
interface CommitListProps {
    commits: GitCommitItem[];
    loading?: boolean;
    onCommitClick?: (hash: string) => void;
}
```

**Commit row (collapsed):**
Each row renders as a clickable div showing:
- Short hash in monospace, muted color (`text-[#848484] font-mono text-[11px]`)
- Subject, truncated to ~80 chars (`text-xs text-[#1e1e1e] dark:text-[#cccccc] truncate`)
- Relative date via `formatRelativeTime(commit.date)` (`text-[11px] text-[#848484]`)
- Author name (`text-[11px] text-[#848484]`)

Row layout uses flexbox with consistent spacing:
```tsx
<div
    className="flex items-center gap-3 py-1.5 px-2 rounded cursor-pointer
               hover:bg-[#f0f0f0] dark:hover:bg-[#2a2a2a] transition-colors"
    onClick={() => onCommitClick?.(commit.hash)}
    data-testid={`commit-row-${commit.shortHash}`}
>
    <span className="text-[11px] font-mono text-[#848484] flex-shrink-0 w-16">
        {commit.shortHash}
    </span>
    <span className="text-xs text-[#1e1e1e] dark:text-[#cccccc] flex-1 truncate">
        {commit.subject}
    </span>
    <span className="text-[11px] text-[#848484] flex-shrink-0">
        {formatRelativeTime(commit.date)}
    </span>
    <span className="text-[11px] text-[#848484] flex-shrink-0 max-w-[100px] truncate">
        {commit.authorName}
    </span>
</div>
```

**Loading state:**
When `loading` is true and `commits` is empty, render 4 skeleton rows with pulse animation:
```tsx
{loading && commits.length === 0 && (
    <div className="flex flex-col gap-1" data-testid="commit-list-skeleton">
        {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-1.5 px-2 animate-pulse">
                <span className="bg-[#e0e0e0] dark:bg-[#3c3c3c] rounded h-3 w-16" />
                <span className="bg-[#e0e0e0] dark:bg-[#3c3c3c] rounded h-3 flex-1" />
                <span className="bg-[#e0e0e0] dark:bg-[#3c3c3c] rounded h-3 w-12" />
                <span className="bg-[#e0e0e0] dark:bg-[#3c3c3c] rounded h-3 w-16" />
            </div>
        ))}
    </div>
)}
```

**Empty state:**
When not loading and commits is empty:
```tsx
{!loading && commits.length === 0 && (
    <div className="text-center py-6 text-sm text-[#848484]" data-testid="commit-list-empty">
        No commits yet
    </div>
)}
```

**Error state:**
Errors are handled by the parent `RepoHistoryTab` via toast notifications (matching the pattern used by `RepoSchedulesTab` and other tab components). `CommitList` itself does not render error UI — it simply shows the skeleton or empty state depending on load status.

**Imports:**
```ts
import { formatRelativeTime } from '../utils/format';
```

### Key Patterns Followed

| Pattern | Source | How Applied |
|---------|--------|-------------|
| Sub-tab registration | `RepoDetail.tsx` lines 29-36 | Add entry to `SUB_TABS` array |
| Tab component props | `RepoQueueTab`, `RepoSchedulesTab` | Receive `workspaceId: string` |
| API fetching | `RepoSchedulesTab` lines 49-56 | Use `fetchApi()` from `../hooks/useApi` |
| State management | `RepoQueueTab` lines 40-48 | `useState` hooks for data, loading, error |
| Toast notifications | `RepoSchedulesTab`, `PipelineDetail` | `useGlobalToast()` for error toasts |
| Section headings | `RepoQueueTab` lines 272-274 | `text-[11px] uppercase text-[#848484] font-medium` |
| Loading text | `RepoInfoTab` line 69 | `text-xs text-[#848484]` with "Loading..." |
| Empty state | `RepoQueueTab` line 227 | Centered `text-sm text-[#848484]` message |
| Relative time display | `RepoInfoTab`, `RepoQueueTab` | `formatRelativeTime()` from `../utils/format` |
| Button variants | `RepoQueueTab` lines 218-226 | `Button` from `../shared` with `variant="ghost"` |

### Gotchas

1. **Path correction:** The SPA lives under `packages/coc/src/server/spa/client/react/`, not `packages/coc-server/`. The commit plan references `coc-server` paths but the actual code is in `packages/coc/`.
2. **`fetchApi` signature:** The `fetchApi` from `../hooks/useApi` only supports GET by default (calls `fetch(url)` without method option). For POST/DELETE, components use `fetch(getApiBase() + path, { method })` directly. This commit only needs GET, so `fetchApi` is sufficient.
3. **`useEffect` cleanup:** When `workspaceId` changes, the old fetch may still be in-flight. Use an `aborted` flag pattern (like `let cancelled = false` in the effect, checked before `setState`) or an `AbortController` to prevent state updates on unmounted/stale components.
4. **Scroll position:** The history tab renders inside `<div className="h-full overflow-y-auto">` from `RepoDetail.tsx`, so the "Load More" button stays naturally at the scroll bottom.
5. **`GitCommitItem` and `GitCommitFileItem` types:** Create a `git-types.ts` file at `packages/coc/src/server/spa/client/react/repos/git-types.ts` and export both types for reuse by `CommitList.tsx` and later commits (003, 004). Do not put them in `dashboard.ts` since they are git-specific, not dashboard-wide state. `GitCommitFileItem` mirrors pipeline-core's `GitCommitFile` shape: `{ path, originalPath?, status, commitHash, parentHash }`.
6. **Hash routing:** The `switchSubTab` function in `RepoDetail.tsx` already handles hash updates (`#repos/:id/history`). No additional routing logic needed.

## Tests

Tests should be placed alongside the components or in a dedicated test file (following the project's Vitest pattern for the SPA):

- **RepoHistoryTab renders without crashing** — Mount with a mock `workspaceId`, verify component renders.
- **Fetches commits on mount** — Verify `fetchApi` is called with `/workspaces/{id}/git/commits?limit=20&skip=0` on mount.
- **Displays unpushed section when commits have `isAheadOfRemote`** — Provide commits with `isAheadOfRemote: true`, verify "Unpushed" heading and border appear.
- **Hides unpushed section when no unpushed commits** — Provide all commits with `isAheadOfRemote: false`, verify "Unpushed" heading does not appear.
- **Load More button appears when `hasMore` is true** — Mock API returning `{ commits: [...], hasMore: true }`, verify button with `data-testid="history-load-more"` is present.
- **Load More appends new commits** — Click Load More, verify second fetch uses `skip=20`, verify commit count increases.
- **Shows loading state while fetching** — Verify skeleton rows (`data-testid="commit-list-skeleton"`) appear during initial load.
- **Shows error toast on API failure** — Mock API to reject, verify `addToast` is called with error message.
- **CommitList renders commit rows** — Provide 3 commits, verify 3 rows with correct short hash and subject.
- **CommitList shows empty state** — Provide empty array with `loading=false`, verify "No commits yet" message.
- **CommitList calls onCommitClick** — Click a row, verify callback called with commit hash.
- **RepoSubTab type includes 'history'** — Type-level check that `'history'` is assignable to `RepoSubTab`.
- **SUB_TABS includes history entry** — Import `SUB_TABS`, verify it contains `{ key: 'history', label: 'History' }`.

## Acceptance Criteria

- [ ] `RepoSubTab` type includes `'history'`
- [ ] "History" tab appears in the workspace detail sub-tab bar
- [ ] Clicking "History" tab renders `RepoHistoryTab`
- [ ] Commit list loads automatically on tab activation
- [ ] Commits with `isAheadOfRemote === true` grouped in "Unpushed" section at top
- [ ] "Unpushed" section hidden when no unpushed commits exist
- [ ] Each commit row shows: short hash (monospace), subject (truncated), relative date, author name
- [ ] "Load More" button appears when API returns `hasMore: true`
- [ ] "Load More" fetches next 20 commits and appends them to the list
- [ ] Loading state shows skeleton rows with pulse animation
- [ ] API errors show toast notification
- [ ] Empty state shows "No commits yet" when repository has no commits
- [ ] Hash URL updates to `#repos/:id/history` when tab is active

## Dependencies

- Depends on: 001 (API endpoints at `GET /api/workspaces/:id/git/commits`)

## Assumed Prior State

Commit 001 provides REST endpoints for fetching commits. The endpoint `GET /api/workspaces/:id/git/commits?limit=N&skip=N` returns `{ commits: GitCommitItem[], hasMore: boolean }` where each commit includes `hash`, `shortHash`, `subject`, `body`, `authorName`, `authorEmail`, `date`, `parentHashes`, and `isAheadOfRemote`.
