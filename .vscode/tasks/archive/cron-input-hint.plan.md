# Cron Input: Inline Hint & Examples

## Problem
Users editing schedules with the "Cron" tab are faced with a bare text input (placeholder `0 9 * * *`) and no guidance on cron syntax. Users unfamiliar with cron have no way to understand what the 5 fields mean or find common patterns.

## Proposed Approach
Add a contextual hint panel to the right of (or below) the cron input that:
1. Shows a live human-readable description of the currently entered expression.
2. Displays the 5-field format legend (`min  hour  day  month  weekday`).
3. Lists ~6 common cron examples that can be clicked to populate the input.

All changes are confined to `RepoSchedulesTab.tsx` (the cron `<input>` block, lines ~803–810).

## Acceptance Criteria
- [ ] When the "Cron" schedule tab is active, a hint panel is visible adjacent to the cron input.
- [ ] The panel shows the field-order legend: `minute · hour · day-of-month · month · day-of-week`.
- [ ] A human-readable description of the current expression is shown (e.g. `"Every 6 hours"` for `0 */6 * * *`). Falls back to a neutral message when the expression is empty or unrecognized.
- [ ] A set of common examples is listed; clicking one fills the cron input.
- [ ] The hint panel is visually subtle (does not overshadow the main form) and works in both light and dark themes.
- [ ] No regressions to the Interval tab or the rest of the form.

## Subtasks

### 1. Add `describeCron` utility
- [x] Done

### 2. Define `CRON_EXAMPLES` constant
- [x] Done

### 3. Build `CronHint` inline component
- [x] Done

### 4. Wire into the form
- [x] Done

### 5. Test
- [x] Done

## Notes
- Keep changes inside `RepoSchedulesTab.tsx`; no new files needed unless the component becomes large.
- Do **not** add a cron-parsing npm dependency — the inline utility is intentionally minimal.
- Existing `parseCronToInterval` already handles `*/N` interval patterns; `describeCron` is read-only (display only) and separate.
- The field legend order is standard Linux/POSIX cron (NOT Quartz which adds seconds).
