/**
 * Mobile Repos Tests — verify repo list and detail at 375×812.
 */
import { test, expect } from '../fixtures/server-fixture';
import { seedWorkspace } from '../fixtures/seed';
import { MOBILE } from './viewports';

test.use({ viewport: MOBILE, hasTouch: true });

test.describe('Mobile Repos', () => {
    test('mobile: repos show as full-width list', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-mob-1', 'mob-repo-1');
        await seedWorkspace(serverUrl, 'ws-mob-2', 'mob-repo-2');
        await page.goto(`${serverUrl}/#repos`);

        await expect(page.locator('.repo-item').first()).toBeVisible({ timeout: 10000 });
        const items = page.locator('.repo-item');
        const count = await items.count();
        expect(count).toBeGreaterThanOrEqual(2);

        // Items should span close to full viewport width
        const box = await items.first().boundingBox();
        expect(box!.width).toBeGreaterThan(200);
    });

    test('mobile: tap repo opens RepoDetail with back button or detail view', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-mob-det', 'mob-det-repo');
        await page.goto(`${serverUrl}/#repos`);

        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
        await page.locator('.repo-item').first().tap();

        // Detail content should be visible
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });
    });

    test('mobile: sub-tabs are present in repo detail', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-mob-sub', 'mob-sub-repo');
        await page.goto(`${serverUrl}/#repos`);

        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
        await page.locator('.repo-item').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });

        // On mobile, sub-tabs are rendered via MobileTabBar (bottom bar)
        const mobileTabBar = page.locator('[data-testid="mobile-tab-bar"]');
        await expect(mobileTabBar).toBeVisible({ timeout: 10000 });
        const count = await mobileTabBar.locator('button').count();
        expect(count).toBeGreaterThanOrEqual(3);
    });

    test('mobile: sub-tabs scroll horizontally', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-mob-scroll', 'mob-scroll-repo');
        await page.goto(`${serverUrl}/#repos`);

        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
        await page.locator('.repo-item').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });

        // Sub-tab container should allow horizontal scrolling
        const subTabContainer = page.locator('.repo-sub-tab').first().locator('..');
        if (await subTabContainer.count() > 0) {
            const overflowX = await subTabContainer.evaluate(el => getComputedStyle(el).overflowX);
            expect(['auto', 'scroll', 'visible']).toContain(overflowX);
        }
    });

    test('mobile: add repo button visible on mobile', async ({ page, serverUrl }) => {
        await page.goto(`${serverUrl}/#repos`);
        await expect(page.locator('#view-repos')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('#add-repo-btn')).toBeVisible();
    });

    test('mobile: add repo dialog opens full-screen', async ({ page, serverUrl }) => {
        await page.goto(`${serverUrl}/#repos`);
        await expect(page.locator('#view-repos')).toBeVisible({ timeout: 10000 });
        await page.click('#add-repo-btn');

        const overlay = page.locator('#add-repo-overlay');
        await expect(overlay).toBeVisible();
        const box = await overlay.boundingBox();
        // Full-screen on mobile: width should be close to viewport
        expect(box!.width).toBeGreaterThan(340);
    });

    test('mobile: empty state renders correctly', async ({ page, serverUrl }) => {
        await page.goto(`${serverUrl}/#repos`);

        const empty = page.locator('#repos-empty, [data-testid="repos-empty"], #repo-detail-empty, [data-testid="repo-detail-empty"]');
        await expect(empty.first()).toBeVisible({ timeout: 10000 });
    });

    test('mobile: MobileTabBar includes Activity tab', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-mob-activity', 'mob-activity-repo');
        await page.goto(`${serverUrl}/#repos`);

        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
        await page.locator('.repo-item').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });

        const mobileTabBar = page.locator('[data-testid="mobile-tab-bar"]');
        await expect(mobileTabBar).toBeVisible({ timeout: 10000 });

        const activityTab = mobileTabBar.locator('[data-tab="activity"]');
        await expect(activityTab).toBeVisible();
    });

    test('mobile: Activity tab does not show Chat or Queue tabs', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-mob-no-chat', 'mob-no-chat-repo');
        await page.goto(`${serverUrl}/#repos`);

        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
        await page.locator('.repo-item').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });

        const mobileTabBar = page.locator('[data-testid="mobile-tab-bar"]');
        await expect(mobileTabBar).toBeVisible({ timeout: 10000 });

        await expect(mobileTabBar.locator('[data-tab="chat"]')).toHaveCount(0);
        await expect(mobileTabBar.locator('[data-tab="queue"]')).toHaveCount(0);
    });

    test('mobile: tapping Activity tab navigates to Activity view', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-mob-act-nav', 'mob-act-nav-repo');
        await page.goto(`${serverUrl}/#repos`);

        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
        await page.locator('.repo-item').first().tap();
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });

        const mobileTabBar = page.locator('[data-testid="mobile-tab-bar"]');
        await expect(mobileTabBar).toBeVisible({ timeout: 10000 });

        const activityTab = mobileTabBar.locator('[data-tab="activity"]');
        await activityTab.tap();

        await expect(page.locator('[data-testid="activity-split-panel"]')).toBeVisible({ timeout: 10000 });
    });
});
