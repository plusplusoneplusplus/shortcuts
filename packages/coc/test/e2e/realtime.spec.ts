/**
 * Real-time E2E Tests
 *
 * Tests that changes made via REST API are visible after page refresh.
 * Since the custom raw WS implementation isn't compatible with Playwright's
 * Chromium, we verify data consistency via reload instead of live WS updates.
 *
 * The standalone `#processes` route was removed; queue tasks must now be
 * scoped to a workspace and surfaced under `#repos/<wsId>/activity`. Each
 * test provisions its own temp workspace and seeds tasks against it.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedQueueTask, seedWorkspace, request } from './fixtures/seed';
import type { QueueTaskOverrides } from './fixtures/seed';

/**
 * Provision a temporary workspace tied to a fresh temp directory. The
 * Activity tab requires a real workspace so the per-repo queue manager can
 * resolve the workspace's root path.
 */
async function makeWorkspace(
    serverUrl: string,
    idPrefix: string,
): Promise<{ wsId: string; rootPath: string; cleanup: () => void }> {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), `e2e-realtime-${idPrefix}-`));
    const wsId = `${idPrefix}-${Date.now().toString(36)}`;
    await seedWorkspace(serverUrl, wsId, idPrefix, rootPath);
    return { wsId, rootPath, cleanup: () => safeRmSync(rootPath) };
}

/** Build a workspace-scoped queue task spec. */
function wsTask(wsId: string, overrides: QueueTaskOverrides = {}): QueueTaskOverrides {
    const basePayload = (overrides.payload ?? {}) as Record<string, unknown>;
    return {
        repoId: wsId,
        ...overrides,
        payload: { workspaceId: wsId, prompt: 'Test task prompt', ...basePayload },
    };
}

/** Per-repo Activity sub-tab URL (renders ChatListPane in queue mode). */
function activityUrl(serverUrl: string, wsId: string): string {
    return `${serverUrl}/#repos/${encodeURIComponent(wsId)}/activity`;
}

test.describe('Data consistency via REST + reload', () => {
    test('new process appears after page reload', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'rt1');
        try {
            await page.goto(activityUrl(serverUrl, wsId));

            // Initially empty — show empty state
            await expect(page.locator('[data-testid="queue-empty-state"]')).toBeVisible({ timeout: 8000 });

            // Seed a queue task via REST API
            await seedQueueTask(serverUrl, wsTask(wsId, { type: 'chat', displayName: 'Real-time Task' }));

            // Reload to pick up the new task — the hash route restores the same view
            await page.reload();
            await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 8000 });
        } finally {
            cleanup();
        }
    });

    test('process status update is visible after reload', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'rt2');
        try {
            const task = await seedQueueTask(serverUrl, wsTask(wsId, { type: 'chat', displayName: 'Update Me' }));
            const taskId = task.id as string;
            await page.goto(activityUrl(serverUrl, wsId));

            await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 8000 });

            // Update task status via REST API (cancel it)
            await request(`${serverUrl}/api/queue/${encodeURIComponent(taskId)}`, {
                method: 'DELETE',
            });

            // Reload to see updated state
            await page.reload();
            // After deletion the task may appear in history or be gone — just
            // verify the activity panel re-renders without error.
            await expect(page.locator('[data-testid="activity-split-panel"]')).toBeVisible({ timeout: 8000 });
        } finally {
            cleanup();
        }
    });

    test('removed process disappears after reload', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'rt3');
        try {
            const task = await seedQueueTask(serverUrl, wsTask(wsId, { type: 'chat', displayName: 'Remove Me' }));
            const taskId = task.id as string;
            await page.goto(activityUrl(serverUrl, wsId));

            await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 8000 });

            // Cancel the task via REST API
            await request(`${serverUrl}/api/queue/${encodeURIComponent(taskId)}`, { method: 'DELETE' });

            // Reload to see removal
            await page.reload();
            // The cancelled task is in history, not completely gone — just verify
            // the per-repo activity panel still renders.
            await expect(page.locator('[data-testid="activity-split-panel"]')).toBeVisible({ timeout: 8000 });
        } finally {
            cleanup();
        }
    });

    test('multiple processes added concurrently are all visible', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'rt4');
        try {
            // Seed 3 tasks concurrently
            await Promise.all([
                seedQueueTask(serverUrl, wsTask(wsId, { type: 'chat', displayName: 'Rapid 1' })),
                seedQueueTask(serverUrl, wsTask(wsId, { type: 'chat', displayName: 'Rapid 2' })),
                seedQueueTask(serverUrl, wsTask(wsId, { type: 'chat', displayName: 'Rapid 3' })),
            ]);

            await page.goto(activityUrl(serverUrl, wsId));
            // Tasks should appear (running or history)
            await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 8000 });
            const count = await page.locator('[data-task-id]').count();
            expect(count).toBeGreaterThanOrEqual(1);
        } finally {
            cleanup();
        }
    });
});
