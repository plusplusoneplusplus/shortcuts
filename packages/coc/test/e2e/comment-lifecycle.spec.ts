/**
 * Comment Lifecycle E2E Tests
 *
 * Covers the full comment lifecycle within the task preview:
 * resolve/reopen toggling, inline editing, two-step delete confirmation,
 * CommentPopover interactions, AICommandMenu command dispatch,
 * and the sidebar "Resolve All with AI" batch operation.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace, request } from './fixtures/seed';
import { createRepoFixture, createTasksFixture } from './fixtures/repo-fixtures';
import {
    seedComment,
    navigateToTask,
    waitForCommentSidebar,
    getCommentCard,
    getCommentById,
} from './fixtures/comment-fixtures';

const WS_ID = 'ws-lifecycle';
const TASK_PATH = 'task-a.md';
const TASK_NAME = 'task-a';

test.describe('Comment Lifecycle', () => {

    test('resolve toggles comment to resolved state', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-lifecycle-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'lifecycle-repo', repoDir);

            const r1 = await seedComment(serverUrl, WS_ID, TASK_PATH, 'first open comment');
            const r2 = await seedComment(serverUrl, WS_ID, TASK_PATH, 'second open comment');
            const id1 = (r1 as any).comment.id as string;

            await navigateToTask(page, serverUrl, TASK_NAME);
            await waitForCommentSidebar(page);

            const sidebar = page.locator('[data-testid="comment-sidebar"]');
            const commentList = sidebar.locator('[data-testid="comment-list"]');
            await expect(commentList.locator('[data-testid^="comment-card-"]')).toHaveCount(2, { timeout: 5_000 });

            const card = getCommentCard(page, id1);
            await card.locator('button[aria-label="Resolve"]').click();

            // Verify: status dot becomes green, card gets opacity-70
            await expect(card.locator('span[title="Resolved"]')).toBeVisible({ timeout: 5_000 });
            await expect(card).toHaveCSS('opacity', '0.7');

            // Verify server-side
            const apiComment = await getCommentById(serverUrl, WS_ID, TASK_PATH, id1);
            expect(apiComment).not.toBeNull();
            expect((apiComment as any).status).toBe('resolved');

            // Filter to Open → only 1 card
            await sidebar.locator('[data-testid="status-filter-open"]').click();
            await expect(commentList.locator('[data-testid^="comment-card-"]')).toHaveCount(1, { timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('reopen restores a resolved comment to open', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-lifecycle-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'lifecycle-repo', repoDir);

            const r = await seedComment(serverUrl, WS_ID, TASK_PATH, 'resolved comment', 'general', 'resolved');
            const id = (r as any).comment.id as string;

            await navigateToTask(page, serverUrl, TASK_NAME);
            await waitForCommentSidebar(page);

            const card = getCommentCard(page, id);
            await expect(card.locator('span[title="Resolved"]')).toBeVisible({ timeout: 5_000 });

            await card.locator('button[aria-label="Reopen"]').click();

            // Verify: status dot blue, full opacity
            await expect(card.locator('span[title="Open"]')).toBeVisible({ timeout: 5_000 });
            await expect(card).not.toHaveCSS('opacity', '0.7');

            // Verify server-side
            const apiComment = await getCommentById(serverUrl, WS_ID, TASK_PATH, id);
            expect((apiComment as any).status).toBe('open');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('edit updates comment text inline', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-lifecycle-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'lifecycle-repo', repoDir);

            const r = await seedComment(serverUrl, WS_ID, TASK_PATH, 'original text');
            const id = (r as any).comment.id as string;

            await navigateToTask(page, serverUrl, TASK_NAME);
            await waitForCommentSidebar(page);

            const card = getCommentCard(page, id);
            await card.locator('button[aria-label="Edit"]').click();

            const textarea = card.locator('[data-testid="comment-edit-textarea"]');
            await expect(textarea).toBeVisible();
            await textarea.fill('updated text');
            await card.locator('button:has-text("Save")').click();

            // Verify: card shows updated text, textarea gone
            await expect(card.locator('[data-testid="comment-edit-textarea"]')).toHaveCount(0);
            await expect(card).toContainText('updated text');

            // Verify server-side
            const apiComment = await getCommentById(serverUrl, WS_ID, TASK_PATH, id);
            expect((apiComment as any).comment).toBe('updated text');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('edit cancel discards changes', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-lifecycle-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'lifecycle-repo', repoDir);

            await seedComment(serverUrl, WS_ID, TASK_PATH, 'keep this text');

            await navigateToTask(page, serverUrl, TASK_NAME);
            await waitForCommentSidebar(page);

            const card = page.locator('[data-testid^="comment-card-"]').first();
            await card.locator('button[aria-label="Edit"]').click();

            const textarea = card.locator('[data-testid="comment-edit-textarea"]');
            await expect(textarea).toBeVisible();
            await textarea.fill('will discard');
            await card.locator('button:has-text("Cancel")').click();

            // Verify: textarea disappears, original text intact
            await expect(card.locator('[data-testid="comment-edit-textarea"]')).toHaveCount(0);
            await expect(card).toContainText('keep this text');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('delete with two-step confirmation removes comment', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-lifecycle-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'lifecycle-repo', repoDir);

            const r = await seedComment(serverUrl, WS_ID, TASK_PATH, 'delete me');
            const id = (r as any).comment.id as string;

            await navigateToTask(page, serverUrl, TASK_NAME);
            await waitForCommentSidebar(page);

            const card = getCommentCard(page, id);

            // Step 1: click Delete → Confirm/Cancel appear
            await card.locator('button[aria-label="Delete"]').click();
            await expect(card.locator('button:has-text("Confirm")')).toBeVisible();
            await expect(card.locator('button:has-text("Cancel")')).toBeVisible();

            // Cancel → reverts to trash icon
            await card.locator('button:has-text("Cancel")').click();
            await expect(card.locator('button[aria-label="Delete"]')).toBeVisible();

            // Step 2: click Delete → Confirm → card removed
            await card.locator('button[aria-label="Delete"]').click();
            await card.locator('button:has-text("Confirm")').click();
            await expect(card).toHaveCount(0, { timeout: 5_000 });

            // Verify server-side: comment no longer exists
            const apiComment = await getCommentById(serverUrl, WS_ID, TASK_PATH, id);
            expect(apiComment).toBeNull();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('clicking comment card opens CommentPopover', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-lifecycle-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'lifecycle-repo', repoDir);

            const r = await seedComment(serverUrl, WS_ID, TASK_PATH, 'popover test comment');
            const id = (r as any).comment.id as string;

            await navigateToTask(page, serverUrl, TASK_NAME);
            await waitForCommentSidebar(page);

            // Verify comment highlight exists in the rendered markdown
            await expect(page.locator(`#task-preview-body [data-comment-id="${id}"]`)).toBeAttached({ timeout: 10_000 });

            // Click card body (position avoids the action bar at the bottom)
            const card = getCommentCard(page, id);
            await card.click({ position: { x: 10, y: 10 } });

            const popover = page.locator('[data-testid="comment-popover"]');
            await expect(popover).toBeVisible({ timeout: 5_000 });
            await expect(popover.locator('[data-testid="popover-comment-body"]')).toContainText('popover test comment');

            // Close via Escape
            await page.keyboard.press('Escape');
            await expect(popover).toHaveCount(0, { timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('CommentPopover resolve and close', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-lifecycle-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'lifecycle-repo', repoDir);

            const r = await seedComment(serverUrl, WS_ID, TASK_PATH, 'popover resolve');
            const id = (r as any).comment.id as string;

            await navigateToTask(page, serverUrl, TASK_NAME);
            await waitForCommentSidebar(page);

            await expect(page.locator(`#task-preview-body [data-comment-id="${id}"]`)).toBeAttached({ timeout: 10_000 });

            // Open popover via card click
            const card = getCommentCard(page, id);
            await card.click({ position: { x: 10, y: 10 } });

            const popover = page.locator('[data-testid="comment-popover"]');
            await expect(popover).toBeVisible({ timeout: 5_000 });

            // Click Resolve inside popover
            await popover.locator('button[aria-label="Resolve"]').click();

            // Popover closes (MarkdownReviewEditor sets activePopoverComment=null on resolve)
            await expect(popover).toHaveCount(0, { timeout: 5_000 });

            // Sidebar card shows resolved state
            await expect(card.locator('span[title="Resolved"]')).toBeVisible({ timeout: 5_000 });
            await expect(card).toHaveCSS('opacity', '0.7');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('CommentPopover delete immediately closes', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-lifecycle-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'lifecycle-repo', repoDir);

            const r = await seedComment(serverUrl, WS_ID, TASK_PATH, 'popover delete');
            const id = (r as any).comment.id as string;

            await navigateToTask(page, serverUrl, TASK_NAME);
            await waitForCommentSidebar(page);

            await expect(page.locator(`#task-preview-body [data-comment-id="${id}"]`)).toBeAttached({ timeout: 10_000 });

            // Open popover via card click
            const card = getCommentCard(page, id);
            await card.click({ position: { x: 10, y: 10 } });

            const popover = page.locator('[data-testid="comment-popover"]');
            await expect(popover).toBeVisible({ timeout: 5_000 });

            // Delete from popover — immediate, no two-step confirm
            await popover.locator('button[aria-label="Delete"]').click();

            // Popover closes and card is removed
            await expect(popover).toHaveCount(0, { timeout: 5_000 });
            await expect(card).toHaveCount(0, { timeout: 5_000 });

            // Verify server-side
            const apiComment = await getCommentById(serverUrl, WS_ID, TASK_PATH, id);
            expect(apiComment).toBeNull();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('AICommandMenu clarify command triggers AI response', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-lifecycle-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'lifecycle-repo', repoDir);

            const r = await seedComment(serverUrl, WS_ID, TASK_PATH, 'needs clarification');
            const id = (r as any).comment.id as string;

            // Intercept ask-ai to return mock response
            await page.route('**/api/comments/**/ask-ai', async route => {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        aiResponse: 'Mocked AI clarification response',
                    }),
                });
            });

            await navigateToTask(page, serverUrl, TASK_NAME);
            await waitForCommentSidebar(page);

            const card = getCommentCard(page, id);

            // Open AI menu → click Clarify
            await card.locator('[data-testid="ai-menu-trigger"]').click();
            const menu = page.locator('[data-testid="ai-command-menu"]');
            await expect(menu).toBeVisible({ timeout: 5_000 });
            await menu.locator('[data-testid="ai-cmd-clarify"]').click();

            // AI response appears on the card
            await expect(card.locator('[data-testid="ai-response"]')).toBeVisible({ timeout: 15_000 });
            await expect(card.locator('[data-testid="ai-response"]')).toContainText('Mocked AI clarification response');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('AICommandMenu custom question flow', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-lifecycle-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'lifecycle-repo', repoDir);

            const r = await seedComment(serverUrl, WS_ID, TASK_PATH, 'custom question target');
            const id = (r as any).comment.id as string;

            // Intercept ask-ai and capture request body
            let capturedBody: Record<string, unknown> | null = null;
            await page.route('**/api/comments/**/ask-ai', async route => {
                capturedBody = JSON.parse(route.request().postData() || '{}');
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        aiResponse: 'Mocked custom AI answer',
                    }),
                });
            });

            await navigateToTask(page, serverUrl, TASK_NAME);
            await waitForCommentSidebar(page);

            const card = getCommentCard(page, id);

            // Open AI menu → click Custom → type question → Enter
            await card.locator('[data-testid="ai-menu-trigger"]').click();
            const menu = page.locator('[data-testid="ai-command-menu"]');
            await expect(menu).toBeVisible({ timeout: 5_000 });
            await menu.locator('[data-testid="ai-cmd-custom"]').click();

            const input = menu.locator('[data-testid="ai-custom-input"]');
            await expect(input).toBeVisible();
            await input.fill('What is the impact of this change?');
            await input.press('Enter');

            // AI response appears
            await expect(card.locator('[data-testid="ai-response"]')).toBeVisible({ timeout: 15_000 });
            await expect(card.locator('[data-testid="ai-response"]')).toContainText('Mocked custom AI answer');

            // Verify intercepted request contains custom command
            expect(capturedBody).not.toBeNull();
            expect((capturedBody as any).commandId).toBe('custom');
            expect((capturedBody as any).customQuestion).toBe('What is the impact of this change?');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('Resolve All with AI button triggers batch resolve', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-lifecycle-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'lifecycle-repo', repoDir);

            await seedComment(serverUrl, WS_ID, TASK_PATH, 'open comment 1');
            await seedComment(serverUrl, WS_ID, TASK_PATH, 'open comment 2');
            await seedComment(serverUrl, WS_ID, TASK_PATH, 'open comment 3');

            // Intercept batch-resolve to return mock 202
            await page.route('**/batch-resolve', async route => {
                await route.fulfill({
                    status: 202,
                    contentType: 'application/json',
                    body: JSON.stringify({ taskId: 'mock-task-1' }),
                });
            });

            // Intercept queue poll to return completed task immediately
            await page.route('**/api/queue/**', async route => {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        task: {
                            id: 'mock-task-1',
                            status: 'completed',
                            result: { revisedContent: '', commentIds: [] },
                        },
                    }),
                });
            });

            await navigateToTask(page, serverUrl, TASK_NAME);
            await waitForCommentSidebar(page);

            const sidebar = page.locator('[data-testid="comment-sidebar"]');
            const resolveAllBtn = sidebar.locator('[data-testid="resolve-all-ai-btn"]');

            // Button should be visible when there are open comments
            await expect(resolveAllBtn).toBeVisible({ timeout: 5_000 });

            // Click and verify the batch-resolve API is called
            const batchResolveRequest = page.waitForRequest(
                req => req.url().includes('/batch-resolve') && req.method() === 'POST',
            );
            await resolveAllBtn.click();
            await batchResolveRequest;
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('sidebar count updates after lifecycle operations', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-lifecycle-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'lifecycle-repo', repoDir);

            const r1 = await seedComment(serverUrl, WS_ID, TASK_PATH, 'open A');
            const r2 = await seedComment(serverUrl, WS_ID, TASK_PATH, 'open B');
            await seedComment(serverUrl, WS_ID, TASK_PATH, 'resolved C', 'general', 'resolved');
            const idA = (r1 as any).comment.id as string;
            const idB = (r2 as any).comment.id as string;

            await navigateToTask(page, serverUrl, TASK_NAME);
            await waitForCommentSidebar(page);

            const sidebar = page.locator('[data-testid="comment-sidebar"]');
            const commentList = sidebar.locator('[data-testid="comment-list"]');

            // Initial state: 3 comments
            await expect(sidebar).toContainText('Comments (3)');
            await expect(commentList.locator('[data-testid^="comment-card-"]')).toHaveCount(3, { timeout: 5_000 });

            // Delete comment A → 2 comments
            const cardA = getCommentCard(page, idA);
            await cardA.locator('button[aria-label="Delete"]').click();
            await cardA.locator('button:has-text("Confirm")').click();
            await expect(cardA).toHaveCount(0, { timeout: 5_000 });
            await expect(sidebar).toContainText('Comments (2)');

            // Resolve comment B → 2 total (0 open, 2 resolved)
            const cardB = getCommentCard(page, idB);
            await cardB.locator('button[aria-label="Resolve"]').click();
            await expect(cardB.locator('span[title="Resolved"]')).toBeVisible({ timeout: 5_000 });

            // Filter to Open → 0 cards
            await sidebar.locator('[data-testid="status-filter-open"]').click();
            await expect(commentList.locator('[data-testid^="comment-card-"]')).toHaveCount(0, { timeout: 5_000 });

            // Filter to Resolved → 2 cards
            await sidebar.locator('[data-testid="status-filter-resolved"]').click();
            await expect(commentList.locator('[data-testid^="comment-card-"]')).toHaveCount(2, { timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
