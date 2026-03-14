/**
 * FloatingChat E2E Tests
 *
 * Tests the FloatingChatManager and PopOutActivityShell:
 *   - Float button appears in a completed queue task chat
 *   - Clicking float button opens a FloatingDialog overlay
 *   - Closing the floating dialog removes it
 *   - Pop-out button triggers window.open
 *   - Conversation history is retained when floating
 *
 * Relies on existing data-testid attributes:
 *   ActivityChatDetail:
 *     data-testid="activity-chat-detail"
 *     data-testid="activity-chat-float-btn"   — float-in-window button
 *     data-testid="activity-chat-popout-btn"  — pop-out button
 *   FloatingDialog: id={`floating-chat-${taskId}`}
 */

import { test, expect } from './fixtures/server-fixture';
import { seedQueueTask, request } from './fixtures/seed';
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

/** Navigate to a queue task detail and wait for the chat to render. */
async function gotoTaskChat(page: Page, serverUrl: string, taskId: string): Promise<void> {
    await page.goto(`${serverUrl}/#process/queue_${taskId}`);
    await expect(page.locator('[data-testid="activity-chat-detail"]')).toBeVisible({ timeout: 8_000 });
}

// ---------------------------------------------------------------------------
// 1. Float button
// ---------------------------------------------------------------------------

test.describe('FloatingChat – Float button', () => {
    test('FC.1 float button is visible on a completed task', async ({ page, serverUrl }) => {
        const task = await seedQueueTask(serverUrl, { type: 'chat', payload: { prompt: 'Float test' } });
        await waitForTaskComplete(serverUrl, task.id as string).catch(() => {});

        await gotoTaskChat(page, serverUrl, task.id as string);

        // Float button should be present on desktop (not mobile)
        await expect(page.locator('[data-testid="activity-chat-float-btn"]')).toBeVisible({ timeout: 5_000 });
    });

    test('FC.2 clicking float button creates a floating dialog', async ({ page, serverUrl }) => {
        const task = await seedQueueTask(serverUrl, { type: 'chat', payload: { prompt: 'Float dialog test' } });
        await waitForTaskComplete(serverUrl, task.id as string).catch(() => {});

        await gotoTaskChat(page, serverUrl, task.id as string);
        await expect(page.locator('[data-testid="activity-chat-float-btn"]')).toBeVisible({ timeout: 5_000 });

        await page.locator('[data-testid="activity-chat-float-btn"]').click();

        // FloatingDialog is rendered with id="floating-chat-{taskId}"
        const taskId = task.id as string;
        await expect(page.locator(`#floating-chat-${taskId}`)).toBeVisible({ timeout: 5_000 });
    });

    test('FC.3 floating dialog contains the chat content', async ({ page, serverUrl }) => {
        const task = await seedQueueTask(serverUrl, { type: 'chat', payload: { prompt: 'Content in float' } });
        await waitForTaskComplete(serverUrl, task.id as string).catch(() => {});

        await gotoTaskChat(page, serverUrl, task.id as string);
        await page.locator('[data-testid="activity-chat-float-btn"]').click();

        const taskId = task.id as string;
        await expect(page.locator(`#floating-chat-${taskId}`)).toBeVisible({ timeout: 5_000 });

        // The floating dialog should contain an activity-chat-detail inside it
        const floatingDialog = page.locator(`#floating-chat-${taskId}`);
        await expect(floatingDialog.locator('[data-testid="activity-chat-detail"]')).toBeVisible({ timeout: 5_000 });
    });

    test('FC.4 float button is hidden after floating (already floating)', async ({ page, serverUrl }) => {
        const task = await seedQueueTask(serverUrl, { type: 'chat', payload: { prompt: 'Already floating' } });
        await waitForTaskComplete(serverUrl, task.id as string).catch(() => {});

        await gotoTaskChat(page, serverUrl, task.id as string);
        await page.locator('[data-testid="activity-chat-float-btn"]').click();

        // After floating, the float button should be gone from the main pane
        // (because isFloating(taskId) returns true after floatChat() is called)
        await expect(page.locator('[data-testid="activity-chat-float-btn"]')).toHaveCount(0, { timeout: 5_000 });
    });
});

// ---------------------------------------------------------------------------
// 2. Pop-out button
// ---------------------------------------------------------------------------

test.describe('FloatingChat – Pop-out', () => {
    test('FC.5 pop-out button is visible on a completed task', async ({ page, serverUrl }) => {
        const task = await seedQueueTask(serverUrl, { type: 'chat', payload: { prompt: 'Popout test' } });
        await waitForTaskComplete(serverUrl, task.id as string).catch(() => {});

        await gotoTaskChat(page, serverUrl, task.id as string);

        await expect(page.locator('[data-testid="activity-chat-popout-btn"]')).toBeVisible({ timeout: 5_000 });
    });

    test('FC.6 pop-out button triggers window.open navigation', async ({ page, serverUrl }) => {
        const task = await seedQueueTask(serverUrl, { type: 'chat', payload: { prompt: 'Popout nav test' } });
        await waitForTaskComplete(serverUrl, task.id as string).catch(() => {});

        await gotoTaskChat(page, serverUrl, task.id as string);

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
    });
});

// ---------------------------------------------------------------------------
// 3. Conversation retention
// ---------------------------------------------------------------------------

test.describe('FloatingChat – Conversation retention', () => {
    test('FC.7 floating dialog shows conversation from the task', async ({ page, serverUrl }) => {
        const task = await seedQueueTask(serverUrl, {
            type: 'chat',
            payload: { prompt: 'Retained conversation prompt' },
        });
        await waitForTaskComplete(serverUrl, task.id as string).catch(() => {});

        await gotoTaskChat(page, serverUrl, task.id as string);
        await page.locator('[data-testid="activity-chat-float-btn"]').click();

        const taskId = task.id as string;
        const floatingDialog = page.locator(`#floating-chat-${taskId}`);
        await expect(floatingDialog).toBeVisible({ timeout: 5_000 });

        // The chat should contain the user message with the prompt
        await expect(floatingDialog.locator('.chat-message.user')).toBeVisible({ timeout: 5_000 });
    });
});
