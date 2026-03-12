/**
 * Drag-and-Drop E2E Tests (015)
 *
 * Tests dragging file rows over folder rows and dropping to move files.
 * Also tests that isDropTarget styling appears during drag-over,
 * and that isDragSource opacity dimming is applied to the dragged item.
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
    wsId = 'ws-dragdrop',
): Promise<{ repoDir: string; taskRoot: string }> {
    const repoDir = createRepoFixture(tmpDir);
    createTasksFixture(repoDir);

    await seedWorkspace(serverUrl, wsId, 'dragdrop-repo', repoDir);

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

test.describe('Drag-and-Drop (015)', () => {

    test('15.1 drag file row onto folder row moves file on disk', async ({ page, serverUrl, dataDir }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dragdrop-'));
        try {
            const { repoDir, taskRoot } = await setupRepoWithTasks(page, serverUrl, tmpDir, dataDir);

            // Verify task-a.md starts at root level
            const origFile = path.join(taskRoot, 'task-a.md');
            expect(fs.existsSync(origFile)).toBe(true);

            // Get bounding boxes for drag source (task-a) and drop target (backlog)
            const sourceRow = page.locator('[data-testid="task-tree-item-task-a"]');
            const targetRow = page.locator('[data-testid="task-tree-item-backlog"]');

            await expect(sourceRow).toBeVisible();
            await expect(targetRow).toBeVisible();

            // Perform drag from task-a to backlog folder
            await sourceRow.dragTo(targetRow);

            // File should be moved: no longer in root, now in backlog
            const movedFile = path.join(taskRoot, 'backlog', 'task-a.md');
            await expect(async () => {
                expect(fs.existsSync(origFile)).toBe(false);
                expect(fs.existsSync(movedFile)).toBe(true);
            }).toPass({ timeout: 10000 });

            // task-a should no longer appear in root column
            await expect(page.locator('[data-testid="task-tree-item-task-a"]')).toHaveCount(0, { timeout: 10000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('15.2 drag-over folder shows drop-target ring styling', async ({ page, serverUrl, dataDir }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dragdrop-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir, dataDir);

            const sourceRow = page.locator('[data-testid="task-tree-item-task-a"]');
            const targetRow = page.locator('[data-testid="task-tree-item-backlog"]');

            await expect(sourceRow).toBeVisible();
            await expect(targetRow).toBeVisible();

            // Start drag on source
            const sourceBox = await sourceRow.boundingBox();
            const targetBox = await targetRow.boundingBox();
            if (!sourceBox || !targetBox) throw new Error('Could not get bounding boxes');

            await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
            await page.mouse.down();

            // Move to target to trigger dragover
            await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });

            // Drop-target folder should have ring-2 styling (isDropTarget)
            const targetClasses = await targetRow.getAttribute('class');
            expect(targetClasses).toContain('ring-2');

            // Release drag
            await page.mouse.up();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('15.3 drag source item shows opacity dimming', async ({ page, serverUrl, dataDir }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dragdrop-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir, dataDir);

            const sourceRow = page.locator('[data-testid="task-tree-item-task-a"]');
            const targetRow = page.locator('[data-testid="task-tree-item-backlog"]');

            await expect(sourceRow).toBeVisible();
            await expect(targetRow).toBeVisible();

            const sourceBox = await sourceRow.boundingBox();
            const targetBox = await targetRow.boundingBox();
            if (!sourceBox || !targetBox) throw new Error('Could not get bounding boxes');

            await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
            await page.mouse.down();
            await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 5 });

            // Source item should have opacity-30 or opacity-50 (isDragSource)
            const sourceClasses = await sourceRow.getAttribute('class');
            const hasOpacityDim = sourceClasses?.includes('opacity-30') || sourceClasses?.includes('opacity-50');
            expect(hasOpacityDim).toBe(true);

            await page.mouse.up();
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
