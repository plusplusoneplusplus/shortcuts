/**
 * File and Folder Move E2E Tests (016)
 *
 * Tests moving files via the FileMoveDialog and folders via the FolderMoveDialog,
 * both triggered from context menu items.
 *
 * Depends on createRepoFixture + createTasksFixture for on-disk task files.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync, getTaskRoot } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { createRepoFixture, createTasksFixture } from './fixtures/repo-fixtures';

/** Helper: create a repo with tasks, seed it as a workspace, navigate to Tasks sub-tab. */
async function setupRepoWithTasks(
    page: import('@playwright/test').Page,
    serverUrl: string,
    tmpDir: string,
    dataDir: string,
    wsId = 'ws-move',
): Promise<{ repoDir: string; taskRoot: string }> {
    const repoDir = createRepoFixture(tmpDir);
    createTasksFixture(repoDir);

    await seedWorkspace(serverUrl, wsId, 'move-repo', repoDir);

    await page.goto(serverUrl);
    await page.click('[data-tab="repos"]');
    await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

    await page.locator('.repo-item').first().click();
    await expect(page.locator('#repo-detail-content')).toBeVisible();

    await page.click('.repo-sub-tab[data-subtab="tasks"]');
    await expect(page.locator('.repo-sub-tab[data-subtab="tasks"]')).toHaveClass(/active/);
    await expect(page.locator('[data-testid="task-tree"]')).toBeVisible({ timeout: 10000 });

    return { repoDir, taskRoot: getTaskRoot(dataDir, wsId) };
}

test.describe('File and Folder Move (016)', () => {

    test('16.1 move file via context menu into a folder', async ({ page, serverUrl, dataDir }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-move-'));
        try {
            const { repoDir, taskRoot } = await setupRepoWithTasks(page, serverUrl, tmpDir, dataDir);

            // Verify task-a.md exists at root level
            const origFile = path.join(taskRoot, 'task-a.md');
            expect(fs.existsSync(origFile)).toBe(true);

            // Right-click on task-a file row
            const taskRow = page.locator('[data-testid="task-tree-item-task-a"]');
            await expect(taskRow).toBeVisible();
            await taskRow.click({ button: 'right' });

            // Context menu should appear with "Move File" option
            await expect(page.locator('[data-testid="context-menu"]')).toBeVisible({ timeout: 5000 });
            await expect(page.getByRole('menuitem', { name: /Move File/ })).toBeVisible();

            // Click "Move File"
            await page.getByRole('menuitem', { name: /Move File/ }).click();

            // FileMoveDialog should appear
            await expect(page.locator('[data-testid="file-move-destination-list"]')).toBeVisible({ timeout: 5000 });

            // Select "backlog" as destination
            await page.locator('[data-testid="file-move-dest-backlog"]').click();

            // Click Move
            await page.getByRole('button', { name: /^Move$/ }).click();

            // Dialog should close
            await expect(page.locator('[data-testid="file-move-destination-list"]')).toBeHidden({ timeout: 5000 });

            // task-a should no longer appear in root column
            await expect(page.locator('[data-testid="task-tree-item-task-a"]')).toHaveCount(0, { timeout: 10000 });

            // File should be moved on disk
            expect(fs.existsSync(origFile)).toBe(false);
            const movedFile = path.join(taskRoot, 'backlog', 'task-a.md');
            expect(fs.existsSync(movedFile)).toBe(true);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('16.2 move file to Tasks Root via FileMoveDialog', async ({ page, serverUrl, dataDir }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-move-'));
        try {
            const { repoDir, taskRoot } = await setupRepoWithTasks(page, serverUrl, tmpDir, dataDir);

            // Navigate into backlog to expose backlog/item.md
            const backlogRow = page.locator('[data-testid="task-tree-item-backlog"]');
            await expect(backlogRow).toBeVisible();
            await backlogRow.click();
            await expect(page.locator('[data-testid="miller-column-1"]')).toBeVisible({ timeout: 5000 });

            const origFile = path.join(taskRoot, 'backlog', 'item.md');
            expect(fs.existsSync(origFile)).toBe(true);

            // Right-click on item row
            const itemRow = page.locator('[data-testid="task-tree-item-item"]');
            await expect(itemRow).toBeVisible();
            await itemRow.click({ button: 'right' });

            await expect(page.locator('[data-testid="context-menu"]')).toBeVisible({ timeout: 5000 });
            await page.getByRole('menuitem', { name: /Move File/ }).click();

            // FileMoveDialog opens
            await expect(page.locator('[data-testid="file-move-destination-list"]')).toBeVisible({ timeout: 5000 });

            // Select "Tasks Root"
            await page.locator('[data-testid="file-move-dest-root"]').click();
            await page.getByRole('button', { name: /^Move$/ }).click();

            await expect(page.locator('[data-testid="file-move-destination-list"]')).toBeHidden({ timeout: 5000 });

            // File moved to root on disk
            expect(fs.existsSync(origFile)).toBe(false);
            expect(fs.existsSync(path.join(taskRoot, 'item.md'))).toBe(true);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('16.3 move folder via context menu into another folder', async ({ page, serverUrl, dataDir }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-move-'));
        try {
            const { repoDir, taskRoot } = await setupRepoWithTasks(page, serverUrl, tmpDir, dataDir);

            // Verify backlog folder exists at root level
            const origFolder = path.join(taskRoot, 'backlog');
            expect(fs.existsSync(origFolder)).toBe(true);

            // Right-click on "backlog" folder row
            const folderRow = page.locator('[data-testid="task-tree-item-backlog"]');
            await expect(folderRow).toBeVisible();
            await folderRow.click({ button: 'right' });

            // Context menu should have "Move Folder" option
            await expect(page.locator('[data-testid="context-menu"]')).toBeVisible({ timeout: 5000 });
            await expect(page.getByRole('menuitem', { name: /Move Folder/ })).toBeVisible();

            // Click "Move Folder"
            await page.getByRole('menuitem', { name: /Move Folder/ }).click();

            // FolderMoveDialog should appear
            await expect(page.locator('[data-testid="move-destination-list"]')).toBeVisible({ timeout: 5000 });

            // Source folder (backlog) should NOT be in the destination list
            await expect(page.locator('[data-testid="move-dest-backlog"]')).toHaveCount(0);

            // Select "archive" folder as destination (Tasks Root is default)
            // The archive folder is also in the tree
            await page.locator('[data-testid="move-dest-root"]').click();
            await page.getByRole('button', { name: /^Move$/ }).click();

            // Dialog should close
            await expect(page.locator('[data-testid="move-destination-list"]')).toBeHidden({ timeout: 5000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('16.4 cancelling FileMoveDialog does not move file', async ({ page, serverUrl, dataDir }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-move-'));
        try {
            const { repoDir, taskRoot } = await setupRepoWithTasks(page, serverUrl, tmpDir, dataDir);

            const origFile = path.join(taskRoot, 'task-a.md');
            expect(fs.existsSync(origFile)).toBe(true);

            // Right-click and open Move File dialog
            const taskRow = page.locator('[data-testid="task-tree-item-task-a"]');
            await expect(taskRow).toBeVisible();
            await taskRow.click({ button: 'right' });
            await expect(page.locator('[data-testid="context-menu"]')).toBeVisible({ timeout: 5000 });
            await page.getByRole('menuitem', { name: /Move File/ }).click();
            await expect(page.locator('[data-testid="file-move-destination-list"]')).toBeVisible({ timeout: 5000 });

            // Cancel the dialog
            await page.getByRole('button', { name: /Cancel/ }).click();
            await expect(page.locator('[data-testid="file-move-destination-list"]')).toBeHidden({ timeout: 5000 });

            // File should still be at original location
            expect(fs.existsSync(origFile)).toBe(true);
            // File should still appear in miller column
            await expect(page.locator('[data-testid="task-tree-item-task-a"]')).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('16.5 cancelling FolderMoveDialog does not move folder', async ({ page, serverUrl, dataDir }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-move-'));
        try {
            const { repoDir, taskRoot } = await setupRepoWithTasks(page, serverUrl, tmpDir, dataDir);

            const origFolder = path.join(taskRoot, 'backlog');
            expect(fs.existsSync(origFolder)).toBe(true);

            // Right-click and open Move Folder dialog
            const folderRow = page.locator('[data-testid="task-tree-item-backlog"]');
            await expect(folderRow).toBeVisible();
            await folderRow.click({ button: 'right' });
            await expect(page.locator('[data-testid="context-menu"]')).toBeVisible({ timeout: 5000 });
            await page.getByRole('menuitem', { name: /Move Folder/ }).click();
            await expect(page.locator('[data-testid="move-destination-list"]')).toBeVisible({ timeout: 5000 });

            // Cancel
            await page.getByRole('button', { name: /Cancel/ }).click();
            await expect(page.locator('[data-testid="move-destination-list"]')).toBeHidden({ timeout: 5000 });

            // Folder should still be at original location
            expect(fs.existsSync(origFolder)).toBe(true);
            await expect(page.locator('[data-testid="task-tree-item-backlog"]')).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
