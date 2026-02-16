/**
 * Navigation E2E Tests
 *
 * Tests tab switching, sidebar toggle, and navigation bar behavior.
 */

import { test, expect } from './fixtures/server-fixture';
import { seedProcess, seedWorkspace } from './fixtures/seed';

test.describe('Navigation', () => {
    test('default view is Processes tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        // Processes tab button should be active
        await expect(page.locator('[data-tab="processes"]')).toHaveClass(/active/);

        // Processes view should be visible
        await expect(page.locator('#view-processes')).toBeVisible();
        await expect(page.locator('#view-repos')).toBeHidden();
    });

    test('clicking Repos tab switches to repos view', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        await page.click('[data-tab="repos"]');
        await expect(page.locator('[data-tab="repos"]')).toHaveClass(/active/);
        await expect(page.locator('#view-repos')).toBeVisible();
        await expect(page.locator('#view-processes')).toBeHidden();
    });

    test('clicking Wiki tab switches to wiki view', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        await page.click('[data-tab="wiki"]');
        await expect(page.locator('[data-tab="wiki"]')).toHaveClass(/active/);
        await expect(page.locator('#view-wiki')).toBeVisible();
        await expect(page.locator('#view-processes')).toBeHidden();
    });

    test('Reports tab is disabled', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        const reportsBtn = page.locator('[data-tab="reports"]');
        await expect(reportsBtn).toBeDisabled();
    });

    test('can switch back to Processes from Repos', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        await page.click('[data-tab="repos"]');
        await expect(page.locator('#view-repos')).toBeVisible();

        await page.click('[data-tab="processes"]');
        await expect(page.locator('#view-processes')).toBeVisible();
        await expect(page.locator('#view-repos')).toBeHidden();
    });

    test('hamburger button exists in the DOM', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        // The hamburger button exists but is only visible on narrow viewports
        await expect(page.locator('#hamburger-btn')).toHaveCount(1);
    });

    test('top bar navigation links are present', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        await expect(page.locator('[data-page="dashboard"]')).toBeVisible();
        await expect(page.locator('[data-page="review"]')).toHaveCount(0);
    });

    test('hash navigation works for tab routing', async ({ page, serverUrl }) => {
        // Navigate directly to repos tab via hash
        await page.goto(`${serverUrl}/#repos`);

        await expect(page.locator('[data-tab="repos"]')).toHaveClass(/active/);
        await expect(page.locator('#view-repos')).toBeVisible();
    });

    test('workspace selector is visible in top bar', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        const wsSelect = page.locator('#workspace-select');
        await expect(wsSelect).toBeVisible();

        // Should have "All Repos" default option
        await expect(wsSelect.locator('option[value="__all"]')).toHaveText('All Repos');
    });
});
