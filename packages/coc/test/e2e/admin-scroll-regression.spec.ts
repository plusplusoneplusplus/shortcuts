/**
 * Admin page scroll regression E2E test.
 *
 * Regression: after ProviderTokensSection was added to AdminPanel (commit
 * 1c4b9b1e), the admin page became unscrollable because the page renders
 * AdminPanel inline inside <main class="overflow-hidden">, but AdminPanel
 * had no scroll container of its own.
 *
 * Fix: Router.tsx wraps AdminPanel in <div class="h-full overflow-y-auto">
 * so the admin page can scroll within the bounded main area.
 */

import { test, expect } from './fixtures/server-fixture';
import { VIEWPORTS } from './helpers/viewports';

/** Navigate to the admin page via the gear icon and wait for it to be visible. */
async function navigateToAdmin(page: import('@playwright/test').Page, serverUrl: string): Promise<void> {
    await page.goto(serverUrl);
    await page.click('#admin-toggle');
    await expect(page.locator('#view-admin')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#admin-page-content')).not.toBeEmpty({ timeout: 5000 });
}

test.describe('Admin page scrollability regression', () => {
    test.use({ viewport: VIEWPORTS.desktop });

    test('admin scroll container has overflow-y:auto and scrollable content', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);

        const scrollContainer = page.locator('[data-testid="admin-scroll-container"]');
        await expect(scrollContainer).toBeVisible();

        const metrics = await scrollContainer.evaluate((el) => {
            const style = getComputedStyle(el);
            return {
                overflowY: style.overflowY,
                scrollHeight: el.scrollHeight,
                clientHeight: el.clientHeight,
            };
        });

        // Must be scrollable
        expect(['auto', 'scroll']).toContain(metrics.overflowY);
        // Admin panel has enough content to require scrolling
        expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    });

    test('admin scroll container is bounded by viewport height (not taller)', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);

        const scrollContainer = page.locator('[data-testid="admin-scroll-container"]');
        const box = await scrollContainer.boundingBox();
        expect(box).not.toBeNull();

        const viewportHeight = page.viewportSize()?.height ?? 800;
        // The scroll container should fill the viewport area (not exceed it)
        expect(box!.height).toBeLessThanOrEqual(viewportHeight);

        // But content should exceed the visible area (otherwise there's nothing to scroll)
        const scrollHeight = await scrollContainer.evaluate((el) => el.scrollHeight);
        expect(scrollHeight).toBeGreaterThan(box!.height);
    });

    test('admin page scrolls with mouse wheel', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);

        const scrollContainer = page.locator('[data-testid="admin-scroll-container"]');
        await expect(scrollContainer).toBeVisible();

        const before = await scrollContainer.evaluate((el) => (el as HTMLElement).scrollTop);
        const box = await scrollContainer.boundingBox();
        expect(box).not.toBeNull();

        await page.mouse.move(box!.x + box!.width / 2, box!.y + Math.min(200, box!.height / 2));
        await page.mouse.wheel(0, 1200);
        await page.waitForTimeout(200);

        const after = await scrollContainer.evaluate((el) => (el as HTMLElement).scrollTop);
        expect(after).toBeGreaterThan(before);
    });

    test('admin page bottom content (Danger Zone) is reachable by scroll', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);

        // Scroll to the bottom
        await page.locator('#view-admin').evaluate((el) => {
            (el.parentElement!).scrollTop = el.parentElement!.scrollHeight;
        });
        await page.waitForTimeout(100);

        // "Danger Zone" card should be in the DOM and reachable
        const dangerZone = page.getByText('Danger Zone');
        await expect(dangerZone).toBeVisible({ timeout: 3000 });
    });
});

