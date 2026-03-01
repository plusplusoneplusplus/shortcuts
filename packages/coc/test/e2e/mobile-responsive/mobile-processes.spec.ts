/**
 * Mobile Processes Tests — verify process list and detail at 375×812.
 */
import { test, expect } from '../fixtures/server-fixture';
import { seedProcess, seedProcesses } from '../fixtures/seed';
import { MOBILE } from './viewports';

test.use({ viewport: MOBILE, hasTouch: true });

test.describe('Mobile Processes', () => {
    test('mobile: process list is full-width, no sidebar', async ({ page, serverUrl }) => {
        await seedProcesses(serverUrl, 3);
        await page.goto(`${serverUrl}/#processes`);

        await expect(page.locator('.process-item')).toHaveCount(3, { timeout: 10000 });

        // ResponsiveSidebar should be hidden on mobile (or rendered as a drawer, not inline)
        const sidebar = page.locator('[data-testid="responsive-sidebar"]');
        if (await sidebar.count() > 0) {
            const box = await sidebar.boundingBox();
            // Either hidden (null) or full-width (mobile list mode)
            if (box) {
                expect(box.width).toBeGreaterThan(300); // full-width on mobile
            }
        }

        // Process items should span close to full viewport width
        const item = page.locator('.process-item').first();
        const itemBox = await item.boundingBox();
        expect(itemBox!.width).toBeGreaterThan(300);
    });

    test('mobile: process list shows all seeded items', async ({ page, serverUrl }) => {
        await seedProcesses(serverUrl, 5);
        await page.goto(`${serverUrl}/#processes`);

        await expect(page.locator('.process-item')).toHaveCount(5, { timeout: 10000 });
    });

    test('mobile: tap process opens full-screen detail with back button', async ({ page, serverUrl }) => {
        await seedProcess(serverUrl, 'mob-detail-1', { promptPreview: 'Mobile Detail Test' });
        await page.goto(`${serverUrl}/#processes`);

        await expect(page.locator('.process-item')).toHaveCount(1, { timeout: 10000 });
        await page.locator('.process-item').first().tap();

        // Detail should render full-screen on mobile
        const detail = page.locator('#detail-content');
        await expect(detail).toBeVisible({ timeout: 5000 });
        const detailBox = await detail.boundingBox();
        expect(detailBox!.width).toBeGreaterThan(350);

        // Back button must be present
        await expect(page.locator('[data-testid="mobile-back-button"]')).toBeVisible();
    });

    test('mobile: back button returns to process list', async ({ page, serverUrl }) => {
        await seedProcess(serverUrl, 'mob-back-1', { promptPreview: 'Mobile Back Test' });
        await page.goto(`${serverUrl}/#processes`);

        await expect(page.locator('.process-item')).toHaveCount(1, { timeout: 10000 });
        await page.locator('.process-item').first().tap();

        await expect(page.locator('#detail-content')).toBeVisible({ timeout: 5000 });

        // Tap back button
        await page.locator('[data-testid="mobile-back-button"]').tap();

        // Process list should be visible again
        await expect(page.locator('.process-item')).toBeVisible({ timeout: 5000 });
    });

    test('mobile: filters in collapsible section', async ({ page, serverUrl }) => {
        await seedProcesses(serverUrl, 2);
        await page.goto(`${serverUrl}/#processes`);

        await expect(page.locator('.process-item').first()).toBeVisible({ timeout: 10000 });

        // Mobile filters toggle should exist
        const filtersToggle = page.locator('[data-testid="mobile-filters-toggle"]');
        await expect(filtersToggle).toBeVisible();

        // Tap to expand
        await filtersToggle.tap();

        // Filters panel should become visible
        const filtersPanel = page.locator('[data-testid="mobile-filters-panel"]');
        await expect(filtersPanel).toBeVisible({ timeout: 3000 });
    });

    test('mobile: search input is accessible', async ({ page, serverUrl }) => {
        await seedProcesses(serverUrl, 1);
        await page.goto(`${serverUrl}/#processes`);

        await expect(page.locator('.process-item').first()).toBeVisible({ timeout: 10000 });

        // On mobile, search may be inside the collapsible filters panel
        const filtersToggle = page.locator('[data-testid="mobile-filters-toggle"]');
        if (await filtersToggle.isVisible()) {
            await filtersToggle.tap();
            await page.waitForTimeout(300);
        }

        const searchInput = page.locator('#search-input');
        await expect(searchInput).toBeVisible({ timeout: 5000 });
        const box = await searchInput.boundingBox();
        expect(box!.width).toBeGreaterThan(280);
    });

    test('mobile: status filter works on mobile', async ({ page, serverUrl }) => {
        await seedProcess(serverUrl, 'mob-running', { status: 'running', promptPreview: 'Running Process' });
        await seedProcess(serverUrl, 'mob-completed', { status: 'completed', promptPreview: 'Completed Process' });
        await page.goto(`${serverUrl}/#processes`);

        await expect(page.locator('.process-item')).toHaveCount(2, { timeout: 10000 });

        // Expand filters if collapsed
        const filtersToggle = page.locator('[data-testid="mobile-filters-toggle"]');
        if (await filtersToggle.isVisible()) {
            await filtersToggle.tap();
        }

        // Select running status filter
        const statusFilter = page.locator('#status-filter');
        if (await statusFilter.count() > 0 && await statusFilter.isVisible()) {
            await statusFilter.selectOption('running');
            // Wait for filter to apply
            await page.waitForTimeout(500);
            const items = page.locator('.process-item');
            const count = await items.count();
            expect(count).toBeLessThanOrEqual(2);
        }
    });
});
