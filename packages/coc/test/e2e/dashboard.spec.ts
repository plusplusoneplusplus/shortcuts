/**
 * Dashboard E2E Tests
 *
 * Tests the Processes tab: queue task list rendering, filtering, detail panel,
 * pause/resume, enqueue dialog, deep links, and frozen task visuals.
 *
 * Data flow: seed queue tasks via REST → page.goto → assert DOM.
 */

import { test, expect } from './fixtures/server-fixture';
import { seedQueueTask, seedQueueTasks, request } from './fixtures/seed';

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

test.describe('Dashboard — Processes tab', () => {
    // ── Existing happy-path tests ───────────────────────────────────────────────

    test('shows empty state when no processes exist', async ({ page, serverUrl }) => {
        await page.goto(serverUrl + '/#processes');
        await expect(page.locator('[data-testid="queue-empty-state"]')).toBeVisible({ timeout: 8000 });
        await expect(page.locator('[data-testid="queue-empty-state"]')).toContainText('No tasks in queue');
    });

    test('displays seeded processes in the sidebar', async ({ page, serverUrl }) => {
        await seedQueueTasks(serverUrl, [
            { type: 'chat', displayName: 'Task 1' },
            { type: 'chat', displayName: 'Task 2' },
            { type: 'chat', displayName: 'Task 3' },
        ]);
        await page.goto(serverUrl + '/#processes');

        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 8000 });
        await expect(page.locator('[data-testid="queue-empty-state"]')).toBeHidden();
    });

    test('clicking a process shows its detail', async ({ page, serverUrl }) => {
        await seedQueueTask(serverUrl, { type: 'chat', displayName: 'Detail Task' });
        await page.goto(serverUrl + '/#processes');

        const taskItem = page.locator('[data-task-id]').first();
        await expect(taskItem).toBeVisible({ timeout: 8000 });
        await taskItem.click();

        await expect(page.locator('[data-testid="activity-chat-detail"]')).toBeVisible({ timeout: 8000 });
    });

    // ── Type filter actually filters the list (replaces search stub) ───────────

    test('type filter dropdown shows only matching task type', async ({ page, serverUrl }) => {
        // Seed two different types and wait for both to complete into history
        const t1 = await seedQueueTask(serverUrl, { type: 'chat', displayName: 'Alpha Chat' });
        const t2 = await seedQueueTask(serverUrl, { type: 'run-workflow', displayName: 'Beta Workflow' });
        await waitForTaskStatus(serverUrl, t1.id as string, ['completed', 'failed']);
        await waitForTaskStatus(serverUrl, t2.id as string, ['completed', 'failed']);

        await page.goto(serverUrl + '/#processes');
        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 8000 });

        // Filter dropdown appears when ≥3 options (All + Chat + Run Workflow)
        const dropdown = page.locator('[data-testid="queue-filter-dropdown"]');
        await expect(dropdown).toBeVisible({ timeout: 5000 });

        // Select run-workflow: only Beta Workflow should remain
        await dropdown.selectOption('run-workflow');
        await expect(page.locator('[title="Beta Workflow"]').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('[title="Alpha Chat"]')).not.toBeVisible();
    });

    // ── Type filter narrows to chat only (replaces status-filter stub) ─────────

    test('type filter shows only chat tasks when chat selected', async ({ page, serverUrl }) => {
        const t1 = await seedQueueTask(serverUrl, { type: 'chat', displayName: 'Chat Only Task' });
        const t2 = await seedQueueTask(serverUrl, { type: 'run-workflow', displayName: 'Workflow Only Task' });
        await waitForTaskStatus(serverUrl, t1.id as string, ['completed', 'failed']);
        await waitForTaskStatus(serverUrl, t2.id as string, ['completed', 'failed']);

        await page.goto(serverUrl + '/#processes');
        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 8000 });

        const dropdown = page.locator('[data-testid="queue-filter-dropdown"]');
        await expect(dropdown).toBeVisible({ timeout: 5000 });
        await dropdown.selectOption('chat');

        await expect(page.locator('[title="Chat Only Task"]').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('[title="Workflow Only Task"]')).not.toBeVisible();
    });

    // ── Completed Tasks section is expanded by default ─────────────────────────

    test('completed tasks section is expanded and shows tasks by default', async ({ page, serverUrl }) => {
        const task = await seedQueueTask(serverUrl, { type: 'chat', displayName: 'History Task' });
        await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);

        await page.goto(serverUrl + '/#processes');

        // Section header visible
        await expect(page.locator('text=Completed Tasks').first()).toBeVisible({ timeout: 8000 });
        // Task cards visible without needing to expand
        await expect(page.locator('[data-task-id]').first()).toBeVisible();
    });

    // ── Completed Tasks section can be collapsed and re-expanded ───────────────

    test('completed tasks section collapses and re-expands on toggle', async ({ page, serverUrl }) => {
        const task = await seedQueueTask(serverUrl, { type: 'chat', displayName: 'Toggle Task' });
        await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);

        await page.goto(serverUrl + '/#processes');
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
    });

    // ── Queued tasks appear when queue is paused ───────────────────────────────

    test('queued tasks section shows tasks when queue is paused', async ({ page, serverUrl }) => {
        // Pause the queue so tasks stay in the queued state
        await request(`${serverUrl}/api/queue/pause`, { method: 'POST' });
        await seedQueueTasks(serverUrl, [
            { type: 'chat', displayName: 'Queued Task A' },
            { type: 'chat', displayName: 'Queued Task B' },
        ]);

        await page.goto(serverUrl + '/#processes');

        // Queued Tasks section header is visible
        await expect(page.locator('text=Queued Tasks').first()).toBeVisible({ timeout: 8000 });
        // Task cards rendered for queued items
        const cards = page.locator('[data-task-id]');
        await expect(cards.first()).toBeVisible({ timeout: 8000 });
        expect(await cards.count()).toBeGreaterThanOrEqual(2);
    });

    // ── Pause/resume button and paused banner ──────────────────────────────────

    test('paused queue shows banner and resume button; clicking resume hides banner', async ({ page, serverUrl }) => {
        // Pause the queue via API then seed a task so the list is non-empty
        await request(`${serverUrl}/api/queue/pause`, { method: 'POST' });
        await seedQueueTask(serverUrl, { type: 'chat', displayName: 'Paused Task' });

        await page.goto(serverUrl + '/#processes');

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
    });

    // ── Enqueue dialog opens from empty-state button ───────────────────────────

    test('enqueue button in empty state opens the enqueue dialog', async ({ page, serverUrl }) => {
        await page.goto(serverUrl + '/#processes');

        await expect(page.locator('[data-testid="queue-empty-state"]')).toBeVisible({ timeout: 8000 });

        // Click the + Queue Task button in the empty state
        await page.locator('[data-testid="repo-queue-task-btn-empty"]').click();

        // EnqueueDialog should open (contains a prompt textarea)
        await expect(page.locator('textarea').first()).toBeVisible({ timeout: 5000 });
    });

    // ── Detail panel placeholder when no task is selected ─────────────────────

    test('detail panel shows placeholder when no task is selected', async ({ page, serverUrl }) => {
        await page.goto(serverUrl + '/#processes');

        // No task selected → right-panel shows "Select a task to view details"
        await expect(page.locator('text=Select a task to view details')).toBeVisible({ timeout: 8000 });
    });

    // ── Deep link selects the task and opens its detail ────────────────────────

    test('deep link #process/queue_<id> opens the task detail', async ({ page, serverUrl }) => {
        const task = await seedQueueTask(serverUrl, { type: 'chat', displayName: 'Deep Link Task' });
        await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);
        const taskId = task.id as string;

        // Navigate directly via the deep link URL
        await page.goto(`${serverUrl}/#process/queue_${taskId}`);

        // Detail panel should open for this queue task
        await expect(page.locator('[data-testid="activity-chat-detail"]')).toBeVisible({ timeout: 8000 });

        // The task card should have the selection ring applied
        const card = page.locator(`[data-task-id="${taskId}"]`);
        await expect(card).toBeVisible({ timeout: 5000 });
        await expect(card).toHaveClass(/ring-2/);
    });

    // ── Frozen task shows ❄️ indicator ─────────────────────────────────────────

    test('frozen queued task shows frozen indicator on card', async ({ page, serverUrl }) => {
        // Pause so the task stays in queued state
        await request(`${serverUrl}/api/queue/pause`, { method: 'POST' });
        const task = await seedQueueTask(serverUrl, { type: 'chat', displayName: 'Frozen Task' });
        const taskId = task.id as string;

        // Freeze via API
        await request(`${serverUrl}/api/queue/${encodeURIComponent(taskId)}/freeze`, { method: 'POST' });

        await page.goto(serverUrl + '/#processes');

        const card = page.locator(`[data-task-id="${taskId}"]`);
        await expect(card).toBeVisible({ timeout: 8000 });

        // Card should have the task-frozen CSS class
        await expect(card).toHaveClass(/task-frozen/);

        // Card should display the ❄️ icon
        await expect(card).toContainText('❄️');
    });
});
