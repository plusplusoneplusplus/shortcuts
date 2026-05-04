/**
 * Navigation E2E Tests
 *
 * Tests tab switching, sidebar toggle, and navigation bar behavior.
 *
 * Note: the legacy global "Processes" top-level tab was removed. Activity
 * (queue task list + chat detail) now lives under the per-repo `activity`
 * sub-tab. These tests assert the remaining top-level tabs (Repos, Skills,
 * Memory, Logs, Admin) and the legacy hash redirect behavior.
 */

import { test, expect } from './fixtures/server-fixture';

test.describe('Navigation', () => {
    test('default view is Repos tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        // Repos view should be visible (it is the implicit default — no tab button)
        await expect(page.locator('#view-repos')).toBeVisible();
        // URL hash should stay empty (no redirect to #repos)
        expect(new URL(page.url()).hash).toBe('');
        // Standalone Processes view is no longer rendered for any route
        await expect(page.locator('#view-processes')).toHaveCount(0);
    });

    test('clicking Skills tab switches to skills view', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        await page.click('[data-tab="skills"]');
        await expect(page.locator('#view-skills')).toBeVisible({ timeout: 10000 });
    });

    test('clicking Wiki tab switches to wiki view', async ({ page, serverUrl }) => {
        await page.goto(serverUrl + '#wiki');

        await expect(page.locator('#view-wiki')).toBeVisible();
    });

    test('can switch back to Repos from Skills', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        await page.click('[data-tab="skills"]');
        await expect(page.locator('#view-skills')).toBeVisible({ timeout: 10000 });

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
        await expect(page.locator('[data-tab="skills"]')).toBeVisible();
    });

    test('hash navigation works for tab routing', async ({ page, serverUrl }) => {
        // Navigate directly to repos tab via hash
        await page.goto(`${serverUrl}/#repos`);

        await expect(page.locator('[data-tab="repos"]')).toHaveClass(/active/);
        await expect(page.locator('#view-repos')).toBeVisible();
    });

    test('Skills tab navigation switches to Skills view', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        await page.click('[data-tab="skills"]');
        await expect(page.locator('#view-skills')).toBeVisible({ timeout: 10000 });
    });

    test('Memory tab navigation switches to Memory view', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        await page.click('[data-tab="memory"]');
        await expect(page.locator('#view-memory')).toBeVisible({ timeout: 10000 });
    });

    test('admin gear icon navigates to admin view', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        await page.click('#admin-toggle');
        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 10000 });
    });

    test('hamburger button toggles repo management popover open and closed', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        const hamburger = page.locator('#hamburger-btn');

        // Initially closed (popover not open)
        await expect(hamburger).toHaveAttribute('aria-pressed', 'false');

        // Click to open popover
        await hamburger.click();
        await expect(hamburger).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('[data-testid="repo-management-popover"]')).toBeVisible();

        // Click again to close popover
        await hamburger.click();
        await expect(hamburger).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('[data-testid="repo-management-popover"]')).toBeHidden();
    });

    test('hamburger button is noop when not on Repos tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        const hamburger = page.locator('#hamburger-btn');

        // Switch to Skills tab — hamburger should now navigate back to repos
        // rather than toggle the popover.
        await page.click('[data-tab="skills"]');
        await expect(page.locator('#view-skills')).toBeVisible({ timeout: 10000 });

        // Hamburger click should not toggle the popover open
        await expect(hamburger).toHaveAttribute('aria-pressed', 'false');
        await hamburger.click();
        await expect(hamburger).toHaveAttribute('aria-pressed', 'false');
    });

    test('popover state does not persist across page reload', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        const hamburger = page.locator('#hamburger-btn');

        // Open popover
        await hamburger.click();
        await expect(hamburger).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('[data-testid="repo-management-popover"]')).toBeVisible();

        // Reload — popover state is ephemeral, should start closed
        await page.reload();
        await expect(page.locator('#hamburger-btn')).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('[data-testid="repo-management-popover"]')).toBeHidden();
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

        await expect(page.locator('[data-tab="repos"]')).toHaveClass(/active/);
        await expect(page.locator('#view-repos')).toBeVisible();
    });

    test('legacy hash #process/:id falls back to Repos view', async ({ page, serverUrl }) => {
        // The standalone Processes view was removed. Legacy `#process/<id>`
        // links no longer match a top-level tab; the router falls through to
        // the default Repos view rather than navigating to a Processes panel.
        await page.goto(`${serverUrl}/#process/some-id`);

        await expect(page.locator('#view-repos')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('#view-processes')).toHaveCount(0);
    });
});
