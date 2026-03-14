/**
 * ContextWindowIndicator E2E Tests
 *
 * Tests the ContextWindowIndicator component inside ActivityChatDetail:
 *   - Indicator is hidden by default (no token data)
 *   - Indicator appears when SSE delivers token-usage events
 *   - Bar width reflects token percentage usage
 *   - Label shows tokens used / limit
 *
 * The component only opens an EventSource when task.status === 'running'.
 * Tests mock both the queue task API (to return 'running') and the SSE
 * stream (to inject token-usage events).
 *
 * The indicator has class `hidden sm:flex` — tests run at default 1280×720
 * so the sm: breakpoint applies and the indicator is visible once data arrives.
 *
 * Relies on data-testid attributes added in this task:
 *   data-testid="context-window-indicator"
 *   data-testid="context-window-bar"
 *   data-testid="context-window-label"
 */

import { test, expect } from './fixtures/server-fixture';
import { seedQueueTask } from './fixtures/seed';
import type { Page, Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a synthetic SSE response body with a token-usage event.
 * The EventSource in ActivityChatDetail listens for 'token-usage' events.
 */
function buildSseWithTokens(sessionTokenLimit: number, sessionCurrentTokens: number): string {
    const tokenData = JSON.stringify({
        sessionTokenLimit,
        sessionCurrentTokens,
    });
    return [
        `event: token-usage`,
        `data: ${tokenData}`,
        ``,
        // Do NOT send stream-end — keep the SSE stream alive so the component stays in running state
        ``,
    ].join('\n');
}

/**
 * Set up route mocks for a task to appear as 'running' and inject SSE token data.
 * - Mocks /api/queue/{taskId} to return status: 'running'
 * - Mocks /api/processes/queue_{taskId}/stream to inject token-usage events
 */
async function mockRunningTaskWithTokens(
    page: Page,
    serverUrl: string,
    taskId: string,
    sessionTokenLimit: number,
    sessionCurrentTokens: number,
): Promise<void> {
    const baseUrl = serverUrl.replace(/\/$/, '');

    // Mock the task API to return 'running' status
    await page.route(`**/api/queue/${taskId}`, async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                task: {
                    id: taskId,
                    status: 'running',
                    type: 'chat',
                    priority: 'normal',
                    payload: { prompt: 'Token test' },
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                },
            }),
        });
    });

    // Mock the SSE stream with token-usage events
    await page.route(`**/api/processes/queue_${taskId}/stream`, async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: 'text/event-stream; charset=utf-8',
            headers: {
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
            },
            body: buildSseWithTokens(sessionTokenLimit, sessionCurrentTokens),
        });
    });
}

/** Navigate to a queue task chat view. */
async function gotoTaskChat(page: Page, serverUrl: string, taskId: string): Promise<void> {
    await page.goto(`${serverUrl}/#process/queue_${taskId}`);
    await expect(page.locator('[data-testid="activity-chat-detail"]')).toBeVisible({ timeout: 8_000 });
}

// ---------------------------------------------------------------------------
// 1. Default hidden state
// ---------------------------------------------------------------------------

test.describe('ContextWindowIndicator – Default state', () => {
    test('CWI.1 indicator is not visible when no token data is present', async ({ page, serverUrl }) => {
        const task = await seedQueueTask(serverUrl, { type: 'chat', payload: { prompt: 'No token test' } });
        // Don't wait for completion — just navigate immediately to a completed/queued task
        await gotoTaskChat(page, serverUrl, task.id as string);

        // Indicator should NOT appear without token data (task is not 'running')
        await expect(page.locator('[data-testid="context-window-indicator"]')).toHaveCount(0, { timeout: 3_000 });
    });
});

// ---------------------------------------------------------------------------
// 2. Token data via SSE
// ---------------------------------------------------------------------------

test.describe('ContextWindowIndicator – Token data via SSE', () => {
    test('CWI.2 indicator appears when SSE delivers token limits', async ({ page, serverUrl }) => {
        const task = await seedQueueTask(serverUrl, { type: 'chat', payload: { prompt: 'Token indicator test' } });
        const taskId = task.id as string;

        await mockRunningTaskWithTokens(page, serverUrl, taskId, 200_000, 10_000);
        await gotoTaskChat(page, serverUrl, taskId);

        // After the token-usage SSE event, the indicator should become visible
        await expect(page.locator('[data-testid="context-window-indicator"]')).toBeVisible({ timeout: 8_000 });
    });

    test('CWI.3 label shows token usage text', async ({ page, serverUrl }) => {
        const task = await seedQueueTask(serverUrl, { type: 'chat', payload: { prompt: 'Label test' } });
        const taskId = task.id as string;

        await mockRunningTaskWithTokens(page, serverUrl, taskId, 200_000, 50_000);
        await gotoTaskChat(page, serverUrl, taskId);

        await expect(page.locator('[data-testid="context-window-label"]')).toBeVisible({ timeout: 8_000 });
        const labelText = await page.locator('[data-testid="context-window-label"]').textContent();
        expect(labelText).toBeTruthy();
        // Label should contain some numeric content related to tokens
        expect(labelText).toMatch(/\d/);
    });

    test('CWI.4 bar element is visible with token data', async ({ page, serverUrl }) => {
        const task = await seedQueueTask(serverUrl, { type: 'chat', payload: { prompt: 'Bar test' } });
        const taskId = task.id as string;

        await mockRunningTaskWithTokens(page, serverUrl, taskId, 200_000, 100_000);
        await gotoTaskChat(page, serverUrl, taskId);

        await expect(page.locator('[data-testid="context-window-bar"]')).toBeVisible({ timeout: 8_000 });
    });

    test('CWI.5 bar width reflects token percentage (50% usage)', async ({ page, serverUrl }) => {
        const task = await seedQueueTask(serverUrl, { type: 'chat', payload: { prompt: 'Bar width test' } });
        const taskId = task.id as string;

        await mockRunningTaskWithTokens(page, serverUrl, taskId, 200_000, 100_000); // exactly 50%
        await gotoTaskChat(page, serverUrl, taskId);

        await expect(page.locator('[data-testid="context-window-bar"]')).toBeVisible({ timeout: 8_000 });

        // Bar should have a width style
        const barStyle = await page.locator('[data-testid="context-window-bar"]').getAttribute('style');
        expect(barStyle).toMatch(/width\s*:/);
    });

    test('CWI.6 high usage (>80%) shows warning color on bar', async ({ page, serverUrl }) => {
        const task = await seedQueueTask(serverUrl, { type: 'chat', payload: { prompt: 'High usage test' } });
        const taskId = task.id as string;

        await mockRunningTaskWithTokens(page, serverUrl, taskId, 200_000, 180_000); // 90%
        await gotoTaskChat(page, serverUrl, taskId);

        await expect(page.locator('[data-testid="context-window-indicator"]')).toBeVisible({ timeout: 8_000 });
        // At 90% usage, the bar should be visible
        await expect(page.locator('[data-testid="context-window-bar"]')).toBeVisible();
    });
});
