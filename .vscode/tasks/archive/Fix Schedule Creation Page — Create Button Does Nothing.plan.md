# Plan: Fix Schedule Creation Page — "Create" Button Does Nothing

## Problem

On the CoC **Schedules** tab → **New Schedule** form, clicking the **Create** button does nothing. No API call is made, no error is shown, and the form stays unchanged.

A secondary concern: form validation errors and draft state (in-progress form inputs) should behave correctly after the fix.

---

## Root Cause Analysis

### Bug 1 — Create button does not submit the form (primary)

**File:** `packages/coc/src/server/spa/client/react/repos/RepoSchedulesTab.tsx` (~line 670)

```tsx
// Current (broken)
<Button variant="primary" size="sm" disabled={submitting}>
    {submitting ? 'Creating...' : 'Create'}
</Button>
```

The `Button` component (`shared/Button.tsx`) defaults to `type="button"`:
```tsx
// Button.tsx line 41
type = 'button',
```

Because no `type` is passed, the Create button renders as `<button type="button">`, which **does not submit** the enclosing `<form>`. This is why clicking Create does nothing — `handleSubmit` is never called.

**Fix:** Add `type="submit"` to the Create button.

```tsx
// Fixed
<Button variant="primary" size="sm" type="submit" disabled={submitting}>
    {submitting ? 'Creating...' : 'Create'}
</Button>
```

---

### Bug 2 — Validation errors may be silently swallowed (secondary)

**File:** `packages/coc/src/server/spa/client/react/repos/RepoSchedulesTab.tsx`

The `handleSubmit` function calls `setError(...)` for validation failures, but the error display should be verified to ensure it's visible in the form layout. If `error` is set but not rendered near the submit buttons, the user would see "nothing happens" again after Bug 1 is fixed.

Verify that `{error && <div className="...">{error}</div>}` (around line 666) is rendered inside the form and visible before the action buttons.

---

### Bug 3 — "Run pipeline" target defaults to empty string (edge case)

**File:** `packages/coc/src/server/spa/client/react/repos/RepoSchedulesTab.tsx` (~line 387)

```tsx
setTarget(templateId === 'run-pipeline' ? '' : tpl.target);
```

When the "Run pipeline" template is selected, `target` starts empty and is only populated when the user picks a pipeline from the dropdown. If no pipeline is selected (e.g., pipelines haven't loaded yet), clicking Create would hit the validation guard `!target.trim()` and show "Name and target are required" — but this is blocked by Bug 1. Once Bug 1 is fixed, the user will get a clear error message for this case. No code change needed here unless better UX guidance is desired (e.g., disable Create until a pipeline is selected).

---

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/RepoSchedulesTab.tsx` | Add `type="submit"` to the Create `<Button>` (~line 670) |
| `packages/coc/src/server/spa/client/react/repos/RepoSchedulesTab.tsx` | Verify error display element is rendered and visible in form |

---

## Todos

1. **fix-create-button-type** — Add `type="submit"` to the Create button in `RepoSchedulesTab.tsx`
2. **verify-error-display** — Confirm the `error` state is rendered in the form so validation messages are visible
3. **test-schedule-creation** — Manually verify: select "Run pipeline", pick a pipeline, set interval, click Create → schedule appears in the list

---

## Notes

- The Cancel button already uses `onClick={onCancel}` (not form submission), so no change needed there.
- The `intervalToCron()` function correctly converts interval mode to a valid cron expression before submission, so that path is fine.
- No backend changes are needed; the API handler and validation are correct.
