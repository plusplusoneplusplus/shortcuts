/**
 * MiniReposSidebar E2E Tests
 *
 * Tests the MiniReposSidebar component in its persistent rail on non-repos pages.
 * In the current architecture, MiniReposSidebar is rendered as a persistent rail
 * on all non-repos pages (Processes, Skills, Memory, Admin, etc.) via WithMiniSidebar.
 *
 * Relies on existing data-testid attributes:
 *   data-testid="mini-repos-sidebar"
 *   data-testid="mini-repo-item"
 *   data-testid="mini-empty"
 *   data-testid="mini-add-btn"
 */

import { test, expect } from './fixtures/server-fixture';
import { seedWorkspace, request } from './fixtures/seed';
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

/**
 * Navigate to a non-repos page where MiniReposSidebar is persistently visible.
 * MiniReposSidebar is only rendered on non-repos pages (Processes, Skills, etc.)
 */
async function navigateToMiniSidebar(page: import('@playwright/test').Page): Promise<void> {
    // Navigate to Processes tab where WithMiniSidebar wraps the content
    await page.click('[data-tab="processes"]');
    await expect(page.locator('#view-processes')).toBeVisible({ timeout: 10_000 });
    // Wait for MiniReposSidebar to appear in the persistent rail
    await expect(page.locator('[data-testid="mini-repos-sidebar"]')).toBeVisible({ timeout: 5_000 });
}

// ---------------------------------------------------------------------------
// 1. Empty state
// ---------------------------------------------------------------------------

test.describe('MiniReposSidebar – Empty state', () => {
    test('MRS.1 shows empty state when no workspaces exist', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await navigateToMiniSidebar(page);

        // No seeded workspaces — empty state should appear
        await expect(page.locator('[data-testid="mini-empty"]')).toBeVisible({ timeout: 5_000 });
    });

    test('MRS.2 add button is visible in empty state', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await navigateToMiniSidebar(page);

        await expect(page.locator('[data-testid="mini-add-btn"]')).toBeVisible({ timeout: 5_000 });
    });
});

// ---------------------------------------------------------------------------
// 2. Populated sidebar
// ---------------------------------------------------------------------------

test.describe('MiniReposSidebar – With workspaces', () => {
    test('MRS.3 lists seeded workspaces in the sidebar', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-mrs-'));
        try {
            const repoA = createTempRepo(tmpDir, 'repo-a');
            const repoB = createTempRepo(tmpDir, 'repo-b');
            await seedWorkspace(serverUrl, 'ws-alpha', 'repo-a', repoA);
            await seedWorkspace(serverUrl, 'ws-beta', 'repo-b', repoB);

            await page.goto(serverUrl);
            await navigateToMiniSidebar(page);

            // Both repos should appear
            const items = page.locator('[data-testid="mini-repo-item"]');
            await expect(items).toHaveCount(2, { timeout: 8_000 });
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('MRS.4 empty state is hidden when repos exist', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-mrs-'));
        try {
            const repoA = createTempRepo(tmpDir, 'repo-c');
            await seedWorkspace(serverUrl, 'ws-gamma', 'repo-c', repoA);

            await page.goto(serverUrl);
            await navigateToMiniSidebar(page);

            await expect(page.locator('[data-testid="mini-repo-item"]')).toHaveCount(1, { timeout: 8_000 });
            await expect(page.locator('[data-testid="mini-empty"]')).toHaveCount(0);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('MRS.5 add button is always visible', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-mrs-'));
        try {
            const repoD = createTempRepo(tmpDir, 'repo-d');
            await seedWorkspace(serverUrl, 'ws-delta', 'repo-d', repoD);

            await page.goto(serverUrl);
            await navigateToMiniSidebar(page);

            await expect(page.locator('[data-testid="mini-add-btn"]')).toBeVisible({ timeout: 5_000 });
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

// ---------------------------------------------------------------------------
// 3. Navigation
// ---------------------------------------------------------------------------

test.describe('MiniReposSidebar – Navigation', () => {
    test('MRS.6 clicking a repo item navigates to repo detail', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-mrs-'));
        try {
            const repoE = createTempRepo(tmpDir, 'repo-e');
            await seedWorkspace(serverUrl, 'ws-epsilon', 'repo-e', repoE);

            await page.goto(serverUrl);
            await navigateToMiniSidebar(page);

            await expect(page.locator('[data-testid="mini-repo-item"]')).toHaveCount(1, { timeout: 8_000 });
            await page.locator('[data-testid="mini-repo-item"]').first().click();

            // After clicking, navigates to repos view and repo detail content shows
            await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 8_000 });
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('MRS.7 clicking repo item switches to repos view with detail', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-mrs-'));
        try {
            const repoF = createTempRepo(tmpDir, 'repo-f');
            await seedWorkspace(serverUrl, 'ws-zeta', 'repo-f', repoF);

            await page.goto(serverUrl);
            await navigateToMiniSidebar(page);

            await expect(page.locator('[data-testid="mini-repo-item"]')).toHaveCount(1, { timeout: 8_000 });
            await page.locator('[data-testid="mini-repo-item"]').first().click();

            // Verify clicking navigated to repos view with detail
            await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 5_000 });
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

// ---------------------------------------------------------------------------
// 4. Add repo
// ---------------------------------------------------------------------------

test.describe('MiniReposSidebar – Add repo', () => {
    test('MRS.8 clicking add button opens add dialog', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await navigateToMiniSidebar(page);

        await page.locator('[data-testid="mini-add-btn"]').click();

        // Add dialog should appear
        await expect(page.locator('#add-repo-overlay')).toBeVisible({ timeout: 5_000 });
    });
});
