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

    test('desktop: ReposView shows sidebar', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-desk-1', 'desk-repo');
        await page.goto(`${serverUrl}/#repos`);

        const sidebar = page.locator('#repos-sidebar');
        await expect(sidebar).toBeVisible({ timeout: 10000 });
        const box = await sidebar.boundingBox();
        // Expanded sidebar should be wider than collapsed 48px
        expect(box!.width).toBeGreaterThan(100);
    });

    test('desktop: ReposView sidebar collapses to mini sidebar', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-desk-col', 'desk-col-repo');
        await page.goto(`${serverUrl}/#repos`);

        // Ensure repos tab is active (hamburger only works on repos tab)
        await page.click('[data-tab="repos"]');
        await expect(page.locator('#repos-sidebar')).toBeVisible({ timeout: 10000 });

        // Get expanded width before collapsing
        const expandedBox = await page.locator('#repos-sidebar').boundingBox();

        await page.click('#hamburger-btn');

        // Wait for CSS transition (150ms)
        await page.waitForTimeout(300);

        const sidebar = page.locator('#repos-sidebar');
        await expect(sidebar).toBeVisible();
        // Collapsed sidebar should have w-44 class (MiniReposSidebar)
        await expect(sidebar).toHaveClass(/w-44/);
        // Collapsed sidebar should be narrower than expanded
        const collapsedBox = await sidebar.boundingBox();
        expect(collapsedBox!.width).toBeLessThan(expandedBox!.width);
    });

    test('desktop: ReposView two-pane layout with repo selected', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-desk-2p', 'desk-2p-repo');
        await page.goto(`${serverUrl}/#repos`);

        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
        await page.locator('.repo-item').first().click();

        await expect(page.locator('#repos-sidebar')).toBeVisible();
        await expect(page.locator('#repo-detail-content')).toBeVisible();
    });

    test('desktop: TopBar shows text tab labels', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        for (const tab of ['repos', 'processes', 'memory']) {
            const tabBtn = page.locator(`[data-tab="${tab}"]`);
            await expect(tabBtn).toBeVisible();
        }

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
        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
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

        await page.click('[data-tab="repos"]');
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
