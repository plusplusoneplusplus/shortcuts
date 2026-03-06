# Queue Task URL Deep Link

## Problem

When a user selects a queue task in the CoC SPA dashboard, the URL stays at `#repos/:repoId/queue` — it doesn't include the task ID. This means:
- Users can't bookmark or share a direct link to a specific queue task
- Browser back/forward doesn't restore task selection
- Refreshing the page loses the selected task

## Proposed Approach

Follow the existing **pipeline deep link pattern** (`#repos/:repoId/pipelines/:pipelineName`) to add `#repos/:repoId/queue/:taskId` URL support.

## Current State

| URL Pattern | Deep-linkable? |
|---|---|
| `#repos/:repoId/pipelines/:name` | ✅ Yes |
| `#repos/:repoId/queue` | ❌ No task ID in URL |
| `#processes/:processId` | ✅ Yes (including `queue_` prefix) |

## Changes

### 1. `Router.tsx` — Parse queue deep link from hash

**File:** `packages/coc/src/server/spa/client/react/layout/Router.tsx`

- Add `parseQueueDeepLink(hash): string | null` — mirrors `parsePipelineDeepLink`, checks `parts[2] === 'queue' && parts[3]`, returns `decodeURIComponent(parts[3])`.
- In `handleHash`: after the pipeline deep link branch, add an `else if (parts[2] === 'queue' && parts[3])` that dispatches `SELECT_QUEUE_TASK` into the queue context.

**Challenge:** `handleHash` currently dispatches to `AppContext` only. `SELECT_QUEUE_TASK` lives in `QueueContext`. We need either:
- (a) Expose the queue dispatch to the Router (e.g., via a ref, callback, or shared event), OR
- (b) Store the deep-linked task ID in `AppContext` (e.g., `pendingQueueTaskId`) and let `RepoQueueTab` pick it up on mount, OR
- (c) Have `RepoQueueTab` read the hash on mount and dispatch `SELECT_QUEUE_TASK` itself.

**Recommended:** Option (c) — simplest, mirrors how components already self-initialize. `RepoQueueTab` reads `location.hash` on mount, parses `parts[3]`, and dispatches `SELECT_QUEUE_TASK` if present. This avoids cross-context coupling.

### 2. `RepoQueueTab.tsx` — Update URL on task selection + read on mount

**File:** `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx`

- **On selection:** Update `selectTask` to also set `location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/queue/' + encodeURIComponent(id)`.
- **On deselection** (when `id` is null or auto-cleared): Reset hash to `#repos/:repoId/queue`.
- **On mount:** Read `location.hash`, parse task ID from 4th segment if present, dispatch `SELECT_QUEUE_TASK`.

### 3. `RepoQueueTab.tsx` — Scroll selected task into view

When a task is selected via deep link (on mount), scroll the task card into view so the user sees it immediately. Use a `useEffect` + `ref` or `scrollIntoView` on the matching card element.

## Todos

1. **url-update-on-select** — In `RepoQueueTab.tsx`, update `selectTask` to set `location.hash` with the task ID, and reset hash on deselection/auto-clear.
2. **read-hash-on-mount** — In `RepoQueueTab.tsx`, add a mount effect that reads the task ID from the URL hash and dispatches `SELECT_QUEUE_TASK`.
3. **scroll-into-view** — After deep-link selection, scroll the selected task card into view.
4. **add-tests** — Add tests for URL parsing, selection-on-mount, and hash update behavior.

## Notes

- The `#processes/queue_:taskId` route already exists for the global processes view. This new route is specifically for the per-repo queue sub-tab.
- Task IDs should be URI-encoded/decoded for safety.
- Browser back/forward should naturally work since we're using `location.hash`.
