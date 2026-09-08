/**
 * Mobile Navigation Tests — verify the scope bar and tab navigation at 375×812.
 *
 * On the Repos tab `MobileScopeBar` owns the row below the TopBar; the admin
 * destinations BottomNav used to show (Skills / Memory / Usage / Servers / Logs)
 * live in its `⋯` sheet. Every one of those destinations routes into the
 * fullscreen admin dialog, so the sheet is where they are reachable from.
 */
import { expect, test } from '../fixtures/server-fixture';
import { seedWorkspace } from '../fixtures/seed';
import { MOBILE } from './viewports';

test.use({ viewport: MOBILE, hasTouch: true });

/** Open the scope bar's `⋯` sheet from a freshly loaded Repos tab. */
async function openMoreSheet(page: any, serverUrl: string) {
    await page.goto(`${serverUrl}/#repos`);
    await expect(page.locator('[data-testid="mobile-scope-bar"]')).toBeVisible({ timeout: 10000 });
    await page.locator('[data-testid="mobile-scope-more-btn"]').tap();
    const sheet = page.locator('[data-testid="mobile-scope-more-sheet"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });
    return sheet;
}

test.describe('Mobile Navigation', () => {
    test('mobile: the repos tab shows the scope bar, not the bottom nav', async ({ page, serverUrl }) => {
        await page.goto(`${serverUrl}/#repos`);

        await expect(page.locator('[data-testid="mobile-scope-bar"]')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('[data-testid="bottom-nav"]')).toHaveCount(0);
    });

    test('mobile: the more sheet lists 5 destinations', async ({ page, serverUrl }) => {
        const sheet = await openMoreSheet(page, serverUrl);
        await expect(sheet.locator('button[data-tab]')).toHaveCount(5);
    });

    test('mobile: more-sheet destinations have correct labels', async ({ page, serverUrl }) => {
        const sheet = await openMoreSheet(page, serverUrl);

        for (const label of ['Skills', 'Memory', 'Usage', 'Servers', 'Logs']) {
            await expect(sheet.locator('button', { hasText: new RegExp(label, 'i') })).toBeVisible();
        }
    });

    test('mobile: TopBar tab bar is hidden', async ({ page, serverUrl }) => {
        await page.goto(`${serverUrl}/#repos`);
        await expect(page.locator('[data-testid="mobile-scope-bar"]')).toBeVisible({ timeout: 10000 });

        // Desktop tab bar should be hidden on mobile
        const tabBar = page.locator('#tab-bar');
        if (await tabBar.count() > 0) {
            await expect(tabBar).toBeHidden();
        }
    });

    test('mobile: tapping Skills in the more sheet switches view', async ({ page, serverUrl }) => {
        const sheet = await openMoreSheet(page, serverUrl);
        await sheet.locator('button[data-tab="skills"]').tap();

        await expect(page.locator('#view-skills')).toBeVisible({ timeout: 10000 });
        expect(page.url()).toContain('#skills');
    });

    test('mobile: tapping Memory in the more sheet switches view', async ({ page, serverUrl }) => {
        const sheet = await openMoreSheet(page, serverUrl);
        await sheet.locator('button[data-tab="memory"]').tap();

        await expect(page.locator('#view-memory')).toBeVisible({ timeout: 10000 });
    });

    test('mobile: navigating back to the repos view via hash', async ({ page, serverUrl }) => {
        const sheet = await openMoreSheet(page, serverUrl);
        await sheet.locator('button[data-tab="memory"]').tap();
        await expect(page.locator('#view-memory')).toBeVisible({ timeout: 10000 });

        // Repos is the default/home view; there is no Repos entry in the sheet.
        await page.goto(`${page.url().split('#')[0]}#repos`);
        await expect(page.locator('#view-repos')).toBeVisible();
        await expect(page.locator('[data-testid="mobile-scope-bar"]')).toBeVisible({ timeout: 10000 });
    });

    test('mobile: closing an admin destination returns to the repos tab and its scope bar', async ({ page, serverUrl }) => {
        const sheet = await openMoreSheet(page, serverUrl);
        await sheet.locator('button[data-tab="skills"]').tap();
        await expect(page.locator('#view-skills')).toBeVisible({ timeout: 10000 });

        // Skills / Memory / Usage / … are admin tool views, rendered inside the
        // admin dialog — fullscreen on mobile.
        await page.keyboard.press('Escape');
        await expect(page.locator('#admin-dialog')).toHaveCount(0);
        await expect(page.locator('[data-testid="mobile-scope-bar"]')).toBeVisible({ timeout: 10000 });
    });

    test('mobile: TopBar shows header', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        // TopBar header should exist
        const header = page.locator('header');
        await expect(header.first()).toBeVisible({ timeout: 10000 });
        // Hamburger button should be visible
        await expect(page.locator('#hamburger-btn')).toBeVisible();
    });

    test('mobile: no desktop tab bar visible', async ({ page, serverUrl }) => {
        await page.goto(`${serverUrl}/#repos`);
        await expect(page.locator('[data-testid="mobile-scope-bar"]')).toBeVisible({ timeout: 10000 });

        // Tab bar buttons should be hidden at mobile width
        const tabBarButtons = page.locator('#tab-bar button');
        if (await tabBarButtons.count() > 0) {
            // All buttons in tab-bar should be hidden
            for (let i = 0; i < await tabBarButtons.count(); i++) {
                await expect(tabBarButtons.nth(i)).toBeHidden();
            }
        }
    });

    test('mobile: admin panel renders at 375px with collapsed sidebar', async ({ page, serverUrl }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        await page.goto(`${serverUrl}/#admin`);
        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 10000 });

        // The Linear-inspired admin redesign hides the entire sidebar under
        // the 600px breakpoint and surfaces a mobile select for the top-level
        // tabs instead.
        await expect(page.locator('#view-admin .ar-mobile-tab-select')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('#view-admin .ar-sidebar')).toBeHidden();
    });

    test('mobile: scope bar hides when a repo is selected', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-mobile-hide-1', 'mobile-hide-repo', '/tmp/mobile-hide-repo');
        await page.goto(`${serverUrl}/#repos`);

        const scopeBar = page.locator('[data-testid="mobile-scope-bar"]');
        await expect(scopeBar).toBeVisible({ timeout: 10000 });

        // Select a repo — the workspace's own MobileTabBar takes the row.
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
        await page.locator('.repo-item').first().tap();

        await expect(scopeBar).toHaveCount(0, { timeout: 10000 });
    });
});
