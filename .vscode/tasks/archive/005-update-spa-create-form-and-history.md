---
status: pending
---

# 005: Update SPA — Schedule Create Form and History View

## Summary
Add a `targetType` picker (Prompt / Script) to the schedule creation form, add a "Run Script" preset template, and surface script exit code and output in the run history panel.

## Motivation
The UI is the end-to-end user experience layer. Placing it last ensures all backend changes are stable before building the form.

## Changes

### Files to Create
_(none)_

### Files to Modify
- `packages/coc/src/server/spa/client/react/repos/RepoSchedulesTab.tsx`:
  1. **Type picker in `CreateScheduleForm`**: Add a two-button toggle (`Prompt` / `Script`) above the Target field. When `Script` selected: Target label becomes "Command / Script", placeholder becomes e.g. `echo "hello world"` or `/path/to/script.sh`. When `Prompt` selected: existing behavior unchanged.
  2. **`SCHEDULE_TEMPLATES`**: Add a new "🖥️ Run Script" template with fields: `name: 'Script Runner'`, `target: ''`, `targetType: 'script'`, `params: { workingDirectory: '' }`, cron preset of `0 * * * *` (hourly).
  3. **POST body**: Include `targetType` in the create/update fetch calls.
  4. **Run history panel**: When `run.processId` is a queue task, and task result contains `stdout`/`stderr`/`exitCode`, show them collapsed in the history row (e.g., `Exit: 0 | stdout: ...`). Use a `<details>` element or small expandable section.
  5. **Schedule list card**: Show a small badge `[Script]` or `[Prompt]` next to the schedule name based on `targetType`.

### Files to Delete
_(none)_

## Implementation Notes
- The toggle should be a controlled `useState` field — `targetType: 'prompt' | 'script'`.
- The `workingDirectory` param should only appear in the form when `targetType === 'script'`.
- Reuse the existing `fetchApi` helper for API calls — just include `targetType` in the JSON body.
- The new "Run Script" template entry in `SCHEDULE_TEMPLATES` follows the same shape as existing entries; add a `targetType` field to the `ScheduleTemplate` type if not already present.

## Tests
This is a React component — add/update Playwright tests in commit 006 rather than unit tests here. However, check if any existing snapshot/unit tests for the form exist and update them.

## Acceptance Criteria
- User can select Script type, enter a command, pick a cron interval, save, and see the schedule listed with `[Script]` badge.
- Run history shows exit code and stdout/stderr output.

## Dependencies
- Depends on commits 001 (`TargetType` type definition), 004 (REST API returning `targetType`)

## Assumed Prior State
- REST API returns `targetType` from commit 004.
- `TargetType` is defined in commit 001.
