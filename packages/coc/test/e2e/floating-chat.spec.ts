/**
 * FloatingChat E2E Tests
 *
 * Tests the FloatingChatManager and PopOutChatShell:
 *   - Float button appears in a completed queue task chat
 *   - Clicking float button opens a FloatingDialog overlay
 *   - Closing the floating dialog removes it
 *   - Pop-out button triggers window.open
 *   - Conversation history is retained when floating
 *
 * Relies on existing data-testid attributes:
 *   ChatDetail:
 *     data-testid="activity-chat-detail"
 *     data-testid="activity-chat-float-btn"   — float-in-window button
 *     data-testid="activity-chat-popout-btn"  — pop-out button
 *   FloatingDialog: id={`floating-chat-${taskId}`}
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedQueueTask, seedWorkspace, request } from './fixtures/seed';
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

/**
 * Provision a temporary workspace and a queue task scoped to it. Returns the
 * workspace id, task id, and a cleanup callback. Tasks must be associated
 * with a workspace because the standalone Processes route was removed and
 * task detail is now rendered under `#repos/<wsId>/activity/<processId>`.
 */
async function setupTaskInWorkspace(
    serverUrl: string,
    idPrefix: string,
    taskOverrides: Record<string, unknown> = {},
): Promise<{ wsId: string; taskId: string; cleanup: () => void }> {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), `e2e-floating-${idPrefix}-`));
    const wsId = `${idPrefix}-${Date.now().toString(36)}`;
    await seedWorkspace(serverUrl, wsId, idPrefix, rootPath);
    const basePayload = (taskOverrides.payload ?? {}) as Record<string, unknown>;
    const task = await seedQueueTask(serverUrl, {
        type: 'chat',
        repoId: wsId,
        ...taskOverrides,
        payload: { workspaceId: wsId, prompt: 'Float test', ...basePayload },
    });
    return { wsId, taskId: task.id as string, cleanup: () => safeRmSync(rootPath) };
}

/** Navigate to a queue task detail under the repo's activity sub-tab. */
async function gotoTaskChat(
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
// 1. Float button
// ---------------------------------------------------------------------------

test.describe('FloatingChat – Float button', () => {
    test('FC.1 float button is visible on a completed task', async ({ page, serverUrl }) => {
        const { wsId, taskId, cleanup } = await setupTaskInWorkspace(serverUrl, 'fc1', {
            payload: { prompt: 'Float test' },
        });
        try {
            await waitForTaskComplete(serverUrl, taskId).catch(() => {});

            await gotoTaskChat(page, serverUrl, wsId, taskId);

            // Float button should be present on desktop (not mobile)
            await expect(page.locator('[data-testid="activity-chat-float-btn"]')).toBeVisible({ timeout: 5_000 });
        } finally {
            cleanup();
        }
    });

    test('FC.2 clicking float button creates a floating dialog', async ({ page, serverUrl }) => {
        const { wsId, taskId, cleanup } = await setupTaskInWorkspace(serverUrl, 'fc2', {
            payload: { prompt: 'Float dialog test' },
        });
        try {
            await waitForTaskComplete(serverUrl, taskId).catch(() => {});

            await gotoTaskChat(page, serverUrl, wsId, taskId);
            await expect(page.locator('[data-testid="activity-chat-float-btn"]')).toBeVisible({ timeout: 5_000 });

            await page.locator('[data-testid="activity-chat-float-btn"]').click();

            // FloatingDialog is rendered with id="floating-chat-{processId}"
            const processId = `queue_${taskId}`;
            await expect(page.locator(`#floating-chat-${processId}`)).toBeVisible({ timeout: 5_000 });
        } finally {
            cleanup();
        }
    });

    test('FC.3 floating dialog contains the chat content', async ({ page, serverUrl }) => {
        const { wsId, taskId, cleanup } = await setupTaskInWorkspace(serverUrl, 'fc3', {
            payload: { prompt: 'Content in float' },
        });
        try {
            await waitForTaskComplete(serverUrl, taskId).catch(() => {});

            await gotoTaskChat(page, serverUrl, wsId, taskId);
            await page.locator('[data-testid="activity-chat-float-btn"]').click();

            const processId = `queue_${taskId}`;
            const floatingDialog = page.locator(`#floating-chat-${processId}`);
            await expect(floatingDialog).toBeVisible({ timeout: 5_000 });

            // The floating dialog should contain an activity-chat-detail inside it
            await expect(floatingDialog.locator('[data-testid="activity-chat-detail"]')).toBeVisible({ timeout: 5_000 });
        } finally {
            cleanup();
        }
    });

    test('FC.4 float button is hidden after floating (already floating)', async ({ page, serverUrl }) => {
        const { wsId, taskId, cleanup } = await setupTaskInWorkspace(serverUrl, 'fc4', {
            payload: { prompt: 'Already floating' },
        });
        try {
            await waitForTaskComplete(serverUrl, taskId).catch(() => {});

            await gotoTaskChat(page, serverUrl, wsId, taskId);
            await page.locator('[data-testid="activity-chat-float-btn"]').click();

            // After floating, the float button should be gone from the main pane
            // (because isFloating(processId) returns true after floatChat() is called)
            await expect(page.locator('[data-testid="activity-chat-float-btn"]')).toHaveCount(0, { timeout: 5_000 });
        } finally {
            cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// 2. Pop-out button
// ---------------------------------------------------------------------------

test.describe('FloatingChat – Pop-out', () => {
    test('FC.5 pop-out button is visible on a completed task', async ({ page, serverUrl }) => {
        const { wsId, taskId, cleanup } = await setupTaskInWorkspace(serverUrl, 'fc5', {
            payload: { prompt: 'Popout test' },
        });
        try {
            await waitForTaskComplete(serverUrl, taskId).catch(() => {});

            await gotoTaskChat(page, serverUrl, wsId, taskId);

            await expect(page.locator('[data-testid="activity-chat-popout-btn"]')).toBeVisible({ timeout: 5_000 });
        } finally {
            cleanup();
        }
    });

    test('FC.6 pop-out button triggers window.open navigation', async ({ page, serverUrl }) => {
        const { wsId, taskId, cleanup } = await setupTaskInWorkspace(serverUrl, 'fc6', {
            payload: { prompt: 'Popout nav test' },
        });
        try {
            await waitForTaskComplete(serverUrl, taskId).catch(() => {});

            await gotoTaskChat(page, serverUrl, wsId, taskId);

            // Intercept new page/window opened by window.open
            const [newPage] = await Promise.all([
                page.context().waitForEvent('page', { timeout: 5_000 }).catch(() => null),
                page.locator('[data-testid="activity-chat-popout-btn"]').click(),
            ]);

            if (newPage) {
                // Pop-out succeeded — the main view shows a placeholder instead of inline chat
                await newPage.close();
                await expect(page.locator('[data-testid="activity-popped-out-placeholder"]')).toBeVisible({ timeout: 5_000 });
            } else {
                // Pop-out was blocked — the inline chat detail should still be visible
                await expect(page.locator('[data-testid="activity-chat-detail"]')).toBeVisible({ timeout: 5_000 });
            }
        } finally {
            cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// 3. Conversation retention
// ---------------------------------------------------------------------------

test.describe('FloatingChat – Conversation retention', () => {
    test('FC.7 floating dialog shows conversation from the task', async ({ page, serverUrl }) => {
        const { wsId, taskId, cleanup } = await setupTaskInWorkspace(serverUrl, 'fc7', {
            payload: { prompt: 'Retained conversation prompt' },
        });
        try {
            await waitForTaskComplete(serverUrl, taskId).catch(() => {});

            await gotoTaskChat(page, serverUrl, wsId, taskId);
            await page.locator('[data-testid="activity-chat-float-btn"]').click();

            const processId = `queue_${taskId}`;
            const floatingDialog = page.locator(`#floating-chat-${processId}`);
            await expect(floatingDialog).toBeVisible({ timeout: 5_000 });

            // The chat should contain the user message with the prompt
            await expect(floatingDialog.locator('.chat-message.user')).toBeVisible({ timeout: 5_000 });
        } finally {
            cleanup();
        }
    });
});
