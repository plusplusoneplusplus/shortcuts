/**
 * Schedule Management E2E Tests
 *
 * Tests for schedule edit, delete, and run history UI/API.
 * Complements schedule-script.spec.ts which covers create + Run Now.
 *
 * Design notes:
 * - ScheduleRunRecord has no exitCode/stdout fields — those are in the queue task result only.
 * - A triggered run always finalises as 'completed' unless enqueue() itself throws.
 * - Edit uses PATCH /api/workspaces/:wsId/schedules/:id.
 * - Delete uses DELETE /api/workspaces/:wsId/schedules/:id (non-repo schedules only).
 * - The delete confirmation is a browser confirm() dialog.
 */

import { type Page } from '@playwright/test';
import { test, expect } from './fixtures/server-fixture';
import { seedWorkspace, request } from './fixtures/seed';
import { seedSchedule } from './fixtures/schedule-seed';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Navigate to the Schedules sub-tab of the sole workspace in the sidebar. */
async function navigateToSchedules(page: Page, serverUrl: string): Promise<void> {
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

/** Click a schedule item in the list and wait for the detail panel to appear. */
async function clickScheduleItem(page: Page, name: string): Promise<void> {
    await page.locator(`.repo-schedule-item:has-text("${name}")`).first().click();
    await expect(page.locator('[data-testid="schedule-detail"]')).toBeVisible({ timeout: 8_000 });
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

test.describe('Schedule Management - Edit, Delete & Run History', () => {

    // =========================================================================
    // API: Edit (PATCH)
    // =========================================================================

    test('API: PATCH /schedules/:id updates cron expression', async ({ serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-mgmt-patch1', 'mgmt-patch1', '/ws/mgmt-patch1');
        const schedule = await seedSchedule(serverUrl, {
            name: 'Patch Test',
            target: `node -e "process.stdout.write('ok')"`,
            cron: '0 * * * *',
            workspaceId: 'ws-mgmt-patch1',
        });

        const patchRes = await request(
            `${serverUrl}/api/workspaces/ws-mgmt-patch1/schedules/${schedule.id}`,
            { method: 'PATCH', body: JSON.stringify({ cron: '0 9 * * 1' }) },
        );
        expect(patchRes.status).toBe(200);
        const body = JSON.parse(patchRes.body) as { schedule: Record<string, unknown> };
        expect(body.schedule.cron).toBe('0 9 * * 1');
        expect(body.schedule.id).toBe(schedule.id);
    });

    test('API: PATCH can update schedule name and target independently', async ({ serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-mgmt-patch2', 'mgmt-patch2', '/ws/mgmt-patch2');
        const schedule = await seedSchedule(serverUrl, {
            name: 'Original Name',
            target: `node -e "process.stdout.write('v1')"`,
            workspaceId: 'ws-mgmt-patch2',
        });

        const res = await request(
            `${serverUrl}/api/workspaces/ws-mgmt-patch2/schedules/${schedule.id}`,
            { method: 'PATCH', body: JSON.stringify({ name: 'Updated Name' }) },
        );
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body) as { schedule: Record<string, unknown> };
        expect(body.schedule.name).toBe('Updated Name');
        // cron should remain unchanged
        expect(body.schedule.cron).toBe(schedule.cron);
    });

    test('API: PATCH with invalid cron expression returns 400', async ({ serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-mgmt-patch3', 'mgmt-patch3', '/ws/mgmt-patch3');
        const schedule = await seedSchedule(serverUrl, {
            name: 'Invalid Cron Test',
            target: `node -e "process.stdout.write('ok')"`,
            workspaceId: 'ws-mgmt-patch3',
        });

        const res = await request(
            `${serverUrl}/api/workspaces/ws-mgmt-patch3/schedules/${schedule.id}`,
            { method: 'PATCH', body: JSON.stringify({ cron: 'not-a-valid-cron' }) },
        );
        expect(res.status).toBe(400);
        const body = JSON.parse(res.body) as { error: string };
        expect(body.error).toMatch(/[Ii]nvalid cron/);
    });

    test('API: PATCH with cron having too many fields returns 400', async ({ serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-mgmt-patch4', 'mgmt-patch4', '/ws/mgmt-patch4');
        const schedule = await seedSchedule(serverUrl, {
            name: 'Bad Cron Fields Test',
            target: `node -e "process.stdout.write('ok')"`,
            workspaceId: 'ws-mgmt-patch4',
        });

        const res = await request(
            `${serverUrl}/api/workspaces/ws-mgmt-patch4/schedules/${schedule.id}`,
            { method: 'PATCH', body: JSON.stringify({ cron: '* * * * * *' }) },
        );
        expect(res.status).toBe(400);
    });

    // =========================================================================
    // API: Delete (DELETE)
    // =========================================================================

    test('API: DELETE /schedules/:id removes the schedule', async ({ serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-mgmt-del1', 'mgmt-del1', '/ws/mgmt-del1');
        const schedule = await seedSchedule(serverUrl, {
            name: 'Delete Test',
            target: `node -e "process.stdout.write('bye')"`,
            workspaceId: 'ws-mgmt-del1',
        });

        const delRes = await request(
            `${serverUrl}/api/workspaces/ws-mgmt-del1/schedules/${schedule.id}`,
            { method: 'DELETE' },
        );
        expect(delRes.status).toBe(200);
        const body = JSON.parse(delRes.body) as { deleted: boolean };
        expect(body.deleted).toBe(true);

        // Verify schedule no longer exists in the list
        const listRes = await request(`${serverUrl}/api/workspaces/ws-mgmt-del1/schedules`);
        const list = JSON.parse(listRes.body) as { schedules: unknown[] };
        expect(list.schedules).toHaveLength(0);
    });

    test('API: DELETE non-existent schedule returns 404', async ({ serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-mgmt-del2', 'mgmt-del2', '/ws/mgmt-del2');

        const res = await request(
            `${serverUrl}/api/workspaces/ws-mgmt-del2/schedules/nonexistent-id-xyz`,
            { method: 'DELETE' },
        );
        expect(res.status).toBe(404);
    });

    test('API: DELETE only target schedule; other schedules remain', async ({ serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-mgmt-del3', 'mgmt-del3', '/ws/mgmt-del3');
        const s1 = await seedSchedule(serverUrl, {
            name: 'Keep Me',
            target: `node -e "process.stdout.write('keep')"`,
            workspaceId: 'ws-mgmt-del3',
        });
        const s2 = await seedSchedule(serverUrl, {
            name: 'Delete Me',
            target: `node -e "process.stdout.write('del')"`,
            workspaceId: 'ws-mgmt-del3',
        });

        await request(
            `${serverUrl}/api/workspaces/ws-mgmt-del3/schedules/${s2.id}`,
            { method: 'DELETE' },
        );

        const listRes = await request(`${serverUrl}/api/workspaces/ws-mgmt-del3/schedules`);
        const list = JSON.parse(listRes.body) as { schedules: Array<{ id: unknown }> };
        expect(list.schedules).toHaveLength(1);
        expect(list.schedules[0].id).toBe(s1.id);
    });

    // =========================================================================
    // API: Run History
    // =========================================================================

    test('API: history endpoint returns completed run after manual trigger', async ({ serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-mgmt-hist1', 'mgmt-hist1', '/ws/mgmt-hist1');
        const schedule = await seedSchedule(serverUrl, {
            name: 'History API Test',
            target: `node -e "process.stdout.write('hist')"`,
            workspaceId: 'ws-mgmt-hist1',
        });

        const runRes = await request(
            `${serverUrl}/api/workspaces/ws-mgmt-hist1/schedules/${schedule.id}/run`,
            { method: 'POST' },
        );
        expect(runRes.status).toBe(200);
        const run = JSON.parse(runRes.body) as { run: Record<string, unknown> };
        expect(run.run.processId).toMatch(/^queue_/);

        const histRes = await request(
            `${serverUrl}/api/workspaces/ws-mgmt-hist1/schedules/${schedule.id}/history`,
        );
        expect(histRes.status).toBe(200);
        const hist = JSON.parse(histRes.body) as { history: Record<string, unknown>[] };
        expect(hist.history).toHaveLength(1);
        expect(hist.history[0].status).toBe('completed');
        expect(hist.history[0].scheduleId).toBe(schedule.id);
        expect(typeof hist.history[0].startedAt).toBe('string');
        expect(typeof hist.history[0].durationMs).toBe('number');
    });

    test('API: history entry contains processId for activity panel linkage', async ({ serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-mgmt-hist2', 'mgmt-hist2', '/ws/mgmt-hist2');
        const schedule = await seedSchedule(serverUrl, {
            name: 'PID Link Test',
            target: `node -e "process.stdout.write('pid')"`,
            workspaceId: 'ws-mgmt-hist2',
        });

        await request(
            `${serverUrl}/api/workspaces/ws-mgmt-hist2/schedules/${schedule.id}/run`,
            { method: 'POST' },
        );

        const histRes = await request(
            `${serverUrl}/api/workspaces/ws-mgmt-hist2/schedules/${schedule.id}/history`,
        );
        const hist = JSON.parse(histRes.body) as { history: Record<string, unknown>[] };
        expect(hist.history[0].processId).toMatch(/^queue_/);
        expect(typeof hist.history[0].taskId).toBe('string');
    });

    test('API: multiple runs accumulate in history newest-first', async ({ serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-mgmt-hist3', 'mgmt-hist3', '/ws/mgmt-hist3');
        const schedule = await seedSchedule(serverUrl, {
            name: 'Multi-Run Test',
            target: `node -e "process.stdout.write('run')"`,
            workspaceId: 'ws-mgmt-hist3',
        });

        // Trigger 3 runs
        for (let i = 0; i < 3; i++) {
            await request(
                `${serverUrl}/api/workspaces/ws-mgmt-hist3/schedules/${schedule.id}/run`,
                { method: 'POST' },
            );
        }

        const histRes = await request(
            `${serverUrl}/api/workspaces/ws-mgmt-hist3/schedules/${schedule.id}/history`,
        );
        const hist = JSON.parse(histRes.body) as { history: Record<string, unknown>[] };
        expect(hist.history).toHaveLength(3);
        // Each entry should have a valid startedAt
        for (const r of hist.history) {
            expect(r.status).toBe('completed');
            expect(typeof r.startedAt).toBe('string');
        }
        // Newest-first: first entry has the latest startedAt
        const timestamps = hist.history.map(r => r.startedAt as string);
        const sorted = [...timestamps].sort((a, b) => b.localeCompare(a));
        expect(timestamps).toEqual(sorted);
    });

    // =========================================================================
    // UI: Edit
    // =========================================================================

    test('UI: edit schedule cron expression via Edit button and Save', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-mgmt-ui-edit1', 'mgmt-ui-edit1', '/ws/mgmt-ui-edit1');
        await seedSchedule(serverUrl, {
            name: 'Edit Cron UI Test',
            target: `node -e "process.stdout.write('edit')"`,
            // Use a non-interval cron so the form opens in cron mode
            cron: '5 4 * * *',
            workspaceId: 'ws-mgmt-ui-edit1',
        });

        await navigateToSchedules(page, serverUrl);
        await clickScheduleItem(page, 'Edit Cron UI Test');

        // Click the Edit button in the detail toolbar
        await page.locator('[data-testid="edit-btn"]').click();
        await expect(page.getByText('Edit Schedule')).toBeVisible({ timeout: 5_000 });

        // Ensure cron mode is active (click the Cron toggle button)
        await page.getByRole('button', { name: 'Cron', exact: true }).click();
        await expect(page.locator('[data-testid="cron-hint-panel"]')).toBeVisible({ timeout: 3_000 });

        // Update the cron expression
        const cronInput = page.locator('[data-testid="cron-hint-panel"] input');
        await cronInput.clear();
        await cronInput.fill('0 9 * * 1');

        // Click Save
        await page.getByRole('button', { name: 'Save', exact: true }).click();

        // Edit form should close and detail view return
        await expect(page.getByText('Edit Schedule')).not.toBeVisible({ timeout: 8_000 });
        await expect(page.locator('[data-testid="schedule-detail"]')).toBeVisible();

        // Updated cron is displayed in the schedule info section
        await expect(page.locator('[data-testid="schedule-info"]')).toContainText('0 9 * * 1', { timeout: 8_000 });
    });

    test('UI: cancel edit returns to detail view without changes', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-mgmt-ui-edit2', 'mgmt-ui-edit2', '/ws/mgmt-ui-edit2');
        await seedSchedule(serverUrl, {
            name: 'Cancel Edit Test',
            target: `node -e "process.stdout.write('cancel')"`,
            cron: '5 4 * * *',
            workspaceId: 'ws-mgmt-ui-edit2',
        });

        await navigateToSchedules(page, serverUrl);
        await clickScheduleItem(page, 'Cancel Edit Test');

        await page.locator('[data-testid="edit-btn"]').click();
        await expect(page.getByText('Edit Schedule')).toBeVisible({ timeout: 5_000 });

        // Click Cancel instead of Save
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();

        // Detail view should return with the original cron intact
        await expect(page.getByText('Edit Schedule')).not.toBeVisible({ timeout: 5_000 });
        await expect(page.locator('[data-testid="schedule-detail"]')).toBeVisible();
        await expect(page.locator('[data-testid="schedule-info"]')).toContainText('5 4 * * *');
    });

    // =========================================================================
    // UI: Delete
    // =========================================================================

    test('UI: delete schedule via confirm dialog removes it from list', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-mgmt-ui-del1', 'mgmt-ui-del1', '/ws/mgmt-ui-del1');
        await seedSchedule(serverUrl, {
            name: 'Delete UI Test',
            target: `node -e "process.stdout.write('del')"`,
            workspaceId: 'ws-mgmt-ui-del1',
        });

        await navigateToSchedules(page, serverUrl);
        await clickScheduleItem(page, 'Delete UI Test');

        // Accept the browser confirm() dialog before clicking delete
        page.on('dialog', dialog => dialog.accept());

        await page.locator('[aria-label="Delete schedule"]').click();

        // Schedule item should disappear from the list
        await expect(
            page.locator('.repo-schedule-item:has-text("Delete UI Test")'),
        ).toHaveCount(0, { timeout: 8_000 });

        // Empty-state element visible in the user-schedules section
        await expect(
            page.locator('[data-testid="user-schedules-dropzone"]'),
        ).toBeVisible({ timeout: 5_000 });
    });

    test('UI: cancelling the delete confirm dialog leaves schedule intact', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-mgmt-ui-del2', 'mgmt-ui-del2', '/ws/mgmt-ui-del2');
        await seedSchedule(serverUrl, {
            name: 'Dismiss Delete Test',
            target: `node -e "process.stdout.write('stay')"`,
            workspaceId: 'ws-mgmt-ui-del2',
        });

        await navigateToSchedules(page, serverUrl);
        await clickScheduleItem(page, 'Dismiss Delete Test');

        // Dismiss the dialog (cancel)
        page.on('dialog', dialog => dialog.dismiss());

        await page.locator('[aria-label="Delete schedule"]').click();

        // Schedule should still be in the list
        await expect(
            page.locator('.repo-schedule-item:has-text("Dismiss Delete Test")'),
        ).toHaveCount(1, { timeout: 5_000 });
    });

    // =========================================================================
    // UI: Run history
    // =========================================================================

    test('UI: run history shows completed status after Run Now', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-mgmt-ui-hist1', 'mgmt-ui-hist1', '/ws/mgmt-ui-hist1');
        await seedSchedule(serverUrl, {
            name: 'History UI Test',
            target: `node -e "process.stdout.write('history')"`,
            workspaceId: 'ws-mgmt-ui-hist1',
        });

        await navigateToSchedules(page, serverUrl);
        await clickScheduleItem(page, 'History UI Test');

        // Initially no runs
        await expect(
            page.locator('[data-testid="no-runs-empty"]'),
        ).toBeVisible({ timeout: 5_000 });

        // Trigger via Run Now button
        await page.getByRole('button', { name: 'Run schedule now' }).click();

        // History panel shows a completed entry
        await expect(page.getByText('Run History')).toBeVisible({ timeout: 10_000 });
        await expect(
            page.locator('[aria-label="Run status: completed"]'),
        ).toBeVisible({ timeout: 10_000 });

        // Refresh button is always accessible
        await expect(
            page.locator('[data-testid="refresh-history-btn"]'),
        ).toBeVisible();
    });

    test('UI: refresh history button re-fetches runs triggered via API', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-mgmt-ui-hist2', 'mgmt-ui-hist2', '/ws/mgmt-ui-hist2');
        const schedule = await seedSchedule(serverUrl, {
            name: 'Refresh History Test',
            target: `node -e "process.stdout.write('refresh')"`,
            workspaceId: 'ws-mgmt-ui-hist2',
        });

        await navigateToSchedules(page, serverUrl);
        await clickScheduleItem(page, 'Refresh History Test');

        // Wait for initial empty state to confirm page is loaded
        await expect(
            page.locator('[data-testid="no-runs-empty"]'),
        ).toBeVisible({ timeout: 5_000 });

        // Trigger run via API (not through the UI)
        await request(
            `${serverUrl}/api/workspaces/ws-mgmt-ui-hist2/schedules/${schedule.id}/run`,
            { method: 'POST' },
        );

        // Click the refresh button to reload history
        await page.locator('[data-testid="refresh-history-btn"]').click();

        // History entry should now appear
        await expect(
            page.locator('[aria-label="Run status: completed"]'),
        ).toBeVisible({ timeout: 8_000 });
    });

    test('UI: load-more-history button appears and loads remaining runs when >20 exist', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-mgmt-ui-pag', 'mgmt-ui-pag', '/ws/mgmt-ui-pag');
        const schedule = await seedSchedule(serverUrl, {
            name: 'Pagination Test',
            target: `node -e "process.stdout.write('page')"`,
            workspaceId: 'ws-mgmt-ui-pag',
        });

        // Trigger 21 runs to exceed HISTORY_PAGE_SIZE (20)
        for (let i = 0; i < 21; i++) {
            await request(
                `${serverUrl}/api/workspaces/ws-mgmt-ui-pag/schedules/${schedule.id}/run`,
                { method: 'POST' },
            );
        }

        // Wait for all 21 runs to be persisted before navigating
        let historyCount = 0;
        let attempts = 0;
        while (historyCount < 21 && attempts < 50) {
            const histRes = await request(
                `${serverUrl}/api/workspaces/ws-mgmt-ui-pag/schedules/${schedule.id}/history`,
            );
            const histData = JSON.parse(histRes.body) as { history: unknown[] };
            historyCount = histData.history?.length ?? 0;
            if (historyCount < 21) {
                await new Promise(r => setTimeout(r, 100));
            }
            attempts++;
        }

        await navigateToSchedules(page, serverUrl);
        await clickScheduleItem(page, 'Pagination Test');

        // Load-more button should appear with count of remaining runs
        const loadMoreBtn = page.locator('[data-testid="load-more-history"]');
        await expect(loadMoreBtn).toBeVisible({ timeout: 10_000 });
        await expect(loadMoreBtn).toContainText('1 remaining');

        // Click load more — all 21 runs shown, button disappears
        await loadMoreBtn.click();
        await expect(loadMoreBtn).not.toBeVisible({ timeout: 5_000 });

        // All 21 status badges visible
        await expect(
            page.locator('[aria-label="Run status: completed"]'),
        ).toHaveCount(21, { timeout: 5_000 });
    });
});
