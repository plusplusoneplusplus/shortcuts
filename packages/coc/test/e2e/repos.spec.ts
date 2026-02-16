/**
 * Repos E2E Tests
 *
 * Tests the Repos tab: add repo, list repos, select repo, delete repo.
 * Repos are fetched via REST when the tab is switched, so data seeded
 * before page.goto() is available once the tab is clicked.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect } from './fixtures/server-fixture';
import { seedWorkspace, request } from './fixtures/seed';
import { createRepoFixture } from './fixtures/repo-fixtures';

test.describe('Repos tab', () => {
    test('shows empty state when no repos exist', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');

        await expect(page.locator('#repos-empty')).toBeVisible();
        await expect(page.locator('#repos-empty')).toContainText('No repos registered');
    });

    test('displays seeded repos in the sidebar', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-1', 'frontend', '/tmp/frontend');
        await seedWorkspace(serverUrl, 'ws-2', 'backend', '/tmp/backend');

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');

        // Wait for repo items to appear (async fetch on tab switch)
        await expect(page.locator('.repo-item')).toHaveCount(2, { timeout: 10000 });
        await expect(page.locator('#repos-empty')).toBeHidden();
    });

    test('clicking a repo shows its detail', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-detail', 'my-project', '/tmp/my-project');

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');

        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
        await page.locator('.repo-item').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();
        await expect(page.locator('#repo-detail-empty')).toBeHidden();
    });

    test('add repo button opens overlay dialog', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');

        await page.click('#add-repo-btn');
        await expect(page.locator('#add-repo-overlay')).toBeVisible();
        await expect(page.locator('#repo-path')).toBeVisible();
    });

    test('cancel button closes add repo dialog', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');

        await page.click('#add-repo-btn');
        await expect(page.locator('#add-repo-overlay')).toBeVisible();

        await page.click('#add-repo-cancel-btn');
        await expect(page.locator('#add-repo-overlay')).toBeHidden();
    });

    test('workspace select dropdown populates with repos', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-sel', 'selector-repo', '/tmp/selector');

        await page.goto(serverUrl);

        // Wait for workspaces to load and populate dropdown
        await expect(page.locator('#workspace-select option')).toHaveCount(2, { timeout: 5000 });
    });
});

// ================================================================
// Add Repo workflow (002-add-repo)
// ================================================================

test.describe('Add Repo workflow', () => {
    test('submit add-repo form with manual path', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-add-'));
        const repoDir = createRepoFixture(tmpDir);

        try {
            await page.goto(serverUrl);
            await page.click('[data-tab="repos"]');
            await page.click('#add-repo-btn');

            await page.fill('#repo-path', repoDir);
            await page.fill('#repo-alias', 'my-new-repo');
            await page.selectOption('#repo-color', '#16825d'); // Green

            await page.click('#add-repo-submit');

            // Dialog should close
            await expect(page.locator('#add-repo-overlay')).toBeHidden({ timeout: 5000 });
            // Repo appears in sidebar
            await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
            await expect(page.locator('.repo-item-name')).toContainText('my-new-repo');

            // Click repo to show detail panel
            await page.locator('.repo-item').first().click();
            await expect(page.locator('#repo-detail-content')).toBeVisible();
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('path browser opens and navigates', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-browse-'));
        const repoDir = createRepoFixture(tmpDir);

        try {
            await page.goto(serverUrl);
            await page.click('[data-tab="repos"]');
            await page.click('#add-repo-btn');

            // Set path to tmpDir so browser starts there
            await page.fill('#repo-path', tmpDir);
            await page.click('#browse-btn');

            // Path browser should be visible
            await expect(page.locator('#path-browser')).toBeVisible();

            // Should see entries (at least the test-repo dir)
            await expect(page.locator('.path-browser-entry')).not.toHaveCount(0, { timeout: 5000 });
            const entryNames = page.locator('.path-browser-entry .entry-name');
            await expect(entryNames.filter({ hasText: 'test-repo' })).toHaveCount(1);

            // Click the test-repo entry to navigate into it
            await page.locator('.path-browser-entry', { hasText: 'test-repo' }).click();

            // Breadcrumb should update to include test-repo
            await expect(page.locator('#path-breadcrumb')).toContainText('test-repo');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('select path from browser fills input', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-select-'));
        const repoDir = createRepoFixture(tmpDir);

        try {
            await page.goto(serverUrl);
            await page.click('[data-tab="repos"]');
            await page.click('#add-repo-btn');

            // Navigate browser to the repo
            await page.fill('#repo-path', tmpDir);
            await page.click('#browse-btn');
            await expect(page.locator('#path-browser')).toBeVisible();

            // Click into test-repo
            await page.locator('.path-browser-entry', { hasText: 'test-repo' }).click();
            await expect(page.locator('#path-breadcrumb')).toContainText('test-repo');

            // Click "Select This Directory"
            await page.click('#path-browser-select');

            // Path input should be filled, browser should be hidden
            await expect(page.locator('#path-browser')).toBeHidden();
            await expect(page.locator('#repo-path')).toHaveValue(repoDir);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('auto-detect name from path', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-auto-'));
        const repoDir = createRepoFixture(tmpDir);

        try {
            await page.goto(serverUrl);
            await page.click('[data-tab="repos"]');
            await page.click('#add-repo-btn');

            // Navigate browser to test-repo and select it
            await page.fill('#repo-path', tmpDir);
            await page.click('#browse-btn');
            await page.locator('.path-browser-entry', { hasText: 'test-repo' }).click();
            await page.click('#path-browser-select');

            // Alias should be auto-populated from last path segment
            await expect(page.locator('#repo-alias')).toHaveValue('test-repo');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('validation error on empty path', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await page.click('#add-repo-btn');
        await expect(page.locator('#add-repo-overlay')).toBeVisible();

        // Ensure path is empty and submit
        await page.fill('#repo-path', '');
        await page.click('#add-repo-submit');

        // Validation error should appear, form should stay open
        await expect(page.locator('#repo-validation')).toContainText('Path is required', { timeout: 5000 });
        await expect(page.locator('#repo-validation')).toHaveClass(/error/);
        await expect(page.locator('#add-repo-overlay')).toBeVisible();
    });

    test('color selection persists in sidebar and detail', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-color-'));
        const repoDir = createRepoFixture(tmpDir);

        try {
            await page.goto(serverUrl);
            await page.click('[data-tab="repos"]');
            await page.click('#add-repo-btn');

            await page.fill('#repo-path', repoDir);
            await page.fill('#repo-alias', 'color-test');
            await page.selectOption('#repo-color', '#16825d'); // Green

            await page.click('#add-repo-submit');
            await expect(page.locator('#add-repo-overlay')).toBeHidden({ timeout: 5000 });

            // Verify sidebar color dot
            await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
            const sidebarDot = page.locator('.repo-item .repo-color-dot');
            await expect(sidebarDot).toHaveAttribute('style', /background:\s*#16825d/);

            // Click repo and verify detail color dot
            await page.locator('.repo-item').first().click();
            await expect(page.locator('#repo-detail-content')).toBeVisible();
            const detailDot = page.locator('#repo-detail-content .repo-color-dot');
            await expect(detailDot.first()).toHaveAttribute('style', /background:\s*#16825d/);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

// ================================================================
// Edit Repo workflow (003-edit-repo)
// ================================================================

test.describe('Edit Repo workflow', () => {
    test('edit button opens dialog pre-filled', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-edit-1', 'original-name', '/tmp/original', '#16825d');

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

        // Select the repo to show detail
        await page.locator('.repo-item').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();

        // Click Edit button
        await page.click('#repo-edit-btn');
        await expect(page.locator('#add-repo-overlay')).toBeVisible();

        // Path should be read-only and pre-filled
        const pathInput = page.locator('#repo-path');
        await expect(pathInput).toHaveValue('/tmp/original');
        await expect(pathInput).toHaveAttribute('readonly', '');

        // Name and color should be pre-filled
        await expect(page.locator('#repo-alias')).toHaveValue('original-name');
        await expect(page.locator('#repo-color')).toHaveValue('#16825d');
    });

    test('save edits updates sidebar and detail', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-edit-2', 'old-name', '/tmp/edit-save', '#0078d4');

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

        // Select repo and open edit dialog
        await page.locator('.repo-item').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();
        await page.click('#repo-edit-btn');
        await expect(page.locator('#add-repo-overlay')).toBeVisible();

        // Change name and color
        await page.fill('#repo-alias', 'new-name');
        await page.selectOption('#repo-color', '#16825d'); // Green

        await page.click('#add-repo-submit');
        await expect(page.locator('#add-repo-overlay')).toBeHidden({ timeout: 5000 });

        // Sidebar item name should be updated
        await expect(page.locator('.repo-item-name')).toContainText('new-name', { timeout: 10000 });

        // Detail header should be updated
        await expect(page.locator('.repo-detail-header h1')).toContainText('new-name');
    });

    test('cancel edit preserves original', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-edit-3', 'keep-me', '/tmp/edit-cancel', '#0078d4');

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

        // Select repo and open edit dialog
        await page.locator('.repo-item').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();
        await page.click('#repo-edit-btn');
        await expect(page.locator('#add-repo-overlay')).toBeVisible();

        // Change name but cancel
        await page.fill('#repo-alias', 'changed-name');
        await page.click('#add-repo-cancel-btn');
        await expect(page.locator('#add-repo-overlay')).toBeHidden();

        // Sidebar should still show original name
        await expect(page.locator('.repo-item-name')).toContainText('keep-me');
    });
});
