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

    // Wait for miller columns to render
    await expect(page.locator('.miller-columns')).toBeVisible({ timeout: 10000 });

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
            const taskRow = page.locator('.miller-file-row', { hasText: 'task-a' });
            await expect(taskRow).toBeVisible();
            await taskRow.click({ button: 'right' });

            // Context menu should appear with "Archive" option
            await expect(page.locator('#task-context-menu')).toBeVisible({ timeout: 5000 });
            await expect(page.locator('[data-ctx-action="archive-task"]')).toBeVisible();

            // Click "Archive"
            await page.locator('[data-ctx-action="archive-task"]').click();

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

            // The archive folder should be visible in the miller column
            const archiveRow = page.locator('.miller-row[data-nav-folder="archive"]');
            await expect(archiveRow).toBeVisible({ timeout: 10000 });

            // It should have the .task-archive-folder class
            await expect(archiveRow).toHaveClass(/task-archive-folder/);
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
            const archiveRow = page.locator('.miller-row[data-nav-folder="archive"]');
            await expect(archiveRow).toBeVisible({ timeout: 10000 });
            await archiveRow.click();

            // Wait for archive column to render with old.md
            const archivedTaskRow = page.locator('.miller-file-row', { hasText: 'old' });
            await expect(archivedTaskRow).toBeVisible({ timeout: 10000 });

            // Right-click on old.md
            await archivedTaskRow.click({ button: 'right' });

            // Context menu should appear with "Unarchive" option
            await expect(page.locator('#task-context-menu')).toBeVisible({ timeout: 5000 });
            await expect(page.locator('[data-ctx-action="unarchive-task"]')).toBeVisible();

            // Click "Unarchive"
            await page.locator('[data-ctx-action="unarchive-task"]').click();

            // After refresh, the archive column collapses; old.md should appear at root level
            // Wait for the root column to show old.md (it was moved from archive/ to root)
            const rootColumn = page.locator('.miller-column').first();
            await expect(rootColumn.locator('.miller-file-row', { hasText: 'old' })).toBeVisible({ timeout: 10000 });

            // File should be moved back to root tasks folder on disk
            expect(fs.existsSync(archivedFile)).toBe(false);
            const restoredFile = path.join(repoDir, '.vscode', 'tasks', 'old.md');
            expect(fs.existsSync(restoredFile)).toBe(true);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
