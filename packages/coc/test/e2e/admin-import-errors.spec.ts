/**
 * Admin Import Error Paths E2E Tests
 *
 * Tests the error branches in the Import Data section:
 * - Invalid JSON file shows 'Invalid JSON file.'
 * - Import token request fails → 'Failed to get import token.'
 * - POST /admin/import returns non-200 → 'Import failed: <error>'
 * - Import preview API returns error → 'Preview failed'
 */

import { test, expect } from './fixtures/server-fixture';

// ================================================================
// Helpers
// ================================================================

/** Navigate to admin page and wait for content. */
async function navigateToAdmin(page: import('@playwright/test').Page, serverUrl: string): Promise<void> {
    await page.goto(serverUrl);
    await page.click('#admin-toggle');
    await expect(page.locator('#view-admin')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#admin-page-content')).not.toBeEmpty({ timeout: 5000 });
}

/** Upload a file to the import file input. */
async function setImportFile(
    page: import('@playwright/test').Page,
    filename: string,
    content: string,
    mimeType = 'application/json',
): Promise<void> {
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.click('#admin-import-file');
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
        name: filename,
        mimeType,
        buffer: Buffer.from(content),
    });
}

// ================================================================
// Tests
// ================================================================

test.describe('Admin: Import error paths', () => {

    // ----------------------------------------------------------------
    // TC1: Invalid JSON file shows error
    // ----------------------------------------------------------------

    test('invalid JSON file shows error on import', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);

        // Upload a file with non-JSON content
        await setImportFile(page, 'bad.json', 'this is not valid json {{{');

        // Click Import
        await page.click('#admin-import-btn');

        // Status shows 'Import failed' since JSON.parse throws
        await expect(page.locator('#admin-import-status')).toContainText('Import failed', { timeout: 5000 });
    });

    test('invalid JSON file shows error on preview', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);

        // Upload a file with non-JSON content
        await setImportFile(page, 'bad-preview.txt', 'definitely not json', 'text/plain');

        // Click Preview
        await page.click('#admin-import-preview-btn');

        // Status should show 'Invalid JSON file.'
        await expect(page.locator('#admin-import-status')).toContainText('Invalid JSON file', { timeout: 5000 });
    });

    // ----------------------------------------------------------------
    // TC2: Import token request failure
    // ----------------------------------------------------------------

    test('import token failure shows error status', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);

        // Upload a valid JSON file
        const payload = {
            version: 1,
            exportedAt: new Date().toISOString(),
            metadata: { processCount: 0, workspaceCount: 0, wikiCount: 0, queueFileCount: 0 },
            processes: [],
            workspaces: [],
            wikis: [],
            queueHistory: [],
            preferences: {},
        };
        await setImportFile(page, 'valid.json', JSON.stringify(payload));

        // Mock import-token to fail
        await page.route('**/api/admin/import-token', route =>
            route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Token generation failed' }),
            }),
        );

        await page.click('#admin-import-btn');

        await expect(page.locator('#admin-import-status')).toContainText('Failed to get import token', { timeout: 5000 });
    });

    // ----------------------------------------------------------------
    // TC3: POST /admin/import returns non-200
    // ----------------------------------------------------------------

    test('import API failure shows error status', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);

        const payload = {
            version: 1,
            exportedAt: new Date().toISOString(),
            metadata: { processCount: 0, workspaceCount: 0, wikiCount: 0, queueFileCount: 0 },
            processes: [],
            workspaces: [],
            wikis: [],
            queueHistory: [],
            preferences: {},
        };
        await setImportFile(page, 'valid2.json', JSON.stringify(payload));

        // Mock token to succeed
        await page.route('**/api/admin/import-token', route =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ token: 'test-token-123', expiresIn: 300 }),
            }),
        );

        // Mock POST /admin/import to fail
        await page.route('**/api/admin/import**', (route, req) => {
            if (req.method() === 'POST' && req.url().includes('confirm=')) {
                return route.fulfill({
                    status: 422,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'Incompatible version' }),
                });
            }
            return route.continue();
        });

        await page.click('#admin-import-btn');

        await expect(page.locator('#admin-import-status')).toContainText('Import failed', { timeout: 5000 });
        await expect(page.locator('#admin-import-status')).toContainText('Incompatible version');
    });

    // ----------------------------------------------------------------
    // TC4: Preview API returns error
    // ----------------------------------------------------------------

    test('preview API error shows preview failed', async ({ page, serverUrl }) => {
        await navigateToAdmin(page, serverUrl);

        const payload = {
            version: 1,
            exportedAt: new Date().toISOString(),
            metadata: { processCount: 1, workspaceCount: 0, wikiCount: 0, queueFileCount: 0 },
            processes: [
                { id: 'p1', promptPreview: 'test', fullPrompt: 'test', status: 'completed', startTime: new Date().toISOString(), type: 'clarification' },
            ],
            workspaces: [],
            wikis: [],
            queueHistory: [],
            preferences: {},
        };
        await setImportFile(page, 'preview-fail.json', JSON.stringify(payload));

        // Mock preview to return error
        await page.route('**/api/admin/import/preview', route =>
            route.fulfill({
                status: 400,
                contentType: 'application/json',
                body: JSON.stringify({ valid: false, error: 'Unsupported version' }),
            }),
        );

        await page.click('#admin-import-preview-btn');

        await expect(page.locator('#admin-import-status')).toContainText('Preview failed', { timeout: 5000 });
        await expect(page.locator('#admin-import-preview')).toContainText('Preview failed: Unsupported version', { timeout: 5000 });
    });
});
