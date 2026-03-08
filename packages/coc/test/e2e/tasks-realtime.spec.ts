/**
 * Tasks Real-time Updates E2E Tests (015)
 *
 * Tests that tasks created or deleted via the REST API appear/disappear
 * in the Miller columns UI without page refresh, driven by WebSocket
 * `tasks-changed` events.
 *
 * Flow: REST API call → file-system change → TaskWatcher (300ms debounce)
 *       → WebSocket `tasks-changed` broadcast → SPA fetchRepoTasks() → re-render
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync, getTaskRoot } from './fixtures/server-fixture';
import { seedWorkspace, request } from './fixtures/seed';
import { createRepoFixture, createTasksFixture } from './fixtures/repo-fixtures';

/** Helper: create a repo with tasks, seed workspace, navigate to Tasks sub-tab. */
async function navigateToTasksTab(
    page: import('@playwright/test').Page,
    serverUrl: string,
    repoDir: string,
    wsId: string,
): Promise<void> {
    await seedWorkspace(serverUrl, wsId, `${wsId}-repo`, repoDir);

    await page.goto(serverUrl);
    await page.click('[data-tab="repos"]');
    await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

    await page.locator('.repo-item').first().click();
    await expect(page.locator('#repo-detail-content')).toBeVisible();

    await page.click('.repo-sub-tab[data-subtab="tasks"]');
    await expect(page.locator('.repo-sub-tab[data-subtab="tasks"]')).toHaveClass(/active/);

    // Wait for initial tasks to finish loading
    await expect(page.locator('[data-testid="task-tree"]')).toContainText('task-a', { timeout: 15000 });
}

// ================================================================
// 15.1 — API-created task appears without refresh
// ================================================================

test.describe('Tasks real-time: API create (015)', () => {
    test('15.1 API-created task appears without page refresh', async ({ page, serverUrl, dataDir }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-rt-tasks-create-'));
        const repoDir = createRepoFixture(tmpDir);
        createTasksFixture(repoDir);
        const taskRoot = getTaskRoot(dataDir, repoDir);

        try {
            await navigateToTasksTab(page, serverUrl, repoDir, 'ws-rt-create');

            // POST a new task via REST API (triggers file write → TaskWatcher → WS broadcast)
            const res = await request(`${serverUrl}/api/workspaces/ws-rt-create/tasks`, {
                method: 'POST',
                body: JSON.stringify({ name: 'api-created-task', type: 'file' }),
            });
            expect(res.status).toBe(201);

            // Task tree should re-render with the new task visible (no page refresh)
            await expect(page.locator('[data-testid="task-tree"]')).toContainText('api-created-task', {
                timeout: 10000,
            });

            // Verify file was created on disk
            const taskFile = path.join(taskRoot, 'api-created-task.md');
            expect(fs.existsSync(taskFile)).toBe(true);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// 15.2 — API-deleted task disappears without refresh
// ================================================================

test.describe('Tasks real-time: API delete (015)', () => {
    test('15.2 API-deleted task disappears without page refresh', async ({ page, serverUrl, dataDir }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-rt-tasks-delete-'));
        const repoDir = createRepoFixture(tmpDir);
        createTasksFixture(repoDir);
        const taskRoot = getTaskRoot(dataDir, repoDir);

        try {
            await navigateToTasksTab(page, serverUrl, repoDir, 'ws-rt-delete');

            // Confirm task-a is visible in the UI before deletion
            await expect(page.locator('[data-testid="task-tree"]')).toContainText('task-a', {
                timeout: 10000,
            });

            // Verify task-a exists on disk
            const taskFile = path.join(taskRoot, 'task-a.md');
            expect(fs.existsSync(taskFile)).toBe(true);

            // DELETE task-a via REST API (triggers file deletion → TaskWatcher → WS broadcast)
            const deleteBody = JSON.stringify({ path: 'task-a.md' });
            const res = await request(`${serverUrl}/api/workspaces/ws-rt-delete/tasks`, {
                method: 'DELETE',
                body: deleteBody,
                headers: { 'Content-Length': String(Buffer.byteLength(deleteBody)) },
            });
            expect(res.status).toBe(204);

            // task-a should disappear from the miller column (no page refresh)
            await expect(page.locator('.miller-file-row', { hasText: 'task-a' })).toHaveCount(0, {
                timeout: 10000,
            });

            // Verify file was deleted on disk
            expect(fs.existsSync(taskFile)).toBe(false);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
