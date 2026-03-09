/**
 * Queue File Path Hover E2E Tests
 *
 * Playwright spec asserting that file paths in chat messages are:
 * 1. Linkified with `.file-path-link` spans (user and assistant bubbles)
 * 2. NOT linkified when inside inline code backticks
 * 3. Hoverable with a tooltip preview
 */

import { test, expect } from './fixtures/server-fixture';
import { seedQueueTask, request } from './fixtures/seed';
import type { Page } from '@playwright/test';

// ── Shared helpers ────────────────────────────────────────────────────────────

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

async function waitForBubbles(page: Page, count: number, timeoutMs = 6_000): Promise<void> {
    await page.waitForFunction(
        (n) => document.querySelectorAll('.chat-message').length >= n,
        count,
        { timeout: timeoutMs },
    );
}

// ── Group A: File Path Linkification in User Messages ─────────────────────────

test.describe('File Path Linkification in User Messages', () => {
    test('Windows path is linkified in user bubble', async ({ serverUrl, mockAI, page }) => {
        mockAI.mockSendMessage.mockResolvedValueOnce({
            success: true,
            response: 'Done.',
            sessionId: 'sess-fp-1',
        });

        const task = await seedQueueTask(serverUrl, {
            payload: {
                prompt: 'Use the impl skill. D:\\projects\\shortcuts\\src\\extension.ts',
            },
        });

        await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);
        await gotoConversation(page, serverUrl, task.id as string);
        await waitForBubbles(page, 1);

        const link = page.locator('.chat-message.user .file-path-link');
        await expect(link).toHaveCount(1);

        const fullPath = await link.getAttribute('data-full-path');
        expect(fullPath).toContain('D:/projects/shortcuts/src/extension.ts');

        // Displayed text is present and matches the (possibly shortened) path
        const displayText = await link.textContent();
        expect(displayText!.length).toBeGreaterThan(0);
    });

    test('Unix path is linkified in user bubble', async ({ serverUrl, mockAI, page }) => {
        mockAI.mockSendMessage.mockResolvedValueOnce({
            success: true,
            response: 'Editing now.',
            sessionId: 'sess-fp-2',
        });

        const task = await seedQueueTask(serverUrl, {
            payload: { prompt: 'Edit /Users/alice/projects/foo/bar.ts please' },
        });

        await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);
        await gotoConversation(page, serverUrl, task.id as string);
        await waitForBubbles(page, 1);

        const link = page.locator('.chat-message.user .file-path-link');
        await expect(link).toHaveCount(1);

        const fullPath = await link.getAttribute('data-full-path');
        expect(fullPath).toContain('/Users/alice/projects/foo/bar.ts');
    });

    test('path inside inline code is NOT linkified', async ({ serverUrl, mockAI, page }) => {
        mockAI.mockSendMessage.mockResolvedValueOnce({
            success: true,
            response: 'OK.',
            sessionId: 'sess-fp-3',
        });

        const task = await seedQueueTask(serverUrl, {
            payload: { prompt: 'Run `C:\\tools\\build.exe` to compile' },
        });

        await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);
        await gotoConversation(page, serverUrl, task.id as string);
        await waitForBubbles(page, 1);

        const link = page.locator('.chat-message.user .file-path-link');
        await expect(link).toHaveCount(0);
    });
});

// ── Group B: Hover Tooltip Behavior ───────────────────────────────────────────

test.describe('File Path Hover Tooltip', () => {
    test('hovering a file-path-link shows the tooltip', async ({ serverUrl, mockAI, page }) => {
        mockAI.mockSendMessage.mockResolvedValueOnce({
            success: true,
            response: 'Done.',
            sessionId: 'sess-fp-4',
        });

        // Mock workspace + file preview APIs
        await page.route('**/api/workspaces', (route) =>
            route.fulfill({
                status: 200,
                body: JSON.stringify({
                    workspaces: [{ id: 'ws1', name: 'shortcuts', root: 'D:/projects/shortcuts' }],
                }),
                contentType: 'application/json',
            }),
        );
        await page.route('**/api/workspaces/*/files/preview*', (route) =>
            route.fulfill({
                status: 200,
                body: JSON.stringify({
                    type: 'file',
                    lines: ['line 1', 'line 2', 'line 3'],
                    totalLines: 3,
                }),
                contentType: 'application/json',
            }),
        );

        const task = await seedQueueTask(serverUrl, {
            payload: {
                prompt: 'Check D:\\projects\\shortcuts\\src\\extension.ts for issues',
            },
        });

        await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);
        await gotoConversation(page, serverUrl, task.id as string);
        await waitForBubbles(page, 1);

        const link = page.locator('.chat-message.user .file-path-link');
        await expect(link).toHaveCount(1);

        // Hover to trigger tooltip (HOVER_DELAY_MS = 250)
        await link.hover();
        const tooltip = page.locator('.file-preview-tooltip');
        await expect(tooltip).toBeVisible({ timeout: 3_000 });
    });

    test('tooltip disappears on mouseout', async ({ serverUrl, mockAI, page }) => {
        mockAI.mockSendMessage.mockResolvedValueOnce({
            success: true,
            response: 'Done.',
            sessionId: 'sess-fp-5',
        });

        await page.route('**/api/workspaces', (route) =>
            route.fulfill({
                status: 200,
                body: JSON.stringify({
                    workspaces: [{ id: 'ws1', name: 'shortcuts', root: 'D:/projects/shortcuts' }],
                }),
                contentType: 'application/json',
            }),
        );
        await page.route('**/api/workspaces/*/files/preview*', (route) =>
            route.fulfill({
                status: 200,
                body: JSON.stringify({
                    type: 'file',
                    lines: ['line 1'],
                    totalLines: 1,
                }),
                contentType: 'application/json',
            }),
        );

        const task = await seedQueueTask(serverUrl, {
            payload: {
                prompt: 'Check D:\\projects\\shortcuts\\src\\extension.ts',
            },
        });

        await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);
        await gotoConversation(page, serverUrl, task.id as string);
        await waitForBubbles(page, 1);

        const link = page.locator('.chat-message.user .file-path-link');
        await link.hover();

        const tooltip = page.locator('.file-preview-tooltip');
        await expect(tooltip).toBeVisible({ timeout: 3_000 });

        // Move mouse away to hide tooltip
        await page.mouse.move(0, 0);
        await expect(tooltip).toBeHidden({ timeout: 3_000 });
    });
});

// ── Group C: Assistant Message File Paths ─────────────────────────────────────

test.describe('File Path Linkification in Assistant Messages', () => {
    test('file paths in assistant response are linkified', async ({
        serverUrl,
        mockAI,
        page,
    }) => {
        mockAI.mockSendMessage.mockResolvedValueOnce({
            success: true,
            response: 'I found an issue in /Users/alice/projects/foo/src/main.ts at line 42.',
            sessionId: 'sess-fp-6',
        });

        const task = await seedQueueTask(serverUrl, {
            payload: { prompt: 'Review the code' },
        });

        await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);
        await gotoConversation(page, serverUrl, task.id as string);
        await waitForBubbles(page, 2);

        const link = page.locator('.chat-message.assistant .file-path-link');
        await expect(link).toHaveCount(1);

        const fullPath = await link.getAttribute('data-full-path');
        expect(fullPath).toContain('/Users/alice/projects/foo/src/main.ts');
    });
});
