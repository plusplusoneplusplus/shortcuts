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

/** Switch the Settings tab to one of its sub-tab cards. The Settings tab defaults to `ai`. */
async function gotoSettingsSubTab(
    page: import('@playwright/test').Page,
    sub: 'ai' | 'chat' | 'appearance' | 'features' | 'integrations' | 'advanced',
): Promise<void> {
    const tab = page.locator(`[data-testid="settings-subtab-${sub}"]`);
    await expect(tab).toBeVisible({ timeout: 5000 });
    await tab.click();
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
        await gotoSettingsSubTab(page, 'appearance');

        // Theme dropdown should be visible
        await expect(page.locator('[data-testid="pref-theme"]')).toBeVisible({ timeout: 5000 });

        // Sidebar collapsed toggle is rendered as an sr-only checkbox inside an
        // AdminToggle (opacity:0, width:0, height:0) so toBeVisible() reports it
        // as hidden. Assert it is attached instead.
        await expect(page.locator('[data-testid="pref-repos-sidebar-collapsed"]')).toBeAttached({ timeout: 5000 });

        // Theme should show one of the valid values (auto/light/dark)
        const themeVal = await page.locator('[data-testid="pref-theme"]').inputValue();
        expect(['auto', 'light', 'dark']).toContain(themeVal);
    });

    // ----------------------------------------------------------------
    // TC2: Changing theme patches preference
    // ----------------------------------------------------------------

    test('changing theme sends PATCH and shows success toast', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);
        await gotoSettingsSubTab(page, 'appearance');

        // Wait for preferences to load
        await expect(page.locator('[data-testid="pref-theme"]')).toBeVisible({ timeout: 5000 });

        // Change theme to 'dark' (Appearance card uses per-card Save model)
        await page.selectOption('[data-testid="pref-theme"]', 'dark');

        const patchPromise = page.waitForRequest(req =>
            req.url().includes('/api/preferences') && req.method() === 'PATCH',
        );

        // Click Save on the Appearance & Navigation card
        await page.click('[data-testid="settings-appearance-save"]');

        const patchReq = await patchPromise;
        const body = JSON.parse(patchReq.postData() ?? '{}');
        expect(body.theme).toBe('dark');

        // Success toast should appear
        await expect(page.locator('.toast-success')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.toast-success')).toContainText('Settings saved');
    });

    // ----------------------------------------------------------------
    // TC3: Preferences load failure shows error state
    // ----------------------------------------------------------------

    test('preferences load failure falls back to default theme without crashing', async ({ page, serverUrl }) => {
        // Abort GET only after the admin panel is open. Aborting every GET breaks App bootstrap
        // (welcome state never loads), which leaves the welcome modal blocking #admin-toggle.
        await page.route('**/api/preferences', async (route, req) => {
            if (req.method() === 'GET') {
                const adminOpen = await page.locator('#view-admin').isVisible().catch(() => false);
                if (adminOpen) return route.abort('failed');
            }
            return route.continue();
        });

        await navigateToAdmin(page, serverUrl);

        // Admin page content should still render even when preferences load fails
        await expect(page.locator('#admin-page-content')).toBeVisible({ timeout: 5000 });

        await gotoSettingsSubTab(page, 'appearance');

        // Theme dropdown should still appear with the default 'auto' value (graceful fallback,
        // since AdminPanel's appearance card renders unconditionally with local defaults)
        await expect(page.locator('[data-testid="pref-theme"]')).toBeVisible({ timeout: 5000 });
        const themeVal = await page.locator('[data-testid="pref-theme"]').inputValue();
        expect(themeVal).toBe('auto');
    });
});
