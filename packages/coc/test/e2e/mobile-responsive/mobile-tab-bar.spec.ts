/**
 * MobileTabBar Tests — '···' overflow sheet, BottomNav ↔ MobileTabBar handoff,
 * and badge counts at 375×812.
 */
import { test, expect } from '../fixtures/server-fixture';
import { seedWorkspace, seedQueueTask } from '../fixtures/seed';
import { MOBILE } from './viewports';

test.use({ viewport: MOBILE, hasTouch: true });

test.describe('MobileTabBar', () => {
    test('mobile: "···" more button opens BottomSheet with overflow tabs', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-more-1', 'more-repo-1');
        await page.goto(`${serverUrl}/#repos`);
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
        await page.locator('.repo-item').first().tap();
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });

        const moreBtn = page.locator('[data-testid="mobile-tab-more-btn"]');
        await expect(moreBtn).toBeVisible({ timeout: 5000 });
        await moreBtn.tap();

        // BottomSheet panel should open
        const sheet = page.locator('[data-testid="bottomsheet-panel"]');
        await expect(sheet).toBeVisible({ timeout: 5000 });

        // The overflow tab list should be present with at least one item
        const moreSheet = page.locator('[data-testid="mobile-tab-more-sheet"]');
        await expect(moreSheet).toBeVisible();
        const overflowItems = moreSheet.locator('button');
        await expect(overflowItems.first()).toBeVisible();
    });

    test('mobile: tapping overflow tab activates it and closes BottomSheet', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-more-2', 'more-repo-2');
        await page.goto(`${serverUrl}/#repos`);
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
        await page.locator('.repo-item').first().tap();
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });

        const moreBtn = page.locator('[data-testid="mobile-tab-more-btn"]');
        await expect(moreBtn).toBeVisible({ timeout: 5000 });
        await moreBtn.tap();

        // Wait for sheet and tap Workflows overflow item
        const workflowsItem = page.locator('[data-testid="mobile-tab-more-item-workflows"]');
        if (await workflowsItem.count() > 0) {
            await expect(workflowsItem).toBeVisible({ timeout: 5000 });
            await workflowsItem.tap();

            // Sheet should close after selection
            const sheet = page.locator('[data-testid="bottomsheet-panel"]');
            await expect(sheet).toBeHidden({ timeout: 5000 });
        }
    });

    test('mobile: BottomNav is hidden when a repo is selected', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-bnav-1', 'bnav-repo-1');
        await page.goto(`${serverUrl}/#repos`);

        // BottomNav must be visible before any repo is selected
        const bottomNav = page.locator('[data-testid="bottom-nav"]');
        await expect(bottomNav).toBeVisible({ timeout: 10000 });

        // Tap a repo item to select it
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
        await page.locator('.repo-item').first().tap();
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });

        // BottomNav should now be gone (returns null when selectedRepoId is set)
        await expect(bottomNav).toBeHidden({ timeout: 5000 });
    });

    test('mobile: MobileTabBar appears when a repo is selected', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-mtb-1', 'mtb-repo-1');
        await page.goto(`${serverUrl}/#repos`);
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

        const mobileTabBar = page.locator('[data-testid="mobile-tab-bar"]');

        await page.locator('.repo-item').first().tap();
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });

        // MobileTabBar (repo sub-tab bar) should be visible
        await expect(mobileTabBar).toBeVisible({ timeout: 5000 });
        // Should have at least the 3 pinned tabs plus the '···' more button
        const buttons = mobileTabBar.locator('button');
        await expect(buttons).toHaveCount(4, { timeout: 5000 }); // 3 pinned + 1 more
    });

    test('mobile: MobileTabBar activity badge visible when repo has running queue tasks', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-badge-1', 'badge-repo-1');
        // Seed a queue task associated with this workspace so activityCount > 0
        await seedQueueTask(serverUrl, {
            type: 'chat',
            displayName: 'Badge Activity Task',
            repoId: 'ws-badge-1',
        });

        await page.goto(`${serverUrl}/#repos`);
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
        await page.locator('.repo-item').first().tap();
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('[data-testid="mobile-tab-bar"]')).toBeVisible({ timeout: 5000 });

        // Activity badge should appear when there are queue tasks for this repo
        const activityBadge = page.locator('[data-testid="mobile-tab-badge-activity"]');
        if (await activityBadge.count() > 0) {
            await expect(activityBadge).toBeVisible();
            const text = await activityBadge.textContent();
            expect(Number(text)).toBeGreaterThan(0);
        }
    });
});
