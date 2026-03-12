/**
 * Keyboard Shortcuts E2E Tests
 *
 * Tests keyboard shortcuts that operate when on the Repos tab with a repo selected:
 *   'A' → navigate to Activity sub-tab
 *   'W' → navigate to Wiki sub-tab
 */

import { test, expect } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';

test.describe('Keyboard shortcuts', () => {
    test("pressing 'A' on Repos tab with selected repo navigates to Activity sub-tab", async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-ks-1', 'kb-test-repo-a', '/tmp/kb-test-repo-a');
        await page.goto(serverUrl);

        // Wait for repo to appear and select it
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
        await page.locator('.repo-item').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();

        // Press 'A' to jump to Activity sub-tab
        await page.keyboard.press('a');

        // Hash should include 'activity'
        await expect(page).toHaveURL(/activity/);
    });

    test("pressing 'W' on Repos tab with selected repo navigates to Wiki sub-tab", async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-ks-2', 'kb-test-repo-w', '/tmp/kb-test-repo-w');
        await page.goto(serverUrl);

        // Wait for repo to appear and select it
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
        await page.locator('.repo-item').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();

        // Press 'W' to jump to Wiki sub-tab
        await page.keyboard.press('w');

        // Hash should include 'wiki'
        await expect(page).toHaveURL(/wiki/);
    });

    test("keyboard shortcuts are ignored when not on Repos tab", async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        // Switch to Processes tab
        await page.click('[data-tab="processes"]');
        await expect(page.locator('#view-processes')).toBeVisible();

        const urlBefore = page.url();

        // Press 'A' — should be ignored (no repo selected, wrong tab)
        await page.keyboard.press('a');
        expect(page.url()).toBe(urlBefore);
    });
});
