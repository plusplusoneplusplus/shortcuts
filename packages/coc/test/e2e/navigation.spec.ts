/**
 * Navigation E2E Tests
 *
 * Tests tab switching, sidebar toggle, and navigation bar behavior.
 */

import { test, expect } from './fixtures/server-fixture';

test.describe('Navigation', () => {
    test('default view is Repos tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        // Repos view should be visible (it is the implicit default — no tab button)
        await expect(page.locator('#view-repos')).toBeVisible();
        // URL hash should stay empty (no redirect to #repos)
        expect(new URL(page.url()).hash).toBe('');
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

    test('Skills tab navigation switches to Skills view', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        await page.click('[data-tab="skills"]');
        await expect(page.locator('[data-tab="skills"]')).toHaveClass(/bg-\[#0078d4\]/);
        await expect(page.locator('#view-skills')).toBeVisible({ timeout: 10000 });
    });

    test('Memory tab navigation switches to Memory view', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        await page.click('[data-tab="memory"]');
        await expect(page.locator('[data-tab="memory"]')).toHaveClass(/bg-\[#0078d4\]/);
        await expect(page.locator('#view-memory')).toBeVisible({ timeout: 10000 });
    });

    test('admin gear icon navigates to admin view', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        await page.click('#admin-toggle');
        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 10000 });
    });

    test('hamburger button toggles sidebar collapse and expand', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        const hamburger = page.locator('#hamburger-btn');

        // Initially expanded (not collapsed)
        await expect(hamburger).toHaveAttribute('aria-pressed', 'false');

        // Click to collapse
        await hamburger.click();
        await expect(hamburger).toHaveAttribute('aria-pressed', 'true');

        // Click again to re-expand
        await hamburger.click();
        await expect(hamburger).toHaveAttribute('aria-pressed', 'false');
    });

    test('hamburger button is noop when not on Repos tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        const hamburger = page.locator('#hamburger-btn');

        // Switch to Processes tab
        await page.click('[data-tab="processes"]');
        await expect(page.locator('#view-processes')).toBeVisible();

        // Hamburger click should not change collapsed state
        await expect(hamburger).toHaveAttribute('aria-pressed', 'false');
        await hamburger.click();
        await expect(hamburger).toHaveAttribute('aria-pressed', 'false');
    });

    test('sidebar collapsed state persists across page reload', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        const hamburger = page.locator('#hamburger-btn');

        // Collapse sidebar
        await hamburger.click();
        await expect(hamburger).toHaveAttribute('aria-pressed', 'true');

        // Verify localStorage was written
        const stored = await page.evaluate(() => localStorage.getItem('coc-repos-sidebar-collapsed'));
        expect(stored).toBe('true');

        // Reload and verify sidebar remains collapsed
        await page.reload();
        await expect(page.locator('#hamburger-btn')).toHaveAttribute('aria-pressed', 'true');
    });

    test('hash navigation routes to Memory tab', async ({ page, serverUrl }) => {
        await page.goto(`${serverUrl}/#memory`);

        await expect(page.locator('[data-tab="memory"]')).toHaveClass(/bg-\[#0078d4\]/);
        await expect(page.locator('#view-memory')).toBeVisible({ timeout: 10000 });
    });

    test('hash navigation routes to Skills tab', async ({ page, serverUrl }) => {
        await page.goto(`${serverUrl}/#skills`);

        await expect(page.locator('[data-tab="skills"]')).toHaveClass(/bg-\[#0078d4\]/);
        await expect(page.locator('#view-skills')).toBeVisible({ timeout: 10000 });
    });

    test('hash navigation routes to Admin panel', async ({ page, serverUrl }) => {
        await page.goto(`${serverUrl}/#admin`);

        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 10000 });
    });

    test('memory sub-tab deep link #memory/config activates config sub-tab', async ({ page, serverUrl }) => {
        await page.goto(`${serverUrl}/#memory/config`);

        await expect(page.locator('#view-memory')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('[data-subtab="config"]')).toBeVisible();
    });

    test('legacy hash #tasks routes to Repos tab', async ({ page, serverUrl }) => {
        await page.goto(`${serverUrl}/#tasks`);

        await expect(page.locator('[data-tab="repos"]')).toHaveClass(/bg-\[#0078d4\]/);
        await expect(page.locator('#view-repos')).toBeVisible();
    });

    test('legacy hash #process/:id routes to Processes tab', async ({ page, serverUrl }) => {
        await page.goto(`${serverUrl}/#process/some-id`);

        await expect(page.locator('[data-tab="processes"]')).toHaveClass(/bg-\[#0078d4\]/);
        await expect(page.locator('#view-processes')).toBeVisible();
    });
});
