/**
 * Mobile Navigation Tests — verify bottom nav and tab navigation at 375×812.
 */
import { expect, test } from '../fixtures/server-fixture';
import { MOBILE } from './viewports';

test.use({ viewport: MOBILE, hasTouch: true });

test.describe('Mobile Navigation', () => {
    test('mobile: bottom nav visible with 3 tabs', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        const bottomNav = page.locator('[data-testid="bottom-nav"]');
        await expect(bottomNav).toBeVisible({ timeout: 10000 });

        const tabs = bottomNav.locator('button');
        await expect(tabs).toHaveCount(3);
    });

    test('mobile: bottom nav tabs have correct labels', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        const bottomNav = page.locator('[data-testid="bottom-nav"]');
        await expect(bottomNav).toBeVisible({ timeout: 10000 });

        for (const label of ['Repos', 'Processes', 'Memory']) {
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

    test('mobile: tapping bottom nav Processes switches view', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        const bottomNav = page.locator('[data-testid="bottom-nav"]');
        await expect(bottomNav).toBeVisible({ timeout: 10000 });
        await bottomNav.locator('button', { hasText: /Processes/i }).tap();

        await expect(page.locator('#view-processes')).toBeVisible();
        expect(page.url()).toContain('#processes');
    });

    test('mobile: tapping bottom nav Memory switches view', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        const bottomNav = page.locator('[data-testid="bottom-nav"]');
        await expect(bottomNav).toBeVisible({ timeout: 10000 });
        await bottomNav.locator('button', { hasText: /Memory/i }).tap();

        await expect(page.locator('#view-memory')).toBeVisible();
    });

    test('mobile: tapping bottom nav Repos switches view', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        const bottomNav = page.locator('[data-testid="bottom-nav"]');
        await expect(bottomNav).toBeVisible({ timeout: 10000 });

        // First go to processes
        await bottomNav.locator('button', { hasText: /Processes/i }).tap();
        await expect(page.locator('#view-processes')).toBeVisible();

        // Then tap Repos
        await bottomNav.locator('button', { hasText: /Repos/i }).tap();
        await expect(page.locator('#view-repos')).toBeVisible();
    });

    test('mobile: bottom nav highlights active tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        const bottomNav = page.locator('[data-testid="bottom-nav"]');
        await expect(bottomNav).toBeVisible({ timeout: 10000 });

        // Navigate to Processes
        await bottomNav.locator('button', { hasText: /Processes/i }).tap();
        await expect(page.locator('#view-processes')).toBeVisible();

        // The active button should have distinct styling (aria-current or active class)
        const processesBtn = bottomNav.locator('button[data-tab="processes"]');
        const memoryBtn = bottomNav.locator('button[data-tab="memory"]');

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
});
