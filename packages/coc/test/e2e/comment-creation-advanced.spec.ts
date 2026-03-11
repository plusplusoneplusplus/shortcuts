/**
 * Inline Comment Category Selection E2E Tests
 *
 * Covers: Selecting a non-default category in InlineCommentPopup creates
 * a comment with the correct category reflected in the sidebar filter chips.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { createRepoFixture, createTasksFixture } from './fixtures/repo-fixtures';
import {
    navigateToTask,
    selectTextAndOpenContextMenu,
    waitForCommentSidebar,
} from './fixtures/comment-fixtures';

const WS_ID = 'ws-category-sel';

test.describe('Category Selection in InlineCommentPopup', () => {

    test('selecting bug category creates comment filterable by bug', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-catsel-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'catsel-repo', repoDir);

            await navigateToTask(page, serverUrl, 'task-a');
            await selectTextAndOpenContextMenu(page, 'Root-level pending');

            // Click "Add comment"
            await page.locator('[data-testid="context-menu-item-0"]').click();
            await expect(page.locator('[data-testid="inline-comment-popup"]')).toBeVisible();

            // Category picker should be visible with default 'general' selected
            await expect(page.locator('[data-testid="category-picker"]')).toBeVisible();

            // Click the 'bug' category chip
            await page.locator('[data-testid="category-chip-bug"]').click();

            // Type comment and submit
            await page.locator('[data-testid="comment-textarea"]').fill('This is a bug');
            await page.locator('[data-testid="inline-comment-popup"] button:has-text("Submit")').click();

            // Popup should disappear
            await expect(page.locator('[data-testid="inline-comment-popup"]')).toHaveCount(0);

            // Comment sidebar should appear
            await waitForCommentSidebar(page);
            const sidebar = page.locator('[data-testid="comment-sidebar"]');
            const commentList = sidebar.locator('[data-testid="comment-list"]');
            await expect(commentList.locator('[data-testid^="comment-card-"]')).toHaveCount(1, { timeout: 5_000 });

            // Category filter chip for 'bug' should appear in the sidebar
            await expect(sidebar.locator('[data-testid="category-filter-bug"]')).toBeVisible();

            // Click bug filter → comment should still be visible (it IS a bug)
            await sidebar.locator('[data-testid="category-filter-bug"]').click();
            await expect(commentList.locator('[data-testid^="comment-card-"]')).toHaveCount(1, { timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('selecting suggestion category creates comment with suggestion category', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-catsel-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'catsel-repo', repoDir);

            await navigateToTask(page, serverUrl, 'task-a');
            await selectTextAndOpenContextMenu(page, 'Root-level pending');
            await page.locator('[data-testid="context-menu-item-0"]').click();
            await expect(page.locator('[data-testid="inline-comment-popup"]')).toBeVisible();

            // Click 'suggestion' category chip
            await page.locator('[data-testid="category-chip-suggestion"]').click();

            await page.locator('[data-testid="comment-textarea"]').fill('Suggest improvement');
            await page.locator('[data-testid="inline-comment-popup"] button:has-text("Submit")').click();
            await expect(page.locator('[data-testid="inline-comment-popup"]')).toHaveCount(0);

            await waitForCommentSidebar(page);
            const sidebar = page.locator('[data-testid="comment-sidebar"]');

            // Suggestion filter chip should appear
            await expect(sidebar.locator('[data-testid="category-filter-suggestion"]')).toBeVisible();

            // Clicking suggestion filter should keep the comment visible
            await sidebar.locator('[data-testid="category-filter-suggestion"]').click();
            await expect(sidebar.locator('[data-testid="comment-list"] [data-testid^="comment-card-"]')).toHaveCount(1, { timeout: 5_000 });

            // Clicking bug filter should hide the comment (it's not a bug)
            // First need to add a bug filter chip - it won't exist if no bug comments.
            // Instead, verify suggestion comment is the only one shown
            await expect(sidebar.locator('[data-testid="comment-list"]')).toContainText('Suggest improvement');
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
