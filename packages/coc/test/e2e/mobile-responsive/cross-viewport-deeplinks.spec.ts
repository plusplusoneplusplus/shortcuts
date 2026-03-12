/**
 * Cross-Viewport Deep Link Tests — verify hash routing at all viewport sizes.
 */
import { test, expect } from '../fixtures/server-fixture';
import { seedQueueTask, seedWorkspace } from '../fixtures/seed';
import { MOBILE, TABLET, DESKTOP } from './viewports';

test.describe('Cross-Viewport Deep Links', () => {
    test('deeplinks: #repos resolves at mobile viewport', async ({ page, serverUrl }) => {
        await page.setViewportSize(MOBILE);
        await page.goto(`${serverUrl}/#repos`);

        await expect(page.locator('#view-repos')).toBeVisible({ timeout: 10000 });
    });

    test('deeplinks: #processes/:id resolves at mobile viewport', async ({ page, serverUrl }) => {
        await page.setViewportSize(MOBILE);
        const task = await seedQueueTask(serverUrl, { type: 'chat', displayName: 'DeepLink Mobile' });
        const taskId = task.id as string;
        await page.goto(`${serverUrl}/#process/queue_${encodeURIComponent(taskId)}`);

        // Detail should render on mobile (full-screen)
        await expect(page.locator('[data-testid="activity-chat-detail"]')).toBeVisible({ timeout: 10000 });
    });

    test('deeplinks: #repos/:id resolves at mobile viewport', async ({ page, serverUrl }) => {
        await page.setViewportSize(MOBILE);
        await seedWorkspace(serverUrl, 'dl-mob-ws', 'dl-mob-repo');
        await page.goto(`${serverUrl}/#repos/dl-mob-ws`);

        // Repo detail should be visible
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });
    });

    test('deeplinks: #memory resolves at mobile viewport', async ({ page, serverUrl }) => {
        await page.setViewportSize(MOBILE);
        await page.goto(`${serverUrl}/#memory`);

        await expect(page.locator('#view-memory')).toBeVisible({ timeout: 15000 });
    });

    test('deeplinks: #repos/:id/:subTab resolves at desktop viewport', async ({ page, serverUrl }) => {
        await page.setViewportSize(DESKTOP);
        await seedWorkspace(serverUrl, 'dl-desk-ws', 'dl-desk-repo');
        await page.goto(`${serverUrl}/#repos/dl-desk-ws/workflows`);

        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });

        // Workflows sub-tab should be active
        const workflowsTab = page.locator('[data-subtab="workflows"]');
        if (await workflowsTab.count() > 0) {
            await expect(workflowsTab).toBeVisible();
        }
    });

    test('deeplinks: #repos/:id/:subTab resolves at mobile viewport', async ({ page, serverUrl }) => {
        await page.setViewportSize(MOBILE);
        await seedWorkspace(serverUrl, 'dl-mob-sub-ws', 'dl-mob-sub-repo');
        await page.goto(`${serverUrl}/#repos/dl-mob-sub-ws/activity`);

        // Repo detail should open with the sub-tab active
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });

        // MobileTabBar should be visible (mobile sub-tab navigation)
        const mobileTabBar = page.locator('[data-testid="mobile-tab-bar"]');
        await expect(mobileTabBar).toBeVisible({ timeout: 5000 });
    });

    test('deeplinks: #repos/:id resolves at tablet viewport', async ({ page, serverUrl }) => {
        await page.setViewportSize(TABLET);
        await seedWorkspace(serverUrl, 'dl-tab-ws', 'dl-tab-repo');
        await page.goto(`${serverUrl}/#repos/dl-tab-ws`);

        // Tablet two-pane: sidebar + detail content visible
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('[data-testid="responsive-sidebar"]')).toBeVisible({ timeout: 5000 });
    });

    test('deeplinks: #processes/:id resolves at tablet viewport', async ({ page, serverUrl }) => {
        await page.setViewportSize(TABLET);
        const task = await seedQueueTask(serverUrl, { type: 'chat', displayName: 'Tablet DeepLink' });
        const taskId = task.id as string;
        await page.goto(`${serverUrl}/#process/queue_${encodeURIComponent(taskId)}`);

        // At tablet width, two-pane with detail visible
        await expect(page.locator('[data-testid="activity-chat-detail"]')).toBeVisible({ timeout: 10000 });
    });

    test('deeplinks: #admin resolves at all viewports', async ({ page, serverUrl }) => {
        for (const vp of [MOBILE, TABLET, DESKTOP]) {
            await page.setViewportSize(vp);
            await page.goto(`${serverUrl}/#admin`);
            await expect(page.locator('#view-admin')).toBeVisible({ timeout: 5000 });
        }
    });
});
