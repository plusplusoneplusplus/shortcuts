# Improve Schedule Detail View

## Problem

The schedule detail panel only supports **Run Now**, **Pause/Resume**, and **Delete**. There is no way to edit an existing schedule — users must delete and recreate it to change any field (name, cron, target, params, onFailure). This is tedious and error-prone, especially for schedules with complex params or cron expressions.

The backend **already supports** a `PATCH /api/workspaces/:id/schedules/:sid` endpoint that accepts updates to all fields (name, target, targetType, cron, params, onFailure, status). Only the UI is missing.

## Current State (from screenshot)

```
┌─────────────────────────────────────────────────────────────┐
│ 🟢 Run Pipeline [Prompt]          Every 1 hours  next: 57m │
│                                                             │
│ [Run Now]  [Pause]  [Delete]                                │
│                                                             │
│ Target: D:\...\pipelines\git-fetch                          │
│ Schedule: 0 */1 * * * · Every 1 hours                      │
│ Params: {"pipeline":"D:\\...\\git-fetch"}                   │
│ On Failure: notify                                          │
│                                                             │
│ RUN HISTORY                                                 │
│ ✔ 2m ago                                    0s  completed   │
└─────────────────────────────────────────────────────────────┘
```

## Proposed Improvements

### 1. Add "Edit" button to schedule detail panel

Add an **Edit** button next to the existing action buttons. Clicking it opens an inline edit form pre-populated with the schedule's current values.

### 2. Inline edit form (reuse CreateScheduleForm pattern)

When editing, the detail section transforms into editable fields:

- **Name** — text input (pre-filled)
- **Target** — pipeline picker or text input (pre-filled, respects targetType)
- **Schedule** — interval/cron mode toggle (pre-filled, same as create form)
- **Params** — dynamic param inputs (pre-filled)
- **On Failure** — dropdown (pre-filled)

The form has **Save** and **Cancel** buttons. Save sends a `PATCH` request with only changed fields.

```
┌─────────────────────────────────────────────────────────────┐
│ 🟢 Run Pipeline [Prompt]          Every 1 hours  next: 57m │
│                                                             │
│ [Run Now]  [Pause]  [Save ✓]  [Cancel ✕]                   │
│                                                             │
│ Name:        [Run Pipeline              ]                   │
│ Target:      [▼ git-fetch               ]                   │
│ Schedule:    (•) Interval  ( ) Cron                         │
│              Every [1] [hours ▼]                             │
│ On Failure:  [notify ▼]                                     │
│ Params:      pipeline [D:\...\git-fetch ]                   │
│                                                             │
│ RUN HISTORY                                                 │
│ ✔ 2m ago                                    0s  completed   │
└─────────────────────────────────────────────────────────────┘
```

### 3. "Duplicate" action

Add a **Duplicate** button that opens the create form pre-populated with the selected schedule's values. Useful for creating similar schedules with minor variations (e.g., same pipeline, different interval).

### 4. Click-to-edit individual fields (stretch)

Allow clicking on individual field values (e.g., the cron expression, on-failure setting) to edit them inline without entering full edit mode. Lower priority — the full edit form covers this use case.

## Acceptance Criteria

- [x] An **Edit** button appears in the schedule detail panel action bar
- [x] Clicking Edit transforms the detail view into an editable form pre-populated with current values
- [x] All editable fields are supported: name, target, targetType, schedule (cron), params, onFailure
- [x] The interval ↔ cron mode toggle works correctly when editing (detect current mode from cron expression)
- [x] **Save** sends a `PATCH` request with changed fields only; on success, exits edit mode and refreshes the schedule
- [x] **Cancel** discards changes and returns to the read-only detail view
- [x] Edit is disabled while the schedule is currently running (to avoid race conditions)
- [x] A **Duplicate** button opens the create form pre-populated with the schedule's current configuration
- [x] Existing tests pass; new tests cover the edit and duplicate flows
- [x] WebSocket `schedule-updated` events update the UI in real-time during/after edits

## Subtasks

### S1: Extract reusable form fields from `CreateScheduleForm`

The create form (lines 377–755 in `RepoSchedulesTab.tsx`) has all the field logic but is tightly coupled to creation. Extract shared field components or a shared form state hook so both Create and Edit can reuse them.

**Files:** `packages/coc/src/server/spa/client/react/repos/RepoSchedulesTab.tsx`

### S2: Add Edit button and edit mode state

- Add `editingId` state variable (similar to `expandedId`)
- Add "Edit" button to the detail panel action bar
- When `editingId` matches, render the edit form instead of static fields
- Wire Save to `PATCH /api/workspaces/:id/schedules/:sid`
- Wire Cancel to clear `editingId`

**Files:** `packages/coc/src/server/spa/client/react/repos/RepoSchedulesTab.tsx`

### S3: Implement cron-to-interval reverse parsing

The create form supports an "Interval" mode that generates cron expressions. The edit form needs to detect whether an existing cron expression matches a simple interval pattern (e.g., `0 */1 * * *` → every 1 hour) and pre-select the correct mode. Fall back to raw cron mode for complex expressions.

**Files:** `packages/coc/src/server/spa/client/react/repos/RepoSchedulesTab.tsx`

### S4: Add Duplicate action

- Add "Duplicate" button to the detail panel
- On click, open the create form with all fields pre-populated from the selected schedule
- The name should be prefixed with "Copy of " to avoid confusion

**Files:** `packages/coc/src/server/spa/client/react/repos/RepoSchedulesTab.tsx`

### S5: Add tests for edit and duplicate flows

- Test that Edit button appears and toggles edit mode
- Test that Save sends correct PATCH payload
- Test that Cancel reverts to read-only view
- Test cron-to-interval detection
- Test Duplicate pre-populates the create form

**Files:** `packages/coc/src/server/spa/client/react/repos/__tests__/` or co-located test files

## Notes

- The backend `PATCH` endpoint is already fully implemented in `packages/coc/src/server/schedule-handler.ts` — no backend changes needed.
- The `ScheduleManager.updateSchedule()` method handles cron timer rescheduling, persistence, and event emission.
- The `CreateScheduleForm` is a module-private function (~380 lines). Refactoring it for reuse (S1) is the biggest effort; the rest is straightforward wiring.
- Consider keeping the form in the same file to avoid a large refactor, using a `mode: 'create' | 'edit'` prop and an optional `initialValues` prop.
- The `SCHEDULE_TEMPLATES` (auto-commit, run-pipeline, pull-sync, clean-outputs, run-script) are only relevant for creation, not editing — hide the template picker in edit mode.
