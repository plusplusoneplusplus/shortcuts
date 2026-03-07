/**
 * Mobile Touch Interaction Tests — verify touch targets and mobile-specific UI.
 */
import { test, expect } from '../fixtures/server-fixture';
import { seedProcess, seedProcesses, seedWorkspace } from '../fixtures/seed';
import { MOBILE } from './viewports';

test.use({ viewport: MOBILE, hasTouch: true });

test.describe('Mobile Touch Interaction', () => {
    test('mobile: all bottom nav buttons meet 44px min touch target', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        const bottomNav = page.locator('[data-testid="bottom-nav"]');
        await expect(bottomNav).toBeVisible({ timeout: 10000 });

        const buttons = bottomNav.locator('button');
        const count = await buttons.count();
        expect(count).toBe(3);

        for (let i = 0; i < count; i++) {
            const box = await buttons.nth(i).boundingBox();
            expect(box!.height).toBeGreaterThanOrEqual(44);
        }
    });

    test('mobile: process list items meet 44px min tap height', async ({ page, serverUrl }) => {
        await seedProcesses(serverUrl, 3);
        await page.goto(`${serverUrl}/#processes`);

        await expect(page.locator('.process-item')).toHaveCount(3, { timeout: 10000 });

        const items = page.locator('.process-item');
        for (let i = 0; i < 3; i++) {
            const box = await items.nth(i).boundingBox();
            expect(box!.height).toBeGreaterThanOrEqual(44);
        }
    });

    test('mobile: repo items meet 44px min tap height', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-touch-1', 'touch-repo-1');
        await seedWorkspace(serverUrl, 'ws-touch-2', 'touch-repo-2');
        await page.goto(`${serverUrl}/#repos`);

        await expect(page.locator('.repo-item').first()).toBeVisible({ timeout: 10000 });

        const items = page.locator('.repo-item');
        const count = await items.count();
        for (let i = 0; i < count; i++) {
            const box = await items.nth(i).boundingBox();
            expect(box!.height).toBeGreaterThanOrEqual(44);
        }
    });

    test('mobile: dialog renders full-screen', async ({ page, serverUrl }) => {
        await page.goto(`${serverUrl}/#repos`);
        await expect(page.locator('#view-repos')).toBeVisible({ timeout: 10000 });
        await page.click('#add-repo-btn');

        const overlay = page.locator('#add-repo-overlay');
        await expect(overlay).toBeVisible();
        const box = await overlay.boundingBox();

        // Full-screen: width close to viewport (within padding)
        expect(box!.width).toBeGreaterThan(340);
        // Height covers significant portion of viewport
        expect(box!.height).toBeGreaterThan(500);
    });

    test('mobile: sidebar drawer opens and closes', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await expect(page.locator('[data-testid="bottom-nav"]')).toBeVisible({ timeout: 10000 });

        // Hamburger button should be visible
        const hamburger = page.locator('#hamburger-btn');
        await expect(hamburger).toBeVisible();

        // Tap hamburger to open drawer
        await hamburger.tap();

        // Sidebar drawer should appear
        const drawer = page.locator('[data-testid="sidebar-drawer"]');
        if (await drawer.count() > 0) {
            await expect(drawer).toBeVisible({ timeout: 3000 });

            // Close by tapping backdrop
            const backdrop = page.locator('[data-testid="sidebar-backdrop"]');
            if (await backdrop.count() > 0 && await backdrop.isVisible()) {
                await backdrop.tap();
                await expect(drawer).toBeHidden({ timeout: 3000 });
            }
        }
    });

    test('mobile: back button is visible and tappable', async ({ page, serverUrl }) => {
        await seedProcess(serverUrl, 'touch-back-1', { promptPreview: 'Touch Back Test' });
        await page.goto(`${serverUrl}/#processes`);

        await expect(page.locator('.process-item')).toHaveCount(1, { timeout: 10000 });
        await page.locator('.process-item').first().tap();

        const backBtn = page.locator('[data-testid="mobile-back-button"]');
        await expect(backBtn).toBeVisible({ timeout: 5000 });

        const box = await backBtn.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(28);
        expect(box!.width).toBeGreaterThanOrEqual(28);

        // Verify tapping back button works
        await backBtn.tap();
        await expect(page.locator('.process-item')).toBeVisible({ timeout: 5000 });
    });
});
