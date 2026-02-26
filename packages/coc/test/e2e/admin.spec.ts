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
    // Admin view becomes visible (AdminPanel is a separate route view)
    await expect(page.locator('#view-admin')).toBeVisible({ timeout: 5000 });
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

        // Default tab is repos — repos view should be visible
        await expect(page.locator('#view-repos')).toBeVisible();

        // Click gear icon (navigates to #admin)
        await page.click('#admin-toggle');

        // Admin view should be visible (AdminPanel is a separate route)
        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 5000 });

        // Hash should be #admin
        expect(page.url()).toContain('#admin');
    });

    test('8.2 navigating away from admin hides admin page', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);

        // Click Repos tab (navigates away from admin route)
        await page.click('[data-tab="repos"]');

        // Repos view should be visible; admin view no longer shown
        await expect(page.locator('#view-repos')).toBeVisible();
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

        // Preview area is not rendered initially (React conditional)
        await expect(page.locator('#admin-wipe-preview')).toHaveCount(0);

        // Click preview button
        await page.click('#admin-preview-wipe');

        // Preview should become visible with content
        await expect(page.locator('#admin-wipe-preview')).toBeVisible({ timeout: 5000 });
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

        await expect(page.locator('#admin-wipe-preview')).toBeVisible({ timeout: 5000 });
    });

    // ----------------------------------------------------------------
    // TC5: Wipe Data — Cancel
    // ----------------------------------------------------------------

    test('8.7 wipe data dismissed on cancel', async ({ page, serverUrl }) => {
        await seedProcess(serverUrl, 'admin-wipe-cancel-1', { status: 'completed' });

        await navigateToAdmin(page, serverUrl);
        await expect(page.locator('#admin-stat-processes')).not.toHaveText('…', { timeout: 5000 });

        // Click "Wipe Data" to get token (two-step flow)
        await page.click('#admin-wipe-btn');

        // "Confirm Wipe" and "Cancel" buttons should appear
        await expect(page.locator('#admin-wipe-cancel')).toBeVisible({ timeout: 5000 });

        // Click cancel
        await page.click('#admin-wipe-cancel');

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

        // Click "Wipe Data" to get token (two-step flow)
        await page.click('#admin-wipe-btn');

        // "Confirm Wipe" button should appear
        await expect(page.locator('#admin-wipe-confirm')).toBeVisible({ timeout: 5000 });

        // Click confirm
        await page.click('#admin-wipe-confirm');

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

    test('8.9 wipe two-step flow shows confirm and cancel buttons', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);

        // Initially only "Wipe Data" button visible, no confirm/cancel
        await expect(page.locator('#admin-wipe-btn')).toBeVisible();
        await expect(page.locator('#admin-wipe-confirm')).toHaveCount(0);
        await expect(page.locator('#admin-wipe-cancel')).toHaveCount(0);

        // Click "Wipe Data" to request token
        await page.click('#admin-wipe-btn');

        // After token received, "Confirm Wipe" and "Cancel" should appear
        await expect(page.locator('#admin-wipe-confirm')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#admin-wipe-cancel')).toBeVisible();

        // Cancel to reset
        await page.click('#admin-wipe-cancel');
        await expect(page.locator('#admin-wipe-status')).toContainText('Cancelled', { timeout: 5000 });
    });

    // ----------------------------------------------------------------
    // TC8: Stats Show Error on API Failure
    // ----------------------------------------------------------------

    test('8.10 stats show dash when API fails', async ({ page, serverUrl }) => {
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
        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#admin-page-content')).not.toBeEmpty({ timeout: 5000 });

        // Stats should show "—" (dash) when API fails
        await expect(page.locator('[data-testid="stat-processes"]')).toHaveText('—', { timeout: 5000 });
        await expect(page.locator('[data-testid="stat-wikis"]')).toHaveText('—');
        await expect(page.locator('[data-testid="stat-disk"]')).toHaveText('—');
    });

    // ----------------------------------------------------------------
    // TC9: Export Button
    // ----------------------------------------------------------------

    test('8.11 export button triggers download', async ({ page, serverUrl }) => {
        await seedProcess(serverUrl, 'export-ui-1', { status: 'completed' });
        await navigateToAdmin(page, serverUrl);

        // Intercept download
        const downloadPromise = page.waitForEvent('download');
        await page.click('#admin-export-btn');
        const download = await downloadPromise;

        expect(download.suggestedFilename()).toMatch(/^coc-export-.*\.json$/);

        // Status should show success
        await expect(page.locator('#admin-export-status')).toContainText('Exported successfully', { timeout: 5000 });
    });

    test('8.12 export shows error on network failure', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        // Intercept export API to return error
        await page.route('**/api/admin/export', route =>
            route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Internal Server Error' }),
            }),
        );

        await page.click('#admin-toggle');
        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#admin-page-content')).not.toBeEmpty({ timeout: 5000 });

        await page.click('#admin-export-btn');
        await expect(page.locator('#admin-export-status')).toContainText('Export failed', { timeout: 5000 });
    });

    // ----------------------------------------------------------------
    // TC10: Import — File Picker
    // ----------------------------------------------------------------

    test('8.13 import file input accepts .json', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);

        const fileInput = page.locator('#admin-import-file');
        await expect(fileInput).toBeVisible();
        expect(await fileInput.getAttribute('accept')).toContain('.json');
    });

    // ----------------------------------------------------------------
    // TC11: Import — Preview
    // ----------------------------------------------------------------

    test('8.14 import preview shows counts', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);

        // Create a valid export payload file
        const exportPayload = {
            version: 1,
            exportedAt: new Date().toISOString(),
            metadata: { processCount: 2, workspaceCount: 1, wikiCount: 0, queueFileCount: 0 },
            processes: [
                { id: 'p1', promptPreview: 'test', fullPrompt: 'test', status: 'completed', startTime: new Date().toISOString(), type: 'clarification' },
                { id: 'p2', promptPreview: 'test2', fullPrompt: 'test2', status: 'running', startTime: new Date().toISOString(), type: 'clarification' },
            ],
            workspaces: [{ id: 'ws1', name: 'WS1', rootPath: '/tmp/ws1' }],
            wikis: [],
            queueHistory: [],
            preferences: {},
        };

        // Use file chooser to set the file
        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.click('#admin-import-file');
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles({
            name: 'test-export.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(exportPayload)),
        });

        // Click preview
        await page.click('#admin-import-preview-btn');

        // Preview should become visible with counts
        await expect(page.locator('#admin-import-preview')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#admin-import-preview')).not.toContainText('Loading preview…', { timeout: 5000 });

        const previewText = await page.locator('#admin-import-preview').textContent();
        expect(previewText).toContain('Processes: 2');
        expect(previewText).toContain('Workspaces: 1');

        await expect(page.locator('#admin-import-status')).toContainText('Preview loaded', { timeout: 5000 });
    });

    test('8.15 import preview shows error for no file selected', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);

        await page.click('#admin-import-preview-btn');
        await expect(page.locator('#admin-import-status')).toContainText('select a JSON file', { timeout: 5000 });
    });

    // ----------------------------------------------------------------
    // TC12: Import — Replace with Confirmation
    // ----------------------------------------------------------------

    test('8.16 import replace executes', async ({ page, serverUrl }) => {
        await seedProcess(serverUrl, 'existing-1', { status: 'completed' });
        await navigateToAdmin(page, serverUrl);

        const exportPayload = {
            version: 1,
            exportedAt: new Date().toISOString(),
            metadata: { processCount: 1, workspaceCount: 0, wikiCount: 0, queueFileCount: 0 },
            processes: [
                { id: 'imported-1', promptPreview: 'imported', fullPrompt: 'imported full', status: 'completed', startTime: new Date().toISOString(), type: 'clarification' },
            ],
            workspaces: [],
            wikis: [],
            queueHistory: [],
            preferences: {},
        };

        // Select file
        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.click('#admin-import-file');
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles({
            name: 'test-import.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(exportPayload)),
        });

        // Ensure replace is selected (default)
        await page.check('input[name="import-mode"][value="replace"]');

        await page.click('#admin-import-btn');

        // Status should show success
        await expect(page.locator('#admin-import-status')).toContainText('Import complete', { timeout: 10000 });

        // Verify data via API
        const res = await request(`${serverUrl}/api/processes`);
        const data = JSON.parse(res.body);
        const processes = data.processes ?? data;
        const ids = processes.map((p: any) => p.id);
        expect(ids).toContain('imported-1');
    });

    // ----------------------------------------------------------------
    // TC13: Import — Merge with Confirmation
    // ----------------------------------------------------------------

    test('8.17 import merge executes', async ({ page, serverUrl }) => {
        await seedProcess(serverUrl, 'existing-merge-1', { status: 'completed' });
        await navigateToAdmin(page, serverUrl);

        const exportPayload = {
            version: 1,
            exportedAt: new Date().toISOString(),
            metadata: { processCount: 1, workspaceCount: 0, wikiCount: 0, queueFileCount: 0 },
            processes: [
                { id: 'merged-1', promptPreview: 'merged', fullPrompt: 'merged full', status: 'completed', startTime: new Date().toISOString(), type: 'clarification' },
            ],
            workspaces: [],
            wikis: [],
            queueHistory: [],
            preferences: {},
        };

        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.click('#admin-import-file');
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles({
            name: 'test-merge.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(exportPayload)),
        });

        // Select merge mode
        await page.check('input[name="import-mode"][value="merge"]');

        await page.click('#admin-import-btn');

        await expect(page.locator('#admin-import-status')).toContainText('Import complete', { timeout: 10000 });
    });

    // ----------------------------------------------------------------
    // TC14: Import — Cancel Confirmation
    // ----------------------------------------------------------------

    test('8.18 import with valid payload shows success', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);

        const exportPayload = {
            version: 1,
            exportedAt: new Date().toISOString(),
            metadata: { processCount: 0, workspaceCount: 0, wikiCount: 0, queueFileCount: 0 },
            processes: [],
            workspaces: [],
            wikis: [],
            queueHistory: [],
            preferences: {},
        };

        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.click('#admin-import-file');
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles({
            name: 'test-empty-import.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(exportPayload)),
        });

        await page.click('#admin-import-btn');

        await expect(page.locator('#admin-import-status')).toContainText('Import complete', { timeout: 10000 });
    });

    // ----------------------------------------------------------------
    // TC15: Import — Mode Radio Buttons
    // ----------------------------------------------------------------

    test('8.19 import mode radios are present and default to replace', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);

        const replaceRadio = page.locator('input[name="import-mode"][value="replace"]');
        const mergeRadio = page.locator('input[name="import-mode"][value="merge"]');

        await expect(replaceRadio).toBeVisible();
        await expect(mergeRadio).toBeVisible();
        expect(await replaceRadio.isChecked()).toBe(true);
        expect(await mergeRadio.isChecked()).toBe(false);
    });
});
