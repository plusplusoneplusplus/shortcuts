/**
 * Real-time E2E Tests
 *
 * Tests that changes made via REST API are visible after page refresh.
 * Since the custom raw WS implementation isn't compatible with Playwright's
 * Chromium, we verify data consistency via reload instead of live WS updates.
 */

import { test, expect } from './fixtures/server-fixture';
import { seedProcess, request } from './fixtures/seed';

test.describe('Data consistency via REST + reload', () => {
    test('new process appears after page reload', async ({ page, serverUrl }) => {
        await page.goto(serverUrl + '/#processes');

        // Initially empty
        await expect(page.locator('#empty-state')).toBeVisible();

        // Seed a process via REST API
        await seedProcess(serverUrl, 'rt-new', { promptPreview: 'Real-time Process' });

        // Reload to pick up the new process
        await page.reload();
        await page.click('[data-tab="processes"]');
        await expect(page.locator('.process-item')).toHaveCount(1, { timeout: 5000 });
        await expect(page.locator('.process-item')).toContainText('Real-time Process');
    });

    test('process status update is visible after reload', async ({ page, serverUrl }) => {
        await seedProcess(serverUrl, 'rt-update', { status: 'running', promptPreview: 'Update Me' });
        await page.goto(serverUrl + '/#processes');

        await expect(page.locator('.process-item')).toHaveCount(1, { timeout: 5000 });
        await expect(page.locator('.process-item').filter({ hasText: /running|Running/i })).toHaveCount(1);

        // Update process status via REST API
        await request(`${serverUrl}/api/processes/rt-update`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'completed' }),
        });

        // Reload to see updated status
        await page.reload();
        await page.click('[data-tab="processes"]');
        await expect(page.locator('.process-item').filter({ hasText: /completed|Completed/i })).toHaveCount(1, {
            timeout: 5000,
        });
    });

    test('removed process disappears after reload', async ({ page, serverUrl }) => {
        await seedProcess(serverUrl, 'rt-remove', { promptPreview: 'Remove Me' });
        await page.goto(serverUrl + '/#processes');

        await expect(page.locator('.process-item')).toHaveCount(1, { timeout: 5000 });

        // Delete process via REST API
        await request(`${serverUrl}/api/processes/rt-remove`, { method: 'DELETE' });

        // Reload to see removal
        await page.reload();
        await page.click('[data-tab="processes"]');
        await expect(page.locator('.process-item')).toHaveCount(0, { timeout: 5000 });
        await expect(page.locator('#empty-state')).toBeVisible();
    });

    test('multiple processes added concurrently are all visible', async ({ page, serverUrl }) => {
        // Seed 3 processes concurrently
        await Promise.all([
            seedProcess(serverUrl, 'rt-rapid-1', { promptPreview: 'Rapid 1' }),
            seedProcess(serverUrl, 'rt-rapid-2', { promptPreview: 'Rapid 2' }),
            seedProcess(serverUrl, 'rt-rapid-3', { promptPreview: 'Rapid 3' }),
        ]);

        await page.goto(serverUrl + '/#processes');
        await expect(page.locator('.process-item')).toHaveCount(3, { timeout: 5000 });
    });
});
