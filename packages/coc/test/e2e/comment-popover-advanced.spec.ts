/**
 * CommentPopover Advanced E2E Tests
 *
 * Covers: Popover inline edit, Escape key close, AI command from popover.
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
    getCommentById,
} from './fixtures/comment-fixtures';

const WS_ID = 'ws-popover-adv';
const TASK_PATH = 'task-a.md';
const TASK_NAME = 'task-a';

test.describe('CommentPopover Advanced', () => {

    test('popover inline edit saves text correctly', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-popover-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'popover-repo', repoDir);

            const r = await seedComment(serverUrl, WS_ID, TASK_PATH, 'popover edit target');
            const id = (r as any).comment.id as string;

            await navigateToTask(page, serverUrl, TASK_NAME);
            await waitForCommentSidebar(page);

            // Wait for highlight to be attached
            await expect(page.locator(`#task-preview-body [data-comment-id="${id}"]`)).toBeAttached({ timeout: 10_000 });

            // Open popover
            const card = getCommentCard(page, id);
            await card.click({ position: { x: 10, y: 10 } });
            const popover = page.locator('[data-testid="comment-popover"]');
            await expect(popover).toBeVisible({ timeout: 5_000 });
            await expect(popover.locator('[data-testid="popover-comment-body"]')).toContainText('popover edit target');

            // Click Edit in popover
            await popover.locator('button[aria-label="Edit"]').click();

            // Edit textarea should appear with autoFocus
            const textarea = popover.locator('[data-testid="popover-edit-textarea"]');
            await expect(textarea).toBeVisible();

            // Change text and save — wait for PATCH request to complete
            await textarea.fill('popover edited text');
            const patchDone = page.waitForResponse(
                res => res.url().includes('/api/comments/') && res.request().method() === 'PATCH' && res.status() === 200,
            );
            await popover.locator('button:has-text("Save")').click();
            await patchDone;

            // Edit textarea should disappear
            await expect(popover.locator('[data-testid="popover-edit-textarea"]')).toHaveCount(0);

            // Verify server-side
            const apiComment = await getCommentById(serverUrl, WS_ID, TASK_PATH, id);
            expect((apiComment as any).comment).toBe('popover edited text');

            // Close popover and re-open to verify updated text
            await page.keyboard.press('Escape');
            await expect(popover).toHaveCount(0, { timeout: 5_000 });
            await card.click({ position: { x: 10, y: 10 } });
            await expect(popover).toBeVisible({ timeout: 5_000 });
            await expect(popover.locator('[data-testid="popover-comment-body"]')).toContainText('popover edited text');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('popover closes via Escape key', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-popover-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'popover-repo', repoDir);

            const r = await seedComment(serverUrl, WS_ID, TASK_PATH, 'popover escape test');
            const id = (r as any).comment.id as string;

            await navigateToTask(page, serverUrl, TASK_NAME);
            await waitForCommentSidebar(page);

            await expect(page.locator(`#task-preview-body [data-comment-id="${id}"]`)).toBeAttached({ timeout: 10_000 });

            // Open popover
            const card = getCommentCard(page, id);
            await card.click({ position: { x: 10, y: 10 } });
            const popover = page.locator('[data-testid="comment-popover"]');
            await expect(popover).toBeVisible({ timeout: 5_000 });

            // Press Escape
            await page.keyboard.press('Escape');

            // Popover should disappear without any state change
            await expect(popover).toHaveCount(0, { timeout: 5_000 });

            // Comment should still be open (no resolve/delete happened)
            const apiComment = await getCommentById(serverUrl, WS_ID, TASK_PATH, id);
            expect(apiComment).not.toBeNull();
            expect((apiComment as any).status).toBe('open');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('AI command menu opens from popover and is interactive', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-popover-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'popover-repo', repoDir);

            const r = await seedComment(serverUrl, WS_ID, TASK_PATH, 'popover AI target');
            const id = (r as any).comment.id as string;

            await navigateToTask(page, serverUrl, TASK_NAME);
            await waitForCommentSidebar(page);

            await expect(page.locator(`#task-preview-body [data-comment-id="${id}"]`)).toBeAttached({ timeout: 10_000 });

            // Open popover
            const card = getCommentCard(page, id);
            await card.click({ position: { x: 10, y: 10 } });
            const popover = page.locator('[data-testid="comment-popover"]');
            await expect(popover).toBeVisible({ timeout: 5_000 });

            // AI menu trigger should be present in the popover
            const aiTrigger = popover.locator('[data-testid="popover-ai-menu-trigger"]');
            await expect(aiTrigger).toBeVisible();

            // Click AI menu trigger → command menu opens
            await aiTrigger.click();
            const menu = page.locator('[data-testid="popover-ai-command-menu"]');
            await expect(menu).toBeVisible({ timeout: 5_000 });

            // Verify command items are present
            await expect(menu.locator('[data-testid="popover-ai-cmd-clarify"]')).toBeVisible();
            await expect(menu.locator('[data-testid="popover-ai-cmd-custom"]')).toBeVisible();

            // Close menu via Escape
            await page.keyboard.press('Escape');
            await expect(menu).toHaveCount(0, { timeout: 3_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
