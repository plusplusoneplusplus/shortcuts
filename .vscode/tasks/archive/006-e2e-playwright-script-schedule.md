---
status: pending
---

# 006: E2E Playwright Tests for Script-Based Schedules

## Summary

Add a Playwright E2E spec (`schedule-script.spec.ts`) that validates creating a script schedule via the UI, manually triggering it, and verifying `echo "abc"` executes successfully with exit code 0 and stdout "abc" visible in the run history. A companion `schedule-seed.ts` fixture provides a `seedSchedule()` helper for API-level tests.

## Motivation

E2E tests validate the full stack — UI form → REST API → queue → executor → history — in a way unit tests cannot. Script-schedule execution spans every layer added in commits 001–005 (types, executor, manager, API, and UI). Placing these tests last ensures all prior commits are stable and that the feature works end-to-end in a real browser before merging.

## Changes

### Files to Create

- **`packages/coc/test/e2e/schedule-script.spec.ts`** — Main E2E spec containing all 5 test scenarios (see §Tests).
- **`packages/coc/test/e2e/fixtures/schedule-seed.ts`** — Seed helper that exports `seedSchedule(baseURL, overrides?)`, which POSTs to `/api/workspaces/:id/schedules` and returns the created `ScheduleEntry`.

### Files to Modify

_(none — no changes to existing fixtures or source files are required)_

### Files to Delete

_(none)_

## Implementation Notes

### Fixture pattern

Import `{ test, expect }` from `./fixtures/server-fixture` (not from `@playwright/test` directly). The fixture provides:
- `page` — Playwright `Page` with CDN and `/api/processes` patches already applied.
- `serverUrl` — Base URL of the ephemeral server started on port 0.
- `mockAI` — Mock AI controls (not needed for script schedules, but available).

Each test gets an isolated `dataDir` (temp dir created in `_context`) so schedule data never leaks between tests.

### `seedSchedule` helper shape

```ts
// packages/coc/test/e2e/fixtures/schedule-seed.ts
import { request } from './seed';

export interface ScheduleOverrides {
  name?: string;
  target?: string;       // command string for script type
  targetType?: 'script' | 'pipeline';
  cron?: string;
  params?: Record<string, unknown>;
  onFailure?: 'ignore' | 'notify';
  workspaceId?: string;
}

export async function seedSchedule(
  baseURL: string,
  overrides: ScheduleOverrides = {},
): Promise<Record<string, unknown>> {
  const workspaceId = overrides.workspaceId ?? 'default';
  const payload = {
    name: overrides.name ?? 'Test Schedule',
    target: overrides.target ?? 'node -e "process.stdout.write(\'abc\')"',
    targetType: overrides.targetType ?? 'script',
    cron: overrides.cron ?? '0 * * * *',
    params: overrides.params,
    onFailure: overrides.onFailure ?? 'ignore',
  };
  const res = await request(
    `${baseURL}/api/workspaces/${workspaceId}/schedules`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`seedSchedule failed: ${res.status} ${res.body}`);
  }
  const json = JSON.parse(res.body);
  return json.schedule ?? json;
}
```

### Cross-platform command

Use `node -e "process.stdout.write('abc')"` as the primary test command — it is cross-platform and avoids shell quoting differences between Linux/macOS (`echo "abc"`) and Windows (`cmd /c echo abc`). For the failure-case test use `node -e "process.exit(1)"`.

### Polling for queue completion

Mirror the pattern from `queue-mock-ai.spec.ts`:

```ts
async function waitForTaskStatus(
  serverUrl: string,
  taskId: string,
  targetStatuses: string[],
  timeoutMs = 15_000,
): Promise<Record<string, unknown>>
```

Poll `GET /api/queue/:id` every 250 ms until `task.status` is in `targetStatuses` or the timeout is exceeded.

### UI selectors

The schedule UI (added in commit 005) is expected to expose:
- A "Schedules" nav tab: `[data-testid="nav-schedules"]` or text "Schedules".
- A "New Schedule" button: `[data-testid="new-schedule"]` or text "New Schedule".
- Schedule type selector: `[data-testid="schedule-type"]` or `select` with options.
- Name input: `[data-testid="schedule-name"]` or `input[name="name"]`.
- Command input (for script type): `[data-testid="schedule-target"]` or `input[name="target"]`.
- Interval/cron input: `[data-testid="schedule-cron"]` or `input[name="cron"]`.
- Save button: `[data-testid="schedule-save"]` or `button[type="submit"]`.
- Schedule card badge: `.schedule-type-badge` or `[data-testid="schedule-type-badge"]`.
- "Run Now" button: `[data-testid="run-now"]` or `button:has-text("Run Now")`.
- Run history entries: `[data-testid="run-history-entry"]` or `.run-history-item`.
- Exit code display: `[data-testid="exit-code"]` or text matching `/exit.*0/i`.
- Stdout section: `[data-testid="run-stdout"]` or `.stdout-content`.

Adjust selectors to match the actual DOM once the UI is implemented in commit 005. Prefer `data-testid` attributes for stability.

### Cleanup

Because `server-fixture.ts` creates a fresh `tmpDir` per test and deletes it in teardown, no explicit schedule deletion is needed. Each test's server has its own empty data store.

## Tests

### 1 · Create script schedule via UI

```
Navigate to serverUrl → click "Schedules" tab
→ click "New Schedule"
→ select type "Script"
→ fill name "Echo Test"
→ fill target `node -e "process.stdout.write('abc')"`
→ fill cron `* * * * *`
→ click Save
→ assert schedule card is visible with text "Echo Test"
→ assert badge contains "[Script]"
```

### 2 · Trigger run via "Run Now" button

```
(continue from test 1 or re-create schedule)
→ click "Run Now" on the "Echo Test" schedule card
→ waitForSelector(".run-history-item", { timeout: 15000 })
→ assert at least one history entry is visible
→ assert exit code "0" is displayed in the entry
```

### 3 · Verify stdout in history

```
(continue from test 2)
→ click / expand the most recent run history entry
→ waitForSelector(".stdout-content")
→ assert element text contains "abc"
```

### 4 · API-level: seed → run → poll → verify

```ts
test('API: script schedule runs and returns exit 0', async ({ serverUrl }) => {
  const schedule = await seedSchedule(serverUrl, {
    name: 'API Echo Test',
    target: 'node -e "process.stdout.write(\'abc\')"',
    targetType: 'script',
  });

  const workspaceId = schedule.workspaceId ?? 'default';
  const runRes = await request(
    `${serverUrl}/api/workspaces/${workspaceId}/schedules/${schedule.id}/run`,
    { method: 'POST' },
  );
  expect(runRes.status).toBe(200);
  const { taskId } = JSON.parse(runRes.body);

  const task = await waitForTaskStatus(serverUrl, taskId, ['completed', 'failed']);
  expect(task.status).toBe('completed');

  // Verify history entry
  const histRes = await request(
    `${serverUrl}/api/workspaces/${workspaceId}/schedules/${schedule.id}/history`,
  );
  const { history } = JSON.parse(histRes.body);
  const entry = history[0];
  expect(entry.status).toBe('completed');
  expect(entry.exitCode).toBe(0);
  expect(entry.processId).toBeTruthy();

  // Verify process stdout
  const procRes = await request(`${serverUrl}/api/processes/${entry.processId}`);
  const proc = JSON.parse(procRes.body);
  expect(proc.stdout ?? proc.result?.stdout).toContain('abc');
});
```

### 5 · Failure case

```ts
test('API: script schedule with exit 1 shows failed status', async ({ serverUrl }) => {
  const schedule = await seedSchedule(serverUrl, {
    name: 'Fail Test',
    target: 'node -e "process.exit(1)"',
    targetType: 'script',
  });

  const workspaceId = schedule.workspaceId ?? 'default';
  const runRes = await request(
    `${serverUrl}/api/workspaces/${workspaceId}/schedules/${schedule.id}/run`,
    { method: 'POST' },
  );
  expect(runRes.status).toBe(200);
  const { taskId } = JSON.parse(runRes.body);

  const task = await waitForTaskStatus(serverUrl, taskId, ['completed', 'failed']);
  expect(task.status).toBe('failed');

  const histRes = await request(
    `${serverUrl}/api/workspaces/${workspaceId}/schedules/${schedule.id}/history`,
  );
  const { history } = JSON.parse(histRes.body);
  expect(history[0].status).toBe('failed');
  expect(history[0].exitCode).not.toBe(0);
});
```

## Acceptance Criteria

- [ ] All 5 test scenarios pass locally on Linux/macOS and Windows.
- [ ] `echo "abc"` (via `node -e "process.stdout.write('abc')"`) schedule runs with exit code 0.
- [ ] "abc" appears in the run output (both in the UI and in the process record's stdout field).
- [ ] A schedule with `node -e "process.exit(1)"` reports `failed` status in history.
- [ ] Tests run cleanly with `npm run test:e2e` in `packages/coc/` (no leftover temp dirs or orphaned servers).
- [ ] CI (2 workers, 1 retry) passes without flakiness.

## Dependencies

- Depends on commit 001 — `targetType: 'script'` type definitions.
- Depends on commit 002 — Script executor implementation.
- Depends on commit 003 — Schedule manager wired to script executor.
- Depends on commit 004 — REST API endpoints for schedule CRUD and `POST .../run`.
- Depends on commit 005 — SPA UI: Schedules tab, "New Schedule" form, "Run Now" button, history panel.

## Assumed Prior State

All prior commits (001–005) are applied and stable:
- `targetType: 'script'` is fully supported in types, executor, manager, API, and UI.
- `POST /api/workspaces/:id/schedules` creates a schedule and returns it with an `id`.
- `POST /api/workspaces/:id/schedules/:id/run` enqueues a task and returns `{ taskId }`.
- `GET /api/workspaces/:id/schedules/:id/history` returns `{ history: HistoryEntry[] }` where each entry has `status`, `exitCode`, and `processId`.
- `GET /api/processes/:id` returns the process record with stdout available at `stdout` or `result.stdout`.
- `server-fixture.ts` provides `{ page, serverUrl, mockAI }` to all tests via `base.extend`.
