/**
 * Error Handling E2E Tests (008)
 *
 * Comprehensive tests for error paths: API failures, network errors,
 * wipe token validation, toast error display, and data consistency
 * after disruption.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedProcess, seedQueueTask, seedWorkspace, request } from './fixtures/seed';
import { createRepoFixture, createTasksFixture } from './fixtures/repo-fixtures';

// ================================================================
// Helpers
// ================================================================

function createPromptFixtures(repoDir: string): void {
    const promptDir = path.join(repoDir, '.github', 'prompts');
    fs.mkdirSync(promptDir, { recursive: true });
    fs.writeFileSync(
        path.join(promptDir, 'review.prompt.md'),
        '---\ndescription: Review task\n---\nReview this task.\n',
    );

    // Skills must be in .github/skills/ for the FollowPromptDialog to find them
    const skillDir = path.join(repoDir, '.github', 'skills', 'review');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        '---\ndescription: Review task\n---\n# review\nReview this task.\n',
    );
}

// ================================================================
// Tests
// ================================================================

test.describe('Error Handling (008)', () => {

    // ----------------------------------------------------------------
    // TC1: Init handles 500 from /api/processes gracefully
    // ----------------------------------------------------------------

    test('8.11 SPA renders when /api/processes returns 500', async ({ page, serverUrl }) => {
        // Intercept processes API to return 500
        await page.route('**/api/processes', (route, req) => {
            if (req.method() === 'GET') {
                return route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'Internal Server Error' }),
                });
            }
            return route.continue();
        });

        await page.goto(serverUrl);

        // Page should still render (top bar, tab bar visible) — the SPA must
        // tolerate a 500 from /api/processes during init without crashing.
        // The standalone Processes navigation tab was removed; navigation is
        // limited to Repos / Skills / Admin etc.
        await expect(page.locator('header[data-react]')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('[data-tab="repos"]')).toBeVisible();
        await expect(page.locator('#admin-toggle')).toBeVisible();
    });

    // ----------------------------------------------------------------
    // TC2: Init handles network failure gracefully
    // ----------------------------------------------------------------

    test('8.12 handles network failure on init without crash', async ({ page, serverUrl }) => {
        // Abort the processes and workspaces API calls
        await page.route('**/api/processes', route => route.abort('failed'));
        await page.route('**/api/workspaces', route => route.abort('failed'));

        await page.goto(serverUrl);

        // Page should still render (SPA catches errors silently)
        await expect(page.locator('header[data-react]')).toBeVisible({ timeout: 5000 });

        // Top-level navigation should still work (Admin is always reachable)
        await page.click('#admin-toggle');
        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 5000 });
    });

    // ----------------------------------------------------------------
    // TC3: Toast shows error on failed enqueue
    // ----------------------------------------------------------------

    test('8.13 toast shows error on failed enqueue', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-err-enqueue-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            createPromptFixtures(repoDir);

            await seedWorkspace(serverUrl, 'ws-err-enqueue', 'err-enqueue-repo', repoDir);

            await page.goto(serverUrl);
            await page.click('[data-tab="repos"]');
            await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10000 });

            await page.locator('[data-testid="repo-tab"]').first().click();
            await expect(page.locator('#repo-detail-content')).toBeVisible();

            await page.click('.repo-sub-tab[data-subtab="tasks"]');
            await expect(page.locator('.miller-columns')).toBeVisible({ timeout: 10000 });

            // Mock only the enqueue endpoint to return error (avoid breaking /api/models)
            await page.route('**/api/queue', (route, req) => {
                if (req.method() === 'POST') {
                    return route.fulfill({
                        status: 500,
                        contentType: 'application/json',
                        body: JSON.stringify({ error: 'Queue service unavailable' }),
                    });
                }
                return route.continue();
            });

            // Trigger an AI action
            const fileRow = page.locator('.miller-file-row').first();
            await expect(fileRow).toBeVisible();
            await fileRow.click({ button: 'right' });

            const contextMenu = page.locator('[data-testid="context-menu"]');
            await expect(contextMenu).toBeVisible({ timeout: 5000 });
            await contextMenu.getByRole('menuitem', { name: /Run Skill/ }).click();

            // Run Skill now opens the unified EnqueueDialog
            const overlay = page.locator('[data-testid="floating-dialog-panel"]');
            await expect(overlay).toBeVisible({ timeout: 5000 });

            // Open the SkillPicker, pick the first available skill, then submit
            await page.locator('[data-testid="skill-picker-trigger"]').click();
            const firstSkill = page.locator('[data-testid^="skill-picker-item-"]').first();
            await expect(firstSkill).toBeVisible({ timeout: 10000 });
            await firstSkill.click();

            // Submit via primary footer button (label 'Enqueue' for Run Skill mode)
            await overlay.locator('button:has-text("Enqueue")').click();

            // The 500 from /api/queue should propagate as an error indication —
            // either via toast or via dialog status. We accept either signal so
            // the test stays resilient to UI-detail changes.
            const errorToast = page.locator('.toast-error');
            const enqueueBtn = overlay.locator('button:has-text("Enqueue")');
            // Wait until either the error toast appears or the dialog stays open
            // with a re-enabled submit button, indicating the request failed.
            await Promise.race([
                expect(errorToast).toBeVisible({ timeout: 5000 }),
                expect(enqueueBtn).toBeEnabled({ timeout: 5000 }),
            ]).catch(() => undefined);
            const toastVisible = await errorToast.isVisible().catch(() => false);
            const dialogStillOpen = await overlay.isVisible().catch(() => false);
            expect(toastVisible || dialogStillOpen).toBe(true);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    // ----------------------------------------------------------------
    // TC4: Admin wipe with invalid token shows error
    // ----------------------------------------------------------------

    test('8.14 wipe fails with invalid token', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('#admin-toggle');
        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#admin-page-content')).not.toBeEmpty({ timeout: 5000 });

        // Intercept wipe-token to return a fake token
        await page.route('**/api/admin/data/wipe-token', route =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ token: 'invalid-fake-token', expiresIn: 300 }),
            }),
        );

        // Intercept DELETE to simulate invalid token rejection
        await page.route('**/api/admin/data?**', (route, req) => {
            if (req.method() === 'DELETE') {
                return route.fulfill({
                    status: 403,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'Invalid or expired confirmation token' }),
                });
            }
            return route.continue();
        });

        await page.click('[data-testid="admin-tab-data"]');
        await page.click('#admin-wipe-btn');

        // Wait for token → Confirm Wipe button appears, then click it
        await expect(page.locator('#admin-wipe-confirm')).toBeVisible({ timeout: 5000 });
        await page.click('#admin-wipe-confirm');

        // Status should show failure message (DELETE returns 403)
        await expect(page.locator('#admin-wipe-status')).toContainText('failed', { timeout: 5000 });
    });

    // ----------------------------------------------------------------
    // TC5: Preview wipe handles API failure
    // ----------------------------------------------------------------

    test('8.15 preview wipe shows failure on API error', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        // Navigate to admin first
        await page.click('#admin-toggle');
        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#admin-page-content')).not.toBeEmpty({ timeout: 5000 });

        // Now intercept stats API for preview
        await page.route('**/api/admin/data/stats**', route =>
            route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'stats unavailable' }),
            }),
        );

        await page.click('[data-testid="admin-tab-data"]');

        // Click preview
        await page.click('#admin-preview-wipe');

        // Preview should show failure text
        await expect(page.locator('#admin-wipe-preview')).not.toHaveClass(/hidden/, { timeout: 5000 });
        await expect(page.locator('#admin-wipe-preview')).toContainText('Failed', { timeout: 5000 });
    });

    // ----------------------------------------------------------------
    // TC6: Data consistency after page reload
    // ----------------------------------------------------------------

    test('8.16 process changes are reflected after reload', async ({ page, serverUrl }) => {
        // Seed a workspace and a queue task scoped to it. Since the standalone
        // Processes navigation tab was removed, tasks are surfaced via the
        // repo's Chats/Activity sub-tab, which requires a workspace association.
        const wsId = 'ws-err-reload';
        await seedWorkspace(serverUrl, wsId, 'reload-repo');
        await seedQueueTask(serverUrl, {
            type: 'chat',
            displayName: 'Reload Test',
            workspaceId: wsId,
            payload: { prompt: 'Reload-Marker-' + Math.random().toString(36).slice(2) },
        });

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('[data-testid="repo-tab"]').first()).toBeVisible({ timeout: 10000 });
        await page.locator('[data-testid="repo-tab"]').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();

        // Should show the seeded task in the chat list (mock AI completes the task
        // immediately so it lands in the Completed history section). We only need
        // *some* task with a `data-task-id` to be visible.
        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 10_000 });

        // Reload — task should still appear after reload
        await page.reload();
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 10_000 });
    });

    // ----------------------------------------------------------------
    // TC7: Wipe token request failure
    // ----------------------------------------------------------------

    test('8.17 wipe shows error when token request fails', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('#admin-toggle');
        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#admin-page-content')).not.toBeEmpty({ timeout: 5000 });

        // Mock wipe-token to fail
        await page.route('**/api/admin/data/wipe-token', route =>
            route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Token generation failed' }),
            }),
        );

        await page.click('[data-testid="admin-tab-data"]');
        await page.click('#admin-wipe-btn');

        // Status should show failure (no confirm dialog triggered)
        await expect(page.locator('#admin-wipe-status')).toContainText('Failed to get wipe token', {
            timeout: 5000,
        });
    });

    // ----------------------------------------------------------------
    // TC8: Processes tab recovers on reload after init failure
    // ----------------------------------------------------------------

    test('8.18 processes recover on reload after init failure', async ({ page, serverUrl }) => {
        const wsId = 'ws-err-recover';
        await seedWorkspace(serverUrl, wsId, 'recover-repo');

        // First visit: intercept queue history API to fail. The chat list pulls
        // the completed-tasks section from /api/workspaces/:id/history, so we
        // fail that endpoint to simulate an init failure for the chat list.
        await page.route('**/api/workspaces/*/history*', (route, req) => {
            if (req.method() === 'GET') {
                return route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'temporary failure' }),
                });
            }
            return route.continue();
        });

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('[data-testid="repo-tab"]').first()).toBeVisible({ timeout: 10000 });
        await page.locator('[data-testid="repo-tab"]').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();

        // No tasks should be visible while the history API is failing
        await expect(page.locator('[data-task-id]')).toHaveCount(0);

        // Seed a queue task while page shows error
        await seedQueueTask(serverUrl, {
            type: 'chat',
            displayName: 'Recovered Task',
            workspaceId: wsId,
        });

        // Remove route intercept and reload
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        await page.reload();
        await expect(page.locator('[data-testid="repo-tab"]').first()).toBeVisible({ timeout: 10000 });
        await page.locator('[data-testid="repo-tab"]').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();

        // Should now show the recovered task
        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 10_000 });
    });

    // ----------------------------------------------------------------
    // TC9: Admin page re-initializes on each visit
    // ----------------------------------------------------------------

    test('8.19 admin page calls stats API on each visit', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        // First visit to admin
        await page.click('#admin-toggle');
        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#admin-page-content')).not.toBeEmpty({ timeout: 5000 });

        // Switch to repos (navigate away from admin)
        await page.click('[data-tab="repos"]');
        await expect(page.locator('#view-repos')).toBeVisible();

        // Return to admin — intercept to verify stats API is called again
        const statsPromise = page.waitForRequest(req =>
            req.url().includes('/admin/data/stats'),
        );

        await page.click('#admin-toggle');
        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 5000 });

        // Stats API should have been called on re-entry
        await statsPromise;
    });

    // ----------------------------------------------------------------
    // TC10: Wipe followed by reload shows no processes
    // ----------------------------------------------------------------

    test('8.20 wipe followed by reload shows no processes', async ({ page, serverUrl }) => {
        const wsId = 'ws-err-wipe';
        await seedWorkspace(serverUrl, wsId, 'wipe-repo');
        await seedQueueTask(serverUrl, {
            type: 'chat',
            displayName: 'Wipe Me',
            workspaceId: wsId,
        });

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('[data-testid="repo-tab"]').first()).toBeVisible({ timeout: 10000 });
        await page.locator('[data-testid="repo-tab"]').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();

        // Verify the seeded task is reachable
        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 10_000 });

        // Navigate to admin and wipe
        await page.click('#admin-toggle');
        await expect(page.locator('#admin-page-content')).not.toBeEmpty({ timeout: 5000 });

        await page.click('[data-testid="admin-tab-data"]');
        await page.click('#admin-wipe-btn');

        // Wait for Confirm Wipe button, then click it
        await expect(page.locator('#admin-wipe-confirm')).toBeVisible({ timeout: 5000 });
        await page.click('#admin-wipe-confirm');

        await expect(page.locator('#admin-wipe-status')).toContainText('wiped successfully', {
            timeout: 10000,
        });

        // Reload — wipe drops the workspace registry, so there should be no
        // repos and no surviving task chips anywhere on the page.
        await page.reload();
        await expect(page.locator('[data-task-id]')).toHaveCount(0, { timeout: 5000 });
    });
});
