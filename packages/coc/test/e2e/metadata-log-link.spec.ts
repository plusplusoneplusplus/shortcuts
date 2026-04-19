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

import { test, expect } from './fixtures/server-fixture';
import { seedQueueTask, request } from './fixtures/seed';
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

async function gotoConversation(page: Page, serverUrl: string, taskId: string): Promise<void> {
    await page.goto(`${serverUrl}/#process/queue_${taskId}`);
    await page.waitForSelector('[data-testid="activity-chat-detail"]', { timeout: 8_000 });
}

async function openMetadataPopover(page: Page): Promise<void> {
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

        const task = await seedQueueTask(serverUrl, {
            type: 'chat',
            payload: { prompt: 'Hello world' },
        });

        await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);
        await gotoConversation(page, serverUrl, task.id as string);
        await openMetadataPopover(page);

        // The "🔍 logs" link should be present and have the correct href
        const logLink = page.locator('a[title="View logs for this session"]');
        await expect(logLink).toBeVisible();
        const href = await logLink.getAttribute('href');
        expect(href).toContain('#logs?sessionId=');
        expect(href).toContain('e2e-session-42');
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

        const task = await seedQueueTask(serverUrl, {
            type: 'chat',
            payload: { prompt: 'Test alignment' },
        });

        await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);
        await gotoConversation(page, serverUrl, task.id as string);
        await openMetadataPopover(page);

        // Every .contents row in the grid should have exactly 2 direct children
        // (label in col 1, value/wrapper in col 2). The bug caused 3 children
        // when a link was present, breaking subsequent rows.
        const childCounts = await page.evaluate(() => {
            const rows = document.querySelectorAll('.contents');
            return Array.from(rows).map((row) => row.children.length);
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

        const task = await seedQueueTask(serverUrl, {
            type: 'chat',
            payload: { prompt: 'Navigate test' },
        });

        await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);
        await gotoConversation(page, serverUrl, task.id as string);
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

        const task = await seedQueueTask(serverUrl, {
            type: 'chat',
            payload: { prompt: 'No session' },
        });

        await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);
        await gotoConversation(page, serverUrl, task.id as string);
        await openMetadataPopover(page);

        // No log link should be present
        const logLink = page.locator('a[title="View logs for this session"]');
        await expect(logLink).toHaveCount(0);

        // Session ID row should not appear at all
        const sessionRow = page.locator('text=Session ID');
        await expect(sessionRow).toHaveCount(0);
    });
});
