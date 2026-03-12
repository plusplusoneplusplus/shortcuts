/**
 * Task CRUD E2E Tests (010)
 *
 * Tests creating tasks and folders via toolbar buttons, and
 * renaming/deleting via context menu.
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
    wsId = 'ws-crud',
): Promise<{ repoDir: string; taskRoot: string }> {
    const repoDir = createRepoFixture(tmpDir);
    createTasksFixture(repoDir);

    await seedWorkspace(serverUrl, wsId, 'crud-repo', repoDir);

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

    return { repoDir, taskRoot: getTaskRoot(dataDir, wsId) };
}

test.describe('Task CRUD (010)', () => {

    test('10.1 create new task via toolbar', async ({ page, serverUrl, dataDir }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-crud-'));
        try {
            const { repoDir, taskRoot } = await setupRepoWithTasks(page, serverUrl, tmpDir, dataDir);

            // Click "+ New Task" toolbar button
            await page.click('#repo-tasks-new-btn');

            // Input dialog should appear
            await expect(page.locator('#task-input-dialog-overlay')).toBeVisible({ timeout: 5000 });

            // Enter task name and submit
            await page.fill('[data-testid="folder-action-input"]', 'my-new-task');
            await page.click('#task-dialog-form button[type="submit"]');

            // Dialog should close
            await expect(page.locator('#task-input-dialog-overlay')).toBeHidden({ timeout: 5000 });

            // New task should appear in the miller column
            await expect(page.locator('.miller-file-row', { hasText: 'my-new-task' })).toBeVisible({ timeout: 10000 });

            // Verify file was created on disk
            const taskFile = path.join(taskRoot, 'my-new-task.md');
            expect(fs.existsSync(taskFile)).toBe(true);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('10.2 create task with docType', async ({ page, serverUrl, dataDir }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-crud-'));
        try {
            const { repoDir, taskRoot } = await setupRepoWithTasks(page, serverUrl, tmpDir, dataDir);

            // Click "+ New Task" toolbar button
            await page.click('#repo-tasks-new-btn');
            await expect(page.locator('#task-input-dialog-overlay')).toBeVisible({ timeout: 5000 });

            // Enter name and select "plan" docType
            await page.fill('[data-testid="folder-action-input"]', 'release-notes');
            await page.selectOption('#task-dialog-doctype', 'plan');

            await page.click('#task-dialog-form button[type="submit"]');
            await expect(page.locator('#task-input-dialog-overlay')).toBeHidden({ timeout: 5000 });

            // New task should appear in miller column
            await expect(page.locator('.miller-file-row', { hasText: 'release-notes' })).toBeVisible({ timeout: 10000 });

            // Verify file created as name.plan.md on disk
            const taskFile = path.join(taskRoot, 'release-notes.plan.md');
            expect(fs.existsSync(taskFile)).toBe(true);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('10.3 create new folder via toolbar', async ({ page, serverUrl, dataDir }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-crud-'));
        try {
            const { repoDir, taskRoot } = await setupRepoWithTasks(page, serverUrl, tmpDir, dataDir);

            // Click "+ New Folder" toolbar button
            await page.click('#repo-tasks-folder-btn');
            await expect(page.locator('#task-input-dialog-overlay')).toBeVisible({ timeout: 5000 });

            // Enter folder name and submit
            await page.fill('[data-testid="folder-action-input"]', 'sprint-42');
            await page.click('#task-dialog-form button[type="submit"]');

            // Dialog should close
            await expect(page.locator('#task-input-dialog-overlay')).toBeHidden({ timeout: 5000 });

            // New folder should appear in the task tree
            await expect(page.locator('[data-testid="task-tree-item-sprint-42"]')).toBeVisible({ timeout: 10000 });

            // Verify directory was created on disk
            const folderPath = path.join(taskRoot, 'sprint-42');
            expect(fs.existsSync(folderPath)).toBe(true);
            expect(fs.statSync(folderPath).isDirectory()).toBe(true);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('10.4 rename task via context menu', async ({ page, serverUrl, dataDir }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-crud-'));
        try {
            const { repoDir, taskRoot } = await setupRepoWithTasks(page, serverUrl, tmpDir, dataDir);

            // Right-click on task-a file row
            const taskRow = page.locator('[data-testid="task-tree-item-task-a"]');
            await expect(taskRow).toBeVisible();
            await taskRow.click({ button: 'right' });

            // Context menu should appear
            await expect(page.locator('[data-testid="context-menu"]')).toBeVisible({ timeout: 5000 });

            // Click "Rename"
            await page.getByRole('menuitem', { name: /Rename/ }).click();

            // Input dialog should appear with current name
            await expect(page.locator('#task-input-dialog-overlay')).toBeVisible({ timeout: 5000 });

            // Clear and enter new name
            await page.fill('[data-testid="folder-action-input"]', 'task-alpha');
            await page.click('#task-dialog-form button[type="submit"]');

            // Dialog should close
            await expect(page.locator('#task-input-dialog-overlay')).toBeHidden({ timeout: 5000 });

            // Row should update with new name
            await expect(page.locator('.miller-file-row', { hasText: 'task-alpha' })).toBeVisible({ timeout: 10000 });

            // Old file should be gone, new file should exist
            expect(fs.existsSync(path.join(taskRoot, 'task-a.md'))).toBe(false);
            expect(fs.existsSync(path.join(taskRoot, 'task-alpha.md'))).toBe(true);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('10.5 delete task via context menu', async ({ page, serverUrl, dataDir }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-crud-'));
        try {
            const { repoDir, taskRoot } = await setupRepoWithTasks(page, serverUrl, tmpDir, dataDir);

            // Verify task-b exists before deletion
            const taskFile = path.join(taskRoot, 'task-b.md');
            expect(fs.existsSync(taskFile)).toBe(true);

            // Right-click on task-b file row
            const taskRow = page.locator('[data-testid="task-tree-item-task-b"]');
            await expect(taskRow).toBeVisible();
            await taskRow.click({ button: 'right' });

            // Context menu should appear
            await expect(page.locator('[data-testid="context-menu"]')).toBeVisible({ timeout: 5000 });

            // Click "Delete" — opens custom confirmation dialog
            await page.getByRole('menuitem', { name: /Delete/ }).click();

            // Confirm in the custom Delete File dialog (not native confirm)
            await expect(page.getByText('Are you sure you want to delete')).toBeVisible({ timeout: 5000 });
            await page.getByRole('button', { name: 'Delete' }).click();

            // Task should be removed from miller column
            await expect(page.locator('.miller-file-row', { hasText: 'task-b' })).toHaveCount(0, { timeout: 10000 });

            // File should be deleted on disk
            expect(fs.existsSync(taskFile)).toBe(false);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('10.6 delete folder via context menu', async ({ page, serverUrl, dataDir }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-crud-'));
        try {
            const { repoDir, taskRoot } = await setupRepoWithTasks(page, serverUrl, tmpDir, dataDir);

            // Verify backlog folder exists
            const folderPath = path.join(taskRoot, 'backlog');
            expect(fs.existsSync(folderPath)).toBe(true);

            // Right-click on "backlog" folder row
            const folderRow = page.locator('[data-testid="task-tree-item-backlog"]');
            await expect(folderRow).toBeVisible();
            await folderRow.click({ button: 'right' });

            // Context menu should appear
            await expect(page.locator('[data-testid="context-menu"]')).toBeVisible({ timeout: 5000 });

            // Click "Delete Folder" — opens custom confirmation dialog
            await page.getByRole('menuitem', { name: /Delete Folder/ }).click();

            // Confirm in the custom Delete Folder dialog
            await expect(page.getByText('Are you sure you want to delete')).toBeVisible({ timeout: 5000 });
            await page.getByRole('button', { name: 'Delete' }).click();

            // Folder should be removed from task tree
            await expect(page.locator('[data-testid="task-tree-item-backlog"]')).toHaveCount(0, { timeout: 10000 });

            // Folder and contents should be deleted on disk
            expect(fs.existsSync(folderPath)).toBe(false);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('10.7 create subfolder inside existing folder', async ({ page, serverUrl, dataDir }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-crud-'));
        try {
            const { repoDir, taskRoot } = await setupRepoWithTasks(page, serverUrl, tmpDir, dataDir);

            // Navigate into the "backlog" folder
            const backlogRow = page.locator('[data-testid="task-tree-item-backlog"]');
            await expect(backlogRow).toBeVisible();
            await backlogRow.click();

            // Wait for column 1 to appear (inside backlog)
            await expect(page.locator('[data-testid="miller-column-1"]')).toBeVisible({ timeout: 5000 });

            // Right-click on backlog to open folder context menu
            await backlogRow.click({ button: 'right' });
            await expect(page.locator('[data-testid="context-menu"]')).toBeVisible({ timeout: 5000 });

            // Click "Create Subfolder"
            await page.getByRole('menuitem', { name: /Create Subfolder/ }).click();

            // Input dialog should appear
            await expect(page.locator('#task-input-dialog-overlay')).toBeVisible({ timeout: 5000 });

            // Enter subfolder name and submit
            await page.fill('[data-testid="folder-action-input"]', 'sprint-1');
            await page.click('#task-dialog-form button[type="submit"]');

            // Dialog should close
            await expect(page.locator('#task-input-dialog-overlay')).toBeHidden({ timeout: 5000 });

            // New subfolder should appear in the task tree
            await expect(page.locator('[data-testid="task-tree-item-sprint-1"]')).toBeVisible({ timeout: 10000 });

            // Verify directory was created on disk
            const subfolderPath = path.join(taskRoot, 'backlog', 'sprint-1');
            expect(fs.existsSync(subfolderPath)).toBe(true);
            expect(fs.statSync(subfolderPath).isDirectory()).toBe(true);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('10.8 rename folder via context menu', async ({ page, serverUrl, dataDir }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-crud-'));
        try {
            const { repoDir, taskRoot } = await setupRepoWithTasks(page, serverUrl, tmpDir, dataDir);

            // Verify backlog folder exists
            const origFolder = path.join(taskRoot, 'backlog');
            expect(fs.existsSync(origFolder)).toBe(true);

            // Right-click on "backlog" folder row
            const folderRow = page.locator('[data-testid="task-tree-item-backlog"]');
            await expect(folderRow).toBeVisible();
            await folderRow.click({ button: 'right' });

            // Context menu should appear
            await expect(page.locator('[data-testid="context-menu"]')).toBeVisible({ timeout: 5000 });

            // Click "Rename Folder"
            await page.getByRole('menuitem', { name: /Rename Folder/ }).click();

            // Input dialog should appear with current name pre-filled
            await expect(page.locator('#task-input-dialog-overlay')).toBeVisible({ timeout: 5000 });

            // Clear and enter new folder name
            await page.fill('[data-testid="folder-action-input"]', 'icebox');
            await page.click('#task-dialog-form button[type="submit"]');

            // Dialog should close
            await expect(page.locator('#task-input-dialog-overlay')).toBeHidden({ timeout: 5000 });

            // Folder row should show new name
            await expect(page.locator('[data-testid="task-tree-item-icebox"]')).toBeVisible({ timeout: 10000 });
            await expect(page.locator('[data-testid="task-tree-item-backlog"]')).toHaveCount(0, { timeout: 5000 });

            // Old directory gone, new directory exists on disk
            expect(fs.existsSync(origFolder)).toBe(false);
            expect(fs.existsSync(path.join(taskRoot, 'icebox'))).toBe(true);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
