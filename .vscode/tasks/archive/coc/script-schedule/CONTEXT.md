# Context: Script-Based Scheduling in CoC

## User Story
The user wants the CoC schedule manager to support not just AI prompt-based jobs, but also script/command-based jobs. When creating a schedule, the user should be able to choose between a "Prompt" type (existing) or a "Script" type (new), enter a shell command (e.g., `echo "abc"`), and have it execute on the configured cron interval. The run history should show exit code and stdout/stderr output.

## Goal
Extend the CoC scheduler to support script/command execution as a first-class schedule type alongside existing prompt-based schedules, with full E2E Playwright test coverage validating `echo "abc"` executes correctly.

## Commit Sequence
1. Add `targetType` to shared types
2. Implement `run-script` queue executor
3. Update schedule manager dispatch by `targetType`
4. Update REST API to accept `targetType`
5. Update SPA — schedule create form and history view
6. E2E Playwright tests for script-based schedules

## Key Decisions
- `targetType` is optional on `ScheduleEntry`, defaults to `'prompt'` for full backward compatibility
- Script execution uses `child_process.spawn` with `shell: true` — supports both command strings and script paths
- Stdout/stderr captured and stored in queue task result; surfaced in history via process store API
- Concurrency: `run-script` tasks are `exclusive` (serialized), not shared
- Persistence bumped to v2 with forward migration (v1 entries get `targetType: 'prompt'`)
- Cross-platform command in E2E tests: `node -e "process.stdout.write('abc')"` instead of shell-specific `echo`

## Conventions
- Follow existing `isXxxPayload` type guard pattern for new payload types
- Plan files under `.vscode/tasks/coc-scheduler/script-schedule/`
- E2E tests use `packages/coc/test/e2e/fixtures/server-fixture.ts` fixture pattern
- No new npm dependencies — use Node built-ins (`child_process`)
