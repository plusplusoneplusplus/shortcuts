/**
 * Repo Management Edge Cases E2E Tests
 *
 * Coverage gap: repos.spec.ts covers add, edit, remove, and basic validation
 * (empty path), but does not test:
 *   - API error responses for invalid/non-existent paths (server-side 400)
 *   - Duplicate name conflict (server-side 409)
 *   - Remove behavior when repos have in-progress queue tasks
 *
 * NOTE on "non-existent path" and "duplicate name":
 *   The current API does not validate path existence or name uniqueness.
 *   These tests mock the API responses to verify the UI's error handling
 *   capability, which guards against regressions when proper server-side
 *   validation is added.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace, seedQueueTask, request } from './fixtures/seed';
import { createRepoFixture } from './fixtures/repo-fixtures';

// ============================================================================
// Helper: Open the Add Repo dialog
// ============================================================================

async function openAddRepoDialog(page: import('@playwright/test').Page, serverUrl: string): Promise<void> {
    await page.goto(serverUrl);
    await page.click('[data-tab="repos"]');
    await page.click('[data-testid="repo-tab-add-btn"]');
    await expect(page.locator('[data-testid="repo-tab-add-dropdown"]')).toBeVisible();
    await page.locator('[data-testid="repo-tab-add-repo-option"]').dispatchEvent('click');
    await expect(page.locator('#add-repo-overlay')).toBeVisible({ timeout: 5_000 });
}

// ============================================================================
// TC1: Adding a repo with a non-existent path shows error
// ============================================================================

test.describe('Repo add — invalid path error', () => {
    test('server 400 for non-existent path is shown in the validation area', async ({ page, serverUrl }) => {
        // Mock the workspace creation endpoint to return 400 (simulates server-side path validation)
        await page.route('**/api/workspaces', (route, req) => {
            if (req.method() !== 'POST') return route.continue();
            return route.fulfill({
                status: 400,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Path does not exist or is not accessible' }),
            });
        });

        await openAddRepoDialog(page, serverUrl);

        // Fill in a plausible-looking but non-existent path
        await page.fill('#repo-path', '/this/path/does/not/exist/abc123xyz');
        await page.fill('#repo-alias', 'bad-path-repo');
        await page.click('#add-repo-submit');

        // The UI should display the API error in the validation area
        await expect(page.locator('#repo-validation')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('#repo-validation')).toContainText(/does not exist|not accessible/i);

        // Dialog should remain open (not closed on error)
        await expect(page.locator('#add-repo-overlay')).toBeVisible();
    });
});

// ============================================================================
// TC2: Adding a duplicate repo name shows conflict error
// ============================================================================

test.describe('Repo add — duplicate name conflict', () => {
    test('server 409 for duplicate name is shown in the validation area', async ({ page, serverUrl }) => {
        // Mock the workspace creation endpoint to return 409
        await page.route('**/api/workspaces', (route, req) => {
            if (req.method() !== 'POST') return route.continue();
            return route.fulfill({
                status: 409,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'A repository with this name already exists' }),
            });
        });

        await openAddRepoDialog(page, serverUrl);

        await page.fill('#repo-path', '/tmp/some-repo');
        await page.fill('#repo-alias', 'existing-repo');
        await page.click('#add-repo-submit');

        // Validation area should show the conflict error
        await expect(page.locator('#repo-validation')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('#repo-validation')).toContainText(/already exists/i);

        // Dialog should remain open
        await expect(page.locator('#add-repo-overlay')).toBeVisible();
    });
});

// ============================================================================
// TC3: Generic server error during add shows user-friendly message
// ============================================================================

test.describe('Repo add — generic server error handling', () => {
    test('500 error during add shows a fallback message in the validation area', async ({ page, serverUrl }) => {
        await page.route('**/api/workspaces', (route, req) => {
            if (req.method() !== 'POST') return route.continue();
            return route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Internal Server Error' }),
            });
        });

        await openAddRepoDialog(page, serverUrl);

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-repo-err-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            await page.fill('#repo-path', repoDir);
            await page.fill('#repo-alias', 'error-repo');
            await page.click('#add-repo-submit');

            // Validation area should show an error (either the server message or a fallback)
            await expect(page.locator('#repo-validation')).toBeVisible({ timeout: 5_000 });
            await expect(page.locator('#repo-validation')).toHaveClass(/red|error/, { timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ============================================================================
// TC4: Remove repo uses browser confirm dialog (not a special in-progress warning)
//
// Documents current behavior: the remove button opens a browser window.confirm()
// dialog with no special warning about in-progress queue tasks.
// If a "in-progress tasks" warning is ever added, this test should be updated.
// ============================================================================

test.describe('Repo remove — confirm dialog', () => {
    // Remove flow moved from a dedicated #repo-remove-btn to the right-click
    // context menu on the repo tab. Tests now open the context menu and click
    // the "Remove" item ([data-testid="repo-tab-context-remove"]).
    test('remove button triggers browser confirm dialog', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-remove-edge', 'edge-repo', '/tmp/edge-repo');

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10_000 });

        // Set up a dialog handler BEFORE triggering the remove — track that it fires
        let dialogFired = false;
        page.on('dialog', async dialog => {
            dialogFired = true;
            await dialog.dismiss(); // Cancel — do not actually remove
        });

        await page.locator('[data-testid="repo-tab"]').first().click({ button: 'right' });
        await expect(page.locator('[data-testid="repo-tab-context-remove"]')).toBeVisible({ timeout: 5_000 });
        await page.click('[data-testid="repo-tab-context-remove"]');

        // Allow time for dialog to appear
        await page.waitForTimeout(500);

        expect(dialogFired).toBe(true);

        // After cancel, repo should still be in the list
        await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1);
    });

    test('confirming remove deletes the repo', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-remove-confirm', 'confirm-repo', '/tmp/confirm-repo');

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10_000 });

        page.on('dialog', dialog => dialog.accept());

        await page.locator('[data-testid="repo-tab"]').first().click({ button: 'right' });
        await expect(page.locator('[data-testid="repo-tab-context-remove"]')).toBeVisible({ timeout: 5_000 });
        await page.click('[data-testid="repo-tab-context-remove"]');

        // After accept, repo should be gone
        await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(0, { timeout: 10_000 });
    });
});

// ============================================================================
// TC5: Remove repo with running queue task — documents current behavior
//
// NOTE: Currently the UI does NOT warn about in-progress tasks when removing
// a repo. It only shows the generic browser confirm dialog. This test documents
// that the DELETE /api/workspaces/:id succeeds regardless of task state.
// ============================================================================

test.describe('Repo remove — with in-progress tasks (current behavior)', () => {
    test('repo can be removed even when there are in-progress queue tasks (no special warning)', async ({ page, serverUrl }) => {
        // Seed a workspace and a running queue task for it
        await seedWorkspace(serverUrl, 'ws-remove-task', 'task-repo', '/tmp/task-repo');
        await seedQueueTask(serverUrl, {
            type: 'chat',
            displayName: 'In-Progress Task',
            repoId: 'ws-remove-task',
        });

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10_000 });

        // Accept the default confirm dialog (no special in-progress-tasks warning expected)
        page.on('dialog', dialog => dialog.accept());

        await page.locator('[data-testid="repo-tab"]').first().click({ button: 'right' });
        await expect(page.locator('[data-testid="repo-tab-context-remove"]')).toBeVisible({ timeout: 5_000 });
        await page.click('[data-testid="repo-tab-context-remove"]');

        // Repo is removed despite having in-progress tasks
        await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(0, { timeout: 10_000 });

        // Verify the workspace is actually gone from the API
        const res = await request(`${serverUrl}/api/workspaces`);
        const { workspaces } = JSON.parse(res.body);
        const found = workspaces.find((w: Record<string, unknown>) => w.id === 'ws-remove-task');
        expect(found).toBeUndefined();
    });
});
