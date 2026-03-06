---
status: done
---

# 002: Refactor Schedule Selection State

## Summary
Replaces the `expandedId` toggle-based state with a `selectedId` persistent-selection model. The visual layout is unchanged — this commit only rewires the state machine so it is ready for the split-panel rendering change in commit 003.

## Motivation
The current `expandedId` state encodes expand/collapse toggling semantics: clicking the same row again collapses it to `null`. The target design requires a permanently-selected schedule displayed in a right panel, so the state must never be `null` while schedules exist and must not collapse on re-click. Isolating this state refactor in its own commit keeps the diff reviewable and ensures that all downstream behavior (history fetch, editingId reset, auto-select on load) is correct before the layout is changed.

## Changes

### Files to Create
- None

### Files to Modify
- `packages/coc/src/server/spa/client/react/repos/RepoSchedulesTab.tsx`
  - Rename state variable `expandedId` → `selectedId` (line 73) and all its usages (4 references)
  - Rename `handleToggleExpand` → `handleSelect` and change its semantics: remove the early-return that collapses when the same id is clicked; the function now always sets `selectedId` to the clicked id
  - Add a `useEffect` that fetches history whenever `selectedId` changes (replaces the fetch that was inlined in `handleToggleExpand`)
  - Modify `fetchSchedules` (or add a `useEffect` that depends on `schedules`) to auto-select `schedules[0].id` when the resolved list is non-empty and `selectedId` is still `null`
  - In `handleSelect`, clear `editingId` when switching to a different schedule
  - In `handleDelete`, update the guard from `expandedId === scheduleId` to `selectedId === scheduleId`; after deletion, if the deleted schedule was selected, set `selectedId` to the first remaining schedule (or `null` if none)
  - In `handleRunNow`, update the guard from `expandedId === scheduleId` to `selectedId === scheduleId`
  - In the Duplicate button `onClick`, update `setExpandedId(null)` → `setSelectedId(null)` (or remove the reset entirely if the panel should stay open during duplication — see Implementation Notes)
  - Update the arrow indicator expression: `expandedId === schedule.id` → `selectedId === schedule.id`
  - Update the expanded-detail conditional: `expandedId === schedule.id` → `selectedId === schedule.id`

- `packages/coc/test/spa/react/RepoSchedulesTab-edit.test.tsx`
  - The `renderWithSchedules` helper currently returns after the loading spinner disappears. After this commit, once schedules load the component will also fire a history fetch for the auto-selected schedule. Update `mockFetchApi` to return both `{ schedules }` on the first call and `{ history: [] }` on the second call (or use `mockResolvedValue` with a discriminating function that inspects the URL argument).
  - Existing tests that click a row to expand it (`fireEvent.click(screen.getByText('Test Schedule'))`) continue to work because the row click still calls `handleSelect` which still sets `selectedId` — no test fix needed for the click itself, only for the `mockFetchApi` call count.
  - Add test: **auto-selects first schedule on load** — render with one schedule, wait for loading to finish, assert that the detail panel (Run History section or action buttons) is visible without any explicit click.
  - Add test: **switching selection clears editingId** — render with two schedules, expand sched-1, click Edit, assert edit form is visible, then click sched-2's row, assert edit form is gone.

- `packages/coc/test/spa/react/RepoSchedulesTab.test.tsx`
  - No `handleToggleExpand` references in this file; no changes needed unless the `fetchApi` mock needs updating to handle the auto-select history fetch call. Audit the `renderSchedulesTab` helper for unexpected extra `fetchApi` calls.

### Files to Delete
- None

## Implementation Notes

### Exact `useState` change
```tsx
// Before
const [expandedId, setExpandedId] = useState<string | null>(null);

// After
const [selectedId, setSelectedId] = useState<string | null>(null);
```

### Exact `handleSelect` change
```tsx
// Before: handleToggleExpand — collapses on re-click
const handleToggleExpand = async (scheduleId: string) => {
    if (expandedId === scheduleId) {
        setExpandedId(null);
        setEditingId(null);
        return;
    }
    setExpandedId(scheduleId);
    setEditingId(null);
    try {
        const data = await fetchApi(`/workspaces/${...}/schedules/${...}/history`);
        setHistory(data?.history || []);
    } catch {
        setHistory([]);
    }
};

// After: handleSelect — no toggle, history fetch moved to useEffect
const handleSelect = (scheduleId: string) => {
    if (selectedId !== scheduleId) {
        setEditingId(null);   // clear edit form when switching schedules
    }
    setSelectedId(scheduleId);
};
```

### New `useEffect` for history fetch on selection change
```tsx
useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/schedules/${encodeURIComponent(selectedId)}/history`)
        .then(data => {
            if (!cancelled) setHistory(data?.history || []);
        })
        .catch(() => {
            if (!cancelled) setHistory([]);
        });
    return () => { cancelled = true; };
}, [selectedId, workspaceId]);
```
The cancellation flag prevents a stale response from an earlier `selectedId` overwriting history for the currently selected schedule (classic race condition when the user quickly clicks between items).

### Auto-select on load
```tsx
useEffect(() => {
    if (selectedId === null && schedules.length > 0) {
        setSelectedId(schedules[0].id);
        // history fetch is handled by the selectedId useEffect above
    }
}, [schedules, selectedId]);
```
This runs every time `setSchedules` is called (including on WebSocket-triggered `fetchSchedules` refreshes). The `selectedId === null` guard prevents it from resetting a user's existing selection. Note: if the user has selected a schedule and `fetchSchedules` runs in the background (WebSocket event), the guard keeps the current selection intact — this avoids the race condition where a background refresh would jump the user back to the first schedule.

### Race condition risk: `fetchSchedules` resetting selection
If `fetchSchedules` were to call `setSelectedId(null)` unconditionally, any background refresh (WebSocket `schedule-changed` event) would reset the user's selection mid-browsing. The auto-select `useEffect` above avoids this by only acting when `selectedId` is already `null`. However, there is a subtler risk: if the currently selected schedule is deleted by another client, `schedules` will no longer contain it after the next `fetchSchedules` call, and the detail panel will render with a stale `selectedId` pointing to a non-existent schedule. Mitigation (within scope of this commit): after `setSchedules(data.schedules)`, also check if `selectedId` is no longer in the new list and reset it to `null` (which will trigger the auto-select effect to pick `schedules[0]`). This check can be added inside `fetchSchedules`:
```tsx
setSchedules(prev => {
    // Not using prev here; just a pattern note — do the check inline:
    return data?.schedules || [];
});
// Then in a follow-up effect or inline:
if (selectedId && !newSchedules.find(s => s.id === selectedId)) {
    setSelectedId(null);
}
```
Keep this light — it is not required for the commit to be correct in the common path.

### Duplicate button `setExpandedId(null)` call
The current code calls `setExpandedId(null)` when the user clicks Duplicate, presumably to collapse the detail so the Create form is not competing for space. With commit 003 introducing a split panel, this reset will become irrelevant. For this commit, change it to `setSelectedId(null)` to maintain the same interim visual behavior (the detail collapses while the create form is open).

### `handleRunNow` guard
```tsx
// Before
if (expandedId === scheduleId) { ... }

// After
if (selectedId === scheduleId) { ... }
```
The history re-fetch inside `handleRunNow` remains inline here (it runs only for the selected schedule right after a manual run). Alternatively, calling `setSelectedId(scheduleId)` at the top of `handleRunNow` would trigger the history `useEffect` automatically — but that is a larger refactor. Keep it inline for minimal change.

## Tests

- **Auto-selects first schedule on load** (`RepoSchedulesTab-edit.test.tsx` or a new file): mock `fetchApi` to return `{ schedules: [MOCK_SCHEDULE] }` on the schedules call and `{ history: [] }` on the history call. After `waitFor(() => loading gone)`, assert that the action buttons (Run Now, Pause, Edit, Duplicate, Delete) are visible without any `fireEvent.click`.
- **Switching selection clears editingId** (`RepoSchedulesTab-edit.test.tsx`): render with `[MOCK_SCHEDULE, MOCK_SCHEDULE_2]` (add a second schedule constant), click sched-1 to select it, click Edit, assert edit form visible, click sched-2's row, assert edit form is not present and sched-2's detail is visible.
- **Clicking same schedule does not collapse** (`RepoSchedulesTab-edit.test.tsx`): click the selected schedule's row a second time, assert the detail section is still rendered.
- **Update `renderWithSchedules` mock setup**: `mockFetchApi` must return `{ history: [] }` for history URL calls in addition to `{ schedules }`. Use a `mockImplementation` that inspects the URL:
  ```ts
  mockFetchApi.mockImplementation((url: string) => {
      if (url.includes('/history')) return Promise.resolve({ history: [] });
      return Promise.resolve({ schedules });
  });
  ```

## Acceptance Criteria
- [ ] `expandedId` renamed to `selectedId` with zero remaining references to `expandedId` anywhere in the file
- [ ] `handleToggleExpand` renamed to `handleSelect` with zero remaining references to `handleToggleExpand`
- [ ] First schedule is auto-selected when the tab loads with schedules present (no user interaction required)
- [ ] Clicking an already-selected schedule row does NOT deselect it (detail remains visible)
- [ ] Clicking a different schedule row fetches that schedule's history and shows its detail
- [ ] `editingId` resets to `null` when selection changes to a different schedule
- [ ] WebSocket-triggered `fetchSchedules` refresh does NOT reset an existing user selection
- [ ] Arrow indicator `▼`/`▶` and inline expanded-detail section still work visually (layout unchanged)
- [ ] All existing tests pass with only the `mockFetchApi` URL-dispatching update applied

## Dependencies
- Depends on: Commit 001 (Extract ScheduleDetail component)

## Assumed Prior State
- `RepoSchedulesTab.tsx` contains a `ScheduleDetail` sub-component with props `{ schedule, workspaceId, history, onRunNow, onPauseResume, onEdit, onDuplicate, onDelete, editingId, onCancelEdit, onSaved }` extracted in commit 001.
- The render loop in `RepoSchedulesTab` still uses `expandedId` state and renders `<ScheduleDetail />` inline below each row when `expandedId === schedule.id`.
- `fetchApi` is imported from `../hooks/useApi` and used for GET requests; raw `fetch` is used for mutating requests (PATCH, POST, DELETE).
- The `history` state is a flat `RunRecord[]` array shared across all schedules (only the selected schedule's history is ever loaded at one time).
