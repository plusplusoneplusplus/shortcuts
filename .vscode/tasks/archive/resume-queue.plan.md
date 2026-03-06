# Plan: Resume Queue After Pause

## Problem

When a repo's queue is paused (via `POST /api/queue/pause?repoId=...`), there is no discoverable way to resume it from the Queue sub-tab in `RepoDetail`.

**Root cause (UX gap):** The only resume affordance lives inside `RepoQueueTab`'s inner toolbar — a small, unlabeled `▶` ghost button rendered at the end of the task-list toolbar (line 305–316). This button is:
- Icon-only (`▶`), no text label
- Rendered inside the left split-panel of the queue tab, not in the prominent header
- Absent from the `RepoDetail` header, which is where users naturally look for repo-level controls

The `+ Queue Task` button **is** shown in the `RepoDetail` header when the queue sub-tab is active, but no pause/resume control appears there.

The backend `POST /api/queue/resume?repoId={id}` endpoint already exists and works correctly.

## Scope

- **In scope:** Add a clear "Resume" button to the `RepoDetail` header when the queue sub-tab is active and the repo's queue is paused.
- **In scope:** Optionally add a visible banner/callout inside `RepoQueueTab` when the queue is paused, to surface the resume action to users who are looking at the task list.
- **Out of scope:** Changes to the global-queue pause/resume flow (ProcessesSidebar already shows a ▶ button there).
- **Out of scope:** Backend changes (API endpoint already exists).

## Approach

### 1. Expose `isPaused` in `RepoDetail`

`RepoDetail` needs to know whether the repo's queue is paused so it can conditionally render a "Resume" button in the header.

The pause state is already tracked in `QueueContext`:
```ts
queueState.repoQueueMap[workspaceId]?.stats?.isPaused
```

`RepoDetail` already consumes `useQueue()` to read `queueRunningCount` / `queueQueuedCount` (for the sub-tab badges), so reading `.stats.isPaused` from the same map requires no new context wiring.

### 2. Add "Resume" button to `RepoDetail` header

In `RepoDetail.tsx`, within the `{activeSubTab === 'queue' && ...}` block (line 101–111), add a "Resume" button that appears when `isPaused` is true:

```tsx
{activeSubTab === 'queue' && isRepoPaused && (
    <Button
        variant="secondary"
        size="sm"
        disabled={isPauseResumeLoading}
        onClick={handleResumeQueue}
        data-testid="repo-header-resume-btn"
    >
        ▶ Resume Queue
    </Button>
)}
{activeSubTab === 'queue' && (
    <Button variant="ghost" size="sm" onClick={() => queueDispatch({ type: 'OPEN_DIALOG', workspaceId: ws.id })}>
        + Queue Task
    </Button>
)}
```

Add a local handler that calls the API and refreshes:
```ts
const [isPauseResumeLoading, setIsPauseResumeLoading] = useState(false);

async function handleResumeQueue() {
    setIsPauseResumeLoading(true);
    try {
        await fetchApi('/queue/resume?repoId=' + encodeURIComponent(ws.id), { method: 'POST' });
        // Context will be updated via the existing WebSocket / REPO_QUEUE_UPDATED path
    } finally {
        setIsPauseResumeLoading(false);
    }
}
```

### 3. (Optional) Add a pause banner inside `RepoQueueTab`

When the queue is paused and has active tasks, show a dismissible banner at the top of the task-list panel (above the toolbar) to make the paused state obvious and provide a labeled "Resume" button alongside the existing icon-only one:

```tsx
{isPaused && (
    <div className="mx-3 mt-2 rounded bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 px-3 py-1.5 text-xs flex items-center gap-2">
        <span className="flex-1">⏸ Queue is paused — new tasks will not start.</span>
        <Button variant="ghost" size="sm" disabled={isPauseResumeLoading} onClick={handlePauseResume}>
            ▶ Resume
        </Button>
    </div>
)}
```

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx` | Read `isPaused` from `queueState.repoQueueMap`; add resume button to header when queue sub-tab is active |
| `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx` | (Optional) Add a pause-state banner with labeled Resume button above the task toolbar |

## Notes

- The existing `▶` icon button in `RepoQueueTab` toolbar (line 305–316) can remain as-is — the header button supplements it rather than replacing it.
- The WebSocket `REPO_QUEUE_UPDATED` event already propagates `stats.isPaused` changes back to the context, so state will be live.
- No test changes are strictly required beyond adding `data-testid="repo-header-resume-btn"` to the new button for future test coverage.
