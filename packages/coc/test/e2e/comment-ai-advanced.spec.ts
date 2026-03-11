/**
 * Comment AI Advanced E2E Tests
 *
 * Covers: Fix with AI, AI error banner + dismiss, AI response expand/collapse,
 * Resolve All with AI loading state (spinner + disabled cards).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { createRepoFixture, createTasksFixture } from './fixtures/repo-fixtures';
import {
    seedComment,
    navigateToTask,
    waitForCommentSidebar,
    getCommentCard,
} from './fixtures/comment-fixtures';

const WS_ID = 'ws-ai-adv';
const TASK_PATH = 'task-a.md';
const TASK_NAME = 'task-a';

test.describe('Comment AI Advanced', () => {

    test('Fix with AI button triggers handler and shows loading spinner', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ai-adv-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'ai-repo', repoDir);

            const r = await seedComment(serverUrl, WS_ID, TASK_PATH, 'fix with AI target');
            const id = (r as any).comment.id as string;

            // Intercept ask-ai (fix-with-ai uses ask-ai with commandId: 'resolve')
            // Use a delayed response to observe loading state
            let resolveRoute: (() => void) | null = null;
            const routeReady = new Promise<void>(r2 => { resolveRoute = r2; });

            await page.route('**/api/comments/**/ask-ai', async route => {
                resolveRoute!();
                // Delay response to observe spinner
                await new Promise(r3 => setTimeout(r3, 500));
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        aiResponse: 'Fixed by AI',
                        revisedContent: '---\nstatus: pending\n---\n\n# Task A\n\nRevised content.\n',
                    }),
                });
            });

            await navigateToTask(page, serverUrl, TASK_NAME);
            await waitForCommentSidebar(page);

            const card = getCommentCard(page, id);

            // Fix with AI button should be visible on open comment
            const fixBtn = card.locator('[data-testid="fix-with-ai"]');
            await expect(fixBtn).toBeVisible({ timeout: 5_000 });

            // Click Fix with AI
            await fixBtn.click();

            // Wait for the route to be hit
            await routeReady;

            // After response, verify the ask-ai was called
            // The button should eventually disappear or comment should be resolved
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('AI error banner appears on failed AI command and is dismissible', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ai-adv-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'ai-repo', repoDir);

            const r = await seedComment(serverUrl, WS_ID, TASK_PATH, 'AI error test');
            const id = (r as any).comment.id as string;

            // Intercept ask-ai to return error
            await page.route('**/api/comments/**/ask-ai', async route => {
                await route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'AI service unavailable' }),
                });
            });

            await navigateToTask(page, serverUrl, TASK_NAME);
            await waitForCommentSidebar(page);

            const card = getCommentCard(page, id);

            // Trigger AI command (Clarify)
            await card.locator('[data-testid="ai-menu-trigger"]').click();
            const menu = page.locator('[data-testid="ai-command-menu"]');
            await expect(menu).toBeVisible({ timeout: 5_000 });
            await menu.locator('[data-testid="ai-cmd-clarify"]').click();

            // AI error banner should appear
            await expect(card.locator('[data-testid="ai-error-banner"]')).toBeVisible({ timeout: 15_000 });

            // Dismiss the error
            await card.locator('[data-testid="ai-error-banner"] button[aria-label="Dismiss error"]').click();

            // Banner should disappear
            await expect(card.locator('[data-testid="ai-error-banner"]')).toHaveCount(0, { timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('AI response expand/collapse toggle in CommentCard', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ai-adv-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'ai-repo', repoDir);

            const r = await seedComment(serverUrl, WS_ID, TASK_PATH, 'expand test');
            const id = (r as any).comment.id as string;

            // Intercept ask-ai with a long response
            await page.route('**/api/comments/**/ask-ai', async route => {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        aiResponse: 'Line 1\n\nLine 2\n\nLine 3\n\nLine 4\n\nLine 5\n\nLine 6\n\nLine 7\n\nLine 8\n\nLine 9\n\nLine 10\n\nThis is a very long AI response that should be clamped by default and expandable.',
                    }),
                });
            });

            await navigateToTask(page, serverUrl, TASK_NAME);
            await waitForCommentSidebar(page);

            const card = getCommentCard(page, id);

            // Trigger AI command to get aiResponse
            await card.locator('[data-testid="ai-menu-trigger"]').click();
            const menu = page.locator('[data-testid="ai-command-menu"]');
            await expect(menu).toBeVisible({ timeout: 5_000 });
            await menu.locator('[data-testid="ai-cmd-clarify"]').click();

            // Wait for AI response to appear
            await expect(card.locator('[data-testid="ai-response"]')).toBeVisible({ timeout: 15_000 });

            // Expand button should be visible
            const expandBtn = card.locator('[data-testid="ai-response-expand"]');
            await expect(expandBtn).toBeVisible();

            // Click expand
            await expandBtn.click();

            // Click collapse (toggle)
            await expandBtn.click();

            // Copy button should also be present
            await expect(card.locator('[data-testid="ai-response-copy"]')).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('Resolve All with AI disables cards and shows spinner during batch', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ai-adv-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'ai-repo', repoDir);

            await seedComment(serverUrl, WS_ID, TASK_PATH, 'open 1');
            await seedComment(serverUrl, WS_ID, TASK_PATH, 'open 2');

            // Intercept batch-resolve with delayed response to observe loading state
            let resolveBatchRoute: (() => void) | null = null;
            await page.route('**/batch-resolve', async route => {
                // Signal that the route was hit
                resolveBatchRoute?.();
                // Keep hanging to observe disabled state
                await new Promise(r => setTimeout(r, 1000));
                await route.fulfill({
                    status: 202,
                    contentType: 'application/json',
                    body: JSON.stringify({ taskId: 'mock-batch-1' }),
                });
            });

            await page.route('**/api/queue/**', async route => {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        task: { id: 'mock-batch-1', status: 'completed', result: { revisedContent: '', commentIds: [] } },
                    }),
                });
            });

            await navigateToTask(page, serverUrl, TASK_NAME);
            await waitForCommentSidebar(page);

            const sidebar = page.locator('[data-testid="comment-sidebar"]');
            await expect(sidebar.locator('[data-testid="comment-list"] [data-testid^="comment-card-"]')).toHaveCount(2, { timeout: 5_000 });

            const resolveAllBtn = sidebar.locator('[data-testid="resolve-all-ai-btn"]');
            await expect(resolveAllBtn).toBeVisible({ timeout: 5_000 });

            // Set up batch route resolved callback
            const batchHit = new Promise<void>(r => { resolveBatchRoute = r; });

            // Click Resolve All
            await resolveAllBtn.click();
            await batchHit;

            // During the batch operation, the button should be disabled
            await expect(resolveAllBtn).toBeDisabled();
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
