/**
 * Context Menu E2E Tests (014)
 *
 * Tests right-click context menus on files and folders, and dismiss behavior.
 *
 * Depends on createRepoFixture + createTasksFixture for on-disk task files.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { createRepoFixture, createTasksFixture } from './fixtures/repo-fixtures';

/** Helper: create a repo with tasks, seed it as a workspace, navigate to Tasks sub-tab. */
async function setupRepoWithTasks(
    page: import('@playwright/test').Page,
    serverUrl: string,
    tmpDir: string,
    wsId = 'ws-ctxmenu',
): Promise<string> {
    const repoDir = createRepoFixture(tmpDir);
    createTasksFixture(repoDir);

    await seedWorkspace(serverUrl, wsId, 'ctxmenu-repo', repoDir);

    await page.goto(serverUrl);
    await page.click('[data-tab="repos"]');
    await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

    // Select repo
    await page.locator('.repo-item').first().click();
    await expect(page.locator('#repo-detail-content')).toBeVisible();

    // Switch to Tasks sub-tab
    await page.click('.repo-sub-tab[data-subtab="tasks"]');
    await expect(page.locator('.repo-sub-tab[data-subtab="tasks"]')).toHaveClass(/active/);

    // Wait for miller columns to render
    await expect(page.locator('.miller-columns')).toBeVisible({ timeout: 10000 });

    return repoDir;
}

test.describe('Context Menu (014)', () => {

    test('14.1 right-click file shows context menu with Rename, Delete, Archive, Change Status', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ctxmenu-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir);

            // Right-click on task-a file row
            const taskRow = page.locator('.miller-file-row', { hasText: 'task-a' });
            await expect(taskRow).toBeVisible();
            await taskRow.click({ button: 'right' });

            // Context menu should appear
            const menu = page.locator('#task-context-menu');
            await expect(menu).toBeVisible({ timeout: 5000 });

            // Verify file context menu items: Rename, Delete, Archive, Change Status
            await expect(page.locator('[data-ctx-action="rename-task"]')).toBeVisible();
            await expect(page.locator('[data-ctx-action="delete-task"]')).toBeVisible();
            await expect(page.locator('[data-ctx-action="archive-task"]')).toBeVisible();
            await expect(page.locator('.task-context-menu-item.has-submenu')).toBeVisible(); // Change Status submenu
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('14.2 right-click folder shows folder menu with Rename, Delete but no Change Status', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ctxmenu-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir);

            // Right-click on "backlog" folder row
            const folderRow = page.locator('.miller-row[data-nav-folder]', { hasText: 'backlog' });
            await expect(folderRow).toBeVisible();
            await folderRow.click({ button: 'right' });

            // Context menu should appear
            const menu = page.locator('#task-context-menu');
            await expect(menu).toBeVisible({ timeout: 5000 });

            // Verify folder context menu items: Rename Folder, Delete Folder
            await expect(page.locator('[data-ctx-action="rename-folder"]')).toBeVisible();
            await expect(page.locator('[data-ctx-action="delete-folder"]')).toBeVisible();

            // Change Status submenu should NOT be present in folder menu
            await expect(page.locator('.task-context-menu-item.has-submenu')).toHaveCount(0);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('14.3 click outside dismisses context menu', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ctxmenu-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir);

            // Open context menu by right-clicking a file row
            const taskRow = page.locator('.miller-file-row', { hasText: 'task-a' });
            await expect(taskRow).toBeVisible();
            await taskRow.click({ button: 'right' });

            // Context menu should be visible
            const menu = page.locator('#task-context-menu');
            await expect(menu).toBeVisible({ timeout: 5000 });

            // Click on the miller columns area (outside the menu) to dismiss
            await page.locator('.miller-columns').click({ position: { x: 5, y: 5 } });

            // Menu should disappear
            await expect(menu).toHaveCount(0, { timeout: 5000 });
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
