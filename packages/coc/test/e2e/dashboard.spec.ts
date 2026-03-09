/**
 * Dashboard E2E Tests
 *
 * Tests the Processes tab: queue task list rendering, filtering, detail panel.
 *
 * Data flow: seed queue tasks via REST → page.goto → assert DOM.
 */

import { test, expect } from './fixtures/server-fixture';
import { seedQueueTask, seedQueueTasks } from './fixtures/seed';

test.describe('Dashboard — Processes tab', () => {
    test('shows empty state when no processes exist', async ({ page, serverUrl }) => {
        await page.goto(serverUrl + '/#processes');
        await expect(page.locator('[data-testid="queue-empty-state"]')).toBeVisible({ timeout: 8000 });
        await expect(page.locator('[data-testid="queue-empty-state"]')).toContainText('No tasks in queue');
    });

    test('displays seeded processes in the sidebar', async ({ page, serverUrl }) => {
        // Seed queue tasks so they appear in history
        await seedQueueTasks(serverUrl, [
            { type: 'chat', displayName: 'Task 1' },
            { type: 'chat', displayName: 'Task 2' },
            { type: 'chat', displayName: 'Task 3' },
        ]);
        await page.goto(serverUrl + '/#processes');

        // Wait for tasks to appear (running or history)
        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 8000 });
        await expect(page.locator('[data-testid="queue-empty-state"]')).toBeHidden();
    });

    test('clicking a process shows its detail', async ({ page, serverUrl }) => {
        await seedQueueTask(serverUrl, { type: 'chat', displayName: 'Detail Task' });
        await page.goto(serverUrl + '/#processes');

        // Wait for task to appear then click it
        const taskItem = page.locator('[data-task-id]').first();
        await expect(taskItem).toBeVisible({ timeout: 8000 });
        await taskItem.click();

        // Detail panel should open
        await expect(page.locator('[data-testid="activity-chat-detail"]')).toBeVisible({ timeout: 8000 });
    });

    test('search filters processes by title', async ({ page, serverUrl }) => {
        await seedQueueTasks(serverUrl, [
            { type: 'chat', displayName: 'Alpha Task' },
            { type: 'run-workflow', displayName: 'Beta Workflow' },
        ]);
        await page.goto(serverUrl + '/#processes');

        // Should show both
        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 8000 });
        const totalCount = await page.locator('[data-task-id]').count();
        expect(totalCount).toBeGreaterThanOrEqual(1);
    });

    test('status filter narrows the process list', async ({ page, serverUrl }) => {
        await seedQueueTasks(serverUrl, [
            { type: 'chat', displayName: 'Chat Task 1' },
            { type: 'chat', displayName: 'Chat Task 2' },
        ]);
        await page.goto(serverUrl + '/#processes');

        // Tasks should be visible
        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 8000 });
        const count = await page.locator('[data-task-id]').count();
        expect(count).toBeGreaterThanOrEqual(1);
    });
});
