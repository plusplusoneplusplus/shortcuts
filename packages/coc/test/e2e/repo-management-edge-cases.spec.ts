/**
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
import { openAddRepoOption, openRemotePicker } from './fixtures/remote-shell';

// ============================================================================
// Helper: Open the Add Repo dialog via the remote-chip picker
// ============================================================================

async function openAddRepoDialog(page: import('@playwright/test').Page, serverUrl: string): Promise<void> {
    await page.goto(serverUrl);
    await openAddRepoOption(page, 'remote-add-repo-option');
    await expect(page.locator('#add-repo-overlay')).toBeVisible({ timeout: 5_000 });
}

/**
 * Remove a single-clone workspace through the remote-chip picker's row menu,
 * driving the "Remove from CoC" confirm dialog's own Cancel/Remove buttons
 * directly instead of `removeWorkspaceViaRowMenu` (which only ever confirms).
 * The graduated shell's removal confirmation is an in-app `Dialog`
 * (`#clone-remove-dialog`), not a native `window.confirm()` — see TC4 below.
 */
async function openRemoveConfirmDialog(page: import('@playwright/test').Page, name: string): Promise<void> {
    await openRemotePicker(page, name);
    const row = page.locator('[data-testid="remote-dropdown-item"]');
    await expect(row).toHaveCount(1, { timeout: 10_000 });

    const rowMenu = page.locator('[data-testid="remote-dropdown-row-menu"]');
    await expect(rowMenu).toHaveCount(1);
    await rowMenu.click();

    const menu = page.locator('[data-testid="context-menu"]');
    await expect(menu).toBeVisible({ timeout: 5_000 });
    await menu.getByRole('menuitem', { name: /Remove from CoC/ }).click();

    await expect(page.locator('#clone-remove-dialog')).toBeVisible({ timeout: 5_000 });
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
// TC4: Remove repo uses the remote-chip row menu's in-app confirm dialog
// (not a browser window.confirm())
//
// Documents current behavior: "Remove from CoC" in the remote-dropdown row
// menu opens an in-app `Dialog` (`#clone-remove-dialog`) with explicit
// Cancel/Remove buttons — the classic RepoTabStrip's native
// `window.confirm()` is gone along with the tab strip itself. If a special
// "in-progress tasks" warning is ever added to that dialog, this test should
// be updated.
// ============================================================================

test.describe('Repo remove — in-app confirm dialog', () => {
    test('remove row-menu action opens the in-app confirm dialog, not a browser dialog', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-remove-edge', 'edge-repo', '/tmp/edge-repo');

        await page.goto(serverUrl);
        await expect(page.locator('#view-repos')).toBeVisible({ timeout: 10_000 });

        // A native dialog listener should never fire for this flow.
        let nativeDialogFired = false;
        page.on('dialog', async dialog => {
            nativeDialogFired = true;
            await dialog.dismiss();
        });

        await openRemoveConfirmDialog(page, 'edge-repo');
        expect(nativeDialogFired).toBe(false);

        // Cancel — the repo must remain.
        await page.locator('#clone-remove-dialog').getByRole('button', { name: 'Cancel' }).click();
        await expect(page.locator('#clone-remove-dialog')).toBeHidden({ timeout: 5_000 });

        await openRemotePicker(page, 'edge-repo');
        await expect(page.locator('[data-testid="remote-dropdown-item"]')).toHaveCount(1);
    });

    test('confirming remove in the dialog deletes the repo', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-remove-confirm', 'confirm-repo', '/tmp/confirm-repo');

        await page.goto(serverUrl);
        await expect(page.locator('#view-repos')).toBeVisible({ timeout: 10_000 });

        await openRemoveConfirmDialog(page, 'confirm-repo');
        await page.locator('[data-testid="clone-remove-confirm-btn"]').click();
        await expect(page.locator('#clone-remove-dialog')).toBeHidden({ timeout: 10_000 });

        await openRemotePicker(page);
        await expect(page.locator('[data-testid="remote-dropdown-item"]')).toHaveCount(0, { timeout: 10_000 });
    });
});

// ============================================================================
// TC5: Remove repo with running queue task — documents current behavior
//
// NOTE: Currently the UI does NOT warn about in-progress tasks when removing
// a repo. It only shows the generic "Remove from CoC?" confirm dialog. This
// test documents that the DELETE /api/workspaces/:id succeeds regardless of
// task state.
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
        await expect(page.locator('#view-repos')).toBeVisible({ timeout: 10_000 });

        // Confirm the default dialog (no special in-progress-tasks warning expected)
        await openRemoveConfirmDialog(page, 'task-repo');
        await expect(page.locator('#clone-remove-dialog')).not.toContainText(/in.progress|running task/i);
        await page.locator('[data-testid="clone-remove-confirm-btn"]').click();
        await expect(page.locator('#clone-remove-dialog')).toBeHidden({ timeout: 10_000 });

        // Repo is removed despite having in-progress tasks
        await openRemotePicker(page);
        await expect(page.locator('[data-testid="remote-dropdown-item"]')).toHaveCount(0, { timeout: 10_000 });

        // Verify the workspace is actually gone from the API
        const res = await request(`${serverUrl}/api/workspaces`);
        const { workspaces } = JSON.parse(res.body);
        const found = workspaces.find((w: Record<string, unknown>) => w.id === 'ws-remove-task');
        expect(found).toBeUndefined();
    });
});
