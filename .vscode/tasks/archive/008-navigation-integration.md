---
status: done
---

# 008: Navigation Integration (Queue + Pipelines → Workflow)

## Summary
Wire existing entry points (Queue sub-tab, Pipelines Run History) to navigate to the new workflow detail view instead of their current inline display, and add a mini progress indicator on queue cards for running pipelines.

## Motivation
The workflow detail view exists (Commit 6) but is unreachable from the existing UI. Users need to click through from their natural starting points: the queue (for running tasks) and the pipeline run history (for past runs). Without this wiring, the feature is invisible.

## Changes

### Files to Modify

#### 1. `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx`

**Current behavior:** The `selectTask` callback (line 156–168) handles click routing. For `chat`/`chat-followup` tasks it navigates to the Chat sub-tab via `location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/chat/' + encodeURIComponent(sessionId)` (line 162). For all other task types it dispatches `SELECT_QUEUE_TASK` and sets hash to `#repos/:id/queue/:taskId` (line 166), which opens `QueueTaskDetail` in the right split panel (line 561–562).

**Required changes to `selectTask` (line 156):**
- Add a branch for `run-pipeline` type tasks, before the generic fallback at line 165:
  ```ts
  if (task?.type === 'run-pipeline') {
      const processId = task.processId || task.id;
      location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/workflow/' + encodeURIComponent(processId);
      return;
  }
  ```
- This mirrors the existing chat navigation pattern (lines 157–163) — type-check → navigate → return early.
- Non-pipeline tasks (`follow-prompt`, `code-review`, `custom`, etc.) continue to the existing `SELECT_QUEUE_TASK` dispatch at line 165.

**Mini progress indicator on `QueueTaskItem` (line 608–644):**
- The `QueueTaskItem` component renders each running/queued card with icon, name, and elapsed time.
- For `run-pipeline` tasks with `status === 'running'`, add a small progress line below the prompt preview (after line 641). This should display map progress from SSE `pipeline-progress` events (e.g., `"Map: 18/30"`).
- Approach: create a lightweight `usePipelineProgress(processId)` hook that subscribes to the SSE endpoint (`/processes/:id/stream`) and extracts the latest `pipeline-progress` event's `completedItems`/`totalItems`. Unsubscribes on unmount.
- Render: a single `<div>` with `text-[10px]` showing `"▶ Map: {completed}/{total}"` and optionally a thin CSS progress bar.

**History section cards (lines 488–518):**
- Completed `run-pipeline` tasks in the history section also use `selectTask` (line 495: `onClick={() => selectTask(task.id, task)`), so the `selectTask` change above covers these automatically.

#### 2. `packages/coc/src/server/spa/client/react/repos/PipelineRunHistory.tsx`

**Current behavior:** `PipelineRunHistory` (line 20) renders active tasks (from `queueState.repoQueueMap`, lines 46–53) and completed history (from HTTP `/queue/history`, lines 27–38) as `RunHistoryItem` rows. Clicking a row calls `handleSelectTask` (line 55), which toggles `selectedTaskId` state and fetches process detail via `/processes/:processId`. The expanded detail is rendered inline as `<PipelineResultCard>` below the list (lines 123–127).

**Required changes to `handleSelectTask` (line 55):**
- Replace the toggle-and-fetch logic with direct navigation to the workflow view:
  ```ts
  const handleSelectTask = (task: any) => {
      const processId = task.processId || `queue_${task.id}`;
      location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/workflow/' + encodeURIComponent(processId);
  };
  ```
- Remove the `selectedTaskId`, `selectedProcess` state variables (lines 24–25) since the inline expand pattern is replaced by navigation.
- Remove the `<PipelineResultCard>` section (lines 122–127) — detail is now shown in `WorkflowDetailView`.
- The `RunHistoryItem` component (lines 140–170) stays unchanged — only the `onClick` handler changes.

#### 3. `packages/coc/src/server/spa/client/react/layout/Router.tsx`

**Current behavior:** The Router's `handleHash` effect (line 131) parses `#repos/:id/:subTab` deep links. It handles `pipelines`, `queue`, `chat`, `git`, and `wiki` sub-paths (lines 170–217). There is **no** `workflow` route handler — `workflow` is not in `VALID_REPO_SUB_TABS` (line 114).

**Required changes:**
- Add `'workflow'` to `VALID_REPO_SUB_TABS` (line 114):
  ```ts
  export const VALID_REPO_SUB_TABS: Set<string> = new Set([
      'info', 'git', 'pipelines', 'tasks', 'queue', 'schedules', 'chat', 'wiki', 'copilot', 'workflow'
  ]);
  ```
- Add a `workflow` deep-link handler block inside the `#repos/:id` parsing (after line 194, alongside the git/wiki handlers):
  ```ts
  // Workflow deep-link: #repos/{id}/workflow/{processId}
  if (parts[2] === 'workflow' && parts[3]) {
      dispatch({ type: 'SET_WORKFLOW_PROCESS_ID', processId: decodeURIComponent(parts[3]) });
  }
  ```
- Add a new `parseWorkflowDeepLink` helper (alongside the existing `parsePipelineDeepLink` at line 78):
  ```ts
  export function parseWorkflowDeepLink(hash: string): string | null {
      const cleaned = hash.replace(/^#/, '');
      const parts = cleaned.split('/');
      if (parts[0] === 'repos' && parts[1] && parts[2] === 'workflow' && parts[3]) {
          return decodeURIComponent(parts[3]);
      }
      return null;
  }
  ```
- The `SET_WORKFLOW_PROCESS_ID` action must be added to the AppContext reducer (this is part of the state wiring — see Commit 6 assumed prior state).

#### 4. `packages/coc/src/server/spa/client/react/processes/ProcessDetail.tsx` (supplementary)

**Current behavior:** `ProcessDetail` (line 59) renders the selected process in the Processes tab. It shows conversation turns, pipeline DAG sections, and metadata. There is no link to the workflow view.

**Required changes:**
- For pipeline-type processes (where `process.metadata?.pipelineName` exists or `process.type === 'run-pipeline'`), add a "View Workflow →" button in the header area that navigates to `#repos/:repoId/workflow/:processId`.
- This requires resolving the workspace ID from the process — use `getProcessWorkspaceId()` (already imported at line 16).
- This is supplementary: the Processes tab keeps its existing detail view, the button is an optional shortcut.

## Implementation Notes

### Navigation pattern
All navigation uses the hash-based pattern established in the codebase:
```ts
location.hash = '#repos/' + encodeURIComponent(repoId) + '/workflow/' + encodeURIComponent(processId);
```
This is consistent with:
- Chat: `#repos/:id/chat/:sessionId` (RepoQueueTab.tsx line 162)
- Queue: `#repos/:id/queue/:taskId` (RepoQueueTab.tsx line 166)
- Pipelines: `#repos/:id/pipelines/:name` (Router.tsx line 170–171)

### Process ID resolution
Queue tasks expose the process ID in two places:
- `task.processId` — set once the task starts executing (preferred)
- `task.id` — the queue task ID, usable as `queue_${task.id}` for in-flight tasks (see PipelineRunHistory.tsx line 63)

The workflow view should accept both forms. For running tasks that don't yet have a `processId`, use the queue task ID directly and let the workflow view resolve it.

### Mini progress indicator
- SSE endpoint: `/processes/:id/stream` (existing, used by ProcessDetail)
- Event type: `pipeline-progress` with `{ completedItems, totalItems, phase }` payload
- Create `usePipelineProgress(processId: string)` hook that returns `{ completed: number, total: number, phase: string } | null`
- Only subscribe when `task.type === 'run-pipeline'` and `status === 'running'` — avoids unnecessary SSE connections for other task types
- The hook should close the EventSource on unmount and when the task completes

### Back navigation
- The `WorkflowDetailView` (Commit 6) should include a breadcrumb: `Repos > {repo} > Queue > Workflow`
- Back button navigates to `#repos/:id/queue` (or whichever sub-tab the user came from)
- Consider storing the referrer sub-tab in `location.state` or a simple context value, falling back to `queue`

## Tests
- Test: clicking a `run-pipeline` queue card (running section) navigates to `#repos/:id/workflow/:processId`
- Test: clicking a `run-pipeline` queue card (history section) navigates to `#repos/:id/workflow/:processId`
- Test: clicking a `chat` queue card still opens chat view via `#repos/:id/chat/:sessionId` (no regression)
- Test: clicking a `follow-prompt` queue card still opens `QueueTaskDetail` inline (no regression)
- Test: clicking a run history row in `PipelineRunHistory` navigates to `#repos/:id/workflow/:processId`
- Test: `PipelineRunHistory` no longer renders inline `PipelineResultCard` after click
- Test: mini progress indicator renders on running `run-pipeline` queue cards with `"Map: N/M"` text
- Test: mini progress indicator does not render on non-pipeline or completed cards
- Test: `parseWorkflowDeepLink` correctly extracts processId from hash
- Test: Router handles `#repos/:id/workflow/:processId` hash and dispatches `SET_WORKFLOW_PROCESS_ID`
- Test: breadcrumb/back button in workflow view returns to the originating sub-tab

## Acceptance Criteria
- [ ] `run-pipeline` queue cards (running + queued + history) click through to workflow view
- [ ] Pipeline run history rows click through to workflow view
- [ ] Non-pipeline queue items unchanged — `chat` → chat tab, others → `QueueTaskDetail` (no regression)
- [ ] Running pipeline cards show mini progress indicator (`"Map: N/M"`)
- [ ] `#repos/:id/workflow/:processId` hash route is parsed and dispatched by Router
- [ ] Back navigation works from workflow view to originating sub-tab
- [ ] Tests pass on Linux, macOS, Windows

## Dependencies
- Depends on: 006

## Assumed Prior State
- `WorkflowDetailView` rendered at `#repos/:id/workflow/:processId` (Commit 6)
- `ItemConversationPanel` for drill-down (Commit 7) — not strictly required but expected to be present
- Router already renders `ReposView` for all `#repos/…` hashes (Router.tsx line 281)
- AppContext has `SET_WORKFLOW_PROCESS_ID` reducer action (from Commit 6 state additions)
