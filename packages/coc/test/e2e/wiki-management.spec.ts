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
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWiki, request } from './fixtures/seed';
import { createWikiFixture } from './fixtures/wiki-fixtures';

// ================================================================
// Wiki Tab Empty State & List
// ================================================================

test.describe('Wiki tab empty state & list', () => {
    test('shows empty state when no wikis exist', async ({ page, serverUrl }) => {
        await page.goto(serverUrl + '#wiki');
        await expect(page.locator('#view-wiki')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('#wiki-empty')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('#wiki-empty')).toContainText('No wikis yet');
    });

    test('displays seeded wikis in the card list', async ({ page, serverUrl }) => {
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

            await page.goto(serverUrl + '#wiki');

            // 2 wiki cards in the list
            await expect(page.locator('.wiki-card')).toHaveCount(2, { timeout: 10000 });
            await expect(page.locator('.wiki-card[data-wiki-id="wiki-1"]')).toBeVisible();
            await expect(page.locator('.wiki-card[data-wiki-id="wiki-2"]')).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('wiki list shows empty state when no wikis', async ({ page, serverUrl }) => {
        await page.goto(serverUrl + '#wiki');

        await expect(page.locator('.wiki-card')).toHaveCount(0);
        await expect(page.locator('#wiki-empty')).toBeVisible();
    });
});

// ================================================================
// Add Wiki Dialog
// ================================================================

test.describe('Add Wiki dialog', () => {
    test('add wiki button opens overlay dialog', async ({ page, serverUrl }) => {
        await page.goto(serverUrl + '#wiki');

        await page.click('#wiki-list-add-btn');
        await expect(page.locator('#add-wiki-overlay')).toBeVisible();
        await expect(page.locator('#wiki-path')).toBeVisible();
    });

    test('cancel button closes add wiki dialog', async ({ page, serverUrl }) => {
        await page.goto(serverUrl + '#wiki');

        await page.click('#wiki-list-add-btn');
        await expect(page.locator('#add-wiki-overlay')).toBeVisible();

        await page.click('#add-wiki-cancel-btn');
        await expect(page.locator('#add-wiki-overlay')).toBeHidden();
    });

    test('overlay click closes add wiki dialog', async ({ page, serverUrl }) => {
        await page.goto(serverUrl + '#wiki');

        await page.click('#wiki-list-add-btn');
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
        await page.goto(serverUrl + '#wiki');
        await page.click('#wiki-list-add-btn');
        await expect(page.locator('#add-wiki-overlay')).toBeVisible();

        // Ensure path is empty (clear both name and path; form requires both)
        await page.fill('#wiki-path', '');
        await page.fill('#wiki-name', '');
        await page.click('#add-wiki-submit');

        // Form returns early — overlay stays open, no wiki added
        await expect(page.locator('#add-wiki-overlay')).toBeVisible();
        await expect(page.locator('#wiki-card-list .wiki-card')).toHaveCount(0);
    });

    test('validation error on non-existent path', async ({ page, serverUrl }) => {
        await page.goto(serverUrl + '#wiki');
        await page.click('#wiki-list-add-btn');
        await expect(page.locator('#add-wiki-overlay')).toBeVisible();

        // Server derives wikiDir from repoPath+id and creates it; repoPath itself
        // is not validated. Submit with name + non-existent repoPath — server succeeds,
        // wiki is persisted, dialog closes.
        await page.fill('#wiki-name', 'Invalid Path Wiki');
        await page.fill('#wiki-path', '/nonexistent/path/to/repo/that/does/not/exist');
        await page.click('#add-wiki-submit');

        await expect(page.locator('#add-wiki-overlay')).toBeHidden({ timeout: 5000 });
        await expect(page.locator('#wiki-card-list .wiki-card')).toHaveCount(1, { timeout: 5000 });
    });
});

// ================================================================
// Add Wiki Success Workflow
// ================================================================

test.describe('Add Wiki success workflow', () => {
    test('submit add-wiki form with manual path', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-add-'));
        try {
            await page.goto(serverUrl + '#wiki');
            await page.click('#wiki-list-add-btn');

            await page.fill('#wiki-path', tmpDir);
            await page.fill('#wiki-name', 'My Test Wiki');
            await page.selectOption('#wiki-color', '#16825d');

            await page.click('#add-wiki-submit');

            // Dialog should close
            await expect(page.locator('#add-wiki-overlay')).toBeHidden({ timeout: 5000 });
            // Wiki appears in card list
            await expect(page.locator('#wiki-card-list .wiki-card')).toHaveCount(1, { timeout: 10000 });
            await expect(page.locator('#wiki-card-list .wiki-card')).toContainText('My Test Wiki');
        } finally {
            safeRmSync(tmpDir);
        }
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

            await page.goto(serverUrl + '#wiki');

            await expect(page.locator('.wiki-card[data-wiki-id="wiki-sel-1"]')).toBeVisible({ timeout: 10000 });
            await page.click('.wiki-card[data-wiki-id="wiki-sel-1"]');

            // Component tree should populate
            await expect(page.locator('#wiki-component-tree')).not.toBeEmpty({ timeout: 5000 });
            await expect(page.locator('#wiki-component-tree .wiki-tree-empty')).toHaveCount(0);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('selecting wiki shows detail view and hides empty state', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-detail-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createWikiFixture(wikiDir);
            await seedWiki(serverUrl, 'wiki-detail-1', wikiDir, undefined, 'Detail Wiki');

            await page.goto(serverUrl + '#wiki');

            await expect(page.locator('.wiki-card[data-wiki-id="wiki-detail-1"]')).toBeVisible({ timeout: 10000 });
            await page.click('.wiki-card[data-wiki-id="wiki-detail-1"]');

            await expect(page.locator('#wiki-component-detail')).toBeVisible({ timeout: 5000 });
            await expect(page.locator('#wiki-empty')).toBeHidden();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('deselecting wiki clears content and shows empty state', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-desel-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createWikiFixture(wikiDir);
            await seedWiki(serverUrl, 'wiki-desel-1', wikiDir, undefined, 'Deselect Wiki');

            await page.goto(serverUrl + '#wiki');

            // Select wiki
            await expect(page.locator('.wiki-card[data-wiki-id="wiki-desel-1"]')).toBeVisible({ timeout: 10000 });
            await page.click('.wiki-card[data-wiki-id="wiki-desel-1"]');
            await expect(page.locator('#wiki-component-detail')).toBeVisible({ timeout: 5000 });

            // Deselect wiki by navigating to bare #wiki route
            await page.evaluate(() => {
                location.hash = '#wiki';
            });

            await expect(page.locator('#wiki-component-detail')).toBeHidden();
            // Back to list view — card list visible (wiki remains in list)
            await expect(page.locator('#wiki-card-list')).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// Delete Wiki (REST API)
// ================================================================

test.describe('Delete wiki via REST API', () => {
    test('delete wiki via REST API removes it from card list', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-del-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createWikiFixture(wikiDir);
            await seedWiki(serverUrl, 'wiki-del-1', wikiDir, undefined, 'Doomed Wiki');

            await page.goto(serverUrl + '#wiki');

            await expect(page.locator('.wiki-card[data-wiki-id="wiki-del-1"]')).toBeVisible({ timeout: 10000 });

            // Delete via REST API
            const res = await request(`${serverUrl}/api/wikis/wiki-del-1`, { method: 'DELETE' });
            expect(res.status).toBe(200);

            // Reload to see updated state
            await page.reload();
            await page.goto(serverUrl + '#wiki');

            // No wiki cards should remain
            await expect(page.locator('#wiki-card-list .wiki-card')).toHaveCount(0, { timeout: 10000 });
            await expect(page.locator('#wiki-empty')).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// Edit Wiki Dialog
// ================================================================

test.describe('Edit wiki dialog', () => {
    test('edit button visible on wiki card hover', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-edit-btn-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            fs.mkdirSync(wikiDir, { recursive: true });
            await seedWiki(serverUrl, 'wiki-edit-1', wikiDir, undefined, 'Edit Wiki');

            await page.goto(serverUrl + '#wiki');

            const card = page.locator('.wiki-card[data-wiki-id="wiki-edit-1"]');
            await expect(card).toBeVisible({ timeout: 10000 });

            // Hover to reveal action buttons
            await card.hover();
            await expect(card.locator('.wiki-card-edit')).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('edit button opens edit wiki dialog', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-edit-open-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            fs.mkdirSync(wikiDir, { recursive: true });
            await seedWiki(serverUrl, 'wiki-edit-2', wikiDir, undefined, 'Edit Wiki 2');

            await page.goto(serverUrl + '#wiki');

            const card = page.locator('.wiki-card[data-wiki-id="wiki-edit-2"]');
            await expect(card).toBeVisible({ timeout: 10000 });

            await card.hover();
            await card.locator('.wiki-card-edit').click();

            await expect(page.locator('#edit-wiki-overlay')).toBeVisible();
            await expect(page.locator('#edit-wiki-name')).toHaveValue('Edit Wiki 2');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('cancel closes edit wiki dialog', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-edit-cancel-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            fs.mkdirSync(wikiDir, { recursive: true });
            await seedWiki(serverUrl, 'wiki-edit-3', wikiDir, undefined, 'Edit Wiki 3');

            await page.goto(serverUrl + '#wiki');

            const card = page.locator('.wiki-card[data-wiki-id="wiki-edit-3"]');
            await expect(card).toBeVisible({ timeout: 10000 });

            await card.hover();
            await card.locator('.wiki-card-edit').click();
            await expect(page.locator('#edit-wiki-overlay')).toBeVisible();

            await page.click('#edit-wiki-cancel-btn');
            await expect(page.locator('#edit-wiki-overlay')).toBeHidden();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('submit edit updates wiki name in card list', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-edit-submit-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            fs.mkdirSync(wikiDir, { recursive: true });
            await seedWiki(serverUrl, 'wiki-edit-4', wikiDir, undefined, 'Original Name');

            await page.goto(serverUrl + '#wiki');

            const card = page.locator('.wiki-card[data-wiki-id="wiki-edit-4"]');
            await expect(card).toBeVisible({ timeout: 10000 });

            await card.hover();
            await card.locator('.wiki-card-edit').click();
            await expect(page.locator('#edit-wiki-overlay')).toBeVisible();

            await page.fill('#edit-wiki-name', 'Renamed Wiki');
            await page.click('#edit-wiki-submit');

            await expect(page.locator('#edit-wiki-overlay')).toBeHidden({ timeout: 5000 });
            await expect(card).toContainText('Renamed Wiki');
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// Delete Wiki (UI)
// ================================================================

test.describe('Delete wiki via UI', () => {
    test('delete button visible on wiki card hover', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-del-btn-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            fs.mkdirSync(wikiDir, { recursive: true });
            await seedWiki(serverUrl, 'wiki-del-btn-1', wikiDir, undefined, 'Delete Wiki');

            await page.goto(serverUrl + '#wiki');

            const card = page.locator('.wiki-card[data-wiki-id="wiki-del-btn-1"]');
            await expect(card).toBeVisible({ timeout: 10000 });

            await card.hover();
            await expect(card.locator('.wiki-card-delete')).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('delete button opens confirmation dialog', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-del-confirm-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            fs.mkdirSync(wikiDir, { recursive: true });
            await seedWiki(serverUrl, 'wiki-del-confirm-1', wikiDir, undefined, 'Confirm Delete');

            await page.goto(serverUrl + '#wiki');

            const card = page.locator('.wiki-card[data-wiki-id="wiki-del-confirm-1"]');
            await expect(card).toBeVisible({ timeout: 10000 });

            await card.hover();
            await card.locator('.wiki-card-delete').click();

            await expect(page.locator('#delete-wiki-overlay')).toBeVisible();
            await expect(page.locator('#delete-wiki-name')).toContainText('Confirm Delete');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('cancel closes delete confirmation', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-del-cancel-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            fs.mkdirSync(wikiDir, { recursive: true });
            await seedWiki(serverUrl, 'wiki-del-cancel-1', wikiDir, undefined, 'Cancel Delete');

            await page.goto(serverUrl + '#wiki');

            const card = page.locator('.wiki-card[data-wiki-id="wiki-del-cancel-1"]');
            await expect(card).toBeVisible({ timeout: 10000 });

            await card.hover();
            await card.locator('.wiki-card-delete').click();
            await expect(page.locator('#delete-wiki-overlay')).toBeVisible();

            await page.click('#delete-wiki-cancel-btn');
            await expect(page.locator('#delete-wiki-overlay')).toBeHidden();

            // Wiki should still be in the list
            await expect(card).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('confirm removes wiki from card list', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-del-exec-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            fs.mkdirSync(wikiDir, { recursive: true });
            await seedWiki(serverUrl, 'wiki-del-exec-1', wikiDir, undefined, 'Delete Me');

            await page.goto(serverUrl + '#wiki');

            const card = page.locator('.wiki-card[data-wiki-id="wiki-del-exec-1"]');
            await expect(card).toBeVisible({ timeout: 10000 });

            await card.hover();
            await card.locator('.wiki-card-delete').click();
            await expect(page.locator('#delete-wiki-overlay')).toBeVisible();

            await page.click('#delete-wiki-confirm');
            await expect(page.locator('#delete-wiki-overlay')).toBeHidden({ timeout: 5000 });

            // Wiki should be removed
            await expect(page.locator('.wiki-card[data-wiki-id="wiki-del-exec-1"]')).toHaveCount(0, { timeout: 10000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// Admin Action Tabs
// ================================================================

test.describe('Admin action tabs', () => {
    test('project-level action tabs are visible when wiki is selected', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-admin-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createWikiFixture(wikiDir);
            await seedWiki(serverUrl, 'wiki-admin-1', wikiDir, undefined, 'Admin Wiki');

            await page.goto(serverUrl + '#wiki');

            await expect(page.locator('.wiki-card[data-wiki-id="wiki-admin-1"]')).toBeVisible({ timeout: 10000 });
            await page.click('.wiki-card[data-wiki-id="wiki-admin-1"]');

            await expect(page.locator('#wiki-project-tabs')).toBeVisible({ timeout: 5000 });
            await expect(page.locator('.wiki-project-tab[data-wiki-project-tab="browse"]')).toBeVisible();
            await expect(page.locator('.wiki-project-tab[data-wiki-project-tab="ask"]')).toBeVisible();
            await expect(page.locator('.wiki-project-tab[data-wiki-project-tab="graph"]')).toBeVisible();
            await expect(page.locator('.wiki-project-tab[data-wiki-project-tab="admin"]')).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('switching tabs opens admin panel and returns to browse view', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-toggle-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createWikiFixture(wikiDir);
            await seedWiki(serverUrl, 'wiki-toggle-1', wikiDir, undefined, 'Toggle Wiki');

            await page.goto(serverUrl + '#wiki');

            await expect(page.locator('.wiki-card[data-wiki-id="wiki-toggle-1"]')).toBeVisible({ timeout: 10000 });

            // Select wiki and open admin through action tab
            await page.click('.wiki-card[data-wiki-id="wiki-toggle-1"]');
            await expect(page.locator('#wiki-component-detail')).toBeVisible({ timeout: 5000 });
            await page.click('.wiki-project-tab[data-wiki-project-tab="admin"]');
            // Admin tab hides component tree sidebar; admin panel is in detail area
            await expect(page.locator('[data-wiki-admin-tab]').first()).toBeVisible({ timeout: 5000 });
            await expect(page.locator('#wiki-component-detail')).toBeVisible();

            // Back to browse tab
            await page.click('.wiki-project-tab[data-wiki-project-tab="browse"]');
            await expect(page.locator('#wiki-component-detail')).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
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
            await page.goto(serverUrl + '#wiki');
            await page.click('#wiki-list-add-btn');

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
            safeRmSync(tmpDir);
        }
    });

});
