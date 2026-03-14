/**
 * Desktop Regression Tests — verify the desktop experience at 1280×800
 * is unchanged by the responsive commits.
 */
import { test, expect } from '../fixtures/server-fixture';
import { seedWorkspace, seedQueueTask, seedQueueTasks } from '../fixtures/seed';
import { createWikiFixture } from '../fixtures/wiki-fixtures';
import { DESKTOP } from './viewports';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

test.use({ viewport: DESKTOP });

test.describe('Desktop Regression', () => {
    test('desktop: ProcessesView shows sidebar and detail side-by-side', async ({ page, serverUrl }) => {
        await seedQueueTasks(serverUrl, [
            { type: 'chat', displayName: 'T1' },
            { type: 'chat', displayName: 'T2' },
            { type: 'chat', displayName: 'T3' },
        ]);
        await page.goto(`${serverUrl}/#processes`);

        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 10000 });

        // ActivityListPane (left panel) should be visible
        const listPane = page.locator('[data-testid="activity-split-panel"]');
        await expect(listPane).toBeVisible();

        // Detail pane should also be visible
        const detail = page.locator('[data-testid="activity-detail-panel"]');
        await expect(detail.first()).toBeVisible();
    });

    test('desktop: ProcessesView sidebar + detail are both visible', async ({ page, serverUrl }) => {
        await seedQueueTask(serverUrl, { type: 'chat', displayName: 'Desktop Detail' });
        await page.goto(`${serverUrl}/#processes`);

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

    test('desktop: TopBar shows text tab labels', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        for (const tab of ['processes', 'memory']) {
            const tabBtn = page.locator(`[data-tab="${tab}"]`);
            await expect(tabBtn).toBeVisible();
        }
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

    test('desktop: tab navigation works across all tabs', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        await page.goto(`${serverUrl}/#repos`);
        await expect(page.locator('#view-repos')).toBeVisible();

        await page.click('[data-tab="processes"]');
        await expect(page.locator('#view-processes')).toBeVisible();

        await page.click('[data-tab="memory"]');
        await expect(page.locator('#view-memory')).toBeVisible();
    });

    test('desktop: deep links resolve correctly', async ({ page, serverUrl }) => {
        await page.goto(`${serverUrl}/#repos`);
        await expect(page.locator('#view-repos')).toBeVisible({ timeout: 10000 });

        await page.goto(`${serverUrl}/#processes`);
        await expect(page.locator('#view-processes')).toBeVisible({ timeout: 10000 });

        await page.goto(`${serverUrl}/#memory`);
        await expect(page.locator('#view-memory')).toBeVisible({ timeout: 10000 });
    });

    test('desktop: admin panel renders', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('#admin-toggle');

        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#admin-stat-processes')).toBeVisible();
        await expect(page.locator('#admin-stat-wikis')).toBeVisible();
        await expect(page.locator('#admin-stat-disk')).toBeVisible();

        // Stat cards should be in a grid (same row — similar y positions)
        const procBox = await page.locator('#admin-stat-processes').boundingBox();
        const wikiBox = await page.locator('#admin-stat-wikis').boundingBox();
        const diskBox = await page.locator('#admin-stat-disk').boundingBox();
        expect(Math.abs(procBox!.y - wikiBox!.y)).toBeLessThan(10);
        expect(Math.abs(wikiBox!.y - diskBox!.y)).toBeLessThan(10);
    });
});
