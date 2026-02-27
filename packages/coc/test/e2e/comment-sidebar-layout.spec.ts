/**
 * Comment Sidebar Layout E2E Tests
 *
 * Verifies that the comment header ("Comments (N)") and filter controls
 * (status tabs, category chips) are rendered inside the comment sidebar
 * rather than in the main content area.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace, request } from './fixtures/seed';
import { createRepoFixture, createTasksFixture } from './fixtures/repo-fixtures';

const WS_ID = 'ws-sidebar-layout';

async function seedComment(
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

async function navigateToTask(
    page: import('@playwright/test').Page,
    serverUrl: string,
    taskName: string,
): Promise<void> {
    await page.goto(serverUrl);
    await page.click('[data-tab="repos"]');
    await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
    await page.locator('.repo-item').first().click();
    await expect(page.locator('#repo-detail-content')).toBeVisible();

    await page.click('.repo-sub-tab[data-subtab="tasks"]');
    await expect(page.locator('[data-testid="task-tree"]')).toBeVisible({ timeout: 10000 });

    const taskItem = page.locator(`[data-testid="task-tree-item-${taskName}"]`);
    await expect(taskItem).toBeVisible({ timeout: 5000 });
    await taskItem.click();
}

test.describe('Comment Sidebar Layout', () => {

    test('header and filters render inside the sidebar, not in the main content area', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-sidebar-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'sidebar-repo', repoDir);

            await seedComment(serverUrl, WS_ID, 'task-a.md', 'first comment', 'bug');
            await seedComment(serverUrl, WS_ID, 'task-a.md', 'second comment', 'question');
            await seedComment(serverUrl, WS_ID, 'task-a.md', 'resolved one', 'suggestion', 'resolved');

            await navigateToTask(page, serverUrl, 'task-a');

            const sidebar = page.locator('[data-testid="comment-sidebar"]');
            await expect(sidebar).toBeVisible({ timeout: 10000 });

            await expect(sidebar.locator('text=Comments (3)')).toBeVisible();

            await expect(sidebar.locator('[data-testid="status-filter-all"]')).toBeVisible();
            await expect(sidebar.locator('[data-testid="status-filter-open"]')).toBeVisible();
            await expect(sidebar.locator('[data-testid="status-filter-resolved"]')).toBeVisible();

            await expect(sidebar.locator('[data-testid="category-filter-all"]')).toBeVisible();
            await expect(sidebar.locator('[data-testid="category-filter-bug"]')).toBeVisible();

            await expect(page.locator('[data-testid="markdown-review-status-bar"]')).toHaveCount(0);
            await expect(page.locator('[data-testid="editor-status-filter-all"]')).toHaveCount(0);
            await expect(page.locator('[data-testid="editor-category-filter-all"]')).toHaveCount(0);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('sidebar filters actually filter the comment list', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-sidebar-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'sidebar-repo', repoDir);

            await seedComment(serverUrl, WS_ID, 'task-a.md', 'first comment', 'bug');
            await seedComment(serverUrl, WS_ID, 'task-a.md', 'second comment', 'question');
            await seedComment(serverUrl, WS_ID, 'task-a.md', 'resolved one', 'suggestion', 'resolved');

            await navigateToTask(page, serverUrl, 'task-a');

            const sidebar = page.locator('[data-testid="comment-sidebar"]');
            await expect(sidebar).toBeVisible({ timeout: 10000 });

            const commentList = sidebar.locator('[data-testid="comment-list"]');
            await expect(commentList.locator('[data-testid^="comment-card-"]')).toHaveCount(3, { timeout: 5000 });

            await sidebar.locator('[data-testid="status-filter-open"]').click();
            await expect(commentList.locator('[data-testid^="comment-card-"]')).toHaveCount(2, { timeout: 5000 });

            await sidebar.locator('[data-testid="status-filter-resolved"]').click();
            await expect(commentList.locator('[data-testid^="comment-card-"]')).toHaveCount(1, { timeout: 5000 });

            await sidebar.locator('[data-testid="status-filter-all"]').click();
            await expect(commentList.locator('[data-testid^="comment-card-"]')).toHaveCount(3, { timeout: 5000 });

            await sidebar.locator('[data-testid="category-filter-bug"]').click();
            await expect(commentList.locator('[data-testid^="comment-card-"]')).toHaveCount(1, { timeout: 5000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('sidebar is not shown when there are no comments', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-sidebar-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, 'ws-no-comments', 'no-comments-repo', repoDir);

            await navigateToTask(page, serverUrl, 'task-b');

            await expect(page.locator('#task-preview-body')).toBeVisible({ timeout: 10000 });

            await expect(page.locator('[data-testid="comment-sidebar"]')).toHaveCount(0);
            await expect(page.locator('[data-testid="markdown-review-status-bar"]')).toHaveCount(0);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
