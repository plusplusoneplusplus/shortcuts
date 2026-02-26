/**
 * Dashboard E2E Tests
 *
 * Tests the Processes tab: list rendering, filtering, search, detail panel.
 *
 * Data flow: seed via REST → page.goto (patched route transforms response) → assert DOM.
 */

import { test, expect } from './fixtures/server-fixture';
import { seedProcess, seedProcesses, seedWorkspace } from './fixtures/seed';

test.describe('Dashboard — Processes tab', () => {
    test('shows empty state when no processes exist', async ({ page, serverUrl }) => {
        await page.goto(serverUrl + '/#processes');
        await expect(page.locator('#empty-state')).toBeVisible();
        await expect(page.locator('#empty-state')).toContainText('No processes yet');
    });

    test('displays seeded processes in the sidebar', async ({ page, serverUrl }) => {
        // Seed before navigating — patched route returns the array
        await seedProcesses(serverUrl, 3);
        await page.goto(serverUrl + '/#processes');

        await expect(page.locator('.process-item')).toHaveCount(3, { timeout: 5000 });
        await expect(page.locator('#empty-state')).toBeHidden();
    });

    test('clicking a process shows its detail', async ({ page, serverUrl }) => {
        await seedProcess(serverUrl, 'detail-proc', {
            promptPreview: 'Detail Test Process',
            status: 'running',
        });
        await page.goto(serverUrl + '/#processes');

        await expect(page.locator('.process-item')).toHaveCount(1, { timeout: 5000 });
        await page.locator('.process-item').first().click();

        // Detail panel should show content
        await expect(page.locator('#detail-content')).toBeVisible();
        await expect(page.locator('#detail-empty')).toBeHidden();
    });

    test('search filters processes by title', async ({ page, serverUrl }) => {
        await seedProcess(serverUrl, 'search-match', { promptPreview: 'Alpha Process' });
        await seedProcess(serverUrl, 'search-miss', { promptPreview: 'Beta Process' });
        await page.goto(serverUrl + '/#processes');

        // Should show both
        await expect(page.locator('.process-item')).toHaveCount(2, { timeout: 5000 });

        // Type search query
        await page.fill('#search-input', 'Alpha');

        // Should filter to 1
        await expect(page.locator('.process-item')).toHaveCount(1);
        await expect(page.locator('.process-item')).toContainText('Alpha');
    });

    test('status filter narrows the process list', async ({ page, serverUrl }) => {
        await seedProcess(serverUrl, 'running-1', { status: 'running' });
        await seedProcess(serverUrl, 'completed-1', { status: 'completed' });
        await seedProcess(serverUrl, 'failed-1', { status: 'failed' });
        await page.goto(serverUrl + '/#processes');

        await expect(page.locator('.process-item')).toHaveCount(3, { timeout: 5000 });

        // Filter by running only
        await page.selectOption('#status-filter', 'running');
        await expect(page.locator('.process-item')).toHaveCount(1);

        // Filter by completed
        await page.selectOption('#status-filter', 'completed');
        await expect(page.locator('.process-item')).toHaveCount(1);

        // Reset
        await page.selectOption('#status-filter', '__all');
        await expect(page.locator('.process-item')).toHaveCount(3);
    });
});
