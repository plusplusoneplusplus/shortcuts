# Add Manual Refresh Buttons to Queue Tab and Chat Tab

## Problem

The CoC dashboard's Queue and Chat tabs rely on WebSocket events and initial HTTP fetches for data updates. There is no manual "refresh this tab" button, so users must reload the entire webpage when data feels stale — e.g., after a slow git-info sync on startup or when WebSocket events are missed.

## Proposed Approach

Add a small **Refresh** icon button (⟳) to the header area of both the **Queue tab** (`RepoQueueTab.tsx`) and the **Chat tab** (`RepoChatTab.tsx`). Clicking it triggers a fresh HTTP fetch of that tab's data, independent of the full-page reload or git-info sync.

---

## Acceptance Criteria

- [ ] A visible refresh icon button appears in the Queue tab header (near the pause/resume button or section title).
- [ ] Clicking it re-fetches `/api/queue?repoId=<id>` (running, queued, history) and updates the displayed data.
- [ ] A visible refresh icon button appears in the Chat tab header.
- [ ] Clicking it re-fetches the chat session list and active task list for the current workspace.
- [ ] While refresh is in-flight the button shows a loading/spinning state and is disabled to prevent double-triggers.
- [ ] After fetch completes (success or error), the button returns to its normal state.
- [ ] No full-page reload is triggered; only the relevant tab data is updated.
- [ ] Existing WebSocket-driven updates continue to work alongside the manual refresh.

---

## Subtasks

### 1. Queue Tab – Add Refresh Button (`RepoQueueTab.tsx`)
- Locate the existing `fetchQueue()` function.
- Add local `isRefreshing` state (boolean).
- Wrap the `fetchQueue()` call: set `isRefreshing = true` before, `false` after (in `finally`).
- Render a `<button>` with a refresh/spinner icon in the tab header area, disabled when `isRefreshing`.
- Bind `onClick` to a `handleRefresh` function that calls `fetchQueue()`.

### 2. Chat Tab – Add Refresh Button (`RepoChatTab.tsx`)
- Locate the function(s) that load chat sessions and task list on mount.
- Add local `isRefreshing` state.
- Create a `handleRefresh` function that re-invokes those fetches, guarded with `isRefreshing`.
- Render the refresh button in the chat header, disabled while in-flight.

### 3. Shared Refresh Icon Component (optional)
- If a suitable spinner/icon button already exists in the shared UI components, reuse it.
- Otherwise, create a tiny `RefreshButton` component in `packages/coc/src/server/spa/client/react/shared/` to keep both tabs consistent.

### 4. Styling
- Button should be small, low-prominence (icon-only or icon + "Refresh" label on wider viewports).
- Spinning animation while loading (CSS `rotate` keyframe or reuse any existing spinner class).

---

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx` | Add `isRefreshing` state, `handleRefresh`, refresh button in header |
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Add `isRefreshing` state, `handleRefresh`, refresh button in header |
| `packages/coc/src/server/spa/client/react/shared/RefreshButton.tsx` *(new, optional)* | Reusable icon button with loading state |
| CSS/style file for the above components | Spinner animation if not already defined |

---

## Notes

- `fetchQueue()` in `RepoQueueTab` already exists and is called after most queue actions — reuse it directly.
- The Chat tab may need to call two fetches (session list + task list); both should complete before `isRefreshing` is cleared.
- The git-info sync slowness is a separate concern; this button gives users an escape hatch without waiting for it.
- Do **not** change polling intervals or WebSocket logic — this is purely additive.
- Test on both desktop and mobile viewport sizes since the CoC dashboard has mobile navigation.
