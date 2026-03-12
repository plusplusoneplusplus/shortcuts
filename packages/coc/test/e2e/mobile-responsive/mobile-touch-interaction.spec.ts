/**
 * Mobile Touch Interaction Tests — verify touch targets and mobile-specific UI.
 */
import { test, expect } from '../fixtures/server-fixture';
import { seedQueueTask, seedQueueTasks, seedWorkspace } from '../fixtures/seed';
import { MOBILE } from './viewports';

test.use({ viewport: MOBILE, hasTouch: true });

test.describe('Mobile Touch Interaction', () => {
    test('mobile: all bottom nav buttons meet 44px min touch target', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        const bottomNav = page.locator('[data-testid="bottom-nav"]');
        await expect(bottomNav).toBeVisible({ timeout: 10000 });

        const buttons = bottomNav.locator('button');
        const count = await buttons.count();
        expect(count).toBe(4);

        for (let i = 0; i < count; i++) {
            const box = await buttons.nth(i).boundingBox();
            expect(box!.height).toBeGreaterThanOrEqual(44);
        }
    });

    test('mobile: process list items meet 44px min tap height', async ({ page, serverUrl }) => {
        await seedQueueTasks(serverUrl, [
            { type: 'chat', displayName: 'T1' },
            { type: 'chat', displayName: 'T2' },
            { type: 'chat', displayName: 'T3' },
        ]);
        await page.goto(`${serverUrl}/#processes`);

        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 10000 });

        const items = page.locator('[data-task-id]');
        const count = await items.count();
        for (let i = 0; i < count && i < 3; i++) {
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

    test('mobile: swipe-left on sidebar drawer dismisses it', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await expect(page.locator('[data-testid="bottom-nav"]')).toBeVisible({ timeout: 10000 });

        // Open the sidebar drawer via hamburger
        const hamburger = page.locator('#hamburger-btn');
        await expect(hamburger).toBeVisible();
        await hamburger.tap();

        const drawer = page.locator('[data-testid="sidebar-drawer"]');
        if (await drawer.count() > 0) {
            await expect(drawer).toBeVisible({ timeout: 3000 });

            const box = await drawer.boundingBox();
            if (box) {
                const startX = box.x + box.width * 0.5;
                const startY = box.y + box.height * 0.5;
                // Simulate a 70px leftward swipe (> SWIPE_THRESHOLD=50)
                await page.evaluate(({ sx, sy }) => {
                    const el = document.querySelector('[data-testid="sidebar-drawer"]');
                    if (!el) return;
                    const makeTouch = (x: number, y: number) =>
                        new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
                    el.dispatchEvent(new TouchEvent('touchstart', {
                        touches: [makeTouch(sx, sy)],
                        changedTouches: [makeTouch(sx, sy)],
                        bubbles: true, cancelable: true,
                    }));
                    el.dispatchEvent(new TouchEvent('touchmove', {
                        touches: [makeTouch(sx - 70, sy)],
                        changedTouches: [makeTouch(sx - 70, sy)],
                        bubbles: true, cancelable: true,
                    }));
                    el.dispatchEvent(new TouchEvent('touchend', {
                        touches: [],
                        changedTouches: [makeTouch(sx - 70, sy)],
                        bubbles: true, cancelable: true,
                    }));
                }, { sx: startX, sy: startY });

                // Drawer should be dismissed after swipe-left
                await expect(drawer).toBeHidden({ timeout: 3000 });
            }
        }
    });

    test('mobile: Escape key closes the sidebar drawer', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await expect(page.locator('[data-testid="bottom-nav"]')).toBeVisible({ timeout: 10000 });

        const hamburger = page.locator('#hamburger-btn');
        await expect(hamburger).toBeVisible();
        await hamburger.tap();

        const drawer = page.locator('[data-testid="sidebar-drawer"]');
        if (await drawer.count() > 0) {
            await expect(drawer).toBeVisible({ timeout: 3000 });

            // Press Escape — the MobileDrawer's handleKeyDown on the backdrop handles it
            await page.keyboard.press('Escape');
            await expect(drawer).toBeHidden({ timeout: 3000 });
        }
    });

    test('mobile: back button is visible and tappable', async ({ page, serverUrl }) => {
        await seedQueueTask(serverUrl, { type: 'chat', displayName: 'Touch Back Test' });
        await page.goto(`${serverUrl}/#processes`);

        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 10000 });
        await page.locator('[data-task-id]').first().tap();

        const backBtn = page.locator('[data-testid="activity-chat-back-btn"]');
        await expect(backBtn).toBeVisible({ timeout: 8000 });

        const box = await backBtn.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(28);
        expect(box!.width).toBeGreaterThanOrEqual(28);

        // Verify tapping back button works
        await backBtn.tap();
        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 5000 });
    });
});
