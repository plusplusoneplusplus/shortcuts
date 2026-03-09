/**
 * MarkdownReviewDialog E2E Tests
 *
 * Tests the full lifecycle of the MarkdownReviewDialog opened by clicking
 * a `.file-path-link` in a process conversation bubble: open → display →
 * minimize → chip (pill) → restore → close.
 */

import { test, expect } from './fixtures/server-fixture';
import { seedWorkspace, seedQueueTask, request } from './fixtures/seed';
import type { Page } from '@playwright/test';

// ── Shared helpers ────────────────────────────────────────────────────────────

const WORKSPACE_ROOT = '/tmp/review-ws';
const FILE_PATH = '/tmp/review-ws/docs/README.md';

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
            if (targetStatuses.includes(task.status as string)) {
                return task;
            }
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`Task ${taskId} did not reach ${targetStatuses.join('|')} within ${timeoutMs}ms`);
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

/** Seed workspace + queue task, mock APIs, and navigate to conversation. */
async function setupAndNavigate(
    page: Page,
    serverUrl: string,
    mockAI: { mockSendMessage: { mockResolvedValueOnce: (v: unknown) => void } },
    wsId: string,
): Promise<string> {
    await seedWorkspace(serverUrl, wsId, 'review-ws', WORKSPACE_ROOT);

    mockAI.mockSendMessage.mockResolvedValueOnce({
        success: true,
        response: `I reviewed ${FILE_PATH} and found issues.`,
        sessionId: `sess-md-${wsId}`,
    });

    const task = await seedQueueTask(serverUrl, {
        payload: { prompt: 'Review the docs' },
    });
    const taskId = task.id as string;

    await waitForTaskStatus(serverUrl, taskId, ['completed', 'failed']);

    // Mock file content API so the dialog can render content
    await page.route('**/api/workspaces/*/files/content*', (route) =>
        route.fulfill({
            status: 200,
            body: JSON.stringify({ content: '# README\n\nHello world\n' }),
            contentType: 'application/json',
        }),
    );

    // Mock tasks endpoint
    await page.route('**/api/workspaces/*/tasks*', (route) =>
        route.fulfill({
            status: 200,
            body: JSON.stringify({ tasks: [] }),
            contentType: 'application/json',
        }),
    );

    await gotoConversation(page, serverUrl, taskId);
    await waitForBubbles(page, 2);

    return taskId;
}

/** Click the file-path-link in the assistant bubble to open the dialog. */
async function openDialog(page: Page): Promise<void> {
    const link = page.locator('.chat-message.assistant .file-path-link');
    await expect(link).toHaveCount(1);
    await link.click();
}

// Selector for the minimized pill rendered by MinimizedDialogsTray
const PILL_SELECTOR = '[data-testid="minimized-pill-markdown-review"]';

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('MarkdownReviewDialog', () => {
    test('clicking file-path-link opens MarkdownReviewDialog', async ({
        serverUrl,
        mockAI,
        page,
    }) => {
        await setupAndNavigate(page, serverUrl, mockAI, 'ws-md-1');
        await openDialog(page);

        // Dialog should be visible (rendered by MarkdownReviewDialog component)
        const dialog = page.locator('[data-testid="markdown-review-minimize-btn"]');
        await expect(dialog).toBeVisible({ timeout: 5_000 });

        // Close button should be present
        const closeBtn = page.locator('button[aria-label="Close"]');
        await expect(closeBtn.first()).toBeVisible();
    });

    test('minimize button hides dialog and shows chip', async ({
        serverUrl,
        mockAI,
        page,
    }) => {
        await setupAndNavigate(page, serverUrl, mockAI, 'ws-md-2');
        await openDialog(page);

        const minimizeBtn = page.locator('[data-testid="markdown-review-minimize-btn"]');
        await expect(minimizeBtn).toBeVisible({ timeout: 5_000 });

        // Minimize
        await minimizeBtn.click();

        // Dialog minimize button should disappear
        await expect(minimizeBtn).not.toBeVisible();

        // Minimized pill should appear
        const pill = page.locator(PILL_SELECTOR);
        await expect(pill).toBeVisible({ timeout: 3_000 });

        // Pill text should contain the filename
        await expect(pill).toContainText('README.md');
    });

    test('restore from chip reopens the dialog', async ({
        serverUrl,
        mockAI,
        page,
    }) => {
        await setupAndNavigate(page, serverUrl, mockAI, 'ws-md-3');
        await openDialog(page);

        const minimizeBtn = page.locator('[data-testid="markdown-review-minimize-btn"]');
        await expect(minimizeBtn).toBeVisible({ timeout: 5_000 });

        // Minimize
        await minimizeBtn.click();

        const pill = page.locator(PILL_SELECTOR);
        await expect(pill).toBeVisible({ timeout: 3_000 });

        // Click the "Restore" link inside the pill
        await pill.locator('text=Restore').click();

        // Dialog should reappear
        await expect(minimizeBtn).toBeVisible({ timeout: 3_000 });

        // Pill should disappear
        await expect(pill).not.toBeVisible();
    });

    test('close button fully dismisses dialog without chip', async ({
        serverUrl,
        mockAI,
        page,
    }) => {
        await setupAndNavigate(page, serverUrl, mockAI, 'ws-md-4');
        await openDialog(page);

        const minimizeBtn = page.locator('[data-testid="markdown-review-minimize-btn"]');
        await expect(minimizeBtn).toBeVisible({ timeout: 5_000 });

        // Close via Close button
        const closeBtn = page.locator('button[aria-label="Close"]').first();
        await closeBtn.click();

        // Dialog should disappear
        await expect(minimizeBtn).not.toBeVisible();

        // No minimized pill should appear (close ≠ minimize)
        const pill = page.locator(PILL_SELECTOR);
        await expect(pill).toHaveCount(0);
    });

    test('chip close button dismisses both chip and dialog', async ({
        serverUrl,
        mockAI,
        page,
    }) => {
        await setupAndNavigate(page, serverUrl, mockAI, 'ws-md-5');
        await openDialog(page);

        const minimizeBtn = page.locator('[data-testid="markdown-review-minimize-btn"]');
        await expect(minimizeBtn).toBeVisible({ timeout: 5_000 });

        // Minimize first
        await minimizeBtn.click();

        const pill = page.locator(PILL_SELECTOR);
        await expect(pill).toBeVisible({ timeout: 3_000 });

        // Close via the pill close button
        await pill.locator('button[title="Close"]').click();

        // Pill should disappear
        await expect(pill).not.toBeVisible();

        // Dialog should not reappear
        await expect(minimizeBtn).not.toBeVisible();
    });
});
