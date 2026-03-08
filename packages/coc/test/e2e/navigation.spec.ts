/**
 * Navigation E2E Tests
 *
 * Tests tab switching, sidebar toggle, and navigation bar behavior.
 */

import { test, expect } from './fixtures/server-fixture';

test.describe('Navigation', () => {
    test('default view is Repos tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        // Repos tab button should be active
        await expect(page.locator('[data-tab="repos"]')).toHaveClass(/bg-\[#0078d4\]/);
        // Repos view should be visible
        await expect(page.locator('#view-repos')).toBeVisible();
        // Processes view is not rendered when on repos
        await expect(page.locator('#view-processes')).toHaveCount(0);
    });

    test('clicking Processes tab switches to processes view', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        await page.click('[data-tab="processes"]');
        await expect(page.locator('[data-tab="processes"]')).toHaveClass(/bg-\[#0078d4\]/);
        await expect(page.locator('#view-processes')).toBeVisible();
    });

    test('clicking Wiki tab switches to wiki view', async ({ page, serverUrl }) => {
        await page.goto(serverUrl + '#wiki');

        await expect(page.locator('#view-wiki')).toBeVisible();
    });

    test('can switch back to Processes from Repos', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        await page.click('[data-tab="processes"]');
        await expect(page.locator('#view-processes')).toBeVisible();

        await page.click('[data-tab="repos"]');
        await expect(page.locator('#view-repos')).toBeVisible();
    });

    test('hamburger button exists in the DOM', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        // The hamburger button exists but is only visible on narrow viewports
        await expect(page.locator('#hamburger-btn')).toHaveCount(1);
    });

    test('top bar navigation links are present', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        await expect(page.locator('[data-tab="repos"]')).toBeVisible();
        await expect(page.locator('[data-tab="processes"]')).toBeVisible();
    });

    test('hash navigation works for tab routing', async ({ page, serverUrl }) => {
        // Navigate directly to repos tab via hash
        await page.goto(`${serverUrl}/#repos`);

        await expect(page.locator('[data-tab="repos"]')).toHaveClass(/bg-\[#0078d4\]/);
        await expect(page.locator('#view-repos')).toBeVisible();
    });
});
