/**
 * Document Groups E2E Tests (013)
 *
 * Tests that related documents (e.g., `feature.plan.md`, `feature.spec.md`)
 * are rendered as grouped rows with shared base name and rename atomically.
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
    wsId = 'ws-docgroup',
): Promise<{ repoDir: string; taskRoot: string }> {
    const repoDir = createRepoFixture(tmpDir);
    createTasksFixture(repoDir);

    await seedWorkspace(serverUrl, wsId, 'docgroup-repo', repoDir);

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

test.describe('Document Groups (013)', () => {

    test('13.1 grouped docs shown under shared base name', async ({ page, serverUrl, dataDir }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-docgroup-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir, dataDir);

            // The fixture creates feature.plan.md and feature.spec.md.
            // With groupRelatedDocuments: true, they appear as one grouped row "feature"
            const featureRow = page.locator('.miller-file-row', { hasText: 'feature' });
            await expect(featureRow).toBeVisible({ timeout: 10000 });

            // Group row represents both docs — data-file-path uses first doc (feature.plan.md)
            await expect(featureRow).toHaveAttribute('data-file-path', 'feature.plan.md');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('13.2 group docs display correct doc type suffixes', async ({ page, serverUrl, dataDir }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-docgroup-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir, dataDir);

            // With grouping, feature.plan+feature.spec appear as one "feature" row
            // Group uses first doc's status (feature.plan has in-progress)
            const featureRow = page.locator('.miller-file-row', { hasText: 'feature' });
            await expect(featureRow).toBeVisible({ timeout: 10000 });
            await expect(featureRow.locator('.miller-status.task-status-in-progress')).toBeVisible();
            await expect(featureRow.locator('.miller-status.task-status-in-progress')).toHaveText('🔄');

            // Group row's data-file-path points to first doc
            await expect(featureRow).toHaveAttribute('data-file-path', 'feature.plan.md');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('13.3 rename group renames all files atomically', async ({ page, serverUrl, dataDir }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-docgroup-'));
        try {
            const { repoDir, taskRoot } = await setupRepoWithTasks(page, serverUrl, tmpDir, dataDir);
            const tasksDir = taskRoot;

            // Verify both original files exist on disk
            expect(fs.existsSync(path.join(tasksDir, 'feature.plan.md'))).toBe(true);
            expect(fs.existsSync(path.join(tasksDir, 'feature.spec.md'))).toBe(true);

            // Right-click on the "feature" group row to open context menu
            const featureRow = page.locator('[data-testid="task-tree-item-feature"]');
            await expect(featureRow).toBeVisible({ timeout: 10000 });
            await featureRow.click({ button: 'right' });

            // Context menu should appear with "Rename" option
            await expect(page.locator('[data-testid="context-menu"]')).toBeVisible({ timeout: 5000 });
            await expect(page.getByRole('menuitem', { name: /Rename/ })).toBeVisible();

            // Click "Rename"
            await page.getByRole('menuitem', { name: /Rename/ }).click();

            // Input dialog should appear
            await expect(page.locator('#task-input-dialog-overlay')).toBeVisible({ timeout: 5000 });

            // Clear and enter new name "redesign"
            await page.fill('[data-testid="folder-action-input"]', 'redesign');
            await page.click('#task-dialog-form button[type="submit"]');

            // Dialog should close
            await expect(page.locator('#task-input-dialog-overlay')).toBeHidden({ timeout: 5000 });

            // Wait for task tree to refresh — renamed group should appear
            await expect(page.locator('[data-testid="task-tree-item-redesign"]')).toBeVisible({ timeout: 10000 });

            // Old row should be gone
            await expect(page.locator('[data-testid="task-tree-item-feature"]')).toHaveCount(0);

            // Verify on disk: old files gone, new files exist
            expect(fs.existsSync(path.join(tasksDir, 'feature.plan.md'))).toBe(false);
            expect(fs.existsSync(path.join(tasksDir, 'feature.spec.md'))).toBe(false);
            expect(fs.existsSync(path.join(tasksDir, 'redesign.plan.md'))).toBe(true);
            expect(fs.existsSync(path.join(tasksDir, 'redesign.spec.md'))).toBe(true);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('13.4 delete group removes all grouped files from disk', async ({ page, serverUrl, dataDir }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-docgroup-'));
        try {
            const { repoDir, taskRoot } = await setupRepoWithTasks(page, serverUrl, tmpDir, dataDir);
            const tasksDir = taskRoot;

            // Verify both files exist on disk
            expect(fs.existsSync(path.join(tasksDir, 'feature.plan.md'))).toBe(true);
            expect(fs.existsSync(path.join(tasksDir, 'feature.spec.md'))).toBe(true);

            // Right-click on "feature" group row
            const featureRow = page.locator('[data-testid="task-tree-item-feature"]');
            await expect(featureRow).toBeVisible({ timeout: 10000 });
            await featureRow.click({ button: 'right' });

            // Context menu should appear with "Delete" option
            await expect(page.locator('[data-testid="context-menu"]')).toBeVisible({ timeout: 5000 });
            await expect(page.getByRole('menuitem', { name: /Delete$/ })).toBeVisible();

            // Click "Delete"
            await page.getByRole('menuitem', { name: /Delete$/ }).click();

            // Confirm in the custom Delete dialog
            await expect(page.getByText('Are you sure you want to delete')).toBeVisible({ timeout: 5000 });
            await page.getByRole('button', { name: 'Delete' }).click();

            // Group row should disappear
            await expect(page.locator('[data-testid="task-tree-item-feature"]')).toHaveCount(0, { timeout: 10000 });

            // Both grouped files should be deleted on disk
            expect(fs.existsSync(path.join(tasksDir, 'feature.plan.md'))).toBe(false);
            expect(fs.existsSync(path.join(tasksDir, 'feature.spec.md'))).toBe(false);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
