/**
 * Inline Comment Creation E2E Tests
 *
 * Covers the core interaction path for creating comments via text selection:
 * select text → right-click → context menu → "Add comment" → popup → type → submit.
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
    getCommentCardCount,
} from './fixtures/comment-fixtures';

const WS_ID = 'ws-inline-comment';

test.describe('Inline Comment Creation', () => {

    test('select text → right-click → Add comment → type → Submit → comment appears in sidebar', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-inline-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'inline-repo', repoDir);

            await navigateToTask(page, serverUrl, 'task-a');
            await selectTextAndOpenContextMenu(page, 'Root-level pending');

            // Context menu should be visible
            await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();

            // Click "Add comment" (first menu item)
            await page.locator('[data-testid="context-menu-item-0"]').click();

            // InlineCommentPopup should appear
            await expect(page.locator('[data-testid="inline-comment-popup"]')).toBeVisible();

            // Type comment text and submit
            await page.locator('[data-testid="comment-textarea"]').fill('This needs clarification');
            await page.locator('[data-testid="inline-comment-popup"] button:has-text("Submit")').click();

            // Popup should disappear
            await expect(page.locator('[data-testid="inline-comment-popup"]')).toHaveCount(0);

            // Comment sidebar should appear with the comment
            await waitForCommentSidebar(page);
            const commentList = page.locator('[data-testid="comment-list"]');
            await expect(commentList.locator('[data-testid^="comment-card-"]')).toHaveCount(1, { timeout: 5_000 });
            await expect(commentList).toContainText('This needs clarification');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('submit button is disabled when textarea is empty', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-inline-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'inline-repo', repoDir);

            await navigateToTask(page, serverUrl, 'task-a');
            await selectTextAndOpenContextMenu(page, 'Root-level pending');
            await page.locator('[data-testid="context-menu-item-0"]').click();
            await expect(page.locator('[data-testid="inline-comment-popup"]')).toBeVisible();

            // Submit button should be disabled when empty
            const submitBtn = page.locator('[data-testid="inline-comment-popup"] button:has-text("Submit")');
            await expect(submitBtn).toBeDisabled();

            // Type whitespace-only — should still be disabled
            await page.locator('[data-testid="comment-textarea"]').fill('   ');
            await expect(submitBtn).toBeDisabled();

            // Type real text — should be enabled
            await page.locator('[data-testid="comment-textarea"]').fill('real comment');
            await expect(submitBtn).toBeEnabled();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('Ctrl+Enter submits the comment', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-inline-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'inline-repo', repoDir);

            await navigateToTask(page, serverUrl, 'task-a');
            await selectTextAndOpenContextMenu(page, 'Root-level pending');
            await page.locator('[data-testid="context-menu-item-0"]').click();
            await expect(page.locator('[data-testid="inline-comment-popup"]')).toBeVisible();

            // Type comment and press Ctrl+Enter
            await page.locator('[data-testid="comment-textarea"]').fill('Keyboard shortcut comment');
            await page.keyboard.press('Control+Enter');

            // Popup should disappear
            await expect(page.locator('[data-testid="inline-comment-popup"]')).toHaveCount(0);

            // Comment sidebar should appear with the comment
            await waitForCommentSidebar(page);
            const commentList = page.locator('[data-testid="comment-list"]');
            await expect(commentList).toContainText('Keyboard shortcut comment');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('Escape key cancels the popup without creating a comment', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-inline-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'inline-repo', repoDir);

            await navigateToTask(page, serverUrl, 'task-a');
            await selectTextAndOpenContextMenu(page, 'Root-level pending');
            await page.locator('[data-testid="context-menu-item-0"]').click();
            await expect(page.locator('[data-testid="inline-comment-popup"]')).toBeVisible();

            // Type some text then press Escape
            await page.locator('[data-testid="comment-textarea"]').fill('Should not be saved');
            await page.keyboard.press('Escape');

            // Popup should disappear
            await expect(page.locator('[data-testid="inline-comment-popup"]')).toHaveCount(0);

            // No comment should be created — sidebar should not appear
            await expect(page.locator('[data-testid="comment-sidebar"]')).toHaveCount(0);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('Cancel button dismisses the popup', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-inline-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'inline-repo', repoDir);

            await navigateToTask(page, serverUrl, 'task-a');
            await selectTextAndOpenContextMenu(page, 'Root-level pending');
            await page.locator('[data-testid="context-menu-item-0"]').click();
            await expect(page.locator('[data-testid="inline-comment-popup"]')).toBeVisible();

            // Type some text then click Cancel
            await page.locator('[data-testid="comment-textarea"]').fill('Should not be saved');
            await page.locator('[data-testid="inline-comment-popup"] button:has-text("Cancel")').click();

            // Popup should disappear
            await expect(page.locator('[data-testid="inline-comment-popup"]')).toHaveCount(0);

            // No comment should be created
            await expect(page.locator('[data-testid="comment-sidebar"]')).toHaveCount(0);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('click outside the popup cancels it', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-inline-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'inline-repo', repoDir);

            await navigateToTask(page, serverUrl, 'task-a');
            await selectTextAndOpenContextMenu(page, 'Root-level pending');
            await page.locator('[data-testid="context-menu-item-0"]').click();
            await expect(page.locator('[data-testid="inline-comment-popup"]')).toBeVisible();

            // Click outside the popup — use top-left of preview body
            const box = await page.locator('#task-preview-body').boundingBox();
            if (!box) throw new Error('Preview body bounding box not found');
            await page.mouse.click(box.x + 2, box.y + 2);

            // Popup should disappear
            await expect(page.locator('[data-testid="inline-comment-popup"]')).toHaveCount(0);

            // No comment should be created
            await expect(page.locator('[data-testid="comment-sidebar"]')).toHaveCount(0);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('creating multiple comments increases sidebar count', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-inline-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'inline-repo', repoDir);

            await navigateToTask(page, serverUrl, 'task-a');

            // Create first comment
            await selectTextAndOpenContextMenu(page, 'Root-level pending');
            await page.locator('[data-testid="context-menu-item-0"]').click();
            await expect(page.locator('[data-testid="inline-comment-popup"]')).toBeVisible();
            await page.locator('[data-testid="comment-textarea"]').fill('First comment');
            await page.locator('[data-testid="inline-comment-popup"] button:has-text("Submit")').click();
            await expect(page.locator('[data-testid="inline-comment-popup"]')).toHaveCount(0);
            await waitForCommentSidebar(page);

            const sidebar = page.locator('[data-testid="comment-sidebar"]');
            const commentList = sidebar.locator('[data-testid="comment-list"]');
            await expect(commentList.locator('[data-testid^="comment-card-"]')).toHaveCount(1, { timeout: 5_000 });

            // Create second comment on different text
            await selectTextAndOpenContextMenu(page, 'Task A');
            await page.locator('[data-testid="context-menu-item-0"]').click();
            await expect(page.locator('[data-testid="inline-comment-popup"]')).toBeVisible();
            await page.locator('[data-testid="comment-textarea"]').fill('Second comment');
            await page.locator('[data-testid="inline-comment-popup"] button:has-text("Submit")').click();
            await expect(page.locator('[data-testid="inline-comment-popup"]')).toHaveCount(0);

            // Verify two comments
            await expect(commentList.locator('[data-testid^="comment-card-"]')).toHaveCount(2, { timeout: 5_000 });
            await expect(sidebar).toContainText('Comments (2)');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('context menu "Add comment" is disabled when no text is selected', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-inline-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'inline-repo', repoDir);

            await navigateToTask(page, serverUrl, 'task-a');

            // Right-click without selecting text
            await page.locator('#task-preview-body').click({ button: 'right', position: { x: 10, y: 10 } });

            // Context menu should appear
            await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();

            // "Add comment" should be disabled
            const addCommentItem = page.locator('[data-testid="context-menu-item-0"]');
            await expect(addCommentItem).toBeDisabled();

            // Clicking it should not open the popup (use force to bypass Playwright's disabled check)
            await addCommentItem.click({ force: true });
            await expect(page.locator('[data-testid="inline-comment-popup"]')).toHaveCount(0);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
