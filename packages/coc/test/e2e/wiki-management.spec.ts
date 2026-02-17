/**
 * Wiki Management E2E Tests
 *
 * Tests the Wiki tab: add wiki, list wikis, select wiki, delete wiki.
 * Wikis are fetched via REST when the tab is switched, so data seeded
 * before page.goto() is available once the tab is clicked.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect } from './fixtures/server-fixture';
import { seedWiki, request } from './fixtures/seed';
import { createWikiFixture } from './fixtures/wiki-fixtures';

// ================================================================
// Wiki Tab Empty State & List
// ================================================================

test.describe('Wiki tab empty state & list', () => {
    test('shows empty state when no wikis exist', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('[data-tab="wiki"]');

        await expect(page.locator('#wiki-empty')).toBeVisible();
        await expect(page.locator('#wiki-empty')).toContainText('Select a wiki');
    });

    test('displays seeded wikis in the selector dropdown', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-list-'));
        try {
            // Seed wikis without component-graph.json so they stay store-only
            // (store wikis return `name` properly in the GET response)
            const wikiDir1 = path.join(tmpDir, 'wiki-1');
            const wikiDir2 = path.join(tmpDir, 'wiki-2');
            fs.mkdirSync(wikiDir1, { recursive: true });
            fs.mkdirSync(wikiDir2, { recursive: true });

            await seedWiki(serverUrl, 'wiki-1', wikiDir1, undefined, 'Frontend Wiki');
            await seedWiki(serverUrl, 'wiki-2', wikiDir2, undefined, 'Backend Wiki');

            await page.goto(serverUrl);
            await page.click('[data-tab="wiki"]');

            // 1 placeholder + 2 wikis
            await expect(page.locator('#wiki-select option')).toHaveCount(3, { timeout: 10000 });
            await expect(page.locator('#wiki-select')).toContainText('Frontend Wiki');
            await expect(page.locator('#wiki-select')).toContainText('Backend Wiki');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('wiki dropdown shows placeholder by default', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('[data-tab="wiki"]');

        await expect(page.locator('#wiki-select')).toHaveValue('');
        await expect(page.locator('#wiki-select option').first()).toContainText('Select wiki...');
    });
});

// ================================================================
// Add Wiki Dialog
// ================================================================

test.describe('Add Wiki dialog', () => {
    test('add wiki button opens overlay dialog', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('[data-tab="wiki"]');

        await page.click('#add-wiki-btn');
        await expect(page.locator('#add-wiki-overlay')).toBeVisible();
        await expect(page.locator('#wiki-path')).toBeVisible();
    });

    test('cancel button closes add wiki dialog', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('[data-tab="wiki"]');

        await page.click('#add-wiki-btn');
        await expect(page.locator('#add-wiki-overlay')).toBeVisible();

        await page.click('#add-wiki-cancel-btn');
        await expect(page.locator('#add-wiki-overlay')).toBeHidden();
    });

    test('overlay click closes add wiki dialog', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('[data-tab="wiki"]');

        await page.click('#add-wiki-btn');
        await expect(page.locator('#add-wiki-overlay')).toBeVisible();

        // Click the overlay background (not the inner dialog)
        await page.locator('#add-wiki-overlay').click({ position: { x: 5, y: 5 } });
        await expect(page.locator('#add-wiki-overlay')).toBeHidden();
    });
});

// ================================================================
// Add Wiki Form Validation
// ================================================================

test.describe('Add Wiki form validation', () => {
    test('empty path does not submit and overlay stays open', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('[data-tab="wiki"]');
        await page.click('#add-wiki-btn');
        await expect(page.locator('#add-wiki-overlay')).toBeVisible();

        // Ensure path is empty
        await page.fill('#wiki-path', '');
        await page.click('#add-wiki-submit');

        // Form returns early — overlay stays open, no wiki added
        await expect(page.locator('#add-wiki-overlay')).toBeVisible();
        await expect(page.locator('#wiki-select option')).toHaveCount(1); // Only placeholder
    });

    test('validation error on non-existent path', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('[data-tab="wiki"]');
        await page.click('#add-wiki-btn');
        await expect(page.locator('#add-wiki-overlay')).toBeVisible();

        // The form sends repoPath to the server; server derives wikiDir and
        // creates it. Even with a non-existent repoPath, wiki is persisted
        // to the store and the dialog closes.  Verify that the wiki is added
        // (server creates derived wiki dir).
        await page.fill('#wiki-path', '/nonexistent/path/to/repo');
        await page.click('#add-wiki-submit');

        // Dialog closes because the server successfully persists
        await expect(page.locator('#add-wiki-overlay')).toBeHidden({ timeout: 5000 });
    });
});

// ================================================================
// Add Wiki Success Workflow
// ================================================================

test.describe('Add Wiki success workflow', () => {
    test('submit add-wiki form with manual path', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-add-'));
        try {
            await page.goto(serverUrl);
            await page.click('[data-tab="wiki"]');
            await page.click('#add-wiki-btn');

            await page.fill('#wiki-path', tmpDir);
            await page.fill('#wiki-name', 'My Test Wiki');
            await page.selectOption('#wiki-color', '#16825d');

            await page.click('#add-wiki-submit');

            // Dialog should close
            await expect(page.locator('#add-wiki-overlay')).toBeHidden({ timeout: 5000 });
            // Wiki appears in dropdown (placeholder + 1 wiki)
            await expect(page.locator('#wiki-select option')).toHaveCount(2, { timeout: 10000 });
            await expect(page.locator('#wiki-select')).toContainText('My Test Wiki');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('auto-populate name from browser path selection', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-auto-'));
        const subDir = path.join(tmpDir, 'test-wiki-repo');
        fs.mkdirSync(subDir);

        try {
            await page.goto(serverUrl);
            await page.click('[data-tab="wiki"]');
            await page.click('#add-wiki-btn');

            // Navigate browser to tmpDir
            await page.fill('#wiki-path', tmpDir);
            await page.click('#wiki-browse-btn');
            await expect(page.locator('#wiki-path-browser')).toBeVisible();

            // Click into the test-wiki-repo directory
            await page.locator('.path-browser-entry', { hasText: 'test-wiki-repo' }).click();
            await page.click('#wiki-path-browser-select');

            // Name should be auto-populated from last path segment
            await expect(page.locator('#wiki-name')).toHaveValue('test-wiki-repo');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

// ================================================================
// Wiki Path Browser
// ================================================================

test.describe('Wiki path browser', () => {
    test('path browser opens and navigates', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-browse-'));
        const nestedDir = path.join(tmpDir, 'test-wiki');
        fs.mkdirSync(path.join(nestedDir, 'src', 'components'), { recursive: true });

        try {
            await page.goto(serverUrl);
            await page.click('[data-tab="wiki"]');
            await page.click('#add-wiki-btn');

            await page.fill('#wiki-path', tmpDir);
            await page.click('#wiki-browse-btn');

            await expect(page.locator('#wiki-path-browser')).toBeVisible();
            await expect(page.locator('.path-browser-entry')).not.toHaveCount(0, { timeout: 5000 });

            const entryNames = page.locator('.path-browser-entry .entry-name');
            await expect(entryNames.filter({ hasText: 'test-wiki' })).toHaveCount(1);

            // Click to navigate into test-wiki
            await page.locator('.path-browser-entry', { hasText: 'test-wiki' }).click();
            await expect(page.locator('#wiki-path-breadcrumb')).toContainText('test-wiki');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('select path from browser fills input', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-select-'));
        const subDir = path.join(tmpDir, 'test-wiki-dir');
        fs.mkdirSync(subDir);

        try {
            await page.goto(serverUrl);
            await page.click('[data-tab="wiki"]');
            await page.click('#add-wiki-btn');

            await page.fill('#wiki-path', tmpDir);
            await page.click('#wiki-browse-btn');
            await expect(page.locator('#wiki-path-browser')).toBeVisible();

            // Click into test-wiki-dir and select
            await page.locator('.path-browser-entry', { hasText: 'test-wiki-dir' }).click();
            await page.click('#wiki-path-browser-select');

            await expect(page.locator('#wiki-path-browser')).toBeHidden();
            await expect(page.locator('#wiki-path')).toHaveValue(subDir);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('cancel button closes path browser', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('[data-tab="wiki"]');
        await page.click('#add-wiki-btn');

        await page.click('#wiki-browse-btn');
        await expect(page.locator('#wiki-path-browser')).toBeVisible();

        await page.click('#wiki-path-browser-cancel');
        await expect(page.locator('#wiki-path-browser')).toBeHidden();
    });
});

// ================================================================
// Wiki Selection & Display
// ================================================================

test.describe('Wiki selection & display', () => {
    test('selecting wiki from dropdown loads component tree', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-sel-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createWikiFixture(wikiDir);
            await seedWiki(serverUrl, 'wiki-sel-1', wikiDir, undefined, 'Select Wiki');

            await page.goto(serverUrl);
            await page.click('[data-tab="wiki"]');

            await expect(page.locator('#wiki-select option')).toHaveCount(2, { timeout: 10000 });
            await page.selectOption('#wiki-select', 'wiki-sel-1');

            // Component tree should populate
            await expect(page.locator('#wiki-component-tree')).not.toBeEmpty({ timeout: 5000 });
            await expect(page.locator('#wiki-component-tree .wiki-tree-empty')).toHaveCount(0);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('selecting wiki shows detail view and hides empty state', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-detail-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createWikiFixture(wikiDir);
            await seedWiki(serverUrl, 'wiki-detail-1', wikiDir, undefined, 'Detail Wiki');

            await page.goto(serverUrl);
            await page.click('[data-tab="wiki"]');

            await expect(page.locator('#wiki-select option')).toHaveCount(2, { timeout: 10000 });
            await page.selectOption('#wiki-select', 'wiki-detail-1');

            await expect(page.locator('#wiki-component-detail')).toBeVisible({ timeout: 5000 });
            await expect(page.locator('#wiki-empty')).toBeHidden();
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('deselecting wiki clears content and shows empty state', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-desel-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createWikiFixture(wikiDir);
            await seedWiki(serverUrl, 'wiki-desel-1', wikiDir, undefined, 'Deselect Wiki');

            await page.goto(serverUrl);
            await page.click('[data-tab="wiki"]');

            // Select wiki
            await expect(page.locator('#wiki-select option')).toHaveCount(2, { timeout: 10000 });
            await page.selectOption('#wiki-select', 'wiki-desel-1');
            await expect(page.locator('#wiki-component-detail')).toBeVisible({ timeout: 5000 });

            // Deselect wiki (select empty option)
            await page.selectOption('#wiki-select', '');

            await expect(page.locator('#wiki-component-detail')).toBeHidden();
            await expect(page.locator('#wiki-empty')).toBeVisible();
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

// ================================================================
// Delete Wiki
// ================================================================

test.describe('Delete wiki', () => {
    test('delete wiki via REST API removes it from dropdown', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-del-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createWikiFixture(wikiDir);
            await seedWiki(serverUrl, 'wiki-del-1', wikiDir, undefined, 'Doomed Wiki');

            await page.goto(serverUrl);
            await page.click('[data-tab="wiki"]');

            await expect(page.locator('#wiki-select option')).toHaveCount(2, { timeout: 10000 });

            // Delete via REST API
            const res = await request(`${serverUrl}/api/wikis/wiki-del-1`, { method: 'DELETE' });
            expect(res.status).toBe(200);

            // Reload to see updated state
            await page.reload();
            await page.click('[data-tab="wiki"]');

            // Only placeholder should remain
            await expect(page.locator('#wiki-select option')).toHaveCount(1, { timeout: 10000 });
            await expect(page.locator('#wiki-empty')).toBeVisible();
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

// ================================================================
// Admin Toggle
// ================================================================

test.describe('Admin toggle', () => {
    test('admin toggle hidden when no wiki selected', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('[data-tab="wiki"]');

        await expect(page.locator('#wiki-admin-toggle')).toHaveClass(/hidden/);
    });

    test('admin toggle visible when wiki selected', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-admin-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createWikiFixture(wikiDir);
            await seedWiki(serverUrl, 'wiki-admin-1', wikiDir, undefined, 'Admin Wiki');

            await page.goto(serverUrl);
            await page.click('[data-tab="wiki"]');

            await expect(page.locator('#wiki-select option')).toHaveCount(2, { timeout: 10000 });
            await page.selectOption('#wiki-select', 'wiki-admin-1');

            await expect(page.locator('#wiki-admin-toggle')).not.toHaveClass(/hidden/, { timeout: 5000 });
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('admin toggle hides when wiki deselected', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-toggle-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createWikiFixture(wikiDir);
            await seedWiki(serverUrl, 'wiki-toggle-1', wikiDir, undefined, 'Toggle Wiki');

            await page.goto(serverUrl);
            await page.click('[data-tab="wiki"]');

            await expect(page.locator('#wiki-select option')).toHaveCount(2, { timeout: 10000 });

            // Select wiki — toggle becomes visible
            await page.selectOption('#wiki-select', 'wiki-toggle-1');
            await expect(page.locator('#wiki-admin-toggle')).not.toHaveClass(/hidden/, { timeout: 5000 });

            // Deselect wiki — toggle hides
            await page.selectOption('#wiki-select', '');
            await expect(page.locator('#wiki-admin-toggle')).toHaveClass(/hidden/);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

// ================================================================
// Color & Form Options
// ================================================================

test.describe('Color & form options', () => {
    test('color selection persists after adding wiki', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-color-'));
        try {
            await page.goto(serverUrl);
            await page.click('[data-tab="wiki"]');
            await page.click('#add-wiki-btn');

            await page.fill('#wiki-path', tmpDir);
            await page.fill('#wiki-name', 'Color Test Wiki');
            await page.selectOption('#wiki-color', '#16825d');

            await page.click('#add-wiki-submit');
            await expect(page.locator('#add-wiki-overlay')).toBeHidden({ timeout: 5000 });

            // Verify via REST API that color was persisted
            const res = await request(`${serverUrl}/api/wikis`);
            const wikis = JSON.parse(res.body);
            const wikiList = Array.isArray(wikis) ? wikis : wikis.wikis ?? [];
            const colorWiki = wikiList.find((w: Record<string, unknown>) => w.name === 'Color Test Wiki');
            expect(colorWiki).toBeDefined();
            expect(colorWiki!.color).toBe('#16825d');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('generate AI checkbox defaults to checked', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('[data-tab="wiki"]');
        await page.click('#add-wiki-btn');

        await expect(page.locator('#wiki-generate-ai')).toBeChecked();
    });

    test('generate AI checkbox can be unchecked', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('[data-tab="wiki"]');
        await page.click('#add-wiki-btn');

        await expect(page.locator('#wiki-generate-ai')).toBeChecked();
        await page.uncheck('#wiki-generate-ai');
        await expect(page.locator('#wiki-generate-ai')).not.toBeChecked();
    });
});
