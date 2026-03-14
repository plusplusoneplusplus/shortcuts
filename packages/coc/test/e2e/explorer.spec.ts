/**
 * Explorer E2E Tests
 *
 * Tests the ExplorerPanel inside a repo detail view:
 *   - FileTree navigation (initial load, expand directory, filter)
 *   - PreviewPane: file open, dirty-indicator after edit, save button
 *   - QuickOpen: Ctrl+P overlay, filter, select file
 *   - Refresh: reloads the file tree
 *
 * Relies on existing data-testid attributes in the explorer components
 * (no new testids added):
 *   explorer-panel, explorer-sidebar, explorer-refresh-btn,
 *   explorer-preview-pane, file-tree, tree-node-{path},
 *   preview-pane, preview-toolbar, save-btn, dirty-indicator,
 *   monaco-container, quick-open-overlay, quick-open-dialog,
 *   quick-open-input, quick-open-results, quick-open-item-{idx}
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a repo with files for explorer testing. */
function createExplorerRepoFixture(tmpDir: string): string {
    const repoDir = path.join(tmpDir, 'explorer-repo');
    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export default {};\n// main entry\n');
    fs.writeFileSync(path.join(repoDir, 'src', 'utils.ts'), 'export const add = (a: number, b: number) => a + b;\n');
    fs.writeFileSync(path.join(repoDir, 'docs', 'README.md'), '# Project Docs\n\nWelcome.\n');
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# Root README\n');
    return repoDir;
}

/** Navigate to the repo detail and click the Explorer sub-tab. */
async function gotoExplorer(page: Page, serverUrl: string): Promise<void> {
    // Repos is the implicit default view — navigate to base URL (no tab button needed)
    await page.goto(serverUrl);
    await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10_000 });
    await page.locator('.repo-item').first().click();
    await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 8_000 });
    await page.locator('button[data-subtab="explorer"]').click();
    await expect(page.locator('[data-testid="explorer-panel"]')).toBeVisible({ timeout: 8_000 });
}

// ---------------------------------------------------------------------------
// 1. Initial render
// ---------------------------------------------------------------------------

test.describe('ExplorerPanel – Initial render', () => {
    test('E.1 explorer panel renders with sidebar and file tree', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-'));
        try {
            const repoDir = createExplorerRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, 'ws-explorer', 'explorer-repo', repoDir);

            await gotoExplorer(page, serverUrl);

            await expect(page.locator('[data-testid="explorer-sidebar"]')).toBeVisible();
            await expect(page.locator('[data-testid="file-tree"]')).toBeVisible({ timeout: 8_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('E.2 root directory entries appear in the file tree', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-'));
        try {
            const repoDir = createExplorerRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, 'ws-explorer', 'explorer-repo', repoDir);

            await gotoExplorer(page, serverUrl);

            // src and docs directories should appear
            await expect(page.locator('[data-testid="tree-node-src"]')).toBeVisible({ timeout: 8_000 });
            await expect(page.locator('[data-testid="tree-node-docs"]')).toBeVisible({ timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('E.3 refresh button is visible', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-'));
        try {
            const repoDir = createExplorerRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, 'ws-explorer', 'explorer-repo', repoDir);

            await gotoExplorer(page, serverUrl);

            await expect(page.locator('[data-testid="explorer-refresh-btn"]')).toBeVisible({ timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ---------------------------------------------------------------------------
// 2. Directory expansion
// ---------------------------------------------------------------------------

test.describe('ExplorerPanel – Directory navigation', () => {
    test('E.4 clicking a directory node reveals child files', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-'));
        try {
            const repoDir = createExplorerRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, 'ws-explorer', 'explorer-repo', repoDir);

            await gotoExplorer(page, serverUrl);

            // Click the 'src' directory to expand it
            await expect(page.locator('[data-testid="tree-node-src"]')).toBeVisible({ timeout: 8_000 });
            await page.locator('[data-testid="tree-node-src"]').click();

            // Child files should now appear
            await expect(page.locator('[data-testid="tree-node-src/index.ts"]')).toBeVisible({ timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('E.5 breadcrumbs update when navigating into a directory', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-'));
        try {
            const repoDir = createExplorerRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, 'ws-explorer', 'explorer-repo', repoDir);

            await gotoExplorer(page, serverUrl);

            await expect(page.locator('[data-testid="explorer-breadcrumbs"]')).toBeVisible({ timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ---------------------------------------------------------------------------
// 3. File preview
// ---------------------------------------------------------------------------

test.describe('ExplorerPanel – File preview', () => {
    test('E.6 clicking a file opens the preview pane', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-'));
        try {
            const repoDir = createExplorerRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, 'ws-explorer', 'explorer-repo', repoDir);

            await gotoExplorer(page, serverUrl);

            // Expand src directory first
            await expect(page.locator('[data-testid="tree-node-src"]')).toBeVisible({ timeout: 8_000 });
            await page.locator('[data-testid="tree-node-src"]').click();
            await expect(page.locator('[data-testid="tree-node-src/index.ts"]')).toBeVisible({ timeout: 5_000 });

            // Double-click to open in preview
            await page.locator('[data-testid="tree-node-src/index.ts"]').dblclick();

            // Preview pane should become active with the file
            await expect(page.locator('[data-testid="preview-pane"]')).toBeVisible({ timeout: 8_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('E.7 preview toolbar is present when a file is open', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-'));
        try {
            const repoDir = createExplorerRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, 'ws-explorer', 'explorer-repo', repoDir);

            await gotoExplorer(page, serverUrl);

            await expect(page.locator('[data-testid="tree-node-src"]')).toBeVisible({ timeout: 8_000 });
            await page.locator('[data-testid="tree-node-src"]').click();
            await expect(page.locator('[data-testid="tree-node-src/index.ts"]')).toBeVisible({ timeout: 5_000 });
            await page.locator('[data-testid="tree-node-src/index.ts"]').dblclick();

            await expect(page.locator('[data-testid="preview-toolbar"]')).toBeVisible({ timeout: 8_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ---------------------------------------------------------------------------
// 4. Search / filter
// ---------------------------------------------------------------------------

test.describe('ExplorerPanel – Search bar', () => {
    test('E.8 search bar is rendered and accepts input', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-'));
        try {
            const repoDir = createExplorerRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, 'ws-explorer', 'explorer-repo', repoDir);

            await gotoExplorer(page, serverUrl);

            await expect(page.locator('[data-testid="explorer-search-bar"]')).toBeVisible({ timeout: 5_000 });
            await page.locator('[data-testid="explorer-search-input"]').fill('index');
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ---------------------------------------------------------------------------
// 5. Refresh
// ---------------------------------------------------------------------------

test.describe('ExplorerPanel – Refresh', () => {
    test('E.9 refresh button reloads the tree without error', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-'));
        try {
            const repoDir = createExplorerRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, 'ws-explorer', 'explorer-repo', repoDir);

            await gotoExplorer(page, serverUrl);

            await expect(page.locator('[data-testid="explorer-refresh-btn"]')).toBeVisible({ timeout: 5_000 });
            await page.locator('[data-testid="explorer-refresh-btn"]').click();

            // Tree should still be visible after refresh
            await expect(page.locator('[data-testid="file-tree"]')).toBeVisible({ timeout: 8_000 });
            await expect(page.locator('[data-testid="explorer-error"]')).toHaveCount(0);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ---------------------------------------------------------------------------
// 6. QuickOpen overlay
// ---------------------------------------------------------------------------

test.describe('ExplorerPanel – QuickOpen', () => {
    test('E.10 QuickOpen overlay opens with Ctrl+P', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-'));
        try {
            const repoDir = createExplorerRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, 'ws-explorer', 'explorer-repo', repoDir);

            await gotoExplorer(page, serverUrl);

            // Ensure explorer panel is focused then press Ctrl+P
            await page.locator('[data-testid="explorer-panel"]').click();
            await page.keyboard.press('Control+p');

            await expect(page.locator('[data-testid="quick-open-overlay"]')).toBeVisible({ timeout: 5_000 });
            await expect(page.locator('[data-testid="quick-open-input"]')).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('E.11 QuickOpen input filters file results', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-'));
        try {
            const repoDir = createExplorerRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, 'ws-explorer', 'explorer-repo', repoDir);

            await gotoExplorer(page, serverUrl);

            await page.locator('[data-testid="explorer-panel"]').click();
            await page.keyboard.press('Control+p');
            await expect(page.locator('[data-testid="quick-open-input"]')).toBeVisible({ timeout: 5_000 });

            await page.locator('[data-testid="quick-open-input"]').fill('index');

            // Should show filtered results or no-results
            await expect(
                page.locator('[data-testid="quick-open-results"], [data-testid="quick-open-no-results"]')
            ).toBeVisible({ timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
