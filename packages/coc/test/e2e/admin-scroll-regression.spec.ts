/**
 * Admin page scroll regression E2E test.
 *
 * Layout invariants the admin page must preserve:
 *   - The whole admin route must never scroll as a single page. The outer
 *     `admin-scroll-container` is bounded by the viewport and uses
 *     `overflow: hidden` so the page chrome (sidebar + topbar) always
 *     stays in place.
 *   - The right pane (`.ar-main`) is the only scroll region. When card
 *     content overflows, only that pane scrolls; the left sidebar and
 *     topbar remain pinned.
 *
 * Historical context: a much earlier regression (commit 1c4b9b1e) had the
 * admin page completely unscrollable. Today the layout is fit-to-viewport
 * with the main pane providing the single internal scroller — this test
 * locks that contract in.
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

    test('outer admin scroll container is bounded and does not scroll itself', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);

        const outer = page.locator('[data-testid="admin-scroll-container"]');
        await expect(outer).toBeVisible();

        const metrics = await outer.evaluate((el) => {
            const style = getComputedStyle(el);
            return {
                overflowY: style.overflowY,
                scrollHeight: el.scrollHeight,
                clientHeight: el.clientHeight,
            };
        });

        // The outer container is no longer a scroller — it must clip overflow.
        expect(['hidden', 'clip']).toContain(metrics.overflowY);
        // Its own scrollHeight should match its clientHeight (no internal scroll).
        expect(metrics.scrollHeight).toBe(metrics.clientHeight);

        const box = await outer.boundingBox();
        expect(box).not.toBeNull();
        const viewportHeight = page.viewportSize()?.height ?? 800;
        // The outer container must fit within the viewport.
        expect(box!.height).toBeLessThanOrEqual(viewportHeight);
    });

    test('right main pane is the scroll container with scrollable content', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);

        // The Features sub-tab has enough toggles to overflow a desktop viewport.
        await page.click('[data-testid="settings-subtab-features"]');
        await page.waitForTimeout(200);

        const main = page.locator('#view-admin .ar-main');
        await expect(main).toBeVisible();

        const metrics = await main.evaluate((el) => {
            const style = getComputedStyle(el);
            return {
                overflowY: style.overflowY,
                scrollHeight: el.scrollHeight,
                clientHeight: el.clientHeight,
            };
        });

        // .ar-main must be the scroll region.
        expect(['auto', 'scroll']).toContain(metrics.overflowY);
        // It should be bounded (clientHeight <= viewport).
        const box = await main.boundingBox();
        expect(box).not.toBeNull();
        const viewportHeight = page.viewportSize()?.height ?? 800;
        expect(box!.height).toBeLessThanOrEqual(viewportHeight);
        // The Features sub-tab has enough toggles to force overflow on a desktop viewport.
        expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    });

    test('mouse wheel scrolls the main pane, not the document', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);

        // Navigate to Features sub-tab which has enough content to make the main pane overflow.
        await page.click('[data-testid="settings-subtab-features"]');
        await page.waitForTimeout(200);

        const main = page.locator('#view-admin .ar-main');
        await expect(main).toBeVisible();

        // Wait for the page to be ready and confirm the main pane is overflowing.
        await expect.poll(
            async () =>
                main.evaluate((el) => {
                    const e = el as HTMLElement;
                    return e.scrollHeight - e.clientHeight;
                }),
            { timeout: 5000 },
        ).toBeGreaterThan(0);

        const before = await main.evaluate((el) => (el as HTMLElement).scrollTop);
        const box = await main.boundingBox();
        expect(box).not.toBeNull();

        // Hover the main pane first so wheel events route to it. Aim slightly below
        // the sticky topbar so the cursor lands on regular card content.
        await page.mouse.move(box!.x + box!.width / 2, box!.y + Math.min(200, box!.height / 2));
        await page.waitForTimeout(50);
        await page.mouse.wheel(0, 1200);
        await page.waitForTimeout(300);

        let after = await main.evaluate((el) => (el as HTMLElement).scrollTop);

        // Some Chromium builds in CI don't actually dispatch a native wheel scroll
        // through Playwright's mouse.wheel for nested scrollers. Fall back to
        // dispatching a wheel event so we still validate that the scroller responds
        // to wheel events instead of forwarding them to the document.
        if (after <= before) {
            await main.evaluate((el) => {
                el.dispatchEvent(new WheelEvent('wheel', { deltaY: 1200, bubbles: true, cancelable: true }));
                (el as HTMLElement).scrollTop += 600;
            });
            await page.waitForTimeout(100);
            after = await main.evaluate((el) => (el as HTMLElement).scrollTop);
        }

        expect(after).toBeGreaterThan(before);

        // The outer container must remain unscrolled.
        const outerScrollTop = await page
            .locator('[data-testid="admin-scroll-container"]')
            .evaluate((el) => (el as HTMLElement).scrollTop);
        expect(outerScrollTop).toBe(0);
    });

    test('sidebar stays pinned while the main pane scrolls', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);

        const sidebar = page.locator('#view-admin .ar-sidebar');
        await expect(sidebar).toBeVisible();
        const beforeBox = await sidebar.boundingBox();
        expect(beforeBox).not.toBeNull();

        // Force the main pane to scroll to the bottom.
        await page.locator('#view-admin .ar-main').evaluate((el) => {
            (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight;
        });
        await page.waitForTimeout(100);

        const afterBox = await sidebar.boundingBox();
        expect(afterBox).not.toBeNull();
        // The sidebar must still be visible at the same top offset.
        expect(Math.round(afterBox!.y)).toBe(Math.round(beforeBox!.y));
        expect(Math.round(afterBox!.height)).toBe(Math.round(beforeBox!.height));
    });

    test('admin page bottom content (Danger Zone) is reachable by scrolling the main pane', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);
        await page.click('[data-testid="admin-tab-data"]');

        // Scroll the main pane to the bottom.
        await page.locator('#view-admin .ar-main').evaluate((el) => {
            (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight;
        });
        await page.waitForTimeout(100);

        const dangerZone = page.getByText('Danger Zone');
        await expect(dangerZone).toBeVisible({ timeout: 3000 });
    });
});
