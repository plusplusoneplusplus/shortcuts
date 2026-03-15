/**
 * Persistent Repo List on All Pages — E2E Tests (persistent-repo-list)
 *
 * Verifies the "persistent mini repos sidebar" feature:
 *   - Mini sidebar is NOT shown on the repos tab
 *   - Mini sidebar IS shown on non-repos tabs (processes, admin, skills, logs, memory)
 *   - Clicking a repo in the mini sidebar navigates to #repos with that repo selected
 *   - RepoTabStrip in TopBar is always visible (on all tabs)
 *   - On mobile viewport the mini sidebar is hidden
 *
 * Relies on data-testid attributes:
 *   data-testid="mini-sidebar-layout"        — wrapper div
 *   data-testid="persistent-mini-sidebar"    — aside element
 *   data-testid="mini-repos-sidebar"         — the sidebar nav
 *   data-testid="mini-repo-item"             — individual repo buttons
 *   data-testid="repo-tab-strip"             — RepoTabStrip in TopBar
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

async function navigateTo(page: import('@playwright/test').Page, serverUrl: string, tab: string): Promise<void> {
    await page.goto(`${serverUrl}/#${tab}`);
    await page.waitForTimeout(300);
}

// ---------------------------------------------------------------------------
// 1. Repos tab — no mini sidebar
// ---------------------------------------------------------------------------

test.describe('PRL.1 — Repos tab has no persistent mini sidebar', () => {
    test('PRL.1.1 mini-sidebar-layout is not present on repos tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await expect(page.locator('#view-repos')).toBeVisible({ timeout: 10_000 });

        // Mini sidebar layout wrapper should NOT be present on repos tab
        await expect(page.locator('[data-testid="mini-sidebar-layout"]')).toHaveCount(0);
    });

    test('PRL.1.2 persistent-mini-sidebar is not present on repos tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await expect(page.locator('#view-repos')).toBeVisible({ timeout: 10_000 });

        await expect(page.locator('[data-testid="persistent-mini-sidebar"]')).toHaveCount(0);
    });
});

// ---------------------------------------------------------------------------
// 2. Non-repos tabs — mini sidebar appears
// ---------------------------------------------------------------------------

test.describe('PRL.2 — Persistent mini sidebar on non-repos tabs', () => {
    test('PRL.2.1 mini sidebar is visible on processes tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('#processes-toggle');
        await expect(page.locator('#view-processes')).toBeVisible({ timeout: 10_000 });

        await expect(page.locator('[data-testid="mini-sidebar-layout"]')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('[data-testid="persistent-mini-sidebar"]')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('[data-testid="mini-repos-sidebar"]')).toBeVisible({ timeout: 5_000 });
    });

    test('PRL.2.2 mini sidebar is visible on admin tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('#admin-toggle');
        // Admin renders inside a scroll container
        await expect(page.locator('[data-testid="admin-scroll-container"]')).toBeVisible({ timeout: 10_000 });

        await expect(page.locator('[data-testid="mini-sidebar-layout"]')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('[data-testid="mini-repos-sidebar"]')).toBeVisible({ timeout: 5_000 });
    });

    test('PRL.2.3 mini sidebar is visible on skills tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('#skills-toggle');
        await page.waitForTimeout(500); // lazy load

        await expect(page.locator('[data-testid="mini-sidebar-layout"]')).toBeVisible({ timeout: 8_000 });
        await expect(page.locator('[data-testid="mini-repos-sidebar"]')).toBeVisible({ timeout: 5_000 });
    });

    test('PRL.2.4 mini sidebar is visible on logs tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('#logs-toggle');
        await page.waitForTimeout(500); // lazy load

        await expect(page.locator('[data-testid="mini-sidebar-layout"]')).toBeVisible({ timeout: 8_000 });
        await expect(page.locator('[data-testid="mini-repos-sidebar"]')).toBeVisible({ timeout: 5_000 });
    });

    test('PRL.2.5 mini sidebar is visible on memory tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('#memory-toggle');
        await page.waitForTimeout(500); // lazy load

        await expect(page.locator('[data-testid="mini-sidebar-layout"]')).toBeVisible({ timeout: 8_000 });
        await expect(page.locator('[data-testid="mini-repos-sidebar"]')).toBeVisible({ timeout: 5_000 });
    });
});

// ---------------------------------------------------------------------------
// 3. Mini sidebar navigation — clicking a repo navigates to repos tab
// ---------------------------------------------------------------------------

test.describe('PRL.3 — Mini sidebar repo navigation', () => {
    test('PRL.3.1 clicking repo in mini sidebar navigates to repos tab with repo selected', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-prl-'));
        try {
            const repoPath = createTempRepo(tmpDir, 'my-project');
            await seedWorkspace(serverUrl, 'ws-prl-test', 'my-project', repoPath);

            // Navigate to processes tab
            await page.goto(serverUrl);
            await page.click('#processes-toggle');
            await expect(page.locator('[data-testid="mini-repos-sidebar"]')).toBeVisible({ timeout: 10_000 });

            // Wait for the repo to appear in the mini sidebar
            const repoItem = page.locator('[data-testid="mini-repo-item"]').first();
            await expect(repoItem).toBeVisible({ timeout: 10_000 });

            // Click the repo
            await repoItem.click();

            // Should navigate to repos tab and select the repo
            await expect(page.locator('#view-repos')).toBeVisible({ timeout: 8_000 });
            // Hash should include #repos
            await expect(page).toHaveURL(/[#]repos/, { timeout: 5_000 });
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('PRL.3.2 clicking repo in mini sidebar from admin shows repo detail', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-prl-'));
        try {
            const repoPath = createTempRepo(tmpDir, 'admin-nav-repo');
            await seedWorkspace(serverUrl, 'ws-prl-admin', 'admin-nav-repo', repoPath);

            // Start on admin tab
            await page.goto(serverUrl);
            await page.click('#admin-toggle');
            await expect(page.locator('[data-testid="mini-repos-sidebar"]')).toBeVisible({ timeout: 10_000 });

            // Wait for the repo to appear and click it
            const repoItem = page.locator('[data-testid="mini-repo-item"]').first();
            await expect(repoItem).toBeVisible({ timeout: 10_000 });
            await repoItem.click();

            // Should navigate to repos tab
            await expect(page.locator('#view-repos')).toBeVisible({ timeout: 8_000 });
            await expect(page).toHaveURL(/[#]repos/, { timeout: 5_000 });
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

// ---------------------------------------------------------------------------
// 4. RepoTabStrip visible on all tabs
// ---------------------------------------------------------------------------

test.describe('PRL.4 — RepoTabStrip always visible in TopBar (desktop)', () => {
    test('PRL.4.1 repo-tab-strip is visible on repos tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await expect(page.locator('#view-repos')).toBeVisible({ timeout: 10_000 });

        await expect(page.locator('[data-testid="repo-tab-strip"]')).toBeVisible({ timeout: 5_000 });
    });

    test('PRL.4.2 repo-tab-strip is visible on processes tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('#processes-toggle');
        await expect(page.locator('#view-processes')).toBeVisible({ timeout: 10_000 });

        await expect(page.locator('[data-testid="repo-tab-strip"]')).toBeVisible({ timeout: 5_000 });
    });

    test('PRL.4.3 repo-tab-strip is visible on admin tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('#admin-toggle');
        await expect(page.locator('[data-testid="admin-scroll-container"]')).toBeVisible({ timeout: 10_000 });

        await expect(page.locator('[data-testid="repo-tab-strip"]')).toBeVisible({ timeout: 5_000 });
    });

    test('PRL.4.4 repo-tab-strip is visible on memory tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('#memory-toggle');
        await page.waitForTimeout(500);

        await expect(page.locator('[data-testid="repo-tab-strip"]')).toBeVisible({ timeout: 8_000 });
    });
});

// ---------------------------------------------------------------------------
// 5. Mobile — mini sidebar hidden
// ---------------------------------------------------------------------------

test.describe('PRL.5 — Mini sidebar hidden on mobile', () => {
    test('PRL.5.1 persistent-mini-sidebar not visible on mobile viewport', async ({ page, serverUrl }) => {
        // Set mobile viewport
        await page.setViewportSize({ width: 375, height: 812 });
        await page.goto(serverUrl);

        // Navigate to processes
        await page.goto(`${serverUrl}/#processes`);
        await page.waitForTimeout(300);

        // The persistent-mini-sidebar has hidden md:flex classes, so it is in DOM
        // but hidden at mobile viewport (display: none via Tailwind)
        const sidebar = page.locator('[data-testid="persistent-mini-sidebar"]');
        // Either not present or not visible (Tailwind hidden class = display:none)
        const count = await sidebar.count();
        if (count > 0) {
            await expect(sidebar).not.toBeVisible();
        }
    });
});

// ---------------------------------------------------------------------------
// 6. Repos tab unaffected — no double repo list
// ---------------------------------------------------------------------------

test.describe('PRL.6 — Repos tab unaffected', () => {
    test('PRL.6.1 only one mini-repos-sidebar instance on repos tab (via tab strip, not sidebar)', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await expect(page.locator('#view-repos')).toBeVisible({ timeout: 10_000 });

        // persistent-mini-sidebar should NOT be rendered on the repos tab
        await expect(page.locator('[data-testid="persistent-mini-sidebar"]')).toHaveCount(0);
    });
});
