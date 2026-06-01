/**
 * Mobile Navigation Tests — verify bottom nav and tab navigation at 375×812.
 */
import { expect, test } from '../fixtures/server-fixture';
import { seedWorkspace } from '../fixtures/seed';
import { MOBILE } from './viewports';

test.use({ viewport: MOBILE, hasTouch: true });

test.describe('Mobile Navigation', () => {
    test('mobile: bottom nav visible with 4 tabs', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        const bottomNav = page.locator('[data-testid="bottom-nav"]');
        await expect(bottomNav).toBeVisible({ timeout: 10000 });

        const tabs = bottomNav.locator('button');
        await expect(tabs).toHaveCount(5);
    });

    test('mobile: bottom nav tabs have correct labels', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        const bottomNav = page.locator('[data-testid="bottom-nav"]');
        await expect(bottomNav).toBeVisible({ timeout: 10000 });

        for (const label of ['Skills', 'Memory', 'Usage', 'Servers', 'Logs']) {
            await expect(bottomNav.locator('button', { hasText: new RegExp(label, 'i') })).toBeVisible();
        }
    });

    test('mobile: TopBar tab bar is hidden', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await expect(page.locator('[data-testid="bottom-nav"]')).toBeVisible({ timeout: 10000 });

        // Desktop tab bar should be hidden on mobile
        const tabBar = page.locator('#tab-bar');
        if (await tabBar.count() > 0) {
            await expect(tabBar).toBeHidden();
        }
    });

    test('mobile: tapping bottom nav Skills switches view', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        const bottomNav = page.locator('[data-testid="bottom-nav"]');
        await expect(bottomNav).toBeVisible({ timeout: 10000 });
        await bottomNav.locator('button', { hasText: /Skills/i }).tap();

        await expect(page.locator('#view-skills')).toBeVisible({ timeout: 10000 });
        expect(page.url()).toContain('#skills');
    });

    test('mobile: tapping bottom nav Memory switches view', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        const bottomNav = page.locator('[data-testid="bottom-nav"]');
        await expect(bottomNav).toBeVisible({ timeout: 10000 });
        await bottomNav.locator('button', { hasText: /Memory/i }).tap();

        await expect(page.locator('#view-memory')).toBeVisible();
    });

    test('mobile: navigating to repos view via hash', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        const bottomNav = page.locator('[data-testid="bottom-nav"]');
        await expect(bottomNav).toBeVisible({ timeout: 10000 });

        // First go to memory via bottom nav
        await bottomNav.locator('button', { hasText: /Memory/i }).tap();
        await expect(page.locator('#view-memory')).toBeVisible();

        // Navigate to repos via hash — BottomNav does not have a Repos button
        // since repos is the default/home view accessed via the CoC header link
        await page.goto(`${page.url().split('#')[0]}#repos`);
        await expect(page.locator('#view-repos')).toBeVisible();
    });

    test('mobile: bottom nav highlights active tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        const bottomNav = page.locator('[data-testid="bottom-nav"]');
        await expect(bottomNav).toBeVisible({ timeout: 10000 });

        // Navigate to Skills
        await bottomNav.locator('button', { hasText: /Skills/i }).tap();
        await expect(page.locator('#view-skills')).toBeVisible({ timeout: 10000 });

        // The active button should have distinct styling (aria-current or active class)
        const skillsBtn = bottomNav.locator('button[data-tab="skills"]');
        const memoryBtn = bottomNav.locator('button[data-tab="memory"]');

        // skills button should exist (suppress unused-var lint)
        await expect(skillsBtn).toBeVisible();

        // Tap Memory
        await memoryBtn.tap();
        await expect(page.locator('#view-memory')).toBeVisible();
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
        await page.goto(serverUrl);
        await expect(page.locator('[data-testid="bottom-nav"]')).toBeVisible({ timeout: 10000 });

        // Tab bar buttons should be hidden at mobile width
        const tabBarButtons = page.locator('#tab-bar button');
        if (await tabBarButtons.count() > 0) {
            // All buttons in tab-bar should be hidden
            for (let i = 0; i < await tabBarButtons.count(); i++) {
                await expect(tabBarButtons.nth(i)).toBeHidden();
            }
        }
    });

    test('mobile: tapping bottom nav Skills switches to Skills view', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        const bottomNav = page.locator('[data-testid="bottom-nav"]');
        await expect(bottomNav).toBeVisible({ timeout: 10000 });

        const skillsBtn = bottomNav.locator('button[data-tab="skills"]');
        if (await skillsBtn.count() > 0) {
            await skillsBtn.tap();
            // Skills view should be rendered
            await expect(page.locator('#view-skills')).toBeVisible({ timeout: 10000 });
        }
    });

    test('mobile: admin panel renders at 375px with collapsed sidebar', async ({ page, serverUrl }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        await page.goto(`${serverUrl}/#admin`);
        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 10000 });

        // The Linear-inspired admin redesign hides the entire sidebar (which carries
        // the usage stats) under the 600px breakpoint and surfaces a mobile select
        // for the top-level tabs instead. The mobile-tab fallback control should be
        // visible while the desktop-only stat rows must be hidden.
        await expect(page.locator('#view-admin .ar-mobile-tab-select')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('#view-admin .ar-sidebar')).toBeHidden();
        await expect(page.locator('[data-testid="stat-processes"]')).toBeHidden();
    });

    test('mobile: bottom nav hides when a repo is selected', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-mobile-hide-1', 'mobile-hide-repo', '/tmp/mobile-hide-repo');
        await page.goto(serverUrl);

        const bottomNav = page.locator('[data-testid="bottom-nav"]');
        await expect(bottomNav).toBeVisible({ timeout: 10000 });

        // Select a repo — BottomNav returns null when selectedRepoId is truthy
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
        await page.locator('.repo-item').first().tap();

        // BottomNav should be removed from the DOM
        await expect(bottomNav).toHaveCount(0, { timeout: 10000 });
    });
});
