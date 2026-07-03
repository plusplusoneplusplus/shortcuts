/**
 * Metadata Popover Log Link E2E Tests
 *
 * Verifies the "🔍 logs" link in the ConversationMetadataPopover:
 * - Grid layout remains intact (2-column alignment) when a session ID link is present
 * - The link navigates to #logs?sessionId=...
 * - The session filter chip appears in the Logs view
 *
 * Note: The `view-logs-btn` in ProcessDetail.tsx is dead code (component is never
 * imported/rendered). Queue tasks use ChatDetail → ChatHeader which renders
 * ConversationMetadataPopover but has no standalone logs button.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedQueueTask, seedWorkspace, request } from './fixtures/seed';
import type { Page } from '@playwright/test';

/** Poll GET /api/queue/:id until status matches or timeout expires. */
async function waitForTaskStatus(
    serverUrl: string,
    taskId: string,
    targetStatuses: string[],
    timeoutMs = 10_000,
    intervalMs = 250,
): Promise<Record<string, unknown>> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const res = await request(`${serverUrl}/api/queue/${taskId}`);
        if (res.status === 200) {
            const json = JSON.parse(res.body);
            const task = json.task ?? json;
            if (targetStatuses.includes(task.status as string)) {
                return task;
            }
        }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(
        `Task ${taskId} did not reach ${targetStatuses.join('|')} within ${timeoutMs}ms`,
    );
}

async function gotoConversation(
    page: Page,
    serverUrl: string,
    wsId: string,
    taskId: string,
): Promise<void> {
    const processId = `queue_${taskId}`;
    await page.goto(
        `${serverUrl}/#repos/${encodeURIComponent(wsId)}/activity/${encodeURIComponent(processId)}`,
    );
    await page.waitForSelector('[data-testid="activity-chat-detail"]', { timeout: 8_000 });
}

/** Provision a workspace + queue task scoped to it. */
async function setup(
    serverUrl: string,
    idPrefix: string,
    payload: Record<string, unknown>,
): Promise<{ wsId: string; taskId: string; cleanup: () => void }> {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), `e2e-meta-${idPrefix}-`));
    const wsId = `${idPrefix}-${Date.now().toString(36)}`;
    await seedWorkspace(serverUrl, wsId, idPrefix, rootPath);
    const task = await seedQueueTask(serverUrl, {
        type: 'chat',
        repoId: wsId,
        payload: { workspaceId: wsId, ...payload },
    });
    return { wsId, taskId: task.id as string, cleanup: () => safeRmSync(rootPath) };
}

async function openMetadataPopover(page: Page): Promise<void> {
    // Metadata trigger is now inside the overflow menu — open it first
    const overflowBtn = page.locator('[data-testid="chat-header-overflow-btn"]');
    await expect(overflowBtn).toBeVisible({ timeout: 8_000 });
    await overflowBtn.click();
    const trigger = page.locator('button[aria-label="Show conversation metadata"]');
    await expect(trigger).toBeVisible({ timeout: 8_000 });
    await trigger.click();
    await expect(page.locator('text=Conversation metadata')).toBeVisible({ timeout: 5_000 });
}

// ── Metadata popover log link ──────────────────────────────────────────────

test.describe('Metadata popover — log link', () => {
    test('renders "🔍 logs" link with correct href in the metadata popover', async ({
        serverUrl,
        mockAI,
        page,
    }) => {
        mockAI.mockSendMessage.mockResolvedValueOnce({
            success: true,
            response: 'Test response',
            sessionId: 'e2e-session-42',
        });

        const { wsId, taskId, cleanup } = await setup(serverUrl, 'meta1', { prompt: 'Hello world' });
        try {
            await waitForTaskStatus(serverUrl, taskId, ['completed', 'failed']);
            await gotoConversation(page, serverUrl, wsId, taskId);
            await openMetadataPopover(page);

            // The "🔍 logs" link should be present and have the correct href
            const logLink = page.locator('a[title="View logs for this session"]');
            await expect(logLink).toBeVisible();
            const href = await logLink.getAttribute('href');
            expect(href).toContain('#logs?sessionId=');
            expect(href).toContain('e2e-session-42');
        } finally {
            cleanup();
        }
    });

    test('grid rows are properly aligned with 2 children per row (no overflow)', async ({
        serverUrl,
        mockAI,
        page,
    }) => {
        mockAI.mockSendMessage.mockResolvedValueOnce({
            success: true,
            response: 'Alignment test',
            sessionId: 'alignment-sess',
        });

        const { wsId, taskId, cleanup } = await setup(serverUrl, 'meta2', { prompt: 'Test alignment' });
        try {
            await waitForTaskStatus(serverUrl, taskId, ['completed', 'failed']);
            await gotoConversation(page, serverUrl, wsId, taskId);
            await openMetadataPopover(page);

            // Every .contents row inside the metadata popover grid should have
            // exactly 2 direct children (label in col 1, value/wrapper in col 2).
            // Scope the query from the log link to avoid coupling to the grid's
            // exact responsive column widths.
            const childCounts = await page.evaluate(() => {
                const link = document.querySelector('a[title="View logs for this session"]');
                const grid = link?.closest('div.grid');
                if (!grid) return [];
                return Array.from(grid.children)
                    .filter((child) => child.classList.contains('contents'))
                    .map((row) => row.children.length);
            });

            expect(childCounts.length).toBeGreaterThan(0);
            for (const count of childCounts) {
                expect(count).toBe(2);
            }

            // Verify the Session ID row specifically has the link inside col 2 wrapper
            const sessionLinkInsideWrapper = await page.evaluate(() => {
                const link = document.querySelector('a[title="View logs for this session"]');
                if (!link) return false;
                // Link should be inside a flex wrapper div, not a direct child of .contents
                const parent = link.parentElement;
                return parent?.tagName === 'DIV' && parent?.classList.contains('flex');
            });
            expect(sessionLinkInsideWrapper).toBe(true);
        } finally {
            cleanup();
        }
    });

    test('clicking the "🔍 logs" link navigates to logs view with session filter', async ({
        serverUrl,
        mockAI,
        page,
    }) => {
        mockAI.mockSendMessage.mockResolvedValueOnce({
            success: true,
            response: 'Navigation test',
            sessionId: 'nav-session-99',
        });

        const { wsId, taskId, cleanup } = await setup(serverUrl, 'meta3', { prompt: 'Navigate test' });
        try {
            await waitForTaskStatus(serverUrl, taskId, ['completed', 'failed']);
            await gotoConversation(page, serverUrl, wsId, taskId);
            await openMetadataPopover(page);

            // Click the log link
            const logLink = page.locator('a[title="View logs for this session"]');
            await logLink.click();

            // URL should contain the session ID hash
            await page.waitForFunction(
                () => location.hash.includes('logs?sessionId='),
                null,
                { timeout: 5_000 },
            );
            expect(page.url()).toContain('#logs?sessionId=nav-session-99');

            // The Logs view should be visible with the session filter chip
            await expect(page.locator('[data-testid="logs-view"]')).toBeVisible({ timeout: 8_000 });
            await expect(page.locator('[data-testid="session-filter-chip"]')).toBeVisible({ timeout: 5_000 });
        } finally {
            cleanup();
        }
    });

    test('no log link appears when process has no session ID', async ({
        serverUrl,
        mockAI,
        page,
    }) => {
        // Return a response without sessionId
        mockAI.mockSendMessage.mockResolvedValueOnce({
            success: true,
            response: 'No session test',
        });

        const { wsId, taskId, cleanup } = await setup(serverUrl, 'meta4', { prompt: 'No session' });
        try {
            await waitForTaskStatus(serverUrl, taskId, ['completed', 'failed']);
            await gotoConversation(page, serverUrl, wsId, taskId);
            await openMetadataPopover(page);

            // No log link should be present
            const logLink = page.locator('a[title="View logs for this session"]');
            await expect(logLink).toHaveCount(0);

            // Session ID row should not appear at all
            const sessionRow = page.locator('text=Session ID');
            await expect(sessionRow).toHaveCount(0);
        } finally {
            cleanup();
        }
    });
});
