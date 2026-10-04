/**
 * The persistent MiniReposSidebar rail has been removed. Workspace switching
 * was handled by the classic RepoTabStrip in the TopBar next, which was in
 * turn graduated away by the remote-first desktop shell.
 *
 * These tests verify that the sidebar is absent and that the `remote-chip`
 * picker in TopBar's `RemoteShellHeader` (always rendered on desktop,
 * regardless of the active top-level tab) is the current, reachable way to
 * add and switch repos.
 *
 * Relies on data-testid attributes:
 *   data-testid="remote-chip"              — workspace picker trigger in TopBar
 *   data-testid="remote-dropdown"          — the picker's popover
 *   data-testid="remote-dropdown-item"     — one row per remote/clone in the popover
 *   data-testid="remote-add-repo-option"   — "Add repository" footer action
 */

import { test, expect } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { openRemotePicker, openAddRepoOption } from './fixtures/remote-shell';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempRepo(tmpDir: string, name: string): string {
    const dir = path.join(tmpDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.md'), `# ${name}\n`);
    return dir;
}

// ---------------------------------------------------------------------------
// 1. Mini sidebar is absent on all non-repos pages
// ---------------------------------------------------------------------------

test.describe('MiniReposSidebar – Absent from persistent rail', () => {
    // The standalone Processes tab and `[data-tab="processes"]` button were
    // removed; tests that previously exercised the Processes view now navigate
    // to the Skills tab (via the Admin Tools sidebar) to verify the mini
    // sidebar / workspace-picker behaviour on a non-Repos top-level page.
    test('MRS.1 mini-repos-sidebar is not rendered on a non-repos tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('#admin-toggle');
        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 10_000 });
        await page.click('#skills-toggle');
        await expect(page.locator('#view-skills')).toBeVisible({ timeout: 10_000 });

        await expect(page.locator('[data-testid="mini-repos-sidebar"]')).toHaveCount(0);
        await expect(page.locator('[data-testid="persistent-mini-sidebar"]')).toHaveCount(0);
    });

    test('MRS.2 remote-chip picker is visible on a non-repos tab', async ({ page, serverUrl }) => {
        // The Admin dialog is a modal overlay (not a page navigation), so the
        // chip underneath is visible-but-not-interactable while it's open —
        // which is exactly the property this test checks: the picker stays
        // mounted, it does not get unmounted by non-Repos top-level views.
        await page.goto(serverUrl);
        await page.click('#admin-toggle');
        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 10_000 });
        await page.click('#skills-toggle');
        await expect(page.locator('#view-skills')).toBeVisible({ timeout: 10_000 });

        await expect(page.locator('[data-testid="remote-chip"]').first()).toBeVisible({ timeout: 5_000 });
    });
});

// ---------------------------------------------------------------------------
// 2. Add repo via the remote-chip picker
// ---------------------------------------------------------------------------

test.describe('MiniReposSidebar – Add repo via remote-chip picker', () => {
    test('MRS.3 clicking the remote-chip\'s add option opens the add dialog', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        await openAddRepoOption(page, 'remote-add-repo-option');

        await expect(page.locator('#add-repo-overlay')).toBeVisible({ timeout: 5_000 });
    });
});

// ---------------------------------------------------------------------------
// 3. Repos visible in the remote-chip picker after seeding
// ---------------------------------------------------------------------------

test.describe('MiniReposSidebar – Repos in remote-chip picker', () => {
    test('MRS.4 seeded repos appear in the remote-dropdown, not a mini sidebar', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-mrs-'));
        try {
            const repoA = createTempRepo(tmpDir, 'repo-a');
            await seedWorkspace(serverUrl, 'ws-mrs-alpha', 'repo-a', repoA);

            await page.goto(serverUrl);
            await expect(page.locator('#view-repos')).toBeVisible({ timeout: 10_000 });

            // Repo should appear as a row in the remote-chip's popover, not in a
            // mini sidebar (which no longer exists at all).
            await openRemotePicker(page);
            await expect(page.locator('[data-testid="remote-dropdown-item"]')).toHaveCount(1, { timeout: 8_000 });
            await expect(page.locator('[data-testid="mini-repos-sidebar"]')).toHaveCount(0);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
