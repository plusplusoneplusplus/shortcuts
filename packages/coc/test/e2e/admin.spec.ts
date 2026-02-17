/**
 * Admin Panel E2E Tests (008)
 *
 * Tests global admin page functionality: navigation, storage stats display,
 * refresh, preview wipe, and data wipe with confirmation dialog.
 *
 * The admin page is rendered at #admin and contains stat cards, a refresh
 * button, wipe preview, and a wipe-data button protected by a confirm() dialog.
 */

import { test, expect } from './fixtures/server-fixture';
import { seedProcess, seedWorkspace, request } from './fixtures/seed';

// ================================================================
// Helpers
// ================================================================

/** Navigate to the global admin page via the gear icon. */
async function navigateToAdmin(page: import('@playwright/test').Page, serverUrl: string): Promise<void> {
    await page.goto(serverUrl);
    await page.click('#admin-toggle');
    // Admin view becomes visible
    await expect(page.locator('#view-admin')).not.toHaveClass(/hidden/, { timeout: 5000 });
    // Wait for page to initialize (stats load)
    await expect(page.locator('#admin-page-content')).not.toBeEmpty({ timeout: 5000 });
}

// ================================================================
// Tests
// ================================================================

test.describe('Admin Panel (008)', () => {

    // ----------------------------------------------------------------
    // TC1: Navigate to Admin via Gear Icon
    // ----------------------------------------------------------------

    test('8.1 gear icon navigates to admin page', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        // Admin view should be hidden initially (default tab is repos)
        await expect(page.locator('#view-admin')).toHaveClass(/hidden/);

        // Click gear icon
        await page.click('#admin-toggle');

        // Admin view should be visible
        await expect(page.locator('#view-admin')).not.toHaveClass(/hidden/, { timeout: 5000 });

        // Gear icon should be highlighted
        await expect(page.locator('#admin-toggle')).toHaveClass(/active/);

        // Hash should be #admin
        expect(page.url()).toContain('#admin');
    });

    test('8.2 navigating away from admin hides admin page', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);

        // Click Repos tab
        await page.click('[data-tab="repos"]');

        // Admin view should be hidden
        await expect(page.locator('#view-admin')).toHaveClass(/hidden/);

        // Gear icon should not be active
        await expect(page.locator('#admin-toggle')).not.toHaveClass(/active/);
    });

    // ----------------------------------------------------------------
    // TC2: Admin Page Shows Storage Stats
    // ----------------------------------------------------------------

    test('8.3 admin page renders stat cards', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);

        // Stat cards should be visible and rendered
        await expect(page.locator('#admin-stat-processes')).toBeVisible();
        await expect(page.locator('#admin-stat-wikis')).toBeVisible();
        await expect(page.locator('#admin-stat-disk')).toBeVisible();

        // Stats should have loaded (no longer showing the loading indicator "…")
        await expect(page.locator('#admin-stat-processes')).not.toHaveText('…', { timeout: 5000 });
    });

    // ----------------------------------------------------------------
    // TC3: Refresh Stats
    // ----------------------------------------------------------------

    test('8.4 refresh button triggers stats API call', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);

        // Wait for initial stats load
        await expect(page.locator('#admin-stat-processes')).not.toHaveText('…', { timeout: 5000 });

        // Intercept the next stats request to prove refresh triggers a new fetch
        const statsPromise = page.waitForRequest(req =>
            req.url().includes('/admin/data/stats'),
        );

        // Click refresh
        await page.click('#admin-refresh-stats');

        // Should trigger a stats API call
        await statsPromise;

        // After refresh, stats should finish loading again
        await expect(page.locator('#admin-stat-processes')).not.toHaveText('…', { timeout: 5000 });
    });

    // ----------------------------------------------------------------
    // TC4: Preview Wipe
    // ----------------------------------------------------------------

    test('8.5 preview shows data summary', async ({ page, serverUrl }) => {
        // Seed data
        await seedProcess(serverUrl, 'admin-preview-1', { status: 'completed' });
        await seedProcess(serverUrl, 'admin-preview-2', { status: 'running' });

        await navigateToAdmin(page, serverUrl);

        // Preview area should be hidden initially
        await expect(page.locator('#admin-wipe-preview')).toHaveClass(/hidden/);

        // Click preview button
        await page.click('#admin-preview-wipe');

        // Preview should become visible with content
        await expect(page.locator('#admin-wipe-preview')).not.toHaveClass(/hidden/, { timeout: 5000 });
        // Preview should contain WipeResult data (JSON or formatted lines)
        await expect(page.locator('#admin-wipe-preview')).not.toHaveText('Loading preview…', {
            timeout: 5000,
        });
        const previewText = await page.locator('#admin-wipe-preview').textContent();
        expect(previewText).toBeTruthy();
        // Should contain process-related data (either field name from WipeResult)
        expect(previewText!.length).toBeGreaterThan(5);
    });

    test('8.6 preview with include-wikis checkbox', async ({ page, serverUrl }) => {
        await seedProcess(serverUrl, 'admin-preview-wikis-1');

        await navigateToAdmin(page, serverUrl);

        // Check include wikis checkbox
        await page.check('#admin-include-wikis');
        expect(await page.isChecked('#admin-include-wikis')).toBe(true);

        // Click preview — the request should include includeWikis=true
        const apiPromise = page.waitForRequest(req =>
            req.url().includes('/admin/data/stats') && req.url().includes('includeWikis=true'),
        );
        await page.click('#admin-preview-wipe');
        await apiPromise;

        await expect(page.locator('#admin-wipe-preview')).not.toHaveClass(/hidden/, { timeout: 5000 });
    });

    // ----------------------------------------------------------------
    // TC5: Wipe Data — Cancel
    // ----------------------------------------------------------------

    test('8.7 wipe data dismissed on cancel', async ({ page, serverUrl }) => {
        await seedProcess(serverUrl, 'admin-wipe-cancel-1', { status: 'completed' });

        await navigateToAdmin(page, serverUrl);
        await expect(page.locator('#admin-stat-processes')).not.toHaveText('…', { timeout: 5000 });

        // Dismiss the confirm dialog
        page.on('dialog', dialog => dialog.dismiss());

        await page.click('#admin-wipe-btn');

        // Status should show "Cancelled."
        await expect(page.locator('#admin-wipe-status')).toContainText('Cancelled', { timeout: 5000 });

        // Data should still exist — verify via API
        const res = await request(`${serverUrl}/api/processes/admin-wipe-cancel-1`);
        expect(res.status).toBe(200);
    });

    // ----------------------------------------------------------------
    // TC6: Wipe Data — Confirm
    // ----------------------------------------------------------------

    test('8.8 wipe data removes all processes when confirmed', async ({ page, serverUrl }) => {
        await seedProcess(serverUrl, 'admin-wipe-ok-1', { status: 'completed' });
        await seedProcess(serverUrl, 'admin-wipe-ok-2', { status: 'running' });

        await navigateToAdmin(page, serverUrl);

        // Accept the confirm dialog
        page.on('dialog', dialog => dialog.accept());

        await page.click('#admin-wipe-btn');

        // Status should show success
        await expect(page.locator('#admin-wipe-status')).toContainText('wiped successfully', { timeout: 10000 });

        // Verify data is actually wiped via API
        const res = await request(`${serverUrl}/api/processes`);
        const data = JSON.parse(res.body);
        const processes = data.processes ?? data;
        expect(Array.isArray(processes) ? processes.length : 0).toBe(0);
    });

    // ----------------------------------------------------------------
    // TC7: Wipe Confirm Dialog Content
    // ----------------------------------------------------------------

    test('8.9 wipe confirmation dialog has expected message', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);

        let dialogMessage = '';
        page.on('dialog', async dialog => {
            dialogMessage = dialog.message();
            await dialog.dismiss();
        });

        await page.click('#admin-wipe-btn');

        // Wait for the dialog to be handled by waiting for the final status
        // (either "Cancelled." from dismiss, or "Failed to get wipe token.")
        await expect(page.locator('#admin-wipe-status')).toContainText('Cancelled', { timeout: 10000 });

        // Dialog should mention the irreversible action
        expect(dialogMessage).toContain('wipe all data');
    });

    // ----------------------------------------------------------------
    // TC8: Stats Show Error on API Failure
    // ----------------------------------------------------------------

    test('8.10 stats show Error when API fails', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        // Intercept stats API to return error
        await page.route('**/api/admin/data/stats**', route =>
            route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Internal Server Error' }),
            }),
        );

        // Navigate to admin
        await page.click('#admin-toggle');
        await expect(page.locator('#view-admin')).not.toHaveClass(/hidden/, { timeout: 5000 });
        await expect(page.locator('#admin-page-content')).not.toBeEmpty({ timeout: 5000 });

        // Stats should show "Error"
        await expect(page.locator('#admin-stat-processes')).toHaveText('Error', { timeout: 5000 });
        await expect(page.locator('#admin-stat-wikis')).toHaveText('Error');
        await expect(page.locator('#admin-stat-disk')).toHaveText('Error');
    });
});
