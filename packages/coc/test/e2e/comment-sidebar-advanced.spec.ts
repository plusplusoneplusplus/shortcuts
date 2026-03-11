/**
 * Comment Sidebar Advanced E2E Tests
 *
 * Covers: Combined status+category filter, empty filter result placeholder,
 * copy prompt button feedback, orphaned comment badge, show all replies.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { createRepoFixture, createTasksFixture } from './fixtures/repo-fixtures';
import {
    seedComment,
    seedCommentWithFields,
    seedReply,
    navigateToTask,
    waitForCommentSidebar,
} from './fixtures/comment-fixtures';

const WS_ID = 'ws-sidebar-adv';
const TASK_PATH = 'task-a.md';
const TASK_NAME = 'task-a';

test.describe('Comment Sidebar Advanced', () => {

    test('combined status + category filter narrows list to intersection', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-sidebar-adv-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'sidebar-repo', repoDir);

            // Seed 4 comments: 2 open-bug, 1 resolved-bug, 1 open-question
            await seedComment(serverUrl, WS_ID, TASK_PATH, 'open bug 1', 'bug', 'open');
            await seedComment(serverUrl, WS_ID, TASK_PATH, 'open bug 2', 'bug', 'open');
            await seedComment(serverUrl, WS_ID, TASK_PATH, 'resolved bug', 'bug', 'resolved');
            await seedComment(serverUrl, WS_ID, TASK_PATH, 'open question', 'question', 'open');

            await navigateToTask(page, serverUrl, TASK_NAME);
            await waitForCommentSidebar(page);

            const sidebar = page.locator('[data-testid="comment-sidebar"]');
            const commentList = sidebar.locator('[data-testid="comment-list"]');

            // Initially all 4 visible
            await expect(commentList.locator('[data-testid^="comment-card-"]')).toHaveCount(4, { timeout: 5_000 });

            // Click Resolved status filter
            await sidebar.locator('[data-testid="status-filter-resolved"]').click();
            // Should show 1 resolved-bug
            await expect(commentList.locator('[data-testid^="comment-card-"]')).toHaveCount(1, { timeout: 5_000 });

            // Now also click bug category filter
            await sidebar.locator('[data-testid="category-filter-bug"]').click();
            // Should still show 1 (resolved + bug = resolved-bug)
            await expect(commentList.locator('[data-testid^="comment-card-"]')).toHaveCount(1, { timeout: 5_000 });

            // Switch to Open status + bug category → should show 2 open bugs
            await sidebar.locator('[data-testid="status-filter-open"]').click();
            await expect(commentList.locator('[data-testid^="comment-card-"]')).toHaveCount(2, { timeout: 5_000 });

            // Switch to Open + question → should show 1 open question
            await sidebar.locator('[data-testid="category-filter-question"]').click();
            await expect(commentList.locator('[data-testid^="comment-card-"]')).toHaveCount(1, { timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('empty filter result shows "No comments match" placeholder', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-sidebar-adv-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'sidebar-repo', repoDir);

            // Only seed open bug comments
            await seedComment(serverUrl, WS_ID, TASK_PATH, 'open bug only', 'bug', 'open');

            await navigateToTask(page, serverUrl, TASK_NAME);
            await waitForCommentSidebar(page);

            const sidebar = page.locator('[data-testid="comment-sidebar"]');
            const commentList = sidebar.locator('[data-testid="comment-list"]');

            // Initially 1 comment visible
            await expect(commentList.locator('[data-testid^="comment-card-"]')).toHaveCount(1, { timeout: 5_000 });

            // Click Resolved filter → no resolved comments exist → empty
            await sidebar.locator('[data-testid="status-filter-resolved"]').click();
            await expect(commentList.locator('[data-testid^="comment-card-"]')).toHaveCount(0, { timeout: 5_000 });

            // "No comments match" placeholder should appear
            await expect(sidebar.locator('[data-testid="empty-comments"]')).toBeVisible();
            await expect(sidebar.locator('[data-testid="empty-comments"]')).toContainText('No comments match the current filter.');

            // Switch back to All → comments reappear, placeholder gone
            await sidebar.locator('[data-testid="status-filter-all"]').click();
            await expect(commentList.locator('[data-testid^="comment-card-"]')).toHaveCount(1, { timeout: 5_000 });
            await expect(sidebar.locator('[data-testid="empty-comments"]')).toHaveCount(0);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('copy prompt button shows checkmark feedback', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-sidebar-adv-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'sidebar-repo', repoDir);

            await seedComment(serverUrl, WS_ID, TASK_PATH, 'comment for copy');

            // Grant clipboard permissions
            await page.context().grantPermissions(['clipboard-write', 'clipboard-read']);

            await navigateToTask(page, serverUrl, TASK_NAME);
            await waitForCommentSidebar(page);

            const sidebar = page.locator('[data-testid="comment-sidebar"]');

            // Copy prompt button should be visible when there are open comments
            const copyBtn = sidebar.locator('[data-testid="copy-prompt-btn"]');
            await expect(copyBtn).toBeVisible({ timeout: 5_000 });

            // Initial state: clipboard icon (📋)
            await expect(copyBtn).toContainText('📋');

            // Click copy
            await copyBtn.click();

            // Should briefly show checkmark (✓)
            await expect(copyBtn).toContainText('✓');

            // After 2 seconds, should revert to clipboard icon
            await expect(copyBtn).toContainText('📋', { timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('orphaned comment badge renders with warning', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-sidebar-adv-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'sidebar-repo', repoDir);

            // Seed an orphaned comment (status: 'orphaned' passes through without validation)
            await seedCommentWithFields(serverUrl, WS_ID, TASK_PATH, {
                comment: 'orphaned comment',
                status: 'orphaned',
            });
            // Also seed a normal comment to verify contrast
            await seedComment(serverUrl, WS_ID, TASK_PATH, 'normal comment');

            await navigateToTask(page, serverUrl, TASK_NAME);
            await waitForCommentSidebar(page);

            const sidebar = page.locator('[data-testid="comment-sidebar"]');
            const commentList = sidebar.locator('[data-testid="comment-list"]');

            // Both comments should be visible
            await expect(commentList.locator('[data-testid^="comment-card-"]')).toHaveCount(2, { timeout: 5_000 });

            // Orphaned badge should be visible
            await expect(sidebar.locator('[data-testid="orphaned-badge"]')).toBeVisible();
            await expect(sidebar.locator('[data-testid="orphaned-badge"]')).toContainText('Location lost');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('show all replies button expands hidden replies beyond 2', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-sidebar-adv-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'sidebar-repo', repoDir);

            // Create a comment and add 4 replies
            const r = await seedComment(serverUrl, WS_ID, TASK_PATH, 'comment with replies');
            const id = (r as any).comment.id as string;

            await seedReply(serverUrl, WS_ID, TASK_PATH, id, 'Reply 1', 'Alice');
            await seedReply(serverUrl, WS_ID, TASK_PATH, id, 'Reply 2', 'Bob');
            await seedReply(serverUrl, WS_ID, TASK_PATH, id, 'Reply 3', 'Charlie');
            await seedReply(serverUrl, WS_ID, TASK_PATH, id, 'Reply 4', 'Diana');

            await navigateToTask(page, serverUrl, TASK_NAME);
            await waitForCommentSidebar(page);

            const card = page.locator(`[data-testid="comment-card-${id}"]`);
            await expect(card).toBeVisible({ timeout: 5_000 });

            // "Show all 4 replies" button should be visible
            const showAllBtn = card.locator('[data-testid="show-all-replies"]');
            await expect(showAllBtn).toBeVisible({ timeout: 5_000 });
            await expect(showAllBtn).toContainText('Show all 4 replies');

            // Only last 2 replies should be visible initially
            await expect(card.locator('[data-testid^="comment-reply-"]')).toHaveCount(2, { timeout: 5_000 });

            // Click "Show all" → all 4 replies visible
            await showAllBtn.click();
            await expect(card.locator('[data-testid^="comment-reply-"]')).toHaveCount(4, { timeout: 5_000 });

            // "Show all" button should be gone
            await expect(showAllBtn).toHaveCount(0);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
