/**
 * Archive Workflow E2E Tests (012)
 *
 * Tests archiving and unarchiving tasks via context menu,
 * and verifies archive folder special styling.
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
    wsId = 'ws-archive',
): Promise<string> {
    const repoDir = createRepoFixture(tmpDir);
    createTasksFixture(repoDir);

    await seedWorkspace(serverUrl, wsId, 'archive-repo', repoDir);

    await page.goto(serverUrl);
    await page.click('[data-tab="repos"]');
    await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

    // Select repo
    await page.locator('.repo-item').first().click();
    await expect(page.locator('#repo-detail-content')).toBeVisible();

    // Switch to Tasks sub-tab
    await page.click('.repo-sub-tab[data-subtab="tasks"]');
    await expect(page.locator('.repo-sub-tab[data-subtab="tasks"]')).toHaveClass(/active/);

    // Wait for task tree to render
    await expect(page.locator('[data-testid="task-tree"]')).toBeVisible({ timeout: 10000 });

    return repoDir;
}

test.describe('Archive Workflow (012)', () => {

    test('12.1 archive task via context menu', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-archive-'));
        try {
            const repoDir = await setupRepoWithTasks(page, serverUrl, tmpDir);

            // Verify task-a exists on disk at root level
            const origFile = path.join(repoDir, '.vscode', 'tasks', 'task-a.md');
            expect(fs.existsSync(origFile)).toBe(true);

            // Right-click on task-a file row
            const taskRow = page.locator('[data-testid="task-tree-item-task-a"]');
            await expect(taskRow).toBeVisible();
            await taskRow.click({ button: 'right' });

            // Context menu should appear with "Archive" option
            await expect(page.locator('[data-testid="context-menu"]')).toBeVisible({ timeout: 5000 });
            await expect(page.getByRole('menuitem', { name: /Archive/ })).toBeVisible();

            // Click "Archive"
            await page.getByRole('menuitem', { name: /Archive/ }).click();

            // task-a should disappear from root miller column
            await expect(page.locator('.miller-file-row', { hasText: 'task-a' })).toHaveCount(0, { timeout: 10000 });

            // File should be moved to archive/ on disk
            expect(fs.existsSync(origFile)).toBe(false);
            const archivedFile = path.join(repoDir, '.vscode', 'tasks', 'archive', 'task-a.md');
            expect(fs.existsSync(archivedFile)).toBe(true);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('12.2 archive folder shown with special styling', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-archive-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir);

            // The archive folder should be visible in the task tree
            const archiveRow = page.locator('[data-testid="task-tree-item-archive"]');
            await expect(archiveRow).toBeVisible({ timeout: 10000 });

            // Archive folder has italic styling (isArchived affects child docs)
            await expect(archiveRow).toHaveClass(/italic/);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('12.3 unarchive task via context menu', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-archive-'));
        try {
            const repoDir = await setupRepoWithTasks(page, serverUrl, tmpDir);

            // Verify old.md exists in archive/ on disk
            const archivedFile = path.join(repoDir, '.vscode', 'tasks', 'archive', 'old.md');
            expect(fs.existsSync(archivedFile)).toBe(true);

            // Navigate into archive folder by clicking it
            const archiveRow = page.locator('[data-testid="task-tree-item-archive"]');
            await expect(archiveRow).toBeVisible({ timeout: 10000 });
            await archiveRow.click();

            // Wait for archive column to render with old.md
            const archivedTaskRow = page.locator('[data-testid="task-tree-item-old"]');
            await expect(archivedTaskRow).toBeVisible({ timeout: 10000 });

            // Right-click on old.md
            await archivedTaskRow.click({ button: 'right' });

            // Context menu should appear with "Unarchive" option
            await expect(page.locator('[data-testid="context-menu"]')).toBeVisible({ timeout: 5000 });
            await expect(page.getByRole('menuitem', { name: /Unarchive/ })).toBeVisible();

            // Click "Unarchive"
            await page.getByRole('menuitem', { name: /Unarchive/ }).click();

            // After refresh, old.md should appear at root level
            const rootColumn = page.locator('[data-testid="miller-column-0"]');
            await expect(rootColumn.locator('[data-testid="task-tree-item-old"]')).toBeVisible({ timeout: 10000 });

            // File should be moved back to root tasks folder on disk
            expect(fs.existsSync(archivedFile)).toBe(false);
            const restoredFile = path.join(repoDir, '.vscode', 'tasks', 'old.md');
            expect(fs.existsSync(restoredFile)).toBe(true);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
