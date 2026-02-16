/**
 * Status Cycling E2E Tests (011)
 *
 * Tests that task status icons render correctly and cycle through
 * pending → in-progress → done → future.
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
    wsId = 'ws-status',
): Promise<string> {
    const repoDir = createRepoFixture(tmpDir);
    createTasksFixture(repoDir);

    await seedWorkspace(serverUrl, wsId, 'status-repo', repoDir);

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

test.describe('Status Cycling (011)', () => {

    test('11.1 status icon reflects file status', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-status-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir);

            // task-a is pending → should show ○
            const taskARow = page.locator('.miller-file-row', { hasText: 'task-a' });
            await expect(taskARow).toBeVisible();
            const taskAStatus = taskARow.locator('.miller-status.task-status-pending');
            await expect(taskAStatus).toBeVisible();
            await expect(taskAStatus).toHaveText('○');

            // task-b is done → should show ●
            const taskBRow = page.locator('.miller-file-row', { hasText: 'task-b' });
            await expect(taskBRow).toBeVisible();
            const taskBStatus = taskBRow.locator('.miller-status.task-status-done');
            await expect(taskBStatus).toBeVisible();
            await expect(taskBStatus).toHaveText('●');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('11.2 click status cycles to next', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-status-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir);

            // Right-click on task-a (pending) to open context menu
            const taskRow = page.locator('.miller-file-row', { hasText: 'task-a' });
            await expect(taskRow).toBeVisible();
            await taskRow.click({ button: 'right' });

            // Context menu should appear
            await expect(page.locator('#task-context-menu')).toBeVisible({ timeout: 5000 });

            // Hover over "Change Status" submenu parent to reveal status options
            await page.locator('.task-context-menu-item.has-submenu').hover();
            await expect(page.locator('.task-context-submenu')).toBeVisible({ timeout: 5000 });

            // Click "In Progress" status option to cycle from pending → in-progress
            await page.locator('[data-ctx-action="set-status"][data-ctx-status="in-progress"]').click();

            // Status icon should update to ◐ (in-progress)
            const updatedRow = page.locator('.miller-file-row', { hasText: 'task-a' });
            await expect(updatedRow.locator('.miller-status.task-status-in-progress')).toBeVisible({ timeout: 10000 });
            await expect(updatedRow.locator('.miller-status.task-status-in-progress')).toHaveText('◐');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('11.3 status persists after refresh', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-status-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir);

            // Change task-a from pending → in-progress via context menu
            const taskRow = page.locator('.miller-file-row', { hasText: 'task-a' });
            await expect(taskRow).toBeVisible();
            await taskRow.click({ button: 'right' });

            await expect(page.locator('#task-context-menu')).toBeVisible({ timeout: 5000 });

            // Hover over "Change Status" submenu parent to reveal status options
            await page.locator('.task-context-menu-item.has-submenu').hover();
            await expect(page.locator('.task-context-submenu')).toBeVisible({ timeout: 5000 });

            await page.locator('[data-ctx-action="set-status"][data-ctx-status="in-progress"]').click();

            // Wait for status to update
            await expect(
                page.locator('.miller-file-row', { hasText: 'task-a' })
                    .locator('.miller-status.task-status-in-progress'),
            ).toBeVisible({ timeout: 10000 });

            // Reload the page
            await page.goto(serverUrl);
            await page.click('[data-tab="repos"]');
            await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

            // Re-select repo and navigate to Tasks
            await page.locator('.repo-item').first().click();
            await expect(page.locator('#repo-detail-content')).toBeVisible();
            await page.click('.repo-sub-tab[data-subtab="tasks"]');
            await expect(page.locator('.miller-columns')).toBeVisible({ timeout: 10000 });

            // task-a should still show ◐ (in-progress) after refresh
            const refreshedRow = page.locator('.miller-file-row', { hasText: 'task-a' });
            await expect(refreshedRow.locator('.miller-status.task-status-in-progress')).toBeVisible({ timeout: 10000 });
            await expect(refreshedRow.locator('.miller-status.task-status-in-progress')).toHaveText('◐');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
