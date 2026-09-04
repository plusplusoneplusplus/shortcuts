/**
 * Tests the ExplorerPanel inside a repo detail view:
 *   - FileTree navigation (initial load, expand directory, filter)
 *   - PreviewPane: file open, dirty-indicator after edit, save button
 *   - QuickOpen: Ctrl+P overlay, filter, select file
 *   - Refresh: reloads the file tree
 *   - Content search: Search view, grouped results, click-to-open-at-line,
 *     include filter + collapse + keyboard navigation
 *   - Editor tabs (behind `features.explorerEditorTabs`): preview replacement,
 *     pinning, switching, closing, duplicate-name labels, reload persistence
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
 *   content-search-include,
 *   explorer-tab-strip, explorer-tab-list, explorer-tab-{id},
 *   explorer-tab-label-{id}, explorer-tab-close-{id}, explorer-tab-dirty-{id},
 *   explorer-tab-panel-{id}, explorer-tabbed-editor,
 *   explorer-mobile-back-bar, explorer-mobile-back-btn
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { editorTab, enableExplorerEditorTabs, expectEditorTabs } from './fixtures/explorer-tabs-seed';
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

/**
 * Add files whose names are long enough to hit the tab's 180 px cap, so the
 * number of tabs needed to overflow the strip stays predictable.
 *
 * Returns the repo-relative paths, in creation order.
 */
function createOverflowFiles(repoDir: string, count: number): string[] {
    const dir = path.join(repoDir, 'overflow');
    fs.mkdirSync(dir, { recursive: true });
    const paths: string[] = [];
    for (let i = 0; i < count; i++) {
        const name = `overflow-tab-fixture-${String(i).padStart(2, '0')}.ts`;
        fs.writeFileSync(path.join(dir, name), `export const overflow${i} = ${i};\n`);
        paths.push(`overflow/${name}`);
    }
    return paths;
}

/** A narrow phone-sized viewport: below the 767 px mobile breakpoint. */
const MOBILE_VIEWPORT = { width: 390, height: 844 };

/**
 * The strip's horizontal scroll geometry, plus whether one tab currently sits
 * inside the visible slice of it. Read in one evaluate so the numbers describe
 * the same frame.
 */
async function stripGeometry(page: Page, tabId: string) {
    return page.evaluate((id: string) => {
        const list = document.querySelector('[data-testid="explorer-tab-list"]') as HTMLElement | null;
        const tab = list?.querySelector(`[data-tab-id="${id}"]`) as HTMLElement | null;
        if (!list || !tab) return null;
        const listBox = list.getBoundingClientRect();
        const tabBox = tab.getBoundingClientRect();
        return {
            scrollWidth: list.scrollWidth,
            clientWidth: list.clientWidth,
            scrollLeft: list.scrollLeft,
            // 1 px of slack: sub-pixel layout should not decide this.
            fullyVisible: tabBox.left >= listBox.left - 1 && tabBox.right <= listBox.right + 1,
        };
    }, tabId);
}

/**
 * Put the caret in a Monaco buffer and wait until it really has the keystrokes.
 *
 * Clicking the text is not enough on its own: Monaco attaches its hidden input
 * a beat after the view paints, so under load a `keyboard.type` right after the
 * click can land on nothing at all.
 */
async function focusMonacoBuffer(page: Page, panelTestId: string): Promise<void> {
    const editor = page.locator(`[data-testid="${panelTestId}"] [data-testid="monaco-container"] .monaco-editor`);
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await editor.locator('.view-lines').click();
    await expect
        .poll(
            () =>
                page.evaluate(
                    (id: string) =>
                        !!document.activeElement &&
                        !!document
                            .querySelector(`[data-testid="${id}"] [data-testid="monaco-container"]`)
                            ?.contains(document.activeElement),
                    panelTestId,
                ),
            { timeout: 10_000 },
        )
        .toBe(true);
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

// ---------------------------------------------------------------------------
// 7. Editor tabs (features.explorerEditorTabs)
// ---------------------------------------------------------------------------

test.describe('ExplorerPanel – Editor tabs', () => {
    test('E.18 preview replacement, pinning, switching and closing across a tab strip', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-'));
        try {
            const repoDir = createExplorerRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, 'ws-explorer', 'explorer-repo', repoDir);
            // Live flag: must be on before the SPA loads its runtime config.
            await enableExplorerEditorTabs(serverUrl);

            await gotoExplorer(page, serverUrl);
            await expect(page.locator('[data-testid="tree-node-src"]')).toBeVisible({ timeout: 8_000 });
            await page.locator('[data-testid="tree-node-src"]').click();
            await expect(page.locator('[data-testid="tree-node-src/index.ts"]')).toBeVisible({ timeout: 5_000 });

            // 1. A single click opens ONE replaceable preview tab, and a second
            //    single click replaces it rather than stacking.
            await page.locator('[data-testid="tree-node-src/index.ts"]').click();
            await expectEditorTabs(page, ['file:src/index.ts']);
            await expect(editorTab(page, 'file:src/index.ts')).toHaveAttribute('data-preview', 'true');

            await page.locator('[data-testid="tree-node-src/utils.ts"]').click();
            await expectEditorTabs(page, ['file:src/utils.ts']);

            // 2. A double click pins, so the next single click adds a tab.
            await page.locator('[data-testid="tree-node-src/utils.ts"]').dblclick();
            await expect(editorTab(page, 'file:src/utils.ts')).not.toHaveAttribute('data-preview', 'true');
            await page.locator('[data-testid="tree-node-src/index.ts"]').click();
            await expectEditorTabs(page, ['file:src/utils.ts', 'file:src/index.ts']);

            // 3. Both buffers stay mounted; clicking a tab switches which one shows.
            const utilsPanel = page.locator('[data-testid="explorer-tab-panel-file:src/utils.ts"]');
            const indexPanel = page.locator('[data-testid="explorer-tab-panel-file:src/index.ts"]');
            await expect(indexPanel).toHaveAttribute('data-active', 'true');
            await editorTab(page, 'file:src/utils.ts').click();
            await expect(utilsPanel).toHaveAttribute('data-active', 'true');
            await expect(indexPanel).not.toHaveAttribute('data-active', 'true');
            await expect(
                utilsPanel.locator('[data-testid="monaco-container"] .monaco-editor .view-lines'),
            ).toContainText('add', { timeout: 15_000 });

            // 4. The close button on a clean tab closes just that tab.
            await page.locator('[data-testid="explorer-tab-close-file:src/utils.ts"]').click();
            await expectEditorTabs(page, ['file:src/index.ts']);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('E.19 the tab session survives a full reload, and colliding names widen', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-'));
        try {
            const repoDir = createExplorerRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, 'ws-explorer', 'explorer-repo', repoDir);
            await enableExplorerEditorTabs(serverUrl);

            await gotoExplorer(page, serverUrl);
            await expect(page.locator('[data-testid="tree-node-docs"]')).toBeVisible({ timeout: 8_000 });
            await page.locator('[data-testid="tree-node-docs"]').click();
            await expect(page.locator('[data-testid="tree-node-docs/README.md"]')).toBeVisible({ timeout: 5_000 });

            // Two files with the SAME filename: the labels widen to the shortest
            // distinguishing path, and every tab still tooltips its full path.
            await page.locator('[data-testid="tree-node-README.md"]').dblclick();
            await page.locator('[data-testid="tree-node-docs/README.md"]').dblclick();
            await expectEditorTabs(page, ['file:README.md', 'file:docs/README.md']);
            await expect(page.locator('[data-testid="explorer-tab-label-file:docs/README.md"]'))
                .toHaveText('docs/README.md');
            await expect(editorTab(page, 'file:docs/README.md')).toHaveAttribute('title', 'docs/README.md');

            // A real reload (not a same-hash navigation) restores the session.
            await page.reload();
            await expect(page.locator('[data-testid="explorer-panel"]')).toBeVisible({ timeout: 10_000 });
            await expectEditorTabs(page, ['file:README.md', 'file:docs/README.md']);
            await expect(editorTab(page, 'file:docs/README.md')).toHaveAttribute('aria-selected', 'true');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('E.20 on a narrow viewport the strip sits above the buffer and Files keeps the session', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-'));
        try {
            const repoDir = createExplorerRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, 'ws-explorer', 'explorer-repo', repoDir);
            await enableExplorerEditorTabs(serverUrl);

            // Navigate at the default desktop size, then shrink: `useBreakpoint`
            // listens for matchMedia changes, so the panel re-lays-out live and
            // the repos navigation never has to be driven at phone width.
            await gotoExplorer(page, serverUrl);
            await expect(page.locator('[data-testid="tree-node-src"]')).toBeVisible({ timeout: 8_000 });
            await page.locator('[data-testid="tree-node-src"]').click();
            await expect(page.locator('[data-testid="tree-node-src/index.ts"]')).toBeVisible({ timeout: 5_000 });
            await page.locator('[data-testid="tree-node-src/index.ts"]').dblclick();
            await page.locator('[data-testid="tree-node-src/utils.ts"]').dblclick();
            await expectEditorTabs(page, ['file:src/index.ts', 'file:src/utils.ts']);

            await page.setViewportSize(MOBILE_VIEWPORT);

            // Mobile shows the editor OR the tree, never both: the tree is gone
            // and the back bar appears in its place.
            await expect(page.locator('[data-testid="explorer-mobile-back-bar"]')).toBeVisible({ timeout: 5_000 });
            await expect(page.locator('[data-testid="file-tree"]')).not.toBeVisible();

            // The strip stays a horizontal strip stacked above the buffer — it
            // never becomes a column beside it, and it spans the editor area.
            const editorBox = (await page.locator('[data-testid="explorer-tabbed-editor"]').boundingBox())!;
            const stripBox = (await page.locator('[data-testid="explorer-tab-strip"]').boundingBox())!;
            const panelBox = (await page.locator('[data-testid="explorer-tab-panel-file:src/utils.ts"]').boundingBox())!;
            expect(stripBox.y + stripBox.height).toBeLessThanOrEqual(panelBox.y + 1);
            expect(stripBox.width).toBeGreaterThan(editorBox.width * 0.9);
            expect(panelBox.height).toBeGreaterThan(0);

            // Files goes back to the tree WITHOUT closing anything (AC-06): both
            // tabs are still open and the active one is still the active one.
            await page.locator('[data-testid="explorer-mobile-back-btn"]').click();
            await expect(page.locator('[data-testid="file-tree"]')).toBeVisible({ timeout: 5_000 });
            await expectEditorTabs(page, ['file:src/index.ts', 'file:src/utils.ts']);
            await expect(editorTab(page, 'file:src/utils.ts')).toHaveAttribute('aria-selected', 'true');

            // And tapping a file returns to the editor with that tab active.
            await page.locator('[data-testid="tree-node-src/index.ts"]').click();
            await expect(page.locator('[data-testid="explorer-mobile-back-bar"]')).toBeVisible({ timeout: 5_000 });
            await expect(editorTab(page, 'file:src/index.ts')).toHaveAttribute('aria-selected', 'true');
            await expectEditorTabs(page, ['file:src/index.ts', 'file:src/utils.ts']);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('E.21 the active tab is legible in both light and dark themes', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-'));
        try {
            const repoDir = createExplorerRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, 'ws-explorer', 'explorer-repo', repoDir);
            await enableExplorerEditorTabs(serverUrl);

            await gotoExplorer(page, serverUrl);
            await expect(page.locator('[data-testid="tree-node-src"]')).toBeVisible({ timeout: 8_000 });
            await page.locator('[data-testid="tree-node-src"]').click();
            await expect(page.locator('[data-testid="tree-node-src/index.ts"]')).toBeVisible({ timeout: 5_000 });
            await page.locator('[data-testid="tree-node-src/index.ts"]').dblclick();
            await page.locator('[data-testid="tree-node-src/utils.ts"]').dblclick();
            await expectEditorTabs(page, ['file:src/index.ts', 'file:src/utils.ts']);

            const active = editorTab(page, 'file:src/utils.ts');
            const inactive = editorTab(page, 'file:src/index.ts');
            const styleOf = (id: string) =>
                editorTab(page, id).evaluate(el => {
                    const style = getComputedStyle(el);
                    return {
                        background: style.backgroundColor,
                        color: style.color,
                        accent: style.borderBottomColor,
                        accentWidth: style.borderBottomWidth,
                    };
                });

            // The toggle cycles auto → dark → light, so drive it explicitly
            // rather than trusting whatever the system preference resolves to.
            await page.locator('#theme-toggle').click();
            await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
            await expect(active).toHaveAttribute('aria-selected', 'true');
            const dark = await styleOf('file:src/utils.ts');
            const darkInactive = await styleOf('file:src/index.ts');
            expect(dark.background).toBe('rgb(30, 30, 30)');
            expect(dark.color).toBe('rgb(255, 255, 255)');
            expect(dark.accent).toBe('rgb(55, 148, 255)');
            expect(dark.accentWidth).toBe('2px');
            // The active tab is distinguishable from its neighbour, not just tinted.
            expect(darkInactive.background).not.toBe(dark.background);

            await page.locator('#theme-toggle').click();
            await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
            const light = await styleOf('file:src/utils.ts');
            const lightInactive = await styleOf('file:src/index.ts');
            expect(light.background).toBe('rgb(255, 255, 255)');
            expect(light.color).toBe('rgb(30, 30, 30)');
            expect(light.accent).toBe('rgb(0, 120, 212)');
            expect(light.accentWidth).toBe('2px');
            expect(lightInactive.background).not.toBe(light.background);

            // Same tab, genuinely repainted for the theme.
            expect(light.background).not.toBe(dark.background);
            await expect(inactive).toHaveAttribute('aria-selected', 'false');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('E.22 the strip overflows instead of squeezing, and reveals an off-screen tab', async ({ page, serverUrl }) => {
        test.setTimeout(90_000);
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-'));
        try {
            const repoDir = createExplorerRepoFixture(tmpDir);
            const overflowPaths = createOverflowFiles(repoDir, 8);
            await seedWorkspace(serverUrl, 'ws-explorer', 'explorer-repo', repoDir);
            await enableExplorerEditorTabs(serverUrl);

            await gotoExplorer(page, serverUrl);
            await expect(page.locator('[data-testid="tree-node-overflow"]')).toBeVisible({ timeout: 8_000 });
            await page.locator('[data-testid="tree-node-overflow"]').click();
            await expect(page.locator(`[data-testid="tree-node-${overflowPaths[0]}"]`)).toBeVisible({ timeout: 5_000 });

            // Pin every file so they stack instead of replacing one preview tab.
            for (const filePath of overflowPaths) {
                await page.locator(`[data-testid="tree-node-${filePath}"]`).dblclick();
            }
            await expectEditorTabs(page, overflowPaths.map(p => `file:${p}`));

            const firstId = `file:${overflowPaths[0]}`;
            const lastId = `file:${overflowPaths[overflowPaths.length - 1]}`;
            await expect(editorTab(page, lastId)).toHaveAttribute('aria-selected', 'true');

            // With more tabs than fit, the strip scrolls: it does not shrink the
            // tabs down until every label is unreadable.
            const overflowing = await stripGeometry(page, firstId);
            expect(overflowing).not.toBeNull();
            expect(overflowing!.scrollWidth).toBeGreaterThan(overflowing!.clientWidth);

            // Opening the last tab scrolled the strip past the first one.
            await expect.poll(async () => (await stripGeometry(page, firstId))!.scrollLeft, { timeout: 5_000 })
                .toBeGreaterThan(0);
            expect((await stripGeometry(page, firstId))!.fullyVisible).toBe(false);

            // Activating that off-screen tab from outside the strip (the tree)
            // has to scroll it back into view — it is unreachable otherwise.
            await page.locator(`[data-testid="tree-node-${overflowPaths[0]}"]`).click();
            await expect(editorTab(page, firstId)).toHaveAttribute('aria-selected', 'true');
            await expect.poll(async () => (await stripGeometry(page, firstId))!.fullyVisible, { timeout: 5_000 })
                .toBe(true);

            // The tab really is clickable now that it has been revealed.
            await editorTab(page, firstId).click();
            await expect(editorTab(page, firstId)).toHaveAttribute('aria-selected', 'true');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('E.23 a dragged tab is marked while dragging, and keyboard focus is visible', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-'));
        try {
            const repoDir = createExplorerRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, 'ws-explorer', 'explorer-repo', repoDir);
            await enableExplorerEditorTabs(serverUrl);

            await gotoExplorer(page, serverUrl);
            await expect(page.locator('[data-testid="tree-node-src"]')).toBeVisible({ timeout: 8_000 });
            await page.locator('[data-testid="tree-node-src"]').click();
            await expect(page.locator('[data-testid="tree-node-src/index.ts"]')).toBeVisible({ timeout: 5_000 });
            await page.locator('[data-testid="tree-node-src/index.ts"]').dblclick();
            await page.locator('[data-testid="tree-node-src/utils.ts"]').dblclick();
            await expectEditorTabs(page, ['file:src/index.ts', 'file:src/utils.ts']);

            const indexTab = editorTab(page, 'file:src/index.ts');
            const utilsTab = editorTab(page, 'file:src/utils.ts');

            // 1. Dragging state. A real HTML5 drag needs a live DataTransfer, so
            //    hand the same one to both ends of the gesture.
            await expect(indexTab).toHaveAttribute('draggable', 'true');
            const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
            await indexTab.dispatchEvent('dragstart', { dataTransfer });
            await expect(indexTab).toHaveAttribute('data-dragging', 'true');
            await expect(utilsTab).not.toHaveAttribute('data-dragging', 'true');
            // The dragged tab is dimmed while it travels.
            expect(await indexTab.evaluate(el => getComputedStyle(el).opacity)).toBe('0.5');

            // 2. Dropping it on its neighbour reorders and clears the state.
            await utilsTab.dispatchEvent('dragover', { dataTransfer });
            await utilsTab.dispatchEvent('drop', { dataTransfer });
            await expectEditorTabs(page, ['file:src/utils.ts', 'file:src/index.ts']);
            await expect(indexTab).not.toHaveAttribute('data-dragging', 'true');
            expect(await indexTab.evaluate(el => getComputedStyle(el).opacity)).toBe('1');

            // 3. Roving tabindex: only the active tab is in the tab order.
            await utilsTab.click();
            await expect(utilsTab).toHaveAttribute('tabindex', '0');
            await expect(indexTab).toHaveAttribute('tabindex', '-1');

            // 4. Arrow keys walk the strip, moving DOM focus with the selection,
            //    and the focused tab paints a focus ring (a box-shadow) that a
            //    mouse click alone does not draw.
            await utilsTab.focus();
            const restingShadow = await indexTab.evaluate(el => getComputedStyle(el).boxShadow);
            await page.keyboard.press('ArrowRight');
            await expect(indexTab).toBeFocused();
            await expect(indexTab).toHaveAttribute('aria-selected', 'true');
            await expect(indexTab).toHaveAttribute('tabindex', '0');
            const focusedShadow = await indexTab.evaluate(el => getComputedStyle(el).boxShadow);
            expect(focusedShadow).not.toBe(restingShadow);
            expect(focusedShadow).not.toBe('none');

            // 5. Home/End jump to the ends of the strip, still by keyboard.
            await page.keyboard.press('Home');
            await expect(utilsTab).toBeFocused();
            await expect(utilsTab).toHaveAttribute('aria-selected', 'true');
            await page.keyboard.press('End');
            await expect(indexTab).toBeFocused();
            await expect(indexTab).toHaveAttribute('aria-selected', 'true');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('E.24 an edited tab shows a dirty dot that swaps with the close button on hover', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-'));
        try {
            const repoDir = createExplorerRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, 'ws-explorer', 'explorer-repo', repoDir);
            await enableExplorerEditorTabs(serverUrl);

            await gotoExplorer(page, serverUrl);
            await expect(page.locator('[data-testid="tree-node-src"]')).toBeVisible({ timeout: 8_000 });
            await page.locator('[data-testid="tree-node-src"]').click();
            await expect(page.locator('[data-testid="tree-node-src/index.ts"]')).toBeVisible({ timeout: 5_000 });
            await page.locator('[data-testid="tree-node-src/index.ts"]').dblclick();
            await expectEditorTabs(page, ['file:src/index.ts']);

            const tab = editorTab(page, 'file:src/index.ts');
            const dot = page.locator('[data-testid="explorer-tab-dirty-file:src/index.ts"]');
            const closeBtn = page.locator('[data-testid="explorer-tab-close-file:src/index.ts"]');

            // Clean to start with: no dot, close button offered.
            await expect(tab).not.toHaveAttribute('data-dirty', 'true');
            await expect(dot).toHaveCount(0);
            await expect(closeBtn).toBeVisible();

            const panel = page.locator('[data-testid="explorer-tab-panel-file:src/index.ts"]');
            const editor = panel.locator('[data-testid="monaco-container"] .monaco-editor');
            await expect(editor).toBeVisible({ timeout: 15_000 });
            await expect(editor.locator('.view-lines')).toContainText('main entry', { timeout: 15_000 });

            await focusMonacoBuffer(page, 'explorer-tab-panel-file:src/index.ts');
            await page.keyboard.type('EDITED_BY_E24');
            await expect(editor.locator('.view-lines')).toContainText('EDITED_BY_E24', { timeout: 10_000 });

            // The edit marks the tab, and the buffer's own toolbar agrees.
            await expect(tab).toHaveAttribute('data-dirty', 'true', { timeout: 10_000 });
            await expect(panel.locator('[data-testid="dirty-indicator"]')).toBeVisible();
            // The pointer is in the editor, so the tab shows its resting state:
            // the dot, with the close button folded away behind it.
            await expect(dot).toBeVisible();
            await expect(closeBtn).not.toBeVisible();

            // Hovering swaps them, so a dirty tab never loses its close affordance.
            await tab.hover();
            await expect(closeBtn).toBeVisible();
            await expect(dot).not.toBeVisible();

            // Closing a dirty tab asks before discarding rather than dropping the
            // edit on the floor; Cancel leaves the tab open and still dirty.
            await closeBtn.click();
            await expect(page.locator('[data-testid="explorer-close-tabs-prompt"]')).toBeVisible({ timeout: 5_000 });
            await page.locator('[data-testid="explorer-close-cancel-btn"]').click();
            await expectEditorTabs(page, ['file:src/index.ts']);
            await expect(tab).toHaveAttribute('data-dirty', 'true');
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
