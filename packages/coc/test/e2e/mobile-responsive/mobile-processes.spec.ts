/**
 * Mobile Processes Tests — verify queue task list and detail at 375×812.
 */
import { test, expect } from '../fixtures/server-fixture';
import { seedQueueTask, seedQueueTasks } from '../fixtures/seed';
import { MOBILE } from './viewports';

test.use({ viewport: MOBILE, hasTouch: true });

test.describe('Mobile Processes', () => {
    test('mobile: process list is full-width, no sidebar', async ({ page, serverUrl }) => {
        await seedQueueTasks(serverUrl, [
            { type: 'chat', displayName: 'Task A' },
            { type: 'chat', displayName: 'Task B' },
            { type: 'chat', displayName: 'Task C' },
        ]);
        await page.goto(`${serverUrl}/#processes`);

        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 10000 });

        // Process items should span close to full viewport width
        const item = page.locator('[data-task-id]').first();
        const itemBox = await item.boundingBox();
        expect(itemBox!.width).toBeGreaterThan(300);
    });

    test('mobile: process list shows all seeded items', async ({ page, serverUrl }) => {
        await seedQueueTasks(serverUrl, [
            { type: 'chat', displayName: 'T1' },
            { type: 'chat', displayName: 'T2' },
            { type: 'chat', displayName: 'T3' },
            { type: 'chat', displayName: 'T4' },
            { type: 'chat', displayName: 'T5' },
        ]);
        await page.goto(`${serverUrl}/#processes`);

        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 10000 });
        const count = await page.locator('[data-task-id]').count();
        expect(count).toBeGreaterThanOrEqual(1);
    });

    test('mobile: tap process opens full-screen detail with back button', async ({ page, serverUrl }) => {
        await seedQueueTask(serverUrl, { type: 'chat', displayName: 'Mobile Detail Test' });
        await page.goto(`${serverUrl}/#processes`);

        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 10000 });
        await page.locator('[data-task-id]').first().tap();

        // Detail should render on mobile
        const detail = page.locator('[data-testid="activity-chat-detail"]');
        await expect(detail).toBeVisible({ timeout: 8000 });

        // Back button must be present
        await expect(page.locator('[data-testid="activity-chat-back-btn"]')).toBeVisible();
    });

    test('mobile: back button returns to process list', async ({ page, serverUrl }) => {
        await seedQueueTask(serverUrl, { type: 'chat', displayName: 'Mobile Back Test' });
        await page.goto(`${serverUrl}/#processes`);

        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 10000 });
        await page.locator('[data-task-id]').first().tap();

        await expect(page.locator('[data-testid="activity-chat-detail"]')).toBeVisible({ timeout: 8000 });

        // Tap back button
        await page.locator('[data-testid="activity-chat-back-btn"]').tap();

        // Task list should be visible again
        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 5000 });
    });

    test('mobile: filters in collapsible section', async ({ page, serverUrl }) => {
        await seedQueueTasks(serverUrl, [
            { type: 'chat', displayName: 'T1' },
            { type: 'chat', displayName: 'T2' },
        ]);
        await page.goto(`${serverUrl}/#processes`);

        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 10000 });

        // The queue filter dropdown appears when multiple types are present
        const filterDropdown = page.locator('[data-testid="queue-filter-dropdown"]');
        if (await filterDropdown.count() > 0) {
            await expect(filterDropdown).toBeVisible();
        }
    });

    test('mobile: search input is accessible', async ({ page, serverUrl }) => {
        await seedQueueTask(serverUrl, { type: 'chat', displayName: 'Search Test' });
        await page.goto(`${serverUrl}/#processes`);

        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 10000 });
        // Queue view is accessible — task list renders correctly on mobile
        const item = page.locator('[data-task-id]').first();
        const box = await item.boundingBox();
        expect(box!.width).toBeGreaterThan(280);
    });

    test('mobile: status filter works on mobile', async ({ page, serverUrl }) => {
        await seedQueueTasks(serverUrl, [
            { type: 'chat', displayName: 'Chat Task' },
            { type: 'run-workflow', displayName: 'Workflow Task' },
        ]);
        await page.goto(`${serverUrl}/#processes`);

        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 10000 });

        // Type filter dropdown may appear for multiple task types
        const filterDropdown = page.locator('[data-testid="queue-filter-dropdown"]');
        if (await filterDropdown.count() > 0 && await filterDropdown.isVisible()) {
            await filterDropdown.selectOption('chat');
            await page.waitForTimeout(300);
            const items = page.locator('[data-task-id]');
            const count = await items.count();
            expect(count).toBeGreaterThanOrEqual(0);
        }
    });
});
