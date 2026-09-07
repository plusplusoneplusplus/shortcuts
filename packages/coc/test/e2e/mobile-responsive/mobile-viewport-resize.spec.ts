/**
 * Viewport Resize Tests — verify live breakpoint transitions when the
 * viewport is resized mid-session.
 */
import { test, expect } from '../fixtures/server-fixture';
import { MOBILE, TABLET } from './viewports';

test.describe('Viewport Resize', () => {
    test('resize mobile→tablet: the mobile scope bar disappears, TopBar tabs appear', async ({ page, serverUrl }) => {
        // Start at mobile viewport
        await page.setViewportSize(MOBILE);
        await page.goto(`${serverUrl}/#repos`);

        // The scope bar owns the row under the TopBar at mobile width.
        const bottomNav = page.locator('[data-testid="mobile-scope-bar"]');
        await expect(bottomNav).toBeVisible({ timeout: 10000 });

        // TopBar tab buttons should be hidden at mobile width
        const reposTabBtn = page.locator('[data-tab="repos"]');
        // (desktop tab bar is hidden on mobile)

        // Resize to tablet viewport
        await page.setViewportSize(TABLET);

        // Wait for breakpoint update (matchMedia event fires)
        await page.waitForTimeout(300);

        // The scope bar should disappear (isMobile = false at 768px)
        await expect(bottomNav).toBeHidden({ timeout: 5000 });

        // TopBar tab buttons should now be visible at tablet width
        await expect(reposTabBtn).toBeVisible({ timeout: 5000 });
    });
});
