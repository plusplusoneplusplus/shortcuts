/**
 * MiniReposSidebar E2E Tests
 *
 * The persistent MiniReposSidebar rail has been removed. Repo switching is
 * handled by the RepoTabStrip in the TopBar on all pages.
 *
 * These tests verify that the sidebar is absent and that the RepoTabStrip
 * add button still works as the primary way to add repos.
 *
 * Relies on data-testid attributes:
 *   data-testid="repo-tab-strip"         — RepoTabStrip in TopBar
 *   data-testid="repo-tab-add-btn"       — "+" button in RepoTabStrip
 *   data-testid="repo-tab-add-repo-option" — dropdown option
 */

import { test, expect } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
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
    // sidebar / tab-strip behaviour on a non-Repos top-level page.
    test('MRS.1 mini-repos-sidebar is not rendered on a non-repos tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('#admin-toggle');
        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 10_000 });
        await page.click('#skills-toggle');
        await expect(page.locator('#view-skills')).toBeVisible({ timeout: 10_000 });

        await expect(page.locator('[data-testid="mini-repos-sidebar"]')).toHaveCount(0);
        await expect(page.locator('[data-testid="persistent-mini-sidebar"]')).toHaveCount(0);
    });

    test('MRS.2 repo-tab-strip add button is visible on a non-repos tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('#admin-toggle');
        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 10_000 });
        await page.click('#skills-toggle');
        await expect(page.locator('#view-skills')).toBeVisible({ timeout: 10_000 });

        await expect(page.locator('[data-testid="repo-tab-add-btn"]')).toBeVisible({ timeout: 5_000 });
    });
});

// ---------------------------------------------------------------------------
// 2. Add repo via RepoTabStrip
// ---------------------------------------------------------------------------

test.describe('MiniReposSidebar – Add repo via RepoTabStrip', () => {
    test('MRS.3 clicking add button in tab strip opens add dialog', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        await page.click('[data-testid="repo-tab-add-btn"]');
        await page.click('[data-testid="repo-tab-add-repo-option"]');

        await expect(page.locator('#add-repo-overlay')).toBeVisible({ timeout: 5_000 });
    });
});

// ---------------------------------------------------------------------------
// 3. Repos visible in RepoTabStrip after seeding
// ---------------------------------------------------------------------------

test.describe('MiniReposSidebar – Repos in RepoTabStrip', () => {
    test('MRS.4 seeded repos appear in repo-tab-strip', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-mrs-'));
        try {
            const repoA = createTempRepo(tmpDir, 'repo-a');
            await seedWorkspace(serverUrl, 'ws-mrs-alpha', 'repo-a', repoA);

            await page.goto(serverUrl);
            await page.click('#admin-toggle');
            await expect(page.locator('#view-admin')).toBeVisible({ timeout: 10_000 });
            await page.click('#skills-toggle');
            await expect(page.locator('#view-skills')).toBeVisible({ timeout: 10_000 });

            // Repo should appear in the tab strip, not in a mini sidebar
            await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 8_000 });
            await expect(page.locator('[data-testid="mini-repos-sidebar"]')).toHaveCount(0);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

