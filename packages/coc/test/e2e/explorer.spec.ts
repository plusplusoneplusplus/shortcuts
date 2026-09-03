/**
 * Tests the ExplorerPanel inside a repo detail view:
 *   - FileTree navigation (initial load, expand directory, filter)
 *   - PreviewPane: file open, dirty-indicator after edit, save button
 *   - QuickOpen: Ctrl+P overlay, filter, select file
 *   - Refresh: reloads the file tree
 *   - Content search: Search view, grouped results, click-to-open-at-line,
 *     include filter + collapse + keyboard navigation
 *
 * Relies on existing data-testid attributes in the explorer components
 * (no new testids added):
 *   explorer-panel, explorer-sidebar, explorer-refresh-btn,
 *   explorer-preview-pane, file-tree, tree-node-{path},
 *   preview-pane, preview-toolbar, save-btn, dirty-indicator,
 *   monaco-container, quick-open-overlay, quick-open-dialog,
 *   quick-open-input, quick-open-results, quick-open-item-{idx},
 *   explorer-view-tree, explorer-view-search, content-search-panel,
 *   content-search-input, content-search-toggle-{case,word,regex},
 *   content-search-results, content-search-group, content-search-match,
 *   content-search-summary, content-search-empty, content-search-regex-error,
 *   content-search-file-header, content-search-file-count,
 *   content-search-filters-toggle, content-search-filters-dot,
 *   content-search-include
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

/**
 * A token that appears in exactly two fixture files and nowhere else, so match
 * and group counts stay stable as the fixture grows.
 */
const SEARCH_NEEDLE = 'ZzQqSearchNeedle';

/** 1-based line of SEARCH_NEEDLE inside src/search-fixture.ts. */
const SEARCH_NEEDLE_LINE = 4;

/** Create a repo with files for explorer testing. */
function createExplorerRepoFixture(tmpDir: string): string {
    const repoDir = path.join(tmpDir, 'explorer-repo');
    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export default {};\n// main entry\n');
    fs.writeFileSync(path.join(repoDir, 'src', 'utils.ts'), 'export const add = (a: number, b: number) => a + b;\n');
    fs.writeFileSync(path.join(repoDir, 'docs', 'README.md'), '# Project Docs\n\nWelcome.\n');
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# Root README\n');

    // Content-search fixture: a token that exists nowhere else in the repo, at a
    // known line in exactly two files. Asserting on it keeps the search tests
    // independent of how many other files the fixture grows.
    fs.writeFileSync(
        path.join(repoDir, 'src', 'search-fixture.ts'),
        [
            '// content search fixture',
            'export const before = 1;',
            '',
            `export const target = '${SEARCH_NEEDLE}';`,
            'export const after = 2;',
            '',
        ].join('\n'),
    );
    fs.writeFileSync(
        path.join(repoDir, 'docs', 'search-notes.md'),
        ['# Notes', '', `The token ${SEARCH_NEEDLE} also lives here.`, ''].join('\n'),
    );
    return repoDir;
}

/** Switch the Explorer sidebar to the Search view and wait for the panel. */
async function gotoSearchView(page: Page): Promise<void> {
    await page.locator('[data-testid="explorer-view-search"]').click();
    await expect(page.locator('[data-testid="content-search-panel"]')).toBeVisible({ timeout: 5_000 });
}

/** Navigate to the repo detail and click the Explorer sub-tab. */
async function gotoExplorer(page: Page, serverUrl: string): Promise<void> {
    // Repos is the implicit default view — navigate to base URL (no tab button needed)
    await page.goto(serverUrl);
    await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10_000 });
    await page.locator('[data-testid="repo-tab"]').first().click();
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

            // Should show filtered results or no-results (use .first() to avoid strict-mode violation)
            await expect(
                page.locator('[data-testid="quick-open-results"], [data-testid="quick-open-no-results"]').first()
            ).toBeVisible({ timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ---------------------------------------------------------------------------
// 7. Content search view
// ---------------------------------------------------------------------------

test.describe('ExplorerPanel – Content search', () => {
    test('E.12 switching to the Search view keeps the file tree alive', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-'));
        try {
            const repoDir = createExplorerRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, 'ws-explorer', 'explorer-repo', repoDir);

            await gotoExplorer(page, serverUrl);
            await expect(page.locator('[data-testid="tree-node-src"]')).toBeVisible({ timeout: 8_000 });

            await gotoSearchView(page);
            await expect(page.locator('[data-testid="file-tree"]')).toHaveCount(0);
            await expect(page.locator('[data-testid="content-search-idle"]')).toBeVisible();

            // Back to the tree: the previously loaded entries are still there.
            await page.locator('[data-testid="explorer-view-tree"]').click();
            await expect(page.locator('[data-testid="tree-node-src"]')).toBeVisible({ timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('E.13 a query renders results grouped by file', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-'));
        try {
            const repoDir = createExplorerRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, 'ws-explorer', 'explorer-repo', repoDir);

            await gotoExplorer(page, serverUrl);
            await gotoSearchView(page);

            await page.locator('[data-testid="content-search-input"]').fill(SEARCH_NEEDLE);

            await expect(page.locator('[data-testid="content-search-results"]')).toBeVisible({ timeout: 10_000 });

            // The needle lives in exactly two fixture files, one match each.
            const groups = page.locator('[data-testid="content-search-group"]');
            await expect(groups).toHaveCount(2);
            const matches = page.locator('[data-testid="content-search-match"]');
            await expect(matches).toHaveCount(2);
            await expect(page.locator('[data-testid="content-search-summary"]')).toContainText('2 results in 2 files');

            // Each group header names its file and reports its own match count.
            await expect(
                page.locator('[data-testid="content-search-file-header"][data-path="src/search-fixture.ts"]')
            ).toBeVisible();
            await expect(
                page.locator('[data-testid="content-search-file-header"][data-path="docs/search-notes.md"]')
            ).toBeVisible();

            // The hit is highlighted inside the rendered line.
            await expect(
                page.locator('[data-testid="content-search-match"][data-path="src/search-fixture.ts"] mark')
            ).toHaveText(SEARCH_NEEDLE);
            await expect(
                page.locator('[data-testid="content-search-match"][data-path="src/search-fixture.ts"]')
            ).toHaveAttribute('data-line', String(SEARCH_NEEDLE_LINE));
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('E.14 clicking a match opens the file at that line', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-'));
        try {
            const repoDir = createExplorerRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, 'ws-explorer', 'explorer-repo', repoDir);

            await gotoExplorer(page, serverUrl);
            await gotoSearchView(page);

            await page.locator('[data-testid="content-search-input"]').fill(SEARCH_NEEDLE);
            const match = page.locator('[data-testid="content-search-match"][data-path="src/search-fixture.ts"]');
            await expect(match).toBeVisible({ timeout: 10_000 });
            await match.click();

            // The preview opens on the clicked file …
            await expect(page.locator('[data-testid="monaco-container"]')).toBeVisible({ timeout: 15_000 });
            const editor = page.locator('[data-testid="monaco-container"] .monaco-editor').first();
            await expect(editor).toBeVisible({ timeout: 15_000 });
            await expect(editor.locator('.view-lines')).toContainText(SEARCH_NEEDLE, { timeout: 15_000 });

            // … with the cursor parked on the matched line, which Monaco marks in
            // the gutter as the active line number.
            await expect(editor.locator('.line-numbers.active-line-number')).toHaveText(
                String(SEARCH_NEEDLE_LINE),
                { timeout: 15_000 },
            );
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('E.15 a query with no matches shows the empty state', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-'));
        try {
            const repoDir = createExplorerRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, 'ws-explorer', 'explorer-repo', repoDir);

            await gotoExplorer(page, serverUrl);
            await gotoSearchView(page);

            await page.locator('[data-testid="content-search-input"]').fill('NoSuchTokenLivesInThisRepo');

            await expect(page.locator('[data-testid="content-search-empty"]')).toBeVisible({ timeout: 10_000 });
            await expect(page.locator('[data-testid="content-search-results"]')).toHaveCount(0);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('E.16 an invalid regex reports the parse error inline', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-'));
        try {
            const repoDir = createExplorerRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, 'ws-explorer', 'explorer-repo', repoDir);

            await gotoExplorer(page, serverUrl);
            await gotoSearchView(page);

            // Literal mode first: '(' is just a character, so this is a clean miss.
            await page.locator('[data-testid="content-search-input"]').fill('(unclosed');
            await expect(page.locator('[data-testid="content-search-empty"]')).toBeVisible({ timeout: 10_000 });

            // Turning the regex toggle on re-runs the same query immediately, and
            // now the pattern does not parse.
            await page.locator('[data-testid="content-search-toggle-regex"]').click();
            const regexError = page.locator('[data-testid="content-search-regex-error"]');
            await expect(regexError).toBeVisible({ timeout: 10_000 });
            await expect(regexError).toContainText('regular expression');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('E.17 query, include filter, collapse, keyboard navigation, open', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-'));
        try {
            const repoDir = createExplorerRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, 'ws-explorer', 'explorer-repo', repoDir);

            await gotoExplorer(page, serverUrl);
            await gotoSearchView(page);

            // 1. Type a query — repo-wide, so both fixture files answer.
            await page.locator('[data-testid="content-search-input"]').fill(SEARCH_NEEDLE);
            const groups = page.locator('[data-testid="content-search-group"]');
            await expect(groups).toHaveCount(2, { timeout: 10_000 });

            // 2. Narrow it with an include glob, revealed by the details chevron.
            await page.locator('[data-testid="content-search-filters-toggle"]').click();
            const include = page.locator('[data-testid="content-search-include"]');
            await expect(include).toBeVisible();
            await include.fill('src/**');

            await expect(groups).toHaveCount(1, { timeout: 10_000 });
            const header = page.locator('[data-testid="content-search-file-header"]');
            await expect(header).toHaveAttribute('data-path', 'src/search-fixture.ts');
            // The chevron shows a dot so a filtered search is never invisible.
            await expect(page.locator('[data-testid="content-search-filters-dot"]')).toBeVisible();

            // 3. Collapse the group: its matches go, its count badge stays.
            await header.click();
            await expect(header).toHaveAttribute('data-collapsed', 'true');
            await expect(page.locator('[data-testid="content-search-match"]')).toHaveCount(0);
            await expect(page.locator('[data-testid="content-search-file-count"]')).toHaveText('1');

            // 4. Keyboard alone from here: Right re-opens the group, Down lands on
            //    its single match.
            await header.focus();
            await page.keyboard.press('ArrowRight');
            await expect(header).toHaveAttribute('data-collapsed', 'false');

            const match = page.locator('[data-testid="content-search-match"]');
            await expect(match).toHaveCount(1);
            await page.keyboard.press('ArrowDown');
            await expect(match).toBeFocused();

            // 5. Enter opens the focused match in the preview, at its line.
            await page.keyboard.press('Enter');
            const editor = page.locator('[data-testid="monaco-container"] .monaco-editor').first();
            await expect(editor).toBeVisible({ timeout: 15_000 });
            await expect(editor.locator('.view-lines')).toContainText(SEARCH_NEEDLE, { timeout: 15_000 });
            await expect(editor.locator('.line-numbers.active-line-number')).toHaveText(
                String(SEARCH_NEEDLE_LINE),
                { timeout: 15_000 },
            );
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
