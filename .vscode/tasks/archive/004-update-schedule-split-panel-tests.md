---
status: pending
---

# 004: Update tests for split-panel layout

## Summary
Update existing tests in `RepoSchedulesTab-edit.test.tsx` that relied on toggle-expand behavior, and add new tests in both test files that verify auto-select on load, right-panel rendering, selection highlight, and `+ New` form placement in the split-panel layout.

## Motivation
Commits 001–003 replaced the card-based expand/collapse row pattern with a two-panel layout: a fixed-width left list and a right panel that shows `ScheduleDetail` or `CreateScheduleForm`. Tests that click a schedule row expecting it to toggle open inline now need to confirm the detail appears in the right panel instead. New split-panel-specific behaviors (auto-select, highlight class, panel visibility, `+ New` routing) have no test coverage yet.

## Changes

### Files to Create
- None

### Files to Modify
- `packages/coc/test/spa/react/RepoSchedulesTab-edit.test.tsx` — update eight existing tests that click a row to "expand" it; add `MOCK_SCHEDULE_2` constant for multi-schedule tests
- `packages/coc/test/spa/react/RepoSchedulesTab.test.tsx` — add a new `describe` block (`Split-panel layout`) with five new tests; existing template/pipeline tests are unaffected

### Files to Delete
- None

## Implementation Notes

### Existing tests to update (`RepoSchedulesTab-edit.test.tsx`)

All eight tests below follow the same pattern: `fireEvent.click(screen.getByText('Test Schedule'))` then `await waitFor(() => expect(screen.getByTestId('edit-btn')).toBeTruthy())`. Because `selectedId` now drives the right panel and the first schedule is **auto-selected on load**, the click is no longer needed to reveal the detail — the detail is already present after loading. Each test should:
1. Remove (or make optional) the `fireEvent.click(screen.getByText('Test Schedule'))` that was acting as an expand toggle.
2. Replace the `waitFor` guarding `edit-btn` with a plain `await waitFor` that simply asserts the right-panel detail is visible (e.g. `screen.getByTestId('schedule-detail')` or `screen.getByTestId('edit-btn')` directly after render without a preceding click).

Affected tests:
| Test name | Change needed |
|---|---|
| `'shows Edit and Duplicate buttons in expanded detail'` | Remove click-to-expand; detail auto-visible; assert `edit-btn` and `duplicate-btn` after load |
| `'Edit button is disabled when schedule is running'` | Remove click-to-expand; assert `edit-btn` disabled after load |
| `'clicking Edit shows the edit form with pre-populated fields'` | Remove click-to-expand; rename to `'Edit shows the edit form with pre-populated fields'` |
| `'edit form does not show template picker'` | Remove click-to-expand |
| `'Cancel returns to read-only detail view'` | Remove click-to-expand |
| `'Save sends a PATCH request with updated fields'` | Remove click-to-expand |
| `'edit form shows params in generic editor'` | Remove click-to-expand |
| `'cron expression that is not an interval shows cron mode in edit'` | Remove click-to-expand (uses own `cronSchedule` fixture, same pattern) |

**Duplicate describe block (`Schedule duplicate`)** — four tests all do `fireEvent.click(screen.getByText('Test Schedule'))` before asserting `duplicate-btn`. Same fix: remove click, assert directly after load.

| Test name | Change needed |
|---|---|
| `'Duplicate button opens create form with "Copy of" prefix'` | Remove click-to-expand |
| `'Duplicate pre-populates target and onFailure'` | Remove click-to-expand |
| `'Duplicate shows template picker (create mode)'` | Remove click-to-expand |
| `'Duplicate pre-populates params'` | Remove click-to-expand |
| `'Duplicate submits as POST (create), not PATCH'` | Remove click-to-expand |

> **No expand-arrow assertions** (`▼`/`▶`) or `Card` wrapper queries were found in either file, so no additional removals are needed.

### New tests to add (`RepoSchedulesTab.test.tsx`)

Add a new `describe('Split-panel layout', ...)` block after the existing `Pipeline dropdown selector` describe. The block reuses the same `mockFetch`/`vi.mock` setup already at module scope and introduces a `MOCK_SCHEDULE` constant (same shape as in `RepoSchedulesTab-edit.test.tsx`) plus a `renderWithSchedules` helper that mirrors the one in the edit file.

Add a `MOCK_SCHEDULE_2` constant for the "selection change" test.

## Tests

### New `describe('Split-panel layout')` block — pseudo-code sketches

**1. Auto-select on load**
```tsx
it('auto-selects first schedule on load and shows its detail in right panel', async () => {
    // Setup: mockFetchApi returns [MOCK_SCHEDULE]
    mockFetchApi.mockResolvedValue({ schedules: [MOCK_SCHEDULE] });
    await renderSchedulesTab();  // (reuse existing helper, but with schedule data)

    // No click performed
    await waitFor(() => {
        // Schedule name appears in the right panel detail
        expect(screen.getAllByText('Test Schedule').length).toBeGreaterThanOrEqual(1);
        // Detail-specific content (target, cron) is visible
        expect(screen.getByText('pipelines/test/pipeline.yaml')).toBeTruthy();
    });
});
```

**2. Right panel shows detail on row click**
```tsx
it('clicking a schedule row shows that schedule\'s detail in the right panel', async () => {
    mockFetchApi.mockResolvedValue({ schedules: [MOCK_SCHEDULE, MOCK_SCHEDULE_2] });
    await renderSchedulesTab();

    // Click the second schedule row in the left panel
    fireEvent.click(screen.getByText(MOCK_SCHEDULE_2.name));

    await waitFor(() => {
        // Right panel now shows the second schedule's target
        expect(screen.getByText(MOCK_SCHEDULE_2.target)).toBeTruthy();
    });
});
```

**3. Right panel shows CreateScheduleForm on `+ New`**
```tsx
it('clicking "+ New" shows CreateScheduleForm in the right panel while left list remains visible', async () => {
    mockFetchApi.mockResolvedValue({ schedules: [MOCK_SCHEDULE] });
    await renderSchedulesTab();

    fireEvent.click(screen.getByText('+ New'));

    await waitFor(() => {
        // Form heading is present in right panel
        expect(screen.getByText('New Schedule')).toBeTruthy();
        // Left panel still shows the schedule name
        expect(screen.getByText(MOCK_SCHEDULE.name)).toBeTruthy();
    });
});
```

**4. Selected row has `border-l-2` class**
```tsx
it('selected row has border-l-2 class applied', async () => {
    mockFetchApi.mockResolvedValue({ schedules: [MOCK_SCHEDULE, MOCK_SCHEDULE_2] });
    await renderSchedulesTab();

    // First schedule is auto-selected
    await waitFor(() => {
        const rows = screen.getAllByRole('button');  // or use data-testid="schedule-row-<id>"
        const firstRow = rows.find(r => r.textContent?.includes(MOCK_SCHEDULE.name));
        expect(firstRow?.className).toContain('border-l-2');
    });

    // Click the second schedule; it should gain the class and first should lose it
    fireEvent.click(screen.getByText(MOCK_SCHEDULE_2.name));

    await waitFor(() => {
        const rows = screen.getAllByRole('button');
        const secondRow = rows.find(r => r.textContent?.includes(MOCK_SCHEDULE_2.name));
        expect(secondRow?.className).toContain('border-l-2');

        const firstRow = rows.find(r => r.textContent?.includes(MOCK_SCHEDULE.name));
        expect(firstRow?.className).not.toContain('border-l-2');
    });
});
```

**5. Detail updates when selection changes**
```tsx
it('clicking a different schedule replaces the right panel content', async () => {
    mockFetchApi.mockResolvedValue({ schedules: [MOCK_SCHEDULE, MOCK_SCHEDULE_2] });
    await renderSchedulesTab();

    // First schedule auto-selected — its detail is visible
    await waitFor(() => {
        expect(screen.getByText(MOCK_SCHEDULE.target)).toBeTruthy();
    });

    // Select the second schedule
    fireEvent.click(screen.getByText(MOCK_SCHEDULE_2.name));

    await waitFor(() => {
        // Right panel now shows second schedule's target
        expect(screen.getByText(MOCK_SCHEDULE_2.target)).toBeTruthy();
        // First schedule's unique target is no longer in the right panel
        // (it may still appear in the left list label, so query specifically)
    });
});
```

### Constants to add at the top of `RepoSchedulesTab.test.tsx`

```ts
const MOCK_SCHEDULE = {
    id: 'sched-1',
    name: 'Test Schedule',
    target: 'pipelines/test/pipeline.yaml',
    targetType: 'prompt' as const,
    cron: '0 */2 * * *',
    cronDescription: 'Every 2 hours',
    params: {},
    onFailure: 'notify',
    status: 'active',
    isRunning: false,
    nextRun: new Date(Date.now() + 3600000).toISOString(),
    createdAt: new Date().toISOString(),
};

const MOCK_SCHEDULE_2 = {
    id: 'sched-2',
    name: 'Second Schedule',
    target: 'pipelines/other/pipeline.yaml',
    targetType: 'prompt' as const,
    cron: '*/5 * * * *',
    cronDescription: 'Every 5 minutes',
    params: {},
    onFailure: 'notify',
    status: 'active',
    isRunning: false,
    nextRun: new Date(Date.now() + 300000).toISOString(),
    createdAt: new Date().toISOString(),
};
```

Also add a `renderWithSchedules` helper in `RepoSchedulesTab.test.tsx` — same as the one in the edit file but importing the same `mockFetch`/`mockFetchApi` already available at module scope:

```ts
async function renderWithSchedules(schedules = [MOCK_SCHEDULE]) {
    // pull from the module-scoped mockFetch; wire fetchApi mock similarly
    const { fetchApi } = await import('../../../src/server/spa/client/react/hooks/useApi');
    (fetchApi as ReturnType<typeof vi.fn>).mockResolvedValue({ schedules });
    return renderSchedulesTab();
}
```

> **Note:** The `vi.mock` for `useApi` in `RepoSchedulesTab.test.tsx` uses an inline `vi.fn().mockResolvedValue({ schedules: [] })` with no external handle. To make it controllable per-test the mock declaration should be updated to:
> ```ts
> const mockFetchApi = vi.fn();
> vi.mock('.../useApi', () => ({ fetchApi: (...args: any[]) => mockFetchApi(...args) }));
> ```
> This mirrors the pattern already used in `RepoSchedulesTab-edit.test.tsx` and is a **prerequisite for the new split-panel tests**.

## Acceptance Criteria
- [ ] All tests in `RepoSchedulesTab-edit.test.tsx` pass without `fireEvent.click` used as an expand toggle
- [ ] `'shows Edit and Duplicate buttons in expanded detail'` — edit/duplicate buttons visible immediately after `renderWithSchedules()`, no click needed
- [ ] `'Edit button is disabled when schedule is running'` — disabled state verified without prior expand click
- [ ] All five duplicate tests no longer require a row click before asserting `duplicate-btn`
- [ ] New test: first schedule detail visible in right panel **before** any click
- [ ] New test: clicking a row shows that schedule's detail in the right panel
- [ ] New test: `+ New` shows `CreateScheduleForm` in right panel while left list stays visible
- [ ] New test: selected row carries the `border-l-2` class; unselected rows do not
- [ ] New test: switching selection replaces right-panel content
- [ ] `npm run test:run` (in `packages/coc`) passes with no regressions in template/pipeline describe blocks

## Dependencies
- Depends on: 001, 002, 003

## Assumed Prior State
- `ScheduleDetail` sub-component exists, exported from `RepoSchedulesTab` or a sibling file, and accepts `{ schedule, workspaceId, history, onRunNow, onPauseResume, onEdit, onDuplicate, onDelete, editingId, onCancelEdit, onSaved }` (from commit 001)
- `RepoSchedulesTab` maintains `selectedId` state initialized to the first schedule's id on load; `handleSelect(id)` is non-toggle (from commit 002)
- Split-panel DOM: outer `flex h-full overflow-hidden` div, left panel `w-72` list of clickable rows, right panel `flex-1` showing `ScheduleDetail` or `CreateScheduleForm`; selected row has `border-l-2 border-[#0078d4]` classes (from commit 003)
- `CreateScheduleForm` is shown in the right panel (not in a modal) when `+ New` is clicked or `onDuplicate` is invoked (from commit 003)
- History fetching is driven by `useEffect` watching `selectedId` (from commit 002)
