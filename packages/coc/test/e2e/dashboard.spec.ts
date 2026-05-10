/**
 * Dashboard E2E Tests
 *
 * Tests the per-repo Tasks/Chats tab queue UI: queue task list rendering,
 * filtering, detail panel, pause/resume, deep links, and frozen task visuals.
 *
 * The legacy global `#processes` route was removed; queue tasks are now
 * displayed inside a workspace's Tasks sub-tab. Each test seeds a workspace
 * (so tasks are visible there), seeds queue tasks scoped to the workspace,
 * and navigates to `#repos/<wsId>/tasks` (which renders ChatListPane in
 * `tasks` mode and exposes the filter dropdown / pause-resume controls).
 *
 * Data flow: seed workspace + queue tasks via REST → page.goto → assert DOM.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedQueueTask, seedQueueTasks, seedWorkspace, request } from './fixtures/seed';
import type { QueueTaskOverrides } from './fixtures/seed';

/**
 * Build a queue task spec scoped to the given workspace. Sets both `repoId`
 * (queue partition key) and `payload.workspaceId` so enqueue resolves rootPath
 * to the workspace's rootPath and the per-workspace queue manager is created.
 */
function wsTask(wsId: string, overrides: QueueTaskOverrides = {}): QueueTaskOverrides {
    const basePayload = (overrides.payload ?? {}) as Record<string, unknown>;
    return {
        repoId: wsId,
        ...overrides,
        payload: { workspaceId: wsId, prompt: 'Test task prompt', ...basePayload },
    };
}

/** Poll GET /api/queue/:id until status matches or timeout expires. */
async function waitForTaskStatus(
    serverUrl: string,
    taskId: string,
    targetStatuses: string[],
    timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const res = await request(`${serverUrl}/api/queue/${taskId}`);
        if (res.status === 200) {
            const json = JSON.parse(res.body);
            const task = json.task ?? json;
            if (targetStatuses.includes(task.status as string)) return task;
        }
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`Task ${taskId} did not reach ${targetStatuses.join('|')} within ${timeoutMs}ms`);
}

/**
 * Create a temp workspace (repo) and return the workspace id, root, and
 * cleanup callback. Each test gets its own isolated workspace so queue tasks
 * don't bleed between tests.
 */
async function makeWorkspace(serverUrl: string, idPrefix: string): Promise<{
    wsId: string;
    rootPath: string;
    cleanup: () => void;
}> {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), `e2e-dash-${idPrefix}-`));
    const wsId = `${idPrefix}-${Date.now().toString(36)}`;
    await seedWorkspace(serverUrl, wsId, idPrefix, rootPath);
    return { wsId, rootPath, cleanup: () => safeRmSync(rootPath) };
}

/**
 * Build the per-repo Activity sub-tab URL.
 *
 * The Activity tab renders ChatListPane in tasks/queue mode (showing the
 * filter dropdown, pause/resume, and "No tasks in queue" empty state) in
 * classic UI mode (the test server's default). The Tasks sub-tab in classic
 * mode renders TasksPanel (file-based plan tasks) which is a different UI.
 */
function tasksTabUrl(serverUrl: string, wsId: string): string {
    return `${serverUrl}/#repos/${encodeURIComponent(wsId)}/activity`;
}

test.describe('Dashboard — Processes tab', () => {
    // ── Existing happy-path tests ───────────────────────────────────────────────

    test('shows empty state when no processes exist', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'empty');
        try {
            await page.goto(tasksTabUrl(serverUrl, wsId));
            await expect(page.locator('[data-testid="queue-empty-state"]')).toBeVisible({ timeout: 8000 });
            await expect(page.locator('[data-testid="queue-empty-state"]')).toContainText('No tasks in queue');
        } finally {
            cleanup();
        }
    });

    test('displays seeded processes in the sidebar', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'seeded');
        try {
            await seedQueueTasks(serverUrl, [
                wsTask(wsId, { type: 'chat', displayName: 'Task 1' }),
                wsTask(wsId, { type: 'chat', displayName: 'Task 2' }),
                wsTask(wsId, { type: 'chat', displayName: 'Task 3' }),
            ]);
            await page.goto(tasksTabUrl(serverUrl, wsId));

            await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 8000 });
            await expect(page.locator('[data-testid="queue-empty-state"]')).toBeHidden();
        } finally {
            cleanup();
        }
    });

    test('clicking a process shows its detail', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'detail');
        try {
            await seedQueueTask(serverUrl, wsTask(wsId, { type: 'chat', displayName: 'Detail Task' }));
            await page.goto(tasksTabUrl(serverUrl, wsId));

            const taskItem = page.locator('[data-task-id]').first();
            await expect(taskItem).toBeVisible({ timeout: 8000 });
            await taskItem.click();

            await expect(page.locator('[data-testid="activity-chat-detail"]')).toBeVisible({ timeout: 8000 });
        } finally {
            cleanup();
        }
    });

    // The "type filter dropdown shows only matching task type" and
    // "type filter shows only chat tasks when chat selected" tests were
    // removed when the activity-tab type filter dropdown was retired in
    // favor of the scope segmented control (chats / automations / all).

    // ── Completed Tasks section is expanded by default ─────────────────────────

    test('completed tasks section is expanded and shows tasks by default', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'comp1');
        try {
            const task = await seedQueueTask(serverUrl, wsTask(wsId, { type: 'chat', displayName: 'History Task' }));
            await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);

            await page.goto(tasksTabUrl(serverUrl, wsId));

            // Section header visible
            await expect(page.locator('text=Completed Tasks').first()).toBeVisible({ timeout: 8000 });
            // Task cards visible without needing to expand
            await expect(page.locator('[data-task-id]').first()).toBeVisible();
        } finally {
            cleanup();
        }
    });

    // ── Completed Tasks section can be collapsed and re-expanded ───────────────

    test('completed tasks section collapses and re-expands on toggle', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'comp2');
        try {
            const task = await seedQueueTask(serverUrl, wsTask(wsId, { type: 'chat', displayName: 'Toggle Task' }));
            await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);

            await page.goto(tasksTabUrl(serverUrl, wsId));
            await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 8000 });

            // Collapse the section by clicking its toggle button
            const toggleBtn = page.locator('button', { hasText: /Completed Tasks/ });
            await expect(toggleBtn).toBeVisible({ timeout: 5000 });
            await toggleBtn.click();

            // Task cards should disappear
            await expect(page.locator('[data-task-id]')).toHaveCount(0, { timeout: 5000 });

            // Re-expand
            await toggleBtn.click();
            await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 5000 });
        } finally {
            cleanup();
        }
    });

    // ── Queued tasks appear when queue is paused ───────────────────────────────

    test('queued tasks section shows tasks when queue is paused', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'queued');
        try {
            // Pause the queue so tasks stay in the queued state
            await request(`${serverUrl}/api/queue/pause`, { method: 'POST' });
            await seedQueueTasks(serverUrl, [
                wsTask(wsId, { type: 'chat', displayName: 'Queued Task A' }),
                wsTask(wsId, { type: 'chat', displayName: 'Queued Task B' }),
            ]);

            await page.goto(tasksTabUrl(serverUrl, wsId));

            // Queued Tasks section header is visible
            await expect(page.locator('text=Queued Tasks').first()).toBeVisible({ timeout: 8000 });
            // Task cards rendered for queued items
            const cards = page.locator('[data-task-id]');
            await expect(cards.first()).toBeVisible({ timeout: 8000 });
            expect(await cards.count()).toBeGreaterThanOrEqual(2);
        } finally {
            cleanup();
        }
    });

    // ── Pause/resume button and paused banner ──────────────────────────────────

    test('paused queue shows banner and resume button; clicking resume hides banner', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'pause');
        try {
            // Pause the queue via API then seed a task so the list is non-empty
            await request(`${serverUrl}/api/queue/pause`, { method: 'POST' });
            await seedQueueTask(serverUrl, wsTask(wsId, { type: 'chat', displayName: 'Paused Task' }));

            await page.goto(tasksTabUrl(serverUrl, wsId));

            // Paused banner should be visible
            await expect(page.locator('[data-testid="queue-paused-banner"]')).toBeVisible({ timeout: 8000 });

            // Pause/resume button should show the Resume (▶) icon
            const pauseResumeBtn = page.locator('[data-testid="repo-pause-resume-btn"]');
            await expect(pauseResumeBtn).toBeVisible();
            await expect(pauseResumeBtn).toContainText('▶');

            // Click resume
            await pauseResumeBtn.click();

            // Paused banner should disappear
            await expect(page.locator('[data-testid="queue-paused-banner"]')).not.toBeVisible({ timeout: 8000 });
        } finally {
            cleanup();
        }
    });

    // ── Detail panel placeholder when no task is selected ─────────────────────

    test('detail panel shows placeholder when no task is selected', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'placeholder');
        try {
            await page.goto(tasksTabUrl(serverUrl, wsId));

            // No task selected → right-panel shows the new-conversation prompt placeholder
            await expect(page.locator('text=Start a new conversation')).toBeVisible({ timeout: 8000 });
        } finally {
            cleanup();
        }
    });

    // ── Deep link selects the task and opens its detail ────────────────────────

    test('deep link #process/queue_<id> opens the task detail', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'deep');
        try {
            const task = await seedQueueTask(serverUrl, wsTask(wsId, { type: 'chat', displayName: 'Deep Link Task' }));
            await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);
            const taskId = task.id as string;

            // Navigate directly via the per-repo Activity deep-link URL.
            // After completion, the queue task lands in process history with the
            // `queue_<id>` prefixed process ID; the rendered card uses that ID.
            const processId = `queue_${taskId}`;
            await page.goto(
                `${serverUrl}/#repos/${encodeURIComponent(wsId)}/activity/${encodeURIComponent(processId)}`,
            );

            // Detail panel should open for this queue task
            await expect(page.locator('[data-testid="activity-chat-detail"]')).toBeVisible({ timeout: 8000 });

            // The task card should be visible
            const card = page.locator(`[data-task-id="${processId}"]`);
            await expect(card).toBeVisible({ timeout: 5000 });
            await expect(card).toHaveClass(/ring-2/);
        } finally {
            cleanup();
        }
    });

    // ── Frozen task shows ❄️ indicator ─────────────────────────────────────────

    test('frozen queued task shows frozen indicator on card', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'frozen');
        try {
            // Pause so the task stays in queued state
            await request(`${serverUrl}/api/queue/pause`, { method: 'POST' });
            const task = await seedQueueTask(serverUrl, wsTask(wsId, { type: 'chat', displayName: 'Frozen Task' }));
            const taskId = task.id as string;

            // Freeze via API
            await request(`${serverUrl}/api/queue/${encodeURIComponent(taskId)}/freeze`, { method: 'POST' });

            await page.goto(tasksTabUrl(serverUrl, wsId));

            const card = page.locator(`[data-task-id="${taskId}"]`);
            await expect(card).toBeVisible({ timeout: 8000 });

            // Card should have the task-frozen CSS class
            await expect(card).toHaveClass(/task-frozen/);

            // Card should display the ❄️ icon
            await expect(card).toContainText('❄️');
        } finally {
            cleanup();
        }
    });
});
