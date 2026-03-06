---
status: pending
---

# 001: Extract ScheduleDetail Component

## Summary
Extract the inline expanded-detail JSX block (lines 228–318 of `RepoSchedulesTab.tsx`) into a standalone `ScheduleDetail` sub-component. This is a pure refactor with zero behavioral change.

## Motivation
The expanded-detail block is ~90 lines of rendering logic covering three distinct concerns: an actions bar, a metadata details section, and a run history list. It also conditionally renders `CreateScheduleForm` when in edit mode. Isolating this into `ScheduleDetail` makes commit 3 (the split-panel layout restructure) a focused, diff-readable change instead of a mixed refactor+layout patch. Reviewers can verify commit 1 is behavior-neutral before commit 3 restructures the layout.

## Changes

### Files to Create
- None.

### Files to Modify
- `packages/coc/src/server/spa/client/react/repos/RepoSchedulesTab.tsx`
  - **Add** a `ScheduleDetailProps` interface and a `ScheduleDetail` function component above the `StatusDot` helper (line ~325).
  - **Move** lines 229–317 (the contents of `{expandedId === schedule.id && (<div className="border-t ...">…</div>)}`) verbatim into `ScheduleDetail`'s return value. The outer `<div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] px-3 py-2.5">` becomes the root element of the component.
  - **Replace** lines 228–318 in the render loop with: `{expandedId === schedule.id && <ScheduleDetail … />}` threading all required props.
  - All existing `schedule.*` references inside the moved JSX must be satisfied by props; all handler closures (`handleRunNow`, `handlePauseResume`, `handleDelete`, `setEditingId`, `setDuplicateValues`, `setShowCreate`, `setExpandedId`, `fetchSchedules`) become callback props.

### Files to Delete
- None.

## Implementation Notes

### Exact prop interface

```tsx
interface ScheduleDetailProps {
    schedule: Schedule;
    workspaceId: string;
    history: RunRecord[];           // shared state lifted in RepoSchedulesTab; filtered to expandedId at call site
    editingId: string | null;       // only the value matters — component checks editingId === schedule.id
    onRunNow: (scheduleId: string) => void;
    onPauseResume: (schedule: Schedule) => void;
    onEdit: (scheduleId: string) => void;          // calls setEditingId(schedule.id)
    onDuplicate: (schedule: Schedule) => void;     // calls setDuplicateValues + setShowCreate + setExpandedId(null)
    onDelete: (scheduleId: string) => void;
    onCancelEdit: () => void;       // calls setEditingId(null)
    onSaved: () => void;            // calls setEditingId(null) + fetchSchedules()
}
```

### history is shared, not per-schedule
`history` in `RepoSchedulesTab` is a single `useState<RunRecord[]>` that holds the history for whichever `expandedId` is currently open (fetched in `handleToggleExpand`, lines 110–124). There is no per-schedule history map. Pass `history` directly — the component does not need to filter it because it is only rendered when `expandedId === schedule.id`.

### editingId threading
`editingId` is checked as `editingId === schedule.id` at line 230. The `ScheduleDetail` component can replicate this check internally using `editingId === schedule.id`, or the parent can pass a boolean `isEditing={editingId === schedule.id}` — either works, but passing `editingId` directly keeps the prop surface consistent with commit 3 needs. Use `editingId` (the full string) so commit 3 can inspect the value if needed.

### Duplicate callback
Line 255 in the original: `onClick={() => { setDuplicateValues(schedule); setShowCreate(true); setExpandedId(null); }}`. This touches three pieces of state in `RepoSchedulesTab`. Bundle them into a single `onDuplicate: (schedule: Schedule) => void` callback so the component remains stateless.

### Edit button disabled state
Line 254: `disabled={schedule.isRunning}`. This is a prop on the `<Button>` inside `ScheduleDetail`; no special prop needed — it reads from `schedule.isRunning`.

### CreateScheduleForm import
`CreateScheduleForm` is defined later in the same file (not imported). `ScheduleDetail` is also in the same file, so no import change is needed.

### No state inside ScheduleDetail
`ScheduleDetail` must be a pure presentational component in this commit — all state lives in `RepoSchedulesTab`. Do not introduce `useState` or `useEffect` in `ScheduleDetail`.

### Placement in file
Define `ScheduleDetail` between the closing `}` of `RepoSchedulesTab` (line ~323) and the `StatusDot` function (line 325). This avoids forward-reference issues since `StatusDot` is used inside `ScheduleDetail`.

Wait — `StatusDot` is used in the *row* button, not in the expanded detail block. Confirm by inspection: lines 229–317 do **not** reference `StatusDot`. `StatusDot` is only used at line 205. Therefore `ScheduleDetail` can be placed **after** `StatusDot` with no ordering concern, but placing it before `StatusDot` is also fine.

### Line count reference
| Block | Lines (approx) | Description |
|---|---|---|
| Outer expanded guard + div | 228–229 / 317–318 | `{expandedId === schedule.id && (<div ...>` |
| Edit form branch | 230–245 | `{editingId === schedule.id ? <CreateScheduleForm … />` |
| Actions bar | 248–257 | Run Now, Pause/Resume, Edit, Duplicate, Delete buttons |
| Details section | 259–268 | Target, Schedule, Params, On Failure |
| Run history | 271–316 | Header + list of RunRecord rows with expandable output |

## Tests
- Run `RepoSchedulesTab.test.tsx` — all existing test cases must pass unchanged.
- Run `RepoSchedulesTab-edit.test.tsx` — all edit-mode test cases must pass unchanged.
- No new test file is needed; this commit introduces no new behavior.

## Acceptance Criteria
- [ ] `ScheduleDetail` is exported as a named TypeScript function with a fully-typed `ScheduleDetailProps` interface.
- [ ] The inline expanded-detail block in `RepoSchedulesTab`'s render loop is replaced by `{expandedId === schedule.id && <ScheduleDetail … />}` with all props threaded through.
- [ ] No JSX remains in `RepoSchedulesTab`'s `schedules.map(...)` loop beyond the row button and the `<ScheduleDetail>` invocation.
- [ ] All existing tests in `RepoSchedulesTab.test.tsx` pass.
- [ ] All existing tests in `RepoSchedulesTab-edit.test.tsx` pass.
- [ ] No visual or behavioral change is observable in the browser.
- [ ] TypeScript compilation (`npm run build`) reports zero new errors.

## Dependencies
- Depends on: None. This is the first commit.

## Assumed Prior State
None. This is the first commit in the series. The only assumption is that the source file exists at its current path and the existing tests pass on the base branch.
