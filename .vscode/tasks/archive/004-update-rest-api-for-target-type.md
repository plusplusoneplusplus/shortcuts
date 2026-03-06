---
status: pending
---

# 004: Update REST API to Accept `targetType`

## Summary
Update the schedule POST and PATCH handlers in `schedule-handler.ts` to accept and validate a `targetType` field (`'prompt' | 'script'`), pass it through to the schedule manager, and include it in the serialized schedule response shape returned by `serializeSchedule()`.

## Motivation
The API is the public contract between the frontend and the backend. Isolating API changes here keeps the handler clean and makes the UI commit straightforward. Without surfacing `targetType` in the response shape, the frontend cannot distinguish how a schedule's target should be interpreted or displayed.

## Changes

### Files to Create
_(none)_

### Files to Modify
- **`packages/coc/src/server/schedule-handler.ts`**
  - Add `VALID_TARGET_TYPES` set (`'prompt'`, `'script'`) near the top of the validation section.
  - In **POST handler**: extract `targetType` from the request body; validate it is `'prompt' | 'script'` (or absent); default to `'prompt'` when absent; if `targetType === 'script'`, validate that `target` is a non-empty string (reuse existing check — already required, so no extra code needed); pass `targetType` to `manager.addSchedule()`.
  - In **PATCH handler**: if `targetType` is present in the body, validate it against `VALID_TARGET_TYPES` and return 400 with a clear message on failure; add `targetType` to the `updates` object that is forwarded to `manager.updateSchedule()`.
  - In **`serializeSchedule()`**: add `targetType: schedule.targetType ?? 'prompt'` to the returned object, after the existing `target` field.

### Files to Delete
_(none)_

## Implementation Notes
- `VALID_TARGET_TYPES` should be a `Set<string>` consistent with `VALID_STATUSES` and `VALID_ON_FAILURE` already in the file.
- Invalid `targetType` values must return HTTP 400 with a message like: `"Invalid targetType: <value>. Valid values: prompt, script"`.
- `serializeSchedule()` already adds computed fields (`cronDescription`, `isRunning`, `nextRun`). Simply append `targetType: schedule.targetType ?? 'prompt'` — do not reorder or remove existing fields.
- The `target` field is already validated as a non-empty string in `validateScheduleInput()`, so no additional `script`-specific target validation beyond the existing check is required. If a stricter check is desired (e.g., disallowing whitespace-only strings for scripts), that is out of scope for this commit.
- Keep all existing fields and validation logic untouched.

## Tests
Update **`packages/coc/src/test/server/schedule-handler.test.ts`**:

1. **POST with `targetType: 'script'`** — creates a schedule and the response body contains `targetType: 'script'`.
2. **POST with invalid `targetType`** — returns HTTP 400 with an appropriate error message.
3. **POST without `targetType`** — response body contains `targetType: 'prompt'` (default).
4. **GET response includes `targetType`** — after creating a schedule, the list endpoint returns each schedule object with a `targetType` field.

Existing schedule API tests must remain green without modification.

## Acceptance Criteria
- All 4 new test cases above pass.
- All pre-existing schedule handler tests continue to pass unchanged.
- `targetType` appears in the serialized schedule object for GET (list), POST (create), and PATCH (update) responses.
- POSTing or PATCHing with an unrecognized `targetType` returns HTTP 400.
- POSTing without `targetType` silently defaults to `'prompt'`.

## Dependencies
- Depends on **001** — `TargetType` union type and `ScheduleEntry.targetType` field must exist on the data model.
- Depends on **002** — schedule store must persist `targetType`.
- Depends on **003** — schedule manager dispatch must forward `targetType` to the correct executor.

## Assumed Prior State
- `TargetType = 'prompt' | 'script'` is defined and exported from the types introduced in commit 001.
- `ScheduleEntry.targetType` is an optional field (`TargetType | undefined`) as of commit 001.
- `manager.addSchedule()` and `manager.updateSchedule()` accept `targetType` as of commit 003.
- The test file `packages/coc/src/test/server/schedule-handler.test.ts` already covers the existing CRUD surface and can be extended without restructuring.
