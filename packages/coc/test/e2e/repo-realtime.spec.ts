/**
 * Repo Real-time Updates E2E Tests (008)
 *
 * Tests that WebSocket events update the repo UI without page refresh.
 * Changes are driven via the REST API; the server broadcasts WS events
 * internally and the SPA client reacts by re-fetching and re-rendering.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace, seedProcess, request } from './fixtures/seed';
import { createRepoFixture, createTasksFixture } from './fixtures/repo-fixtures';

// ================================================================
// 8.1 — New process updates stats badge
// ================================================================

test.describe('Repo real-time: stats badge', () => {
    test('new process updates stats badge without page refresh', async ({ page, serverUrl }) => {
        // Seed a workspace with 1 completed process
        await seedWorkspace(serverUrl, 'ws-rt-stats', 'rt-stats-repo', '/tmp/rt-stats');
        await seedProcess(serverUrl, 'rt-stats-p1', {
            status: 'completed',
            workspaceId: 'ws-rt-stats',
        });

        // Navigate to repos tab and select the repo (info tab is default)
        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
        await page.locator('.repo-item').first().click();
        await expect(page.locator('.meta-grid')).toBeVisible();

        // Verify initial stats: 1 completed
        const completedItem = page.locator('.meta-item', { hasText: 'Completed' });
        await expect(completedItem).toContainText('1');

        // POST a new completed process via REST API (triggers WS broadcast)
        await seedProcess(serverUrl, 'rt-stats-p2', {
            status: 'completed',
            workspaceId: 'ws-rt-stats',
        });

        // Stats badge should update to 2 without page refresh (WS → debounced fetchReposData)
        await expect(completedItem).toContainText('2', { timeout: 10000 });
    });
});

// ================================================================
// 8.2 — tasks-changed refreshes task list
// ================================================================

test.describe('Repo real-time: task list', () => {
    test('tasks-changed refreshes task list', async ({ page, serverUrl }) => {
        // Create a real repo fixture with tasks
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-rt-tasks-'));
        const repoDir = createRepoFixture(tmpDir);
        createTasksFixture(repoDir);

        try {
            // Register workspace pointing to the real repo (triggers TaskWatcher auto-watch)
            await seedWorkspace(serverUrl, 'ws-rt-tasks', 'rt-tasks-repo', repoDir);

            // Navigate to repos tab → select repo → switch to Tasks sub-tab
            await page.goto(serverUrl);
            await page.click('[data-tab="repos"]');
            await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
            await page.locator('.repo-item').first().click();
            await expect(page.locator('#repo-detail-content')).toBeVisible();
            await page.click('.repo-sub-tab[data-subtab="tasks"]');
            await expect(page.locator('.repo-sub-tab[data-subtab="tasks"]')).toHaveClass(/active/);

            // Wait for initial tasks to finish loading — fixture includes "task-a"
            await expect(page.locator('[data-testid="task-tree"]')).toContainText('task-a', {
                timeout: 15000,
            });

            // Create a new task file via REST API (triggers file write → TaskWatcher → WS broadcast)
            await request(`${serverUrl}/api/workspaces/ws-rt-tasks/tasks`, {
                method: 'POST',
                body: JSON.stringify({ name: 'realtime-new-task', type: 'file' }),
            });

            // Task tree should re-render with the new task visible (no page refresh)
            await expect(page.locator('[data-testid="task-tree"]')).toContainText('realtime-new-task', {
                timeout: 10000,
            });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
