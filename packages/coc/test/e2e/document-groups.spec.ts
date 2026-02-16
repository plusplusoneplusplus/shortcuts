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
import { test, expect } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { createRepoFixture, createTasksFixture } from './fixtures/repo-fixtures';

/** Helper: create a repo with tasks, seed it as a workspace, navigate to Tasks sub-tab. */
async function setupRepoWithTasks(
    page: import('@playwright/test').Page,
    serverUrl: string,
    tmpDir: string,
    wsId = 'ws-docgroup',
): Promise<string> {
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

    // Wait for miller columns to render
    await expect(page.locator('.miller-columns')).toBeVisible({ timeout: 10000 });

    return repoDir;
}

test.describe('Document Groups (013)', () => {

    test('13.1 grouped docs shown under shared base name', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-docgroup-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir);

            // The fixture creates feature.plan.md and feature.spec.md.
            // They should appear as separate rows with display names "feature.plan" and "feature.spec"
            const planRow = page.locator('.miller-file-row', { hasText: 'feature.plan' });
            const specRow = page.locator('.miller-file-row', { hasText: 'feature.spec' });

            await expect(planRow).toBeVisible({ timeout: 10000 });
            await expect(specRow).toBeVisible({ timeout: 10000 });

            // Both rows share the "feature" base name — no plain "feature" single-document row should exist
            // (single documents use baseName only, without docType suffix)
            // Verify there are exactly 2 rows whose name starts with "feature."
            const featureRows = page.locator('.miller-file-row .miller-row-name').filter({ hasText: /^feature\./ });
            await expect(featureRows).toHaveCount(2);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('13.2 group docs display correct doc type suffixes', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-docgroup-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir);

            // Verify "feature.plan" row shows in-progress status (◐)
            const planRow = page.locator('.miller-file-row', { hasText: 'feature.plan' });
            await expect(planRow).toBeVisible({ timeout: 10000 });
            await expect(planRow.locator('.miller-status.task-status-in-progress')).toBeVisible();
            await expect(planRow.locator('.miller-status.task-status-in-progress')).toHaveText('◐');

            // Verify "feature.spec" row shows pending status (○)
            const specRow = page.locator('.miller-file-row', { hasText: 'feature.spec' });
            await expect(specRow).toBeVisible();
            await expect(specRow.locator('.miller-status.task-status-pending')).toBeVisible();
            await expect(specRow.locator('.miller-status.task-status-pending')).toHaveText('○');

            // Each row should have the correct data-file-path attribute
            await expect(planRow).toHaveAttribute('data-file-path', 'feature.plan.md');
            await expect(specRow).toHaveAttribute('data-file-path', 'feature.spec.md');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('13.3 rename group renames all files atomically', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-docgroup-'));
        try {
            const repoDir = await setupRepoWithTasks(page, serverUrl, tmpDir);
            const tasksDir = path.join(repoDir, '.vscode', 'tasks');

            // Verify both original files exist on disk
            expect(fs.existsSync(path.join(tasksDir, 'feature.plan.md'))).toBe(true);
            expect(fs.existsSync(path.join(tasksDir, 'feature.spec.md'))).toBe(true);

            // Right-click on the "feature.plan" row to open context menu
            const planRow = page.locator('.miller-file-row', { hasText: 'feature.plan' });
            await expect(planRow).toBeVisible({ timeout: 10000 });
            await planRow.click({ button: 'right' });

            // Context menu should appear with "Rename" option
            await expect(page.locator('#task-context-menu')).toBeVisible({ timeout: 5000 });
            await expect(page.locator('[data-ctx-action="rename-task"]')).toBeVisible();

            // Click "Rename"
            await page.locator('[data-ctx-action="rename-task"]').click();

            // Input dialog should appear
            await expect(page.locator('#task-input-dialog-overlay')).toBeVisible({ timeout: 5000 });

            // Clear and enter new name "redesign"
            await page.fill('#task-dialog-input', 'redesign');
            await page.click('#task-dialog-form button[type="submit"]');

            // Dialog should close
            await expect(page.locator('#task-input-dialog-overlay')).toBeHidden({ timeout: 5000 });

            // Wait for miller columns to refresh — renamed rows should appear
            await expect(page.locator('.miller-file-row', { hasText: 'redesign.plan' })).toBeVisible({ timeout: 10000 });
            await expect(page.locator('.miller-file-row', { hasText: 'redesign.spec' })).toBeVisible({ timeout: 10000 });

            // Old rows should be gone
            await expect(page.locator('.miller-file-row', { hasText: 'feature.plan' })).toHaveCount(0);
            await expect(page.locator('.miller-file-row', { hasText: 'feature.spec' })).toHaveCount(0);

            // Verify on disk: old files gone, new files exist
            expect(fs.existsSync(path.join(tasksDir, 'feature.plan.md'))).toBe(false);
            expect(fs.existsSync(path.join(tasksDir, 'feature.spec.md'))).toBe(false);
            expect(fs.existsSync(path.join(tasksDir, 'redesign.plan.md'))).toBe(true);
            expect(fs.existsSync(path.join(tasksDir, 'redesign.spec.md'))).toBe(true);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
