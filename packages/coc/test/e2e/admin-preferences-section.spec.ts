/**
 * Admin Preferences Section E2E Tests
 *
 * Tests the PreferencesSection component rendered inside the AdminPanel:
 * - Loads theme and reposSidebarCollapsed from GET /api/preferences
 * - Changing theme triggers PATCH /api/preferences + success toast
 * - API failure shows error state in the preferences card
 */

import { test, expect } from './fixtures/server-fixture';

// ================================================================
// Helpers
// ================================================================

/** Navigate to admin page and wait for content to load. */
async function navigateToAdmin(page: import('@playwright/test').Page, serverUrl: string): Promise<void> {
    await page.goto(serverUrl);
    await page.click('#admin-toggle');
    await expect(page.locator('#view-admin')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#admin-page-content')).not.toBeEmpty({ timeout: 5000 });
}

// ================================================================
// Tests
// ================================================================

test.describe('Admin: Preferences section', () => {

    // ----------------------------------------------------------------
    // TC1: Preferences section loads with server defaults
    // ----------------------------------------------------------------

    test('preferences section renders theme and sidebar controls', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);

        // Theme dropdown should be visible
        await expect(page.locator('[data-testid="pref-theme"]')).toBeVisible({ timeout: 5000 });

        // Sidebar collapsed toggle should be visible
        await expect(page.locator('[data-testid="pref-repos-sidebar-collapsed"]')).toBeVisible({ timeout: 5000 });

        // Theme should show one of the valid values (auto/light/dark)
        const themeVal = await page.locator('[data-testid="pref-theme"]').inputValue();
        expect(['auto', 'light', 'dark']).toContain(themeVal);
    });

    // ----------------------------------------------------------------
    // TC2: Changing theme patches preference
    // ----------------------------------------------------------------

    test('changing theme sends PATCH and shows success toast', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);

        // Wait for preferences to load
        await expect(page.locator('[data-testid="pref-theme"]')).toBeVisible({ timeout: 5000 });

        const patchPromise = page.waitForRequest(req =>
            req.url().includes('/api/preferences') && req.method() === 'PATCH',
        );

        // Change theme to 'dark'
        await page.selectOption('[data-testid="pref-theme"]', 'dark');

        const patchReq = await patchPromise;
        const body = JSON.parse(patchReq.postData() ?? '{}');
        expect(body.theme).toBe('dark');

        // Success toast should appear
        await expect(page.locator('.toast-success')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.toast-success')).toContainText('Preference saved');
    });

    // ----------------------------------------------------------------
    // TC3: Preferences load failure shows error state
    // ----------------------------------------------------------------

    test('preferences load failure shows error state', async ({ page, serverUrl }) => {
        // Abort the preferences request to simulate network failure
        await page.route('**/api/preferences', (route, req) => {
            if (req.method() === 'GET') return route.abort('failed');
            return route.continue();
        });

        await navigateToAdmin(page, serverUrl);

        // Wait for the preferences card area to load (heading is always shown)
        await expect(page.locator('#admin-page-content')).toBeVisible({ timeout: 5000 });

        // The theme dropdown should not be present — form didn't load
        await expect(page.locator('[data-testid="pref-theme"]')).toHaveCount(0, { timeout: 5000 });
    });
});
