/**
 * Miller Column Navigation E2E Tests (009)
 *
 * Tests the Tasks Miller columns layout: root column rendering,
 * folder expansion, file preview, close preview, and folder count badges.
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
): Promise<string> {
    const repoDir = createRepoFixture(tmpDir);
    createTasksFixture(repoDir);

    await seedWorkspace(serverUrl, 'ws-miller', 'miller-repo', repoDir);

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

test.describe('Miller Column Navigation (009)', () => {

    test('9.1 root column shows tasks and folders', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-miller-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir);

            // Root column should be visible
            const rootColumn = page.locator('[data-testid="miller-column-0"]');
            await expect(rootColumn).toBeVisible();

            // Should contain folder row for "backlog"
            await expect(page.locator('[data-testid="task-tree-item-backlog"]')).toBeVisible();

            // Should contain file rows for root tasks (task-a, task-b, feature)
            await expect(page.locator('.miller-file-row', { hasText: 'task-a' })).toBeVisible();
            await expect(page.locator('.miller-file-row', { hasText: 'task-b' })).toBeVisible();
            await expect(page.locator('[data-testid="task-tree-item-feature"]')).toBeVisible();
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('9.2 click folder opens new column', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-miller-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir);

            // Initially only root column visible
            await expect(page.locator('[data-testid="miller-column-0"]')).toBeVisible();

            // Click the "backlog" folder row
            await page.locator('[data-testid="task-tree-item-backlog"]').click();

            // A second column should appear
            await expect(page.locator('[data-testid="miller-column-1"]')).toBeVisible({ timeout: 5000 });

            // Second column should contain "item" (item.md)
            const secondColumn = page.locator('[data-testid="miller-column-1"]');
            await expect(secondColumn.locator('[data-testid="task-tree-item-item"]')).toBeVisible();
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('9.3 click file opens preview column', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-miller-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir);

            // Click task-a.md file row
            await page.locator('[data-testid="task-tree-item-task-a"]').click();

            // Preview panel should appear (TaskPreview is rendered when openFilePath is set)
            const previewBody = page.locator('#task-preview-body');
            await expect(previewBody).toContainText('Task A', { timeout: 10000 });
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('9.4 close preview column', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-miller-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir);

            // Open a file preview first
            await page.locator('[data-testid="task-tree-item-task-a"]').click();
            await expect(page.locator('#task-preview-body')).toContainText('Task A', { timeout: 10000 });

            // Click the close button
            await page.locator('.task-preview-close').click();

            // Preview should be removed
            await expect(page.locator('#task-preview-body')).toHaveCount(0, { timeout: 5000 });
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('9.5 folder count badges show item counts', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-miller-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir);

            // "backlog" folder has 1 item (item.md)
            const backlogRow = page.locator('[data-testid="task-tree-item-backlog"]');
            const backlogBadge = backlogRow.locator('.task-folder-count');
            await expect(backlogBadge).toBeVisible();
            await expect(backlogBadge).toHaveText('1');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
