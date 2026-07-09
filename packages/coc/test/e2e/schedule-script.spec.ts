/**
 * Schedule Script E2E Tests
 *
 * Tests for script-based schedule creation, manual runs, and execution
 * results for the CoC server's schedule feature.
 *
 * Design notes (implementation vs spec differences):
 * - POST .../run returns { run: { processId: 'queue_<taskId>' } } — not { taskId }
 * - Task status is always 'completed' for both exit 0 and exit 1 scripts
 *   (the queue executor never rejects for script tasks; failure is in task.result.success)
 * - ScheduleRunRecord has no exitCode/stdout fields — only queue task result does
 */

import { type Page } from '@playwright/test';
import { test, expect } from './fixtures/server-fixture';
import { seedWorkspace, request } from './fixtures/seed';
import { seedSchedule } from './fixtures/schedule-seed';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

async function disableSchedulesInScheduledSlide(serverUrl: string): Promise<void> {
    const res = await request(`${serverUrl}/api/admin/config`, {
        method: 'PUT',
        body: JSON.stringify({ 'features.schedulesInScheduledSlide': false }),
    });
    if (res.status !== 200) {
        throw new Error(`Failed to disable schedules-in-slide feature: ${res.status} ${res.body}`);
    }
}

/** Poll GET /api/queue/:id until status matches or timeout. */
async function waitForTaskStatus(
    serverUrl: string,
    taskId: string,
    targetStatuses: string[],
    timeoutMs = 15_000,
    intervalMs = 250,
): Promise<Record<string, unknown>> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const res = await request(`${serverUrl}/api/queue/${taskId}`);
        if (res.status === 200) {
            const json = JSON.parse(res.body);
            const task = json.task ?? json;
            if (targetStatuses.includes(task.status as string)) {
                return task as Record<string, unknown>;
            }
        }
        await new Promise(r => setTimeout(r, intervalMs));
    }
    throw new Error(
        `Task ${taskId} did not reach [${targetStatuses.join('|')}] within ${timeoutMs}ms`,
    );
}

/** Navigate to the Schedules sub-tab of the first workspace in the sidebar. */
async function navigateToSchedules(page: Page, serverUrl: string): Promise<void> {
    await disableSchedulesInScheduledSlide(serverUrl);
    // Pre-dismiss the welcome modal AND concept tour so neither blocks pointer events.
    await request(`${serverUrl}/api/preferences`, {
        method: 'PATCH',
        body: JSON.stringify({
            hasSeenWelcome: true,
            onboardingProgress: { hasCompletedTour: true, dismissed: true },
        }),
    });
    await page.goto(serverUrl);
    await page.click('[data-tab="repos"]');
    await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10_000 });
    await page.locator('[data-testid="repo-tab"]').first().click();
    await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10_000 });
    await page.click('[data-subtab="schedules"]');
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

test.describe('Schedule Script', () => {
    test('UI: create script schedule via form shows Script label pill', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-sched-ui', 'sched-ui', '/ws/sched-ui');

        await navigateToSchedules(page, serverUrl);

        // Wait for the schedules tab to finish loading (empty state means loading=false)
        await expect(page.locator('[data-testid="user-schedules-dropzone"]')).toBeVisible({ timeout: 10_000 });

        // Open the create form (exact match avoids "+ New Chat"). The default
        // form is now the streamlined PromptScheduleForm; we need to switch to
        // the advanced (CreateScheduleForm) view to access the action cards.
        await page.locator('#repo-detail-content').getByRole('button', { name: '+ New', exact: true }).click();
        await page.click('[data-testid="switch-to-advanced"]');
        await expect(page.locator('[data-testid="schedule-action-cards"]')).toBeVisible({ timeout: 10_000 });

        // Explicitly select Script action.
        await page.click('[data-testid="schedule-action-script"]');

        // Fill name and command
        await page.fill('[placeholder="Name (e.g., Daily Report)"]', 'Echo Test');
        await page.fill('[data-testid="target-input"]', `node -e "process.stdout.write('hello')"`);

        // Submit
        await page.getByRole('button', { name: 'Create' }).click();

        // Schedule card with Script label pill should appear
        await expect(page.getByTestId('schedule-name').filter({ hasText: 'Echo Test' })).toBeVisible({ timeout: 10_000 });
        // Type label pills carry a stable data-testid in the list rows
        await expect(
            page.locator('.repo-schedule-item:has-text("Echo Test") [data-testid="type-label-script"]'),
        ).toBeVisible();
    });

    test('UI: Run Now triggers run and history entry appears', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-sched-run', 'sched-run', '/ws/sched-run');
        await seedSchedule(serverUrl, {
            name: 'Run Test',
            target: `node -e "process.stdout.write('run')"`,
            workspaceId: 'ws-sched-run',
        });

        await navigateToSchedules(page, serverUrl);

        // Confirm the schedule card is visible
        await expect(page.getByTestId('schedule-name').filter({ hasText: 'Run Test' })).toBeVisible({ timeout: 10_000 });

        // Click the schedule item to expand and reveal actions
        await page.locator('.repo-schedule-item:has-text("Run Test")').first().click();
        await expect(page.getByRole('button', { name: 'Run schedule now' })).toBeVisible({ timeout: 5_000 });

        // Trigger a manual run — handleRunNow() auto-refreshes history for expanded cards
        await page.getByRole('button', { name: 'Run schedule now' }).click();

        // ScheduleRunRecord status is set to 'completed' immediately after enqueue
        await expect(page.getByText('Run History')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('[aria-label="Run status: completed"]')).toBeVisible({ timeout: 10_000 });
    });

    test('API: script schedule run captures stdout in queue task result', async ({ serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-sched-api1', 'sched-api1', '/ws/sched-api1');
        const schedule = await seedSchedule(serverUrl, {
            name: 'Stdout Test',
            target: `node -e "process.stdout.write('abc')"`,
            workspaceId: 'ws-sched-api1',
        });

        // Trigger a manual run
        const runRes = await request(
            `${serverUrl}/api/workspaces/ws-sched-api1/schedules/${schedule.id}/run`,
            { method: 'POST' },
        );
        expect(runRes.status).toBe(200);
        const run = (JSON.parse(runRes.body) as { run: Record<string, unknown> }).run;
        expect(run.processId).toMatch(/^queue_/);

        // Extract taskId from processId ("queue_<taskId>")
        const taskId = (run.processId as string).replace('queue_', '');

        // Wait for the queue task to complete
        const task = await waitForTaskStatus(serverUrl, taskId, ['completed', 'failed']);
        expect(task.status).toBe('completed');

        // Verify stdout captured by the executor
        const result = task.result as Record<string, unknown>;
        const inner = result.result as Record<string, unknown>;
        expect(inner.stdout).toContain('abc');
    });

    test('API: script schedule exit 0 shows success=true and history status=completed', async ({ serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-sched-api2', 'sched-api2', '/ws/sched-api2');
        const schedule = await seedSchedule(serverUrl, {
            name: 'Exit Zero Test',
            target: `node -e "process.stdout.write('abc')"`,
            workspaceId: 'ws-sched-api2',
        });

        // Trigger run
        const runRes = await request(
            `${serverUrl}/api/workspaces/ws-sched-api2/schedules/${schedule.id}/run`,
            { method: 'POST' },
        );
        expect(runRes.status).toBe(200);
        const run = (JSON.parse(runRes.body) as { run: Record<string, unknown> }).run;
        const taskId = (run.processId as string).replace('queue_', '');

        // Poll until completed
        const task = await waitForTaskStatus(serverUrl, taskId, ['completed', 'failed']);
        expect(task.status).toBe('completed');

        const result = task.result as Record<string, unknown>;
        expect(result.success).toBe(true);
        const inner = result.result as Record<string, unknown>;
        expect(inner.exitCode).toBe(0);
        expect(inner.stdout).toContain('abc');

        // History endpoint reflects the run record
        const histRes = await request(
            `${serverUrl}/api/workspaces/ws-sched-api2/schedules/${schedule.id}/history`,
        );
        expect(histRes.status).toBe(200);
        const hist = JSON.parse(histRes.body) as { history: Array<Record<string, unknown>> };
        expect(hist.history.length).toBeGreaterThan(0);
        expect(hist.history[0].status).toBe('completed');
    });

    test('API: script with exit 1 marks task result failure (task.status stays completed)', async ({ serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-sched-api3', 'sched-api3', '/ws/sched-api3');
        const schedule = await seedSchedule(serverUrl, {
            name: 'Failure Test',
            target: 'node -e "process.exit(1)"',
            workspaceId: 'ws-sched-api3',
        });

        // Trigger run
        const runRes = await request(
            `${serverUrl}/api/workspaces/ws-sched-api3/schedules/${schedule.id}/run`,
            { method: 'POST' },
        );
        expect(runRes.status).toBe(200);
        const run = (JSON.parse(runRes.body) as { run: Record<string, unknown> }).run;
        const taskId = (run.processId as string).replace('queue_', '');

        // The queue executor always resolves (never throws) for run-script tasks:
        // task.status === 'completed' even when the process exits with code 1.
        const task = await waitForTaskStatus(serverUrl, taskId, ['completed', 'failed']);
        expect(task.status).toBe('completed');

        // Failure is reflected via result.success and exitCode
        const result = task.result as Record<string, unknown>;
        expect(result.success).toBe(false);
        const inner = result.result as Record<string, unknown>;
        expect(inner.exitCode).not.toBe(0);
    });

    test('API: script schedule captures stderr separately from stdout', async ({ serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-sched-api4', 'sched-api4', '/ws/sched-api4');
        const schedule = await seedSchedule(serverUrl, {
            name: 'Stderr Test',
            target: `node -e "process.stderr.write('err-output')"`,
            workspaceId: 'ws-sched-api4',
        });

        // Trigger run
        const runRes = await request(
            `${serverUrl}/api/workspaces/ws-sched-api4/schedules/${schedule.id}/run`,
            { method: 'POST' },
        );
        expect(runRes.status).toBe(200);
        const run = (JSON.parse(runRes.body) as { run: Record<string, unknown> }).run;
        const taskId = (run.processId as string).replace('queue_', '');

        const task = await waitForTaskStatus(serverUrl, taskId, ['completed', 'failed']);
        expect(task.status).toBe('completed');

        const result = task.result as Record<string, unknown>;
        const inner = result.result as Record<string, unknown>;
        expect(inner.stderr).toContain('err-output');
    });

    test('UI: create prompt-type schedule shows Prompt label pill', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-sched-prompt', 'sched-prompt', '/ws/sched-prompt');

        await navigateToSchedules(page, serverUrl);
        await expect(page.locator('[data-testid="user-schedules-dropzone"]')).toBeVisible({ timeout: 10_000 });

        // Open create form. The default form is now PromptScheduleForm — switch
        // to the advanced view so we can drive the existing action-cards flow.
        await page.locator('#repo-detail-content').getByRole('button', { name: '+ New', exact: true }).click();
        await page.click('[data-testid="switch-to-advanced"]');
        await expect(page.locator('[data-testid="schedule-action-cards"]')).toBeVisible({ timeout: 10_000 });

        // Fill name and prompt (default type is prompt, no need to switch)
        await page.fill('[placeholder="Name (e.g., Daily Report)"]', 'My Prompt Schedule');
        // Leave targetType as default (prompt) and fill the prompt textarea
        const promptInput = page.locator('[data-testid="target-input"], textarea[placeholder*="Prompt"]').first();
        if (await promptInput.isVisible()) {
            await promptInput.fill('Analyze the project status');
        }

        // Submit
        await page.getByRole('button', { name: 'Create' }).click();

        // Prompt label pill should appear in the list
        await expect(
            page.locator('.repo-schedule-item:has-text("My Prompt Schedule") [data-testid="type-label-prompt"]'),
        ).toBeVisible({ timeout: 10_000 });
    });
});
