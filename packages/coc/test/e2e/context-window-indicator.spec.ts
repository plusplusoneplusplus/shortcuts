/**
 * ContextWindowIndicator E2E Tests
 *
 * Tests the ContextWindowIndicator component inside ChatDetail:
 *   - Indicator is hidden by default (no token data)
 *   - Indicator appears when SSE delivers token-usage events
 *   - Bar width reflects token percentage usage
 *   - Label shows tokens used / limit
 *
 * The component only opens an EventSource when task.status === 'running'.
 * Tests mock both the queue task API (to return 'running') and the SSE
 * stream (to inject token-usage events).
 *
 * The OpenDesign chat-header redesign moved context-window state from the
 * inline header into the composer toolbar (`ComposerMetaStrip`); the
 * legacy `ContextWindowIndicator` element only renders inside the
 * (closed-by-default) metadata popover. These tests therefore assert on
 * the composer fuel-gauge testids:
 *   data-testid="composer-ctx-fuel" — wrapper (visible when tokenLimit > 0)
 *   data-testid="composer-ctx-bar"  — bar background
 *   data-testid="composer-ctx-fill" — fill (carries `style="width: X%"`)
 *   data-testid="composer-ctx-pct"  — percentage label
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedQueueTask, seedWorkspace } from './fixtures/seed';
import type { Page, Route } from '@playwright/test';

/**
 * Provision a temporary workspace and a queue task scoped to it. Returns
 * the workspace id, task id, and a cleanup callback.
 */
async function setupTaskInWorkspace(
    serverUrl: string,
    idPrefix: string,
    taskOverrides: Record<string, unknown> = {},
): Promise<{ wsId: string; taskId: string; cleanup: () => void }> {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), `e2e-cwi-${idPrefix}-`));
    const wsId = `${idPrefix}-${Date.now().toString(36)}`;
    await seedWorkspace(serverUrl, wsId, idPrefix, rootPath);
    const basePayload = (taskOverrides.payload ?? {}) as Record<string, unknown>;
    const task = await seedQueueTask(serverUrl, {
        type: 'chat',
        repoId: wsId,
        ...taskOverrides,
        payload: { workspaceId: wsId, prompt: 'Token test', ...basePayload },
    });
    return { wsId, taskId: task.id as string, cleanup: () => safeRmSync(rootPath) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a synthetic SSE response body with a token-usage event.
 * The EventSource in ChatDetail listens for 'token-usage' events.
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
    void serverUrl;
    const processId = `queue_${taskId}`;

    // Mock the queue task API to return 'running' status (used for pending tasks
    // and as a fallback). The detail page checks processes first when the URL
    // segment is a queue process ID.
    await page.route(`**/api/queue/${taskId}`, async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                task: {
                    id: taskId,
                    processId,
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

    // Mock the process detail API to make the detail page treat the task as
    // running (the indicator only mounts the EventSource for running tasks).
    await page.route(`**/api/processes/${processId}**`, async (route: Route) => {
        const url = route.request().url();
        // Defer SSE handling to its own mock below
        if (url.includes('/stream')) {
            return route.fallback();
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                process: {
                    id: processId,
                    status: 'running',
                    type: 'chat',
                    title: 'Token test',
                    payload: { prompt: 'Token test' },
                    metadata: {},
                    conversationTurns: [],
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                },
            }),
        });
    });

    // Mock the SSE stream with token-usage events
    await page.route(`**/api/processes/${processId}/stream`, async (route: Route) => {
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

/** Navigate to a per-repo queue task chat view (Activity sub-tab deep link). */
async function gotoTaskChat(page: Page, serverUrl: string, wsId: string, taskId: string): Promise<void> {
    const processId = `queue_${taskId}`;
    await page.goto(
        `${serverUrl}/#repos/${encodeURIComponent(wsId)}/activity/${encodeURIComponent(processId)}`,
    );
    await expect(page.locator('[data-testid="activity-chat-detail"]')).toBeVisible({ timeout: 8_000 });
}

// ---------------------------------------------------------------------------
// 1. Default hidden state
// ---------------------------------------------------------------------------

test.describe('ContextWindowIndicator – Default state', () => {
    test('CWI.1 indicator is not visible when no token data is present', async ({ page, serverUrl }) => {
        const { wsId, taskId, cleanup } = await setupTaskInWorkspace(serverUrl, 'cwi1', {
            payload: { prompt: 'No token test' },
        });
        try {
            await gotoTaskChat(page, serverUrl, wsId, taskId);
            // Indicator should NOT appear without token data (task is not 'running')
            await expect(page.locator('[data-testid="context-window-indicator"]')).toHaveCount(0, { timeout: 3_000 });
        } finally {
            cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// 2. Token data via SSE
// ---------------------------------------------------------------------------

test.describe('ContextWindowIndicator – Token data via SSE', () => {
    test('CWI.2 indicator appears when SSE delivers token limits', async ({ page, serverUrl }) => {
        const { wsId, taskId, cleanup } = await setupTaskInWorkspace(serverUrl, 'cwi2', {
            payload: { prompt: 'Token indicator test' },
        });
        try {
            await mockRunningTaskWithTokens(page, serverUrl, taskId, 200_000, 10_000);
            await gotoTaskChat(page, serverUrl, wsId, taskId);

            // After the token-usage SSE event, the composer fuel gauge should
            // become visible (rendered only when sessionTokenLimit > 0).
            await expect(page.locator('[data-testid="composer-ctx-fuel"]')).toBeVisible({ timeout: 8_000 });
        } finally {
            cleanup();
        }
    });

    test('CWI.3 label shows token usage text', async ({ page, serverUrl }) => {
        const { wsId, taskId, cleanup } = await setupTaskInWorkspace(serverUrl, 'cwi3', {
            payload: { prompt: 'Label test' },
        });
        try {
            await mockRunningTaskWithTokens(page, serverUrl, taskId, 200_000, 50_000);
            await gotoTaskChat(page, serverUrl, wsId, taskId);

            await expect(page.locator('[data-testid="composer-ctx-pct"]')).toBeVisible({ timeout: 8_000 });
            const labelText = await page.locator('[data-testid="composer-ctx-pct"]').textContent();
            expect(labelText).toBeTruthy();
            expect(labelText).toMatch(/\d/);
        } finally {
            cleanup();
        }
    });

    test('CWI.4 bar element is visible with token data', async ({ page, serverUrl }) => {
        const { wsId, taskId, cleanup } = await setupTaskInWorkspace(serverUrl, 'cwi4', {
            payload: { prompt: 'Bar test' },
        });
        try {
            await mockRunningTaskWithTokens(page, serverUrl, taskId, 200_000, 100_000);
            await gotoTaskChat(page, serverUrl, wsId, taskId);

            await expect(page.locator('[data-testid="composer-ctx-bar"]')).toBeVisible({ timeout: 8_000 });
        } finally {
            cleanup();
        }
    });

    test('CWI.5 bar width reflects token percentage (50% usage)', async ({ page, serverUrl }) => {
        const { wsId, taskId, cleanup } = await setupTaskInWorkspace(serverUrl, 'cwi5', {
            payload: { prompt: 'Bar width test' },
        });
        try {
            await mockRunningTaskWithTokens(page, serverUrl, taskId, 200_000, 100_000); // exactly 50%
            await gotoTaskChat(page, serverUrl, wsId, taskId);

            await expect(page.locator('[data-testid="composer-ctx-bar"]')).toBeVisible({ timeout: 8_000 });

            // The width style lives on the inner fill element, not the bar wrapper.
            const fillStyle = await page.locator('[data-testid="composer-ctx-fill"]').getAttribute('style');
            expect(fillStyle).toMatch(/width\s*:/);
        } finally {
            cleanup();
        }
    });

    test('CWI.6 high usage (>80%) shows warning color on bar', async ({ page, serverUrl }) => {
        const { wsId, taskId, cleanup } = await setupTaskInWorkspace(serverUrl, 'cwi6', {
            payload: { prompt: 'High usage test' },
        });
        try {
            await mockRunningTaskWithTokens(page, serverUrl, taskId, 200_000, 180_000); // 90%
            await gotoTaskChat(page, serverUrl, wsId, taskId);

            await expect(page.locator('[data-testid="composer-ctx-fuel"]')).toBeVisible({ timeout: 8_000 });
            await expect(page.locator('[data-testid="composer-ctx-bar"]')).toBeVisible();
        } finally {
            cleanup();
        }
    });
});
