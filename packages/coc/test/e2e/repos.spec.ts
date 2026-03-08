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
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace, seedProcess, request } from './fixtures/seed';
import { createRepoFixture, createTasksFixture } from './fixtures/repo-fixtures';

test.describe('Repos tab', () => {
    test('shows empty state when no repos exist', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');

        await expect(page.locator('#repos-empty')).toBeVisible();
        await expect(page.locator('#repos-empty')).toContainText('No repositories registered');
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
        await page.click('[data-tab="processes"]');

        // Wait for workspaces to load and populate dropdown (All + seeded repo = 2)
        await expect(page.locator('#workspace-select option')).toHaveCount(2, { timeout: 10000 });
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
            await page.click('[data-value="#107c10"]'); // Green

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
            safeRmSync(tmpDir);
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
            safeRmSync(tmpDir);
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
            safeRmSync(tmpDir);
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
            safeRmSync(tmpDir);
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
            await page.click('[data-value="#107c10"]'); // Green

            await page.click('#add-repo-submit');
            await expect(page.locator('#add-repo-overlay')).toBeHidden({ timeout: 5000 });

            // Verify sidebar color dot (Green #107c10 — may render as hex or rgb)
            await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
            const sidebarDot = page.locator('.repo-item .repo-color-dot');
            await expect(sidebarDot).toHaveAttribute('style', /#107c10|rgb\s*\(\s*16\s*,\s*124\s*,\s*16\s*\)/);

            // Click repo and verify detail color dot
            await page.locator('.repo-item').first().click();
            await expect(page.locator('#repo-detail-content')).toBeVisible();
            const detailDot = page.locator('#repo-detail-content .repo-color-dot');
            await expect(detailDot.first()).toHaveAttribute('style', /#107c10|rgb\s*\(\s*16\s*,\s*124\s*,\s*16\s*\)/);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// Edit Repo workflow (003-edit-repo)
// ================================================================

test.describe('Edit Repo workflow', () => {
    test('edit button opens dialog pre-filled', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-edit-1', 'original-name', '/tmp/original', '#107c10');

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

        // Name and color should be pre-filled (verify Green #107c10 button is selected)
        await expect(page.locator('#repo-alias')).toHaveValue('original-name');
        await expect(page.locator('#repo-color-picker [data-value="#107c10"]')).toHaveClass(/border-\[#0078d4\]|scale-110/);
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

        // Change name and color to Green
        await page.fill('#repo-alias', 'new-name');
        await page.click('[data-value="#107c10"]');

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

// ================================================================
// Remove Repo (004-remove-repo)
// ================================================================

test.describe('Remove Repo', () => {
    test('remove button deletes repo', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-rm-1', 'doomed-repo', '/tmp/doomed');

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

        // Select the repo to show detail with remove button
        await page.locator('.repo-item').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();

        // Accept the upcoming window.confirm dialog
        page.on('dialog', dialog => dialog.accept());

        await page.click('#repo-remove-btn');

        // Repo should be gone from sidebar, empty state shown
        await expect(page.locator('.repo-item')).toHaveCount(0, { timeout: 10000 });
        await expect(page.locator('#repos-empty')).toBeVisible();
    });

    test('removing selected repo clears detail panel', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-rm-2', 'selected-repo', '/tmp/selected');

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

        // Select the repo
        await page.locator('.repo-item').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();
        await expect(page.locator('#repo-detail-empty')).toBeHidden();

        // Accept the confirm dialog and remove
        page.on('dialog', dialog => dialog.accept());
        await page.click('#repo-remove-btn');

        // Detail panel should revert to empty state
        await expect(page.locator('#repo-detail-empty')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('#repo-detail-content')).toBeHidden();
    });
});

// ================================================================
// Sub-tab Navigation (005-subtab-navigation)
// ================================================================

test.describe('Sub-tab Navigation', () => {
    test('default sub-tab is Info', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-sub-1', 'info-repo', '/tmp/info-repo');

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

        await page.locator('.repo-item').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();

        await expect(page.locator('button[data-subtab="info"]')).toHaveClass(/active/);
        await expect(page.locator('.meta-grid')).toBeVisible();
    });

    test('switch to Workflows tab', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-sub-2', 'pipe-repo', '/tmp/pipe-repo');

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

        await page.locator('.repo-item').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();

        await page.click('button[data-subtab="workflows"]');
        await expect(page.locator('button[data-subtab="workflows"]')).toHaveClass(/active/);
        await expect(page.locator('button[data-subtab="info"]')).not.toHaveClass(/active/);

        const subContent = page.locator('#repo-sub-tab-content');
        await expect(subContent).toBeVisible();
        await expect(subContent.locator('.repo-workflow-list, .empty-state')).toHaveCount(1);
    });

    test('switch to Tasks tab', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-sub-3', 'tasks-repo', '/tmp/tasks-repo');

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

        await page.locator('.repo-item').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();

        await page.click('button[data-subtab="tasks"]');
        await expect(page.locator('button[data-subtab="tasks"]')).toHaveClass(/active/);

        await expect(page.locator('.repo-tasks-toolbar')).toBeVisible();
    });

    test('switch to Activity tab', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-sub-activity', 'activity-repo', '/tmp/activity-repo');

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

        await page.locator('.repo-item').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();

        await page.click('button[data-subtab="activity"]');
        await expect(page.locator('button[data-subtab="activity"]')).toHaveClass(/active/);
        await expect(page.locator('button[data-subtab="info"]')).not.toHaveClass(/active/);

        await expect(page.locator('[data-testid="activity-split-panel"]')).toBeVisible({ timeout: 10000 });
    });

    test('sub-tab state persists on re-select', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-sub-4a', 'repo-alpha', '/tmp/repo-alpha');
        await seedWorkspace(serverUrl, 'ws-sub-4b', 'repo-beta', '/tmp/repo-beta');

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('.repo-item')).toHaveCount(2, { timeout: 10000 });

        await page.locator('.repo-item').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();
        await page.click('button[data-subtab="workflows"]');
        await expect(page.locator('button[data-subtab="workflows"]')).toHaveClass(/active/);

        await page.locator('.repo-item').nth(1).click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();

        await page.locator('.repo-item').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();

        await expect(page.locator('button[data-subtab="workflows"]')).toHaveClass(/active/);
    });

    test('hash navigation works for sub-tab', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-sub-5', 'hash-repo', '/tmp/hash-repo');

        await page.goto(`${serverUrl}/#repos/ws-sub-5/workflows`);

        await expect(page.locator('[data-tab="repos"]')).toHaveClass(/active/);
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });

        await expect(page.locator('button[data-subtab="workflows"]')).toHaveClass(/active/);
        await expect(page.locator('button[data-subtab="info"]')).not.toHaveClass(/active/);
    });

    test('hash navigation works for Activity sub-tab', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-sub-activity-hash', 'activity-hash-repo', '/tmp/activity-hash');

        await page.goto(`${serverUrl}/#repos/ws-sub-activity-hash/activity`);

        await expect(page.locator('[data-tab="repos"]')).toHaveClass(/active/);
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });

        await expect(page.locator('button[data-subtab="activity"]')).toHaveClass(/active/);
        await expect(page.locator('button[data-subtab="info"]')).not.toHaveClass(/active/);
        await expect(page.locator('[data-testid="activity-split-panel"]')).toBeVisible({ timeout: 10000 });
    });
});

// ================================================================
// Info Tab Content (006-info-tab-content)
// ================================================================

test.describe('Info Tab Content', () => {
    test('meta grid shows path and color', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-info-1', 'info-repo', '/tmp/info-repo', '#107c10');

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

        // Click repo to show detail — Info is the default sub-tab
        await page.locator('.repo-item').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();
        await expect(page.locator('.meta-grid')).toBeVisible();

        // Verify path is displayed
        const pathCell = page.locator('.meta-path');
        await expect(pathCell.first()).toContainText('/tmp/info-repo');

        // Verify color dot and color value are shown (Green #107c10 — may render as hex or rgb)
        const colorItem = page.locator('.meta-item', { hasText: 'Color' });
        await expect(colorItem).toBeVisible();
        await expect(colorItem.locator('.repo-color-dot')).toHaveAttribute('style', /#107c10|rgb\s*\(\s*16\s*,\s*124\s*,\s*16\s*\)/);
        await expect(colorItem).toContainText('#107c10');

        // Verify pipeline and task count cells exist
        await expect(page.locator('.meta-item', { hasText: 'Workflows' })).toBeVisible();
        await expect(page.locator('.meta-item', { hasText: 'Tasks' })).toBeVisible();
    });

    test('git info displays branch', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-git-info-'));
        const repoDir = createRepoFixture(tmpDir);

        try {
            // Register workspace with the real git repo path
            await seedWorkspace(serverUrl, 'ws-git-info', 'git-info-repo', repoDir);

            await page.goto(serverUrl);
            await page.click('[data-tab="repos"]');
            await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

            await page.locator('.repo-item').first().click();
            await expect(page.locator('.meta-grid')).toBeVisible();

            // Branch cell should show a real branch name (main or master)
            const branchItem = page.locator('.meta-item', { hasText: 'Branch' });
            await expect(branchItem).toBeVisible();
            await expect(branchItem.locator('span').last()).toContainText(/main|master/);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('stats show process counts', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-stats', 'stats-repo', '/tmp/stats-repo');

        // Seed 3 completed + 1 failed process for this workspace
        await seedProcess(serverUrl, 'stats-p1', { status: 'completed', workspaceId: 'ws-stats' });
        await seedProcess(serverUrl, 'stats-p2', { status: 'completed', workspaceId: 'ws-stats' });
        await seedProcess(serverUrl, 'stats-p3', { status: 'completed', workspaceId: 'ws-stats' });
        await seedProcess(serverUrl, 'stats-p4', { status: 'failed', workspaceId: 'ws-stats' });

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

        // Check sidebar stat counts
        const statCounts = page.locator('.repo-stat-counts');
        await expect(statCounts).toBeVisible();
        // ✓ 3 (completed) and ✗ 1 (failed)
        await expect(statCounts).toContainText('3');
        await expect(statCounts).toContainText('1');

        // Click repo to verify in Info tab meta grid
        await page.locator('.repo-item').first().click();
        await expect(page.locator('.meta-grid')).toBeVisible();

        const completedItem = page.locator('.meta-item', { hasText: 'Completed' });
        await expect(completedItem).toContainText('3');
        const failedItem = page.locator('.meta-item', { hasText: 'Failed' });
        await expect(failedItem).toContainText('1');
        const runningItem = page.locator('.meta-item', { hasText: 'Running' });
        await expect(runningItem).toContainText('0');
    });

    test('recent processes list', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-recent', 'recent-repo', '/tmp/recent-repo');

        // Seed 5 processes for this workspace
        for (let i = 1; i <= 5; i++) {
            await seedProcess(serverUrl, `recent-p${i}`, {
                status: 'completed',
                workspaceId: 'ws-recent',
                promptPreview: `Recent Process ${i}`,
            });
        }

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

        await page.locator('.repo-item').first().click();
        await expect(page.locator('.meta-grid')).toBeVisible();

        // Wait for recent processes to load
        const processList = page.locator('#repo-processes-list');
        await expect(processList).not.toContainText('Loading', { timeout: 10000 });
        await expect(processList).not.toContainText('No processes');

        // Should have 5 process entries
        const processEntries = processList.locator('.repo-process-entry');
        await expect(processEntries).toHaveCount(5, { timeout: 10000 });

        // Verify process names are shown
        await expect(processList).toContainText('Recent Process 1');
        await expect(processList).toContainText('Recent Process 5');
    });
});

// ================================================================
// Pipelines Tab Content (007-pipelines-tab)
// ================================================================

test.describe('Workflows Tab Content', () => {
    test('discovered workflows render with name and View button', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-pipe-'));
        const repoDir = createRepoFixture(tmpDir);

        try {
            await seedWorkspace(serverUrl, 'ws-pipe-1', 'pipe-repo', repoDir);

            await page.goto(serverUrl);
            await page.click('[data-tab="repos"]');
            await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

            await page.locator('.repo-item').first().click();
            await expect(page.locator('#repo-detail-content')).toBeVisible();
            await page.click('button[data-subtab="workflows"]');
            await expect(page.locator('button[data-subtab="workflows"]')).toHaveClass(/active/);

            const pipelineList = page.locator('.repo-workflow-list');
            await expect(pipelineList).toBeVisible({ timeout: 10000 });

            const pipelineItems = page.locator('.repo-workflow-item');
            await expect(pipelineItems).toHaveCount(1);

            await expect(page.locator('.workflow-name').first()).toContainText('p1');

            await expect(pipelineItems.first().locator('.repo-workflow-actions .action-btn')).toBeVisible();
            await expect(pipelineItems.first().locator('.repo-workflow-actions .action-btn')).toContainText('View');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('empty state when no workflows exist', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-pipe-empty', 'empty-pipe-repo', '/tmp/no-such-repo');

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

        await page.locator('.repo-item').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();
        await page.click('button[data-subtab="workflows"]');
        await expect(page.locator('button[data-subtab="workflows"]')).toHaveClass(/active/);

        await expect(page.locator('.repo-workflow-list')).toHaveCount(0);

        const subContent = page.locator('#repo-sub-tab-content');
        const emptyState = subContent.locator('.empty-state');
        await expect(emptyState).toBeVisible({ timeout: 10000 });
        await expect(emptyState).toContainText('No workflows found');
    });
});
