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

        // Page should still render (top bar, tab bar visible)
        await expect(page.locator('header[data-react]')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('[data-tab="repos"]')).toBeVisible();

        // Switch to processes tab — no processes should render
        await page.click('[data-tab="processes"]');
        await expect(page.locator('#view-processes')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.process-item')).toHaveCount(0);
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

        // Tab navigation should still work
        await page.click('[data-tab="processes"]');
        await expect(page.locator('#view-processes')).toBeVisible({ timeout: 5000 });
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
            await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

            await page.locator('.repo-item').first().click();
            await expect(page.locator('#repo-detail-content')).toBeVisible();

            await page.click('.repo-sub-tab[data-subtab="tasks"]');
            await expect(page.locator('.miller-columns')).toBeVisible({ timeout: 10000 });

            // Mock only the enqueue endpoint to return error (avoid breaking /queue/models)
            await page.route('**/api/queue/tasks', (route, req) => {
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
            await expect(page.locator('#follow-prompt-submenu')).toBeVisible();
            await expect(page.locator('.fp-item').first()).toBeVisible({ timeout: 10000 });

            // Click a prompt item to trigger enqueue
            await page.locator('.fp-item').first().click();

            // Error toast should appear
            await expect(page.locator('.toast-error')).toBeVisible({ timeout: 5000 });
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
        // Seed a queue task
        await seedQueueTask(serverUrl, { type: 'chat', displayName: 'Reload Test' });

        await page.goto(serverUrl + '/#processes');

        // Should show at least 1 task
        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 8000 });

        // Reload
        await page.reload();
        await page.click('[data-tab="processes"]');

        // Task should still appear in history after reload
        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 8000 });
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
        // First visit: intercept queue API to fail
        await page.route('**/api/queue', (route, req) => {
            if (req.method() === 'GET') {
                return route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'temporary failure' }),
                });
            }
            return route.continue();
        });

        await page.goto(serverUrl + '/#processes');

        // No tasks should be visible, empty state shown
        await expect(page.locator('[data-task-id]')).toHaveCount(0);

        // Seed a queue task while page shows error
        await seedQueueTask(serverUrl, { type: 'chat', displayName: 'Recovered Task' });

        // Remove route intercept and reload
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        await page.reload();
        await page.click('[data-tab="processes"]');

        // Should now show the task
        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 8000 });
    });

    // ----------------------------------------------------------------
    // TC9: Admin page re-initializes on each visit
    // ----------------------------------------------------------------

    test('8.19 admin page calls stats API on each visit', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        // First visit to admin
        await page.click('#admin-toggle');
        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#admin-stat-processes')).not.toHaveText('…', { timeout: 5000 });

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
        await seedQueueTask(serverUrl, { type: 'chat', displayName: 'Wipe Me' });

        await page.goto(serverUrl + '/#processes');

        // Verify task exists
        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 8000 });

        // Navigate to admin and wipe
        await page.click('#admin-toggle');
        await expect(page.locator('#admin-page-content')).not.toBeEmpty({ timeout: 5000 });

        await page.click('#admin-wipe-btn');

        // Wait for Confirm Wipe button, then click it
        await expect(page.locator('#admin-wipe-confirm')).toBeVisible({ timeout: 5000 });
        await page.click('#admin-wipe-confirm');

        await expect(page.locator('#admin-wipe-status')).toContainText('wiped successfully', {
            timeout: 10000,
        });

        // Reload and check processes tab
        await page.reload();
        await page.click('[data-tab="processes"]');
        await expect(page.locator('[data-task-id]')).toHaveCount(0, { timeout: 5000 });
    });
});
