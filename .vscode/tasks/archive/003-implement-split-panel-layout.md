---
status: done
---

# 003: Implement Split-Panel Layout

## Summary
Convert `RepoSchedulesTab` from a vertical flex-col list with inline expand/collapse cards into a
horizontal two-panel layout (left list + right detail) that exactly mirrors the pattern used by
`PipelinesTab.tsx`.

## Motivation
This is the core visual change of the feature. Commits 001 and 002 prepared the sub-component
(`ScheduleDetail`) and the selection-state model (`selectedId`); this commit wires them into the
split-panel shell. Keeping this as its own commit makes the structural diff easy to review in
isolation.

## Changes

### Files to Create
- _(none)_

### Files to Modify
- `packages/coc/src/server/spa/client/react/repos/RepoSchedulesTab.tsx` — Replace the
  `p-4 flex flex-col gap-3` outer shell with a `flex h-full overflow-hidden` split-panel layout.
  Remove `Card` wrappers from each row. Move `CreateScheduleForm` into the right panel. Wire the
  left list to `selectedId` / `handleSelect` (from commit 002) and the right panel to
  `<ScheduleDetail>` (from commit 001).

### Files to Delete
- _(none — `Card` import removal is a side-effect of the edit, not a separate deletion step)_

---

## Implementation Notes

### 1. Outer container

**Before:**
```tsx
<div className="p-4 flex flex-col gap-3">
```

**After:**
```tsx
<div className="flex h-full overflow-hidden">
```

The `p-4` wrapper padding is removed from the root. Padding is re-introduced per-section inside
each panel header/body.

---

### 2. Left panel

```tsx
<div className="w-72 flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#3c3c3c] flex flex-col overflow-hidden">

  {/* Panel header */}
  <div className="flex items-center justify-between px-4 pt-3 pb-2">
    <span className="text-[11px] uppercase text-[#848484] font-medium">
      SCHEDULES{schedules.length > 0 ? ` (${schedules.length})` : ''}
    </span>
    <Button variant="primary" size="sm" onClick={() => { setShowCreate(true); }}>
      + New
    </Button>
  </div>

  {/* Empty state */}
  {schedules.length === 0 && (
    <div className="p-4 text-center text-sm text-[#848484]">
      <div className="text-2xl mb-2">🕐</div>
      <div>No schedules for this repo yet.</div>
      <div className="text-xs mt-1">Click "+ New" to automate a pipeline or script.</div>
    </div>
  )}

  {/* Schedule list */}
  {schedules.length > 0 && (
    <ul className="repo-schedule-list px-2 pb-4 flex flex-col gap-0.5 overflow-y-auto">
      {schedules.map(schedule => {
        const isActive = schedule.id === selectedId;
        return (
          <li
            key={schedule.id}
            className={
              'repo-schedule-item flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer ' +
              'hover:bg-[#e8e8e8] dark:hover:bg-[#333] ' +
              (isActive
                ? 'bg-[#e8e8e8] dark:bg-[#2a2d2e] border-l-2 border-[#0078d4]'
                : '')
            }
            role="option"
            aria-selected={isActive}
            onClick={() => handleSelect(schedule.id)}
          >
            <span className="flex-shrink-0">
              <StatusDot status={schedule.status} isRunning={schedule.isRunning} />
            </span>
            <span className={
              'flex-1 text-xs text-[#1e1e1e] dark:text-[#cccccc] truncate' +
              (isActive ? ' font-medium' : '')
            }>
              {schedule.name}
              {schedule.targetType === 'script' && (
                <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-[#e8f0fe] dark:bg-[#1a3a5c] text-[#0078d4] font-medium align-middle">
                  [Script]
                </span>
              )}
              {(!schedule.targetType || schedule.targetType === 'prompt') && (
                <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-[#f3f3f3] dark:bg-[#2a2a2a] text-[#848484] font-medium align-middle">
                  [Prompt]
                </span>
              )}
            </span>
            <span className="text-[10px] text-[#848484] font-mono flex-shrink-0 hidden xl:block">
              {schedule.cronDescription}
            </span>
            {schedule.nextRun && schedule.status === 'active' && (
              <span className="text-[10px] text-[#848484] flex-shrink-0">
                {formatRelativeTime(schedule.nextRun)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  )}
</div>
```

Key differences from the old row button:
- No expand arrow (`▶` / `▼`) — removed entirely.
- No `<Card>` wrapper — the `<li>` is the row, flush with the panel background.
- `border-l-2 border-[#0078d4]` applied to the `<li>` itself (not a child element) when active.
- `onClick` calls `handleSelect(schedule.id)` (commit 002's non-toggle version).

---

### 3. Right panel

```tsx
<div className="flex-1 min-w-0 overflow-y-auto">
  {showCreate ? (
    <div className="px-4 py-3">
      <CreateScheduleForm
        workspaceId={workspaceId}
        onCreated={(createdId?: string) => {
          setShowCreate(false);
          setDuplicateValues(null);
          fetchSchedules().then(() => {
            if (createdId) setSelectedId(createdId);
          });
        }}
        onCancel={() => { setShowCreate(false); setDuplicateValues(null); }}
        initialValues={duplicateValues ? {
          name: `Copy of ${duplicateValues.name}`,
          target: duplicateValues.target,
          targetType: duplicateValues.targetType,
          cron: duplicateValues.cron,
          params: duplicateValues.params ? { ...duplicateValues.params } : undefined,
          onFailure: duplicateValues.onFailure,
        } : undefined}
      />
    </div>
  ) : selectedSchedule ? (
    <div className="px-4 py-3">
      <ScheduleDetail
        schedule={selectedSchedule}
        workspaceId={workspaceId}
        history={history}
        onRunNow={handleRunNow}
        onPauseResume={handlePauseResume}
        onEdit={() => setEditingId(selectedSchedule.id)}
        onDuplicate={() => { setDuplicateValues(selectedSchedule); setShowCreate(true); }}
        onDelete={handleDelete}
        editingId={editingId}
        onCancelEdit={() => setEditingId(null)}
        onSaved={() => { setEditingId(null); fetchSchedules(); }}
      />
    </div>
  ) : (
    <div className="flex items-center justify-center h-full text-sm text-[#848484]">
      {schedules.length === 0
        ? 'Create your first schedule with "+ New"'
        : 'Select a schedule to view details'}
    </div>
  )}
</div>
```

Where `selectedSchedule` is derived:
```ts
const selectedSchedule = schedules.find(s => s.id === selectedId) ?? null;
```

Notes:
- `ScheduleDetail` is wrapped in `px-4 py-3` inside the right panel (not inside the component
  itself) to keep `ScheduleDetail` padding-free and composable.
- `CreateScheduleForm` is also wrapped in `px-4 py-3` for visual consistency.
- The right panel uses `overflow-y-auto` (not `overflow-hidden`) so long detail views scroll.
- `showCreate` takes priority over `selectedId`-driven detail: if both are truthy, the form shows.

---

### 4. "+ New" button behaviour

- Sets `showCreate = true`.
- Does **not** clear `selectedId` — the left list keeps the current selection highlighted. When
  the user cancels the form, the previously selected detail reappears automatically.
- On successful creation: `showCreate = false`, re-fetch, then `setSelectedId(createdId)` if the
  API returns a newly created schedule id. (If `CreateScheduleForm.onCreated` does not currently
  receive the new id, this wiring is a follow-up — for now `fetchSchedules()` auto-selects
  `schedules[0]` via commit 002's load logic.)

---

### 5. Duplicate flow

Old flow (inline inside expanded card):
```
setDuplicateValues(schedule) → setShowCreate(true) → setExpandedId(null)
```

New flow:
```
setDuplicateValues(schedule) → setShowCreate(true)
```
`setExpandedId(null)` is gone (no `expandedId` state after commit 002). Left panel selection is
unchanged; the right panel switches from `ScheduleDetail` to `CreateScheduleForm`.

---

### 6. `Card` import removal

The `Card` component is no longer used after this refactor. Remove it from the import line:

**Before:**
```ts
import { Card, Button, cn } from '../shared';
```

**After:**
```ts
import { Button, cn } from '../shared';
```

Verify `cn` is still needed (used inside `ScheduleDetail` run-history status classes — if
`ScheduleDetail` was extracted to its own file in commit 001, `cn` may also be removable from this
file's imports; check at implementation time).

---

### 7. State no longer needed

After this commit the following state / handler are **removed** from `RepoSchedulesTab`:

| Removed | Replaced by |
|---------|-------------|
| `expandedId` / `setExpandedId` | `selectedId` / `setSelectedId` (commit 002) |
| `handleToggleExpand` | `handleSelect` (commit 002) |
| Expand arrow `▶` / `▼` in row | _(gone)_ |
| `handleRunNow` ref to `expandedId` check | history refresh now driven by `selectedId` `useEffect` (commit 002) |

---

### 8. Loading state

The loading guard at the top of the component renders before the split-panel JSX. No change needed:
```tsx
if (loading) {
  return <div className="p-4 text-sm text-[#848484]">Loading schedules...</div>;
}
```

---

## Tests

- Existing tests that query by `Card` wrapper or by expand-button arrow text (`▶`/`▼`) must be
  updated: find rows by `role="option"` or by a `data-testid` attribute on the `<li>` instead.
- Confirm clicking a list row renders `ScheduleDetail` in the right panel.
- Confirm "+ New" renders `CreateScheduleForm` in the right panel without deselecting the left row.
- Confirm the duplicate action opens `CreateScheduleForm` pre-filled in the right panel.
- Confirm empty-state message appears in both the left panel (no rows) and the right panel
  (no selection).
- Confirm active row has `border-l-2 border-[#0078d4]` class applied.

## Acceptance Criteria

- [ ] Tab renders in two-column layout: `w-72` left panel + `flex-1` right panel, matching
      `PipelinesTab` visual style
- [ ] Left panel header shows "SCHEDULES (N)" label and "+ New" button with `px-4 pt-3 pb-2` spacing
- [ ] Left panel list rows use `role="option"` / `aria-selected` and show status dot, name, type
      badge, cron description, and next-run time
- [ ] Active row has `bg-[#e8e8e8] dark:bg-[#2a2d2e] border-l-2 border-[#0078d4]` classes
- [ ] Clicking a row calls `handleSelect(id)` (non-toggle) and updates the right panel detail
- [ ] "+ New" sets `showCreate = true`; left list remains visible and retains its selection
- [ ] Right panel shows `<CreateScheduleForm>` (inside `px-4 py-3`) when `showCreate` is true
- [ ] Right panel shows `<ScheduleDetail>` (inside `px-4 py-3`) when a schedule is selected
- [ ] Right panel shows placeholder text when no schedule is selected and `showCreate` is false
- [ ] Left panel shows empty state (🕐 + message) when `schedules.length === 0`
- [ ] `<Card>` is no longer rendered around each row; `Card` import is removed
- [ ] No expand arrow (`▶`/`▼`) appears anywhere in the list rows
- [ ] Duplicate flow opens `CreateScheduleForm` pre-filled in the right panel
- [ ] All previously passing tests pass (with selector updates for removed Card wrappers)

## Dependencies

- Depends on: 001 (ScheduleDetail component), 002 (selectedId state + handleSelect)

## Assumed Prior State

- `ScheduleDetail` component exists and accepts props:
  `{ schedule, workspaceId, history, onRunNow, onPauseResume, onEdit, onDuplicate, onDelete, editingId, onCancelEdit, onSaved }`
- `selectedId: string | null` state exists (replaces `expandedId`)
- `setSelectedId` setter exists
- `handleSelect(scheduleId: string)` exists as a non-toggle handler
- `history: RunRecord[]` state is populated via a `useEffect` watching `selectedId`
- `editingId` is cleared when `selectedId` changes (commit 002 behaviour)
- `CreateScheduleForm` remains in the same file (not extracted)
- `StatusDot`, `parseCronToInterval`, `SCHEDULE_TEMPLATES` remain in the same file unchanged
