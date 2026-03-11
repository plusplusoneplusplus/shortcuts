/**
 * Shared Comment Test Fixtures for E2E Tests
 *
 * Reusable helpers for seeding comments via API, navigating to task preview,
 * and interacting with the inline comment creation flow.
 */

import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { request } from './seed';

/** Seed a comment via POST /api/comments/{wsId}/{encodedPath}. */
export async function seedComment(
    serverUrl: string,
    wsId: string,
    filePath: string,
    comment: string,
    category = 'general',
    status: 'open' | 'resolved' = 'open',
): Promise<Record<string, unknown>> {
    const body = JSON.stringify({
        filePath,
        selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
        selectedText: 'hello',
        comment,
        category,
        status,
    });
    const encodedPath = encodeURIComponent(filePath);
    const res = await request(
        `${serverUrl}/api/comments/${encodeURIComponent(wsId)}/${encodedPath}`,
        { method: 'POST', body },
    );
    return JSON.parse(res.body);
}

/**
 * Navigate from the SPA root to a specific task file preview.
 * Steps: goto serverUrl → click repos tab → click first repo → click tasks sub-tab
 *        → click task-tree item → wait for #task-preview-body.
 */
export async function navigateToTask(
    page: Page,
    serverUrl: string,
    taskName: string,
): Promise<void> {
    await page.goto(serverUrl);
    await page.click('[data-tab="repos"]');
    await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10_000 });
    await page.locator('.repo-item').first().click();
    await expect(page.locator('#repo-detail-content')).toBeVisible();

    await page.click('.repo-sub-tab[data-subtab="tasks"]');
    await expect(page.locator('[data-testid="task-tree"]')).toBeVisible({ timeout: 10_000 });

    const taskItem = page.locator(`[data-testid="task-tree-item-${taskName}"]`);
    await expect(taskItem).toBeVisible({ timeout: 5_000 });
    await taskItem.click();
    await expect(page.locator('#task-preview-body')).toBeVisible({ timeout: 10_000 });
}

/**
 * Simulate text selection inside #task-preview-body and trigger the right-click
 * context menu.
 *
 * How it works:
 *  1. Find the target text node inside #task-preview-body using page.evaluate()
 *     with TreeWalker + Range API
 *  2. Dispatch a 'mouseup' event so MarkdownReviewEditor's handleMouseUp
 *     calls setSavedSelection() (MIN_SELECTION_LENGTH = 3 chars)
 *  3. Right-click the selection to trigger handleContextMenu → setContextMenuVisible(true)
 */
export async function selectTextAndOpenContextMenu(
    page: Page,
    textToSelect: string,
): Promise<void> {
    // Step 1: Create a DOM selection over the target text
    await page.evaluate((text) => {
        const container = document.getElementById('task-preview-body');
        if (!container) throw new Error('task-preview-body not found');

        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
        let node: Text | null;
        while ((node = walker.nextNode() as Text | null)) {
            const idx = node.textContent?.indexOf(text) ?? -1;
            if (idx >= 0) {
                const range = document.createRange();
                range.setStart(node, idx);
                range.setEnd(node, idx + text.length);
                const sel = window.getSelection()!;
                sel.removeAllRanges();
                sel.addRange(range);
                return;
            }
        }
        throw new Error(`Text "${text}" not found in task-preview-body`);
    }, textToSelect);

    // Step 2: Dispatch mouseup to trigger MarkdownReviewEditor's selection handler
    await page.dispatchEvent('#task-preview-body', 'mouseup');

    // Step 3: Right-click the selected text to open context menu
    const rect = await page.evaluate(() => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        const r = sel.getRangeAt(0).getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (!rect) throw new Error('No selection bounding rect');

    await page.mouse.click(rect.x, rect.y, { button: 'right' });
}

/** Wait for the comment sidebar to be visible. */
export async function waitForCommentSidebar(page: Page): Promise<void> {
    await expect(page.locator('[data-testid="comment-sidebar"]')).toBeVisible({ timeout: 10_000 });
}

/** Get the count of visible comment cards in the sidebar. */
export async function getCommentCardCount(page: Page): Promise<number> {
    return page.locator('[data-testid="comment-sidebar"] [data-testid^="comment-card-"]').count();
}

/** Get a comment card locator by comment ID. */
export function getCommentCard(page: Page, commentId: string) {
    return page.locator(`[data-testid="comment-card-${commentId}"]`);
}

/** Fetch a single comment by ID via the collection GET endpoint. Returns null if not found. */
export async function getCommentById(
    serverUrl: string,
    wsId: string,
    filePath: string,
    commentId: string,
): Promise<Record<string, unknown> | null> {
    const encodedPath = encodeURIComponent(filePath);
    const encodedWs = encodeURIComponent(wsId);
    const res = await request(`${serverUrl}/api/comments/${encodedWs}/${encodedPath}`);
    if (res.status !== 200) return null;
    const { comments } = JSON.parse(res.body);
    return (comments as Record<string, unknown>[]).find(c => c.id === commentId) ?? null;
}

/**
 * Seed a comment with additional fields (e.g. aiResponse, status: 'orphaned').
 * Passes extra fields straight through since the handler stores them as-is.
 */
export async function seedCommentWithFields(
    serverUrl: string,
    wsId: string,
    filePath: string,
    fields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    const body = JSON.stringify({
        filePath,
        selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
        selectedText: 'hello',
        comment: 'test comment',
        category: 'general',
        status: 'open',
        ...fields,
    });
    const encodedPath = encodeURIComponent(filePath);
    const res = await request(
        `${serverUrl}/api/comments/${encodeURIComponent(wsId)}/${encodedPath}`,
        { method: 'POST', body },
    );
    return JSON.parse(res.body);
}

/** Seed a reply on a comment via POST /api/comments/:wsId/:taskPath/:id/replies. */
export async function seedReply(
    serverUrl: string,
    wsId: string,
    filePath: string,
    commentId: string,
    text: string,
    author = 'Tester',
    isAI = false,
): Promise<Record<string, unknown>> {
    const body = JSON.stringify({ author, text, isAI });
    const encodedPath = encodeURIComponent(filePath);
    const res = await request(
        `${serverUrl}/api/comments/${encodeURIComponent(wsId)}/${encodedPath}/${commentId}/replies`,
        { method: 'POST', body },
    );
    return JSON.parse(res.body);
}
