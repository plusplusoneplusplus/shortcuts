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
import { test, expect } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { createRepoFixture, createTasksFixture } from './fixtures/repo-fixtures';

/** Helper: create a repo with tasks, seed it as a workspace, navigate to Tasks sub-tab. */
async function setupRepoWithTasks(
    page: import('@playwright/test').Page,
    serverUrl: string,
    tmpDir: string,
    wsId = 'ws-crud',
): Promise<string> {
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

    // Wait for miller columns to render
    await expect(page.locator('.miller-columns')).toBeVisible({ timeout: 10000 });

    return repoDir;
}

test.describe('Task CRUD (010)', () => {

    test('10.1 create new task via toolbar', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-crud-'));
        try {
            const repoDir = await setupRepoWithTasks(page, serverUrl, tmpDir);

            // Click "+ New Task" toolbar button
            await page.click('#repo-tasks-new-btn');

            // Input dialog should appear
            await expect(page.locator('#task-input-dialog-overlay')).toBeVisible({ timeout: 5000 });

            // Enter task name and submit
            await page.fill('#task-dialog-input', 'my-new-task');
            await page.click('#task-dialog-form button[type="submit"]');

            // Dialog should close
            await expect(page.locator('#task-input-dialog-overlay')).toBeHidden({ timeout: 5000 });

            // New task should appear in the miller column
            await expect(page.locator('.miller-file-row', { hasText: 'my-new-task' })).toBeVisible({ timeout: 10000 });

            // Verify file was created on disk
            const taskFile = path.join(repoDir, '.vscode', 'tasks', 'my-new-task.md');
            expect(fs.existsSync(taskFile)).toBe(true);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('10.2 create task with docType', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-crud-'));
        try {
            const repoDir = await setupRepoWithTasks(page, serverUrl, tmpDir);

            // Click "+ New Task" toolbar button
            await page.click('#repo-tasks-new-btn');
            await expect(page.locator('#task-input-dialog-overlay')).toBeVisible({ timeout: 5000 });

            // Enter name and select "plan" docType
            await page.fill('#task-dialog-input', 'release-notes');
            await page.selectOption('#task-dialog-doctype', 'plan');

            await page.click('#task-dialog-form button[type="submit"]');
            await expect(page.locator('#task-input-dialog-overlay')).toBeHidden({ timeout: 5000 });

            // New task should appear in miller column
            await expect(page.locator('.miller-file-row', { hasText: 'release-notes' })).toBeVisible({ timeout: 10000 });

            // Verify file created as name.plan.md on disk
            const taskFile = path.join(repoDir, '.vscode', 'tasks', 'release-notes.plan.md');
            expect(fs.existsSync(taskFile)).toBe(true);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('10.3 create new folder via toolbar', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-crud-'));
        try {
            const repoDir = await setupRepoWithTasks(page, serverUrl, tmpDir);

            // Click "+ New Folder" toolbar button
            await page.click('#repo-tasks-folder-btn');
            await expect(page.locator('#task-input-dialog-overlay')).toBeVisible({ timeout: 5000 });

            // Enter folder name and submit
            await page.fill('#task-dialog-input', 'sprint-42');
            await page.click('#task-dialog-form button[type="submit"]');

            // Dialog should close
            await expect(page.locator('#task-input-dialog-overlay')).toBeHidden({ timeout: 5000 });

            // New folder should appear in the miller column with folder icon
            await expect(page.locator('.miller-row[data-nav-folder]', { hasText: 'sprint-42' })).toBeVisible({ timeout: 10000 });

            // Verify directory was created on disk
            const folderPath = path.join(repoDir, '.vscode', 'tasks', 'sprint-42');
            expect(fs.existsSync(folderPath)).toBe(true);
            expect(fs.statSync(folderPath).isDirectory()).toBe(true);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('10.4 rename task via context menu', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-crud-'));
        try {
            const repoDir = await setupRepoWithTasks(page, serverUrl, tmpDir);

            // Right-click on task-a file row
            const taskRow = page.locator('.miller-file-row', { hasText: 'task-a' });
            await expect(taskRow).toBeVisible();
            await taskRow.click({ button: 'right' });

            // Context menu should appear
            await expect(page.locator('#task-context-menu')).toBeVisible({ timeout: 5000 });

            // Click "Rename"
            await page.locator('[data-ctx-action="rename-task"]').click();

            // Input dialog should appear with current name
            await expect(page.locator('#task-input-dialog-overlay')).toBeVisible({ timeout: 5000 });

            // Clear and enter new name
            await page.fill('#task-dialog-input', 'task-alpha');
            await page.click('#task-dialog-form button[type="submit"]');

            // Dialog should close
            await expect(page.locator('#task-input-dialog-overlay')).toBeHidden({ timeout: 5000 });

            // Row should update with new name
            await expect(page.locator('.miller-file-row', { hasText: 'task-alpha' })).toBeVisible({ timeout: 10000 });

            // Old file should be gone, new file should exist
            expect(fs.existsSync(path.join(repoDir, '.vscode', 'tasks', 'task-a.md'))).toBe(false);
            expect(fs.existsSync(path.join(repoDir, '.vscode', 'tasks', 'task-alpha.md'))).toBe(true);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('10.5 delete task via context menu', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-crud-'));
        try {
            const repoDir = await setupRepoWithTasks(page, serverUrl, tmpDir);

            // Verify task-b exists before deletion
            const taskFile = path.join(repoDir, '.vscode', 'tasks', 'task-b.md');
            expect(fs.existsSync(taskFile)).toBe(true);

            // Right-click on task-b file row
            const taskRow = page.locator('.miller-file-row', { hasText: 'task-b' });
            await expect(taskRow).toBeVisible();
            await taskRow.click({ button: 'right' });

            // Context menu should appear
            await expect(page.locator('#task-context-menu')).toBeVisible({ timeout: 5000 });

            // Accept the upcoming confirm dialog
            page.on('dialog', dialog => dialog.accept());

            // Click "Delete"
            await page.locator('[data-ctx-action="delete-task"]').click();

            // Task should be removed from miller column
            await expect(page.locator('.miller-file-row', { hasText: 'task-b' })).toHaveCount(0, { timeout: 10000 });

            // File should be deleted on disk
            expect(fs.existsSync(taskFile)).toBe(false);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('10.6 delete folder via context menu', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-crud-'));
        try {
            const repoDir = await setupRepoWithTasks(page, serverUrl, tmpDir);

            // Verify backlog folder exists
            const folderPath = path.join(repoDir, '.vscode', 'tasks', 'backlog');
            expect(fs.existsSync(folderPath)).toBe(true);

            // Right-click on "backlog" folder row
            const folderRow = page.locator('.miller-row[data-nav-folder]', { hasText: 'backlog' });
            await expect(folderRow).toBeVisible();
            await folderRow.click({ button: 'right' });

            // Context menu should appear
            await expect(page.locator('#task-context-menu')).toBeVisible({ timeout: 5000 });

            // Accept the upcoming confirm dialog
            page.on('dialog', dialog => dialog.accept());

            // Click "Delete Folder"
            await page.locator('[data-ctx-action="delete-folder"]').click();

            // Folder should be removed from miller column
            await expect(page.locator('.miller-row[data-nav-folder]', { hasText: 'backlog' })).toHaveCount(0, { timeout: 10000 });

            // Folder and contents should be deleted on disk
            expect(fs.existsSync(folderPath)).toBe(false);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
