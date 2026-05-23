/**
 * Keyboard Shortcuts E2E Tests
 *
 * Tests keyboard shortcuts that operate when on the Repos tab with a repo selected:
 *   Alt+A → navigate to Activity sub-tab
 *   Alt+I → navigate to Wiki sub-tab
 *   Bare 'W' → should NOT navigate (no longer a shortcut)
 */

import { test, expect } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';

test.describe('Keyboard shortcuts', () => {
    test("pressing 'A' on Repos tab with selected repo navigates to Activity sub-tab", async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-ks-1', 'kb-test-repo-a', '/tmp/kb-test-repo-a');
        await page.goto(serverUrl);

        // Wait for repo to appear and select it
        await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10000 });
        await page.locator('[data-testid="repo-tab"]').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();

        // Press Alt+A to jump to Activity sub-tab
        await page.keyboard.press('Alt+a');

        // Hash should include 'activity'
        await expect(page).toHaveURL(/activity/);
    });

    test("pressing Alt+I on Repos tab with selected repo navigates to Work-items sub-tab", async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-ks-2', 'kb-test-repo-w', '/tmp/kb-test-repo-w');
        await page.goto(serverUrl);

        // Wait for repo to appear and select it
        await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10000 });
        await page.locator('[data-testid="repo-tab"]').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();

        // Press Alt+I — the `i` shortcut maps to the Work-items sub-tab
        // (see REPO_TAB_SHORTCUTS in `layout/Router.tsx`).
        await page.keyboard.press('Alt+i');

        await expect(page).toHaveURL(/work-items/);
    });

    test("pressing bare 'W' does NOT navigate away from current tab", async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-ks-3', 'kb-test-repo-bare-w', '/tmp/kb-test-repo-bare-w');
        await page.goto(serverUrl);

        // Wait for repo to appear and select it
        await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10000 });
        await page.locator('[data-testid="repo-tab"]').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();

        const urlBefore = page.url();

        // Press bare 'W' — should NOT navigate to wiki
        await page.keyboard.press('w');
        await page.waitForTimeout(300);

        expect(page.url()).toBe(urlBefore);
    });

    test("keyboard shortcuts are ignored when not on Repos tab", async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        // Switch to Skills tab via the Admin Tools sidebar — repo sub-tab
        // shortcuts only fire when `state.activeTab === 'repos'` AND a repo
        // is selected.
        await page.click('#admin-toggle');
        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 10000 });
        await page.click('#skills-toggle');
        await expect(page.locator('#view-skills')).toBeVisible({ timeout: 10000 });

        const urlBefore = page.url();

        // Press 'A' — should be ignored (no repo selected, wrong tab)
        await page.keyboard.press('a');
        expect(page.url()).toBe(urlBefore);
    });
});
