/**
 * Desktop Regression Tests — verify the desktop experience at 1280×800
 * is unchanged by the responsive commits.
 */
import { test, expect } from '../fixtures/server-fixture';
import { seedWorkspace, seedQueueTask, seedQueueTasks } from '../fixtures/seed';
import { DESKTOP } from './viewports';

test.use({ viewport: DESKTOP });

test.describe('Desktop Regression', () => {
    test('desktop: per-repo activity shows sidebar and detail side-by-side', async ({ page, serverUrl }) => {
        const wsId = 'ws-desk-act-1';
        await seedWorkspace(serverUrl, wsId, 'desk-act-repo-1');
        await seedQueueTasks(serverUrl, [
            { type: 'chat', displayName: 'T1', repoId: wsId },
            { type: 'chat', displayName: 'T2', repoId: wsId },
            { type: 'chat', displayName: 'T3', repoId: wsId },
        ]);
        await page.goto(`${serverUrl}/#repos/${wsId}/activity`);

        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 10000 });

        // ChatListPane (left panel) should be visible
        const splitPanel = page.locator('[data-testid="activity-split-panel"]');
        await expect(splitPanel).toBeVisible();

        // Detail pane should also be visible
        const detail = page.locator('[data-testid="activity-detail-panel"]');
        await expect(detail.first()).toBeVisible();
    });

    test('desktop: per-repo activity sidebar + detail are both visible', async ({ page, serverUrl }) => {
        const wsId = 'ws-desk-act-2';
        await seedWorkspace(serverUrl, wsId, 'desk-act-repo-2');
        await seedQueueTask(serverUrl, { type: 'chat', displayName: 'Desktop Detail', repoId: wsId });
        await page.goto(`${serverUrl}/#repos/${wsId}/activity`);

        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 10000 });
        await page.locator('[data-task-id]').first().click();

        const detail = page.locator('[data-testid="activity-chat-detail"]');
        await expect(detail).toBeVisible({ timeout: 8000 });
    });

    test('desktop: ReposView shows RepoTabStrip and repo tabs', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-desk-1', 'desk-repo');
        await page.goto(`${serverUrl}/#repos`);

        // RepoTabStrip should be visible in TopBar with repo tabs
        await expect(page.locator('[data-testid="repo-tab-strip"]')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10000 });
    });

    test('desktop: hamburger opens RepoManagementPopover', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-desk-col', 'desk-col-repo');
        await page.goto(`${serverUrl}/#repos`);

        // Hamburger opens the repo management popup
        await page.click('#hamburger-btn');
        await expect(page.locator('[data-testid="repo-management-popover"]')).toBeVisible({ timeout: 10000 });

        // Close popup with Escape
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-testid="repo-management-popover"]')).toBeHidden();
    });

    test('desktop: ReposView two-pane layout with repo selected', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-desk-2p', 'desk-2p-repo');
        await page.goto(`${serverUrl}/#repos`);

        // Select repo via RepoTabStrip
        await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10000 });
        await page.locator('[data-testid="repo-tab"]').first().click();

        await expect(page.locator('#repo-detail-content')).toBeVisible();
    });

    test('desktop: TopBar shows available navigation entries', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        // Memory remains directly routable, but its topbar icon is hidden by default.
        await expect(page.locator('[data-tab="memory"]')).toHaveCount(0);
        // Skills lives inside the Tools dropdown — open it first.
        await page.click('#tools-toggle');
        await expect(page.locator('#tools-popover')).toBeVisible();
        await expect(page.locator('[data-tab="skills"]')).toBeVisible();

        // repos tab link is visible as the brand name
        await expect(page.locator('[data-tab="repos"]')).toBeVisible();

        // No bottom navigation at desktop
        const bottomNav = page.locator('[data-testid="bottom-nav"]');
        if (await bottomNav.count() > 0) {
            await expect(bottomNav).toBeHidden();
        }
    });

    test('desktop: no bottom navigation visible', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        const bottomNav = page.locator('[data-testid="bottom-nav"]');
        if (await bottomNav.count() > 0) {
            await expect(bottomNav).toBeHidden();
        }
    });

    test('desktop: dialog renders as centered modal, not full-screen', async ({ page, serverUrl }) => {
        await page.goto(`${serverUrl}/#repos`);
        await expect(page.locator('#view-repos')).toBeVisible();
        // Open hamburger to access ReposGrid
        await page.click('#hamburger-btn');
        await expect(page.locator('[data-testid="repo-management-popover"]')).toBeVisible();
        await page.click('#add-repo-btn');
        await page.locator('[data-testid="add-single-repo-item"]').dispatchEvent('click');

        const overlay = page.locator('#add-repo-overlay');
        await expect(overlay).toBeVisible();

        // The overlay is full-viewport; the inner panel is the centered dialog
        // Check that the overlay uses flex centering (not fullscreen mobile style)
        await expect(overlay).toHaveClass(/flex/);
        await expect(overlay).toHaveClass(/items-center/);

        // The dialog panel inside should be narrower than viewport
        const panel = overlay.locator('> div').first();
        const panelBox = await panel.boundingBox();
        expect(panelBox!.width).toBeLessThan(1280);
    });

    test('desktop: tab navigation works across available tabs', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        await page.goto(`${serverUrl}/#repos`);
        await expect(page.locator('#view-repos')).toBeVisible();

        // The global `processes` tab was removed; memory remains directly routable.
        await page.goto(`${serverUrl}/#memory`);
        await expect(page.locator('#view-memory')).toBeVisible();

        // Skills lives inside the Tools dropdown.
        await page.click('#tools-toggle');
        await expect(page.locator('#tools-popover')).toBeVisible();
        await page.click('[data-tab="skills"]');
        await expect(page.locator('#view-skills')).toBeVisible();
    });

    test('desktop: deep links resolve correctly', async ({ page, serverUrl }) => {
        await page.goto(`${serverUrl}/#repos`);
        await expect(page.locator('#view-repos')).toBeVisible({ timeout: 10000 });

        // The global `#processes` route was removed; verify other routes still resolve.
        await page.goto(`${serverUrl}/#memory`);
        await expect(page.locator('#view-memory')).toBeVisible({ timeout: 10000 });

        await page.goto(`${serverUrl}/#skills`);
        await expect(page.locator('#view-skills')).toBeVisible({ timeout: 10000 });
    });

    test('desktop: admin panel renders', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('#admin-toggle');

        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('[data-testid="stat-processes"]')).toBeVisible();
        await expect(page.locator('[data-testid="stat-wikis"]')).toBeVisible();
        await expect(page.locator('[data-testid="stat-disk"]')).toBeVisible();

        // Sidebar usage block stacks the stats vertically (Linear-inspired admin
        // redesign). Each subsequent stat must sit below the previous one.
        const procBox = await page.locator('[data-testid="stat-processes"]').boundingBox();
        const wikiBox = await page.locator('[data-testid="stat-wikis"]').boundingBox();
        const diskBox = await page.locator('[data-testid="stat-disk"]').boundingBox();
        expect(procBox && wikiBox && diskBox).toBeTruthy();
        expect(wikiBox!.y).toBeGreaterThanOrEqual(procBox!.y);
        expect(diskBox!.y).toBeGreaterThanOrEqual(wikiBox!.y);
    });
});
