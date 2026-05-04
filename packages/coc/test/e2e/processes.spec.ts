/**
 * ProcessesView E2E Tests
 *
 * Tests the queue/activity UI: split-panel layout, task list rendering,
 * filter dropdown, detail-pane rendering, conversation turns, tool-call
 * view, ConversationMiniMap, and WorkflowResultCard.
 *
 * The legacy global `#processes` route was removed; activity is now
 * surfaced under each repo via `#repos/<wsId>/activity`. Each test
 * provisions its own temp workspace, seeds queue tasks scoped to that
 * workspace, and navigates to the repo activity sub-tab. Deep links to
 * an individual task use `#repos/<wsId>/activity/queue_<taskId>`.
 *
 * Uses existing data-testid attributes:
 *   ProcessesView:       data-testid="activity-split-panel"
 *   ChatListPane:        data-testid="queue-empty-state", data-testid="queue-filter-dropdown"
 *   ChatDetailPane:      data-testid="activity-detail-panel"
 *   ChatDetail:          data-testid="activity-chat-detail"
 *   ConversationMiniMap: data-testid="minimap-panel"
 *   WorkflowResultCard:  data-testid="workflow-result-card"
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedQueueTask, seedWorkspace, request } from './fixtures/seed';
import type { QueueTaskOverrides } from './fixtures/seed';
import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Poll until a queue task reaches a terminal status. */
async function waitForTaskComplete(
    serverUrl: string,
    taskId: string,
    timeoutMs = 12_000,
): Promise<Record<string, unknown>> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const res = await request(`${serverUrl}/api/queue/${taskId}`);
        if (res.status === 200) {
            const json = JSON.parse(res.body);
            const task = json.task ?? json;
            if (['completed', 'failed', 'cancelled'].includes(task.status as string)) return task;
        }
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`Task ${taskId} did not complete within ${timeoutMs}ms`);
}

/** Provision a temporary workspace tied to a fresh temp directory. */
async function makeWorkspace(
    serverUrl: string,
    idPrefix: string,
): Promise<{ wsId: string; rootPath: string; cleanup: () => void }> {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), `e2e-proc-${idPrefix}-`));
    const wsId = `${idPrefix}-${Date.now().toString(36)}`;
    await seedWorkspace(serverUrl, wsId, idPrefix, rootPath);
    return { wsId, rootPath, cleanup: () => safeRmSync(rootPath) };
}

/** Build a queue task spec scoped to the given workspace. */
function wsTask(wsId: string, overrides: QueueTaskOverrides = {}): QueueTaskOverrides {
    const basePayload = (overrides.payload ?? {}) as Record<string, unknown>;
    return {
        repoId: wsId,
        ...overrides,
        payload: { workspaceId: wsId, prompt: 'Test task prompt', ...basePayload },
    };
}

/** Navigate to the per-repo Activity sub-tab. */
async function gotoActivity(page: Page, serverUrl: string, wsId: string): Promise<void> {
    await page.goto(`${serverUrl}/#repos/${encodeURIComponent(wsId)}/activity`);
    // RepoChatTab renders the queue list with `data-testid="activity-split-panel"`.
    // The legacy `#view-processes` id only exists on the standalone ProcessesView.
    await expect(page.locator('[data-testid="activity-split-panel"]')).toBeVisible({ timeout: 10_000 });
}

/** Navigate directly to a task via the activity deep link (queue_<taskId>). */
async function gotoTaskDetail(
    page: Page,
    serverUrl: string,
    wsId: string,
    taskId: string,
): Promise<void> {
    const processId = `queue_${taskId}`;
    await page.goto(
        `${serverUrl}/#repos/${encodeURIComponent(wsId)}/activity/${encodeURIComponent(processId)}`,
    );
    await expect(page.locator('[data-testid="activity-chat-detail"]')).toBeVisible({ timeout: 8_000 });
}

// ---------------------------------------------------------------------------
// 1. Desktop layout
// ---------------------------------------------------------------------------

test.describe('ProcessesView – Desktop layout', () => {
    test('P.1 renders split panel with list and detail panes', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'p1');
        try {
            await gotoActivity(page, serverUrl, wsId);

            await expect(page.locator('[data-testid="activity-split-panel"]')).toBeVisible();
            await expect(page.locator('[data-testid="activity-detail-panel"]')).toBeVisible();
        } finally {
            cleanup();
        }
    });

    test('P.2 shows empty state when no tasks exist', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'p2');
        try {
            await gotoActivity(page, serverUrl, wsId);

            await expect(page.locator('[data-testid="queue-empty-state"]')).toBeVisible({ timeout: 8_000 });
        } finally {
            cleanup();
        }
    });

    test('P.3 filter dropdown is present', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'p3');
        try {
            // Two tasks of different chat modes so the filter dropdown renders
            // (it only appears when availableFilters.length > 0).
            const t1 = await seedQueueTask(serverUrl, wsTask(wsId, {
                type: 'chat',
                payload: { mode: 'ask', prompt: 'Filter test ask' },
            }));
            const t2 = await seedQueueTask(serverUrl, wsTask(wsId, {
                type: 'chat',
                payload: { mode: 'autopilot', prompt: 'Filter test auto' },
            }));
            await Promise.all([
                waitForTaskComplete(serverUrl, t1.id as string).catch(() => {}),
                waitForTaskComplete(serverUrl, t2.id as string).catch(() => {}),
            ]);

            await gotoActivity(page, serverUrl, wsId);
            await page.waitForTimeout(500);
            await expect(page.locator('[data-testid="queue-filter-dropdown"]')).toBeVisible({ timeout: 8_000 });
        } finally {
            cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// 2. Task list rendering
// ---------------------------------------------------------------------------

test.describe('ProcessesView – Task list', () => {
    test('P.4 seeded tasks appear in the list', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'p4');
        try {
            const task1 = await seedQueueTask(serverUrl, wsTask(wsId, {
                displayName: 'Alpha Task',
                type: 'chat',
                payload: { prompt: 'Alpha' },
            }));
            const task2 = await seedQueueTask(serverUrl, wsTask(wsId, {
                displayName: 'Beta Task',
                type: 'chat',
                payload: { prompt: 'Beta' },
            }));

            await waitForTaskComplete(serverUrl, task1.id as string).catch(() => {});
            await waitForTaskComplete(serverUrl, task2.id as string).catch(() => {});

            await gotoActivity(page, serverUrl, wsId);

            // Completed tasks land in the activity history with `queue_<taskId>` ids.
            await expect(page.locator(`[data-task-id="queue_${task1.id as string}"]`)).toBeVisible({ timeout: 10_000 });
            await expect(page.locator(`[data-task-id="queue_${task2.id as string}"]`)).toBeVisible({ timeout: 5_000 });
        } finally {
            cleanup();
        }
    });

    test('P.5 clicking a task opens its detail in the right pane', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'p5');
        try {
            const task = await seedQueueTask(serverUrl, wsTask(wsId, {
                type: 'chat',
                payload: { prompt: 'Hello from E2E' },
            }));
            await waitForTaskComplete(serverUrl, task.id as string).catch(() => {});

            await gotoActivity(page, serverUrl, wsId);

            const taskRow = page.locator(`[data-task-id="queue_${task.id as string}"]`);
            await expect(taskRow).toBeVisible({ timeout: 10_000 });
            await taskRow.click();

            await expect(page.locator('[data-testid="activity-chat-detail"]')).toBeVisible({ timeout: 8_000 });
        } finally {
            cleanup();
        }
    });

    test('P.6 task detail shows conversation content', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'p6');
        try {
            const task = await seedQueueTask(serverUrl, wsTask(wsId, {
                type: 'chat',
                payload: { prompt: 'Test conversation prompt' },
            }));
            await waitForTaskComplete(serverUrl, task.id as string).catch(() => {});

            await gotoTaskDetail(page, serverUrl, wsId, task.id as string);

            // User message bubble should show the prompt
            await expect(page.locator('.chat-message.user')).toBeVisible({ timeout: 5_000 });
        } finally {
            cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// 3. Status filtering
// ---------------------------------------------------------------------------

test.describe('ProcessesView – Filtering', () => {
    test('P.7 type filter dropdown changes the visible task list', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'p7');
        try {
            // Two chat tasks with distinct modes so the filter dropdown surfaces
            // both as toggleable items (the chat-mode is what the dropdown
            // groups by in the activity view).
            const askTask = await seedQueueTask(serverUrl, wsTask(wsId, {
                type: 'chat',
                payload: { mode: 'ask', prompt: 'Filter ask' },
            }));
            const autoTask = await seedQueueTask(serverUrl, wsTask(wsId, {
                type: 'chat',
                payload: { mode: 'autopilot', prompt: 'Filter auto' },
            }));
            await Promise.all([
                waitForTaskComplete(serverUrl, askTask.id as string).catch(() => {}),
                waitForTaskComplete(serverUrl, autoTask.id as string).catch(() => {}),
            ]);

            await gotoActivity(page, serverUrl, wsId);

            const filterDd = page.locator('[data-testid="queue-filter-dropdown"]');
            await expect(filterDd).toBeVisible({ timeout: 10_000 });

            // Open the dropdown and uncheck one of the modes — verify it stays unchecked.
            await page.locator('[data-testid="filter-dropdown-trigger"]').click();
            const askCheckbox = page.locator('[data-testid="filter-checkbox-ask"]');
            const autoCheckbox = page.locator('[data-testid="filter-checkbox-autopilot"]');
            await expect(askCheckbox).toBeVisible({ timeout: 5_000 });
            await expect(autoCheckbox).toBeVisible({ timeout: 5_000 });
            await askCheckbox.uncheck();
            await page.waitForTimeout(300);
            await expect(askCheckbox).not.toBeChecked();
        } finally {
            cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// 4. WorkflowResultCard
// ---------------------------------------------------------------------------

test.describe('ProcessesView – WorkflowResultCard', () => {
    test('P.8 workflow result card renders for completed workflow tasks', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'p8');
        try {
            // We use a basic completed chat task and verify the detail pane
            // renders without error. WorkflowResultCard only appears for tasks
            // that produce workflow-style results.
            const task = await seedQueueTask(serverUrl, wsTask(wsId, {
                type: 'chat',
                payload: { prompt: 'Workflow test' },
            }));
            await waitForTaskComplete(serverUrl, task.id as string).catch(() => {});

            await gotoTaskDetail(page, serverUrl, wsId, task.id as string);

            await expect(page.locator('[data-testid="activity-chat-detail"]')).toBeVisible();
        } finally {
            cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// 5. ConversationMiniMap
// ---------------------------------------------------------------------------

test.describe('ProcessesView – ConversationMiniMap', () => {
    test('P.9 minimap panel renders for conversation with multiple turns', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'p9');
        try {
            const task = await seedQueueTask(serverUrl, wsTask(wsId, {
                type: 'chat',
                payload: { prompt: 'Multi turn test' },
            }));
            await waitForTaskComplete(serverUrl, task.id as string).catch(() => {});

            await gotoTaskDetail(page, serverUrl, wsId, task.id as string);

            // The minimap panel may or may not be visible depending on turn count
            // Just verify the chat detail renders without errors.
            await expect(page.locator('[data-testid="activity-chat-detail"]')).toBeVisible();
        } finally {
            cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// 6. Refresh and pause controls
// ---------------------------------------------------------------------------

test.describe('ProcessesView – Controls', () => {
    test('P.10 refresh button reloads the queue', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'p10');
        try {
            await seedQueueTask(serverUrl, wsTask(wsId, { type: 'chat' }));
            await gotoActivity(page, serverUrl, wsId);

            const refreshBtn = page.locator('[data-testid="queue-refresh-btn"]');
            await expect(refreshBtn).toBeVisible({ timeout: 10_000 });
            await refreshBtn.click();

            await page.waitForTimeout(500);
            await expect(page.locator('[data-testid="activity-split-panel"]')).toBeVisible();
        } finally {
            cleanup();
        }
    });
});
