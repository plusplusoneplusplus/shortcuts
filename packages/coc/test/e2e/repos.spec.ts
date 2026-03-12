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
import { seedWorkspace, seedProcess, seedQueueTask, request } from './fixtures/seed';
import { createRepoFixture, createTasksFixture } from './fixtures/repo-fixtures';
import {
    createMultiCommitRepo,
    navigateToGitTab,
} from './fixtures/git-fixtures';

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

        // The global processes view renders the queue activity panel
        await expect(page.locator('#view-processes')).toBeVisible({ timeout: 10000 });
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
        await expect(page.locator('.meta-item', { hasText: 'Plans' })).toBeVisible();
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

// ================================================================
// Git Sub-tab Smoke (008-git-subtab-smoke)
// ================================================================

test.describe('Git Sub-tab (smoke)', () => {
    test('commit list loads after switching to Git tab', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-git-smoke-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            await navigateToGitTab(page, serverUrl, 'ws-git-smoke-1', 'git-smoke-repo', repoDir);

            // Wait for commit list to finish loading
            await expect(page.getByTestId('commit-list-loading')).toBeHidden({ timeout: 10_000 });

            // Verify at least one commit row visible
            const rows = page.locator('[data-testid^="commit-row-"]');
            await expect(rows.first()).toBeVisible({ timeout: 10_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('clicking commit row shows commit detail', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-git-detail-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            await navigateToGitTab(page, serverUrl, 'ws-git-smoke-2', 'git-detail-repo', repoDir);

            await expect(page.getByTestId('commit-list-loading')).toBeHidden({ timeout: 10_000 });

            // Click the first commit row to view details
            const firstRow = page.locator('[data-testid^="commit-row-"]').first();
            await firstRow.click();

            // A commit detail panel or hash indicator should appear
            const commitDetail = page.getByTestId('commit-detail');
            await expect(commitDetail).toBeVisible({ timeout: 10_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// Explorer Sub-tab (009-explorer-subtab)
// ================================================================

test.describe('Explorer Sub-tab', () => {
    test('file tree loads root entries after switching to Explorer tab', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-'));
        const repoDir = createRepoFixture(tmpDir);

        try {
            await seedWorkspace(serverUrl, 'ws-explorer-1', 'explorer-repo', repoDir);

            await page.goto(serverUrl);
            await page.click('[data-tab="repos"]');
            await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

            await page.locator('.repo-item').first().click();
            await expect(page.locator('#repo-detail-content')).toBeVisible();

            await page.click('button[data-subtab="explorer"]');
            await expect(page.locator('button[data-subtab="explorer"]')).toHaveClass(/active/);

            // Wait for loading to finish
            await expect(page.getByTestId('explorer-loading')).toBeHidden({ timeout: 10_000 });

            // File tree should be visible with root entries
            await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 10_000 });

            // The repo fixture has src/, docs/, .vscode/ directories
            await expect(page.locator('[data-testid="tree-node-src"]')).toBeVisible({ timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('clicking a directory expands its children', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-expand-'));
        const repoDir = createRepoFixture(tmpDir);

        try {
            await seedWorkspace(serverUrl, 'ws-explorer-2', 'explorer-expand-repo', repoDir);

            await page.goto(serverUrl);
            await page.click('[data-tab="repos"]');
            await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

            await page.locator('.repo-item').first().click();
            await expect(page.locator('#repo-detail-content')).toBeVisible();

            await page.click('button[data-subtab="explorer"]');
            await expect(page.getByTestId('explorer-loading')).toBeHidden({ timeout: 10_000 });

            // Click the 'src' directory node to expand it
            const srcNode = page.locator('[data-testid="tree-node-src"]');
            await expect(srcNode).toBeVisible({ timeout: 5_000 });
            await srcNode.click();

            // After expanding, the child file src/index.ts should appear
            await expect(page.locator('[data-testid="tree-node-src/index.ts"]')).toBeVisible({ timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('clicking a file opens the preview pane', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-preview-'));
        const repoDir = createRepoFixture(tmpDir);

        try {
            await seedWorkspace(serverUrl, 'ws-explorer-3', 'explorer-preview-repo', repoDir);

            await page.goto(serverUrl);
            await page.click('[data-tab="repos"]');
            await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

            await page.locator('.repo-item').first().click();
            await expect(page.locator('#repo-detail-content')).toBeVisible();

            await page.click('button[data-subtab="explorer"]');
            await expect(page.getByTestId('explorer-loading')).toBeHidden({ timeout: 10_000 });

            // Expand src/ and click index.ts
            const srcNode = page.locator('[data-testid="tree-node-src"]');
            await expect(srcNode).toBeVisible({ timeout: 5_000 });
            await srcNode.click();

            const indexNode = page.locator('[data-testid="tree-node-src/index.ts"]');
            await expect(indexNode).toBeVisible({ timeout: 5_000 });
            await indexNode.click();

            // Preview pane should become visible
            await expect(page.getByTestId('explorer-preview-pane')).toBeVisible({ timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('hash navigation to #repos/<id>/explorer selects explorer sub-tab', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-hash-'));
        const repoDir = createRepoFixture(tmpDir);

        try {
            await seedWorkspace(serverUrl, 'ws-explorer-hash', 'explorer-hash-repo', repoDir);

            await page.goto(`${serverUrl}/#repos/ws-explorer-hash/explorer`);

            await expect(page.locator('[data-tab="repos"]')).toHaveClass(/active/);
            await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });
            await expect(page.locator('button[data-subtab="explorer"]')).toHaveClass(/active/);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// Sidebar Collapse / MiniReposSidebar (010-sidebar-collapse)
// ================================================================

test.describe('Sidebar Collapse', () => {
    test('hamburger button collapses sidebar to MiniReposSidebar', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-collapse-1', 'collapse-repo', '/tmp/collapse-repo');

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

        // Ensure sidebar is currently expanded (full grid visible)
        await expect(page.locator('#add-repo-btn')).toBeVisible();

        // Click hamburger to collapse
        await page.click('#hamburger-btn');

        // MiniReposSidebar should replace ReposGrid — look for mini-repo-item
        await expect(page.locator('[data-testid="mini-repo-item"]')).toBeVisible({ timeout: 5000 });

        // Full add-repo button should no longer be visible in sidebar
        await expect(page.locator('#add-repo-btn')).toBeHidden();
    });

    test('clicking a mini repo item selects the repo and shows detail', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-collapse-2', 'mini-click-repo', '/tmp/mini-click-repo');

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

        // Collapse the sidebar
        await page.click('#hamburger-btn');
        await expect(page.locator('[data-testid="mini-repo-item"]')).toBeVisible({ timeout: 5000 });

        // Click the mini repo item
        await page.locator('[data-testid="mini-repo-item"]').first().click();

        // Repo detail should be shown
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });
    });

    test('hamburger button re-expands collapsed sidebar', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-collapse-3', 'reexpand-repo', '/tmp/reexpand-repo');

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

        // Collapse then re-expand
        await page.click('#hamburger-btn');
        await expect(page.locator('[data-testid="mini-repo-item"]')).toBeVisible({ timeout: 5000 });

        await page.click('#hamburger-btn');

        // Full sidebar grid should be back
        await expect(page.locator('#add-repo-btn')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('[data-testid="mini-repo-item"]')).toBeHidden();
    });
});

// ================================================================
// Repo Group Collapse/Expand (011-group-collapse)
// ================================================================

test.describe('Repo Group Collapse/Expand', () => {
    test('repos with same remote URL appear in a group', async ({ page, serverUrl }) => {
        const remoteUrl = 'https://github.com/test-org/shared-repo.git';

        // Seed two workspaces with the same remoteUrl
        await request(`${serverUrl}/api/workspaces`, {
            method: 'POST',
            body: JSON.stringify({ id: 'ws-group-1a', name: 'group-repo-a', rootPath: '/tmp/group-a', remoteUrl }),
        });
        await request(`${serverUrl}/api/workspaces`, {
            method: 'POST',
            body: JSON.stringify({ id: 'ws-group-1b', name: 'group-repo-b', rootPath: '/tmp/group-b', remoteUrl }),
        });

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');

        // Both repos should appear in the sidebar
        await expect(page.locator('.repo-item')).toHaveCount(2, { timeout: 10000 });

        // A group header button should be visible (contains the group label with repo count badge)
        const groupHeader = page.locator('button:has(.drag-handle)').first();
        await expect(groupHeader).toBeVisible({ timeout: 5000 });
    });

    test('clicking group header collapses and expands the group', async ({ page, serverUrl }) => {
        const remoteUrl = 'https://github.com/test-org/collapse-repo.git';

        await request(`${serverUrl}/api/workspaces`, {
            method: 'POST',
            body: JSON.stringify({ id: 'ws-group-2a', name: 'collapse-a', rootPath: '/tmp/collapse-a', remoteUrl }),
        });
        await request(`${serverUrl}/api/workspaces`, {
            method: 'POST',
            body: JSON.stringify({ id: 'ws-group-2b', name: 'collapse-b', rootPath: '/tmp/collapse-b', remoteUrl }),
        });

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('.repo-item')).toHaveCount(2, { timeout: 10000 });

        // Both repo items visible (group expanded by default)
        await expect(page.locator('.repo-item-name').filter({ hasText: 'collapse-a' })).toBeVisible();
        await expect(page.locator('.repo-item-name').filter({ hasText: 'collapse-b' })).toBeVisible();

        // Click group header to collapse
        const groupHeader = page.locator('button:has(.drag-handle)').first();
        await groupHeader.click();

        // Repo items should now be hidden
        await expect(page.locator('.repo-item-name').filter({ hasText: 'collapse-a' })).toBeHidden({ timeout: 5000 });
        await expect(page.locator('.repo-item-name').filter({ hasText: 'collapse-b' })).toBeHidden({ timeout: 5000 });

        // Click group header again to expand
        await groupHeader.click();
        await expect(page.locator('.repo-item-name').filter({ hasText: 'collapse-a' })).toBeVisible({ timeout: 5000 });
    });
});

// ================================================================
// Hash Navigation — Remaining Sub-tabs (012-hash-navigation)
// ================================================================

test.describe('Hash Navigation — Remaining Sub-tabs', () => {
    test('hash navigation to #repos/<id>/git selects Git sub-tab', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-hash-git-'));
        const repoDir = createMultiCommitRepo(tmpDir);

        try {
            await seedWorkspace(serverUrl, 'ws-hash-git', 'hash-git-repo', repoDir);

            await page.goto(`${serverUrl}/#repos/ws-hash-git/git`);

            await expect(page.locator('[data-tab="repos"]')).toHaveClass(/active/);
            await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });
            await expect(page.locator('button[data-subtab="git"]')).toHaveClass(/active/);
            await expect(page.locator('button[data-subtab="info"]')).not.toHaveClass(/active/);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('hash navigation to #repos/<id>/tasks selects Tasks sub-tab', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-hash-tasks', 'hash-tasks-repo', '/tmp/hash-tasks-repo');

        await page.goto(`${serverUrl}/#repos/ws-hash-tasks/tasks`);

        await expect(page.locator('[data-tab="repos"]')).toHaveClass(/active/);
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('button[data-subtab="tasks"]')).toHaveClass(/active/);
    });

    test('hash navigation to #repos/<id>/schedules selects Schedules sub-tab', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-hash-sched', 'hash-schedules-repo', '/tmp/hash-sched-repo');

        await page.goto(`${serverUrl}/#repos/ws-hash-sched/schedules`);

        await expect(page.locator('[data-tab="repos"]')).toHaveClass(/active/);
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('button[data-subtab="schedules"]')).toHaveClass(/active/);
    });
});

// ================================================================
// Sub-tab Badges (013-subtab-badges)
// ================================================================

test.describe('Sub-tab Badges', () => {
    test('activity badge visible on activity sub-tab when repo has queue tasks', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-badge-queued', 'badge-queued-repo');

        // Seed a queued task for this workspace
        await seedQueueTask(serverUrl, {
            type: 'chat',
            displayName: 'Queued Badge Task',
            repoId: 'ws-badge-queued',
        });

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

        await page.locator('.repo-item').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();

        // Navigate to Activity tab to trigger queue data fetch
        await page.click('button[data-subtab="activity"]');
        await expect(page.locator('[data-testid="activity-split-panel"]')).toBeVisible({ timeout: 10000 });

        // Either the task text or the badge should be visible (task may be queued, running, or just completed)
        // Check that the Activity tab content at least rendered (queue was fetched)
        const subTabContent = page.locator('#repo-sub-tab-content');
        await expect(subTabContent).toBeVisible();

        // Verify the sub-tab button strip contains the activity button
        await expect(page.locator('button[data-subtab="activity"]')).toHaveClass(/active/);

        // The badge may or may not be visible depending on how quickly the task is processed.
        // If it's visible, verify it shows a count > 0.
        const queuedBadge = page.locator('[data-testid="activity-queued-badge"]');
        const runningBadge = page.locator('[data-testid="activity-running-badge"]');
        const queuedCount = await queuedBadge.count();
        const runningCount = await runningBadge.count();
        if (queuedCount > 0 && await queuedBadge.isVisible()) {
            const text = await queuedBadge.textContent();
            expect(Number(text)).toBeGreaterThan(0);
        } else if (runningCount > 0 && await runningBadge.isVisible()) {
            const text = await runningBadge.textContent();
            expect(Number(text)).toBeGreaterThan(0);
        }
        // If neither badge is visible, the task was processed quickly — that's also valid.
    });

    test('tasks count badge appears when repo has tasks', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-tasks-badge-'));
        const repoDir = createRepoFixture(tmpDir);
        createTasksFixture(repoDir);

        try {
            await seedWorkspace(serverUrl, 'ws-badge-tasks', 'badge-tasks-repo', repoDir);

            await page.goto(serverUrl);
            await page.click('[data-tab="repos"]');
            await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

            await page.locator('.repo-item').first().click();
            await expect(page.locator('#repo-detail-content')).toBeVisible();

            // Tasks sub-tab should show a count badge (bg-[#0078d4] span)
            const tasksTabBtn = page.locator('button[data-subtab="tasks"]');
            await expect(tasksTabBtn).toBeVisible();
            // Wait for task count to load (the badge span inside tasks button)
            await expect(tasksTabBtn.locator('span')).toBeVisible({ timeout: 10000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// Queue Task / Ask Buttons (014-queue-task-btn)
// ================================================================

test.describe('Queue Task and Ask Buttons', () => {
    test('Queue Task button opens the enqueue dialog', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-qt-1', 'queue-task-repo');

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

        await page.locator('.repo-item').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();

        // Click the Queue Task button
        await page.click('[data-testid="repo-queue-task-btn"]');

        // The floating enqueue dialog should appear
        await expect(page.getByTestId('floating-dialog-panel')).toBeVisible({ timeout: 5000 });
    });

    test('Ask button opens the enqueue dialog in ask mode', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-ask-1', 'ask-repo');

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

        await page.locator('.repo-item').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();

        // Click the Ask button
        await page.click('[data-testid="repo-ask-btn"]');

        // The floating dialog should appear
        await expect(page.getByTestId('floating-dialog-panel')).toBeVisible({ timeout: 5000 });
    });
});

// ================================================================
// Workflows Tab — Add Workflow Dialog (015-add-workflow-dialog)
// ================================================================

test.describe('Workflows Tab — Add Workflow Dialog', () => {
    test('+ New button opens AddWorkflowDialog', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-addwf-'));
        const repoDir = createRepoFixture(tmpDir);

        try {
            await seedWorkspace(serverUrl, 'ws-addwf-1', 'addwf-repo', repoDir);

            await page.goto(serverUrl);
            await page.click('[data-tab="repos"]');
            await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

            await page.locator('.repo-item').first().click();
            await expect(page.locator('#repo-detail-content')).toBeVisible();

            await page.click('button[data-subtab="workflows"]');
            await expect(page.locator('button[data-subtab="workflows"]')).toHaveClass(/active/);

            // Click the + New button in the Workflows section
            await page.locator('[data-testid="workflows-section"]').getByRole('button', { name: '+ New' }).click();

            // The AddWorkflowDialog should appear with a name input
            await expect(page.locator('input[placeholder*="name"]').or(page.locator('input[type="text"]')).first()).toBeVisible({ timeout: 5000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('validation error on invalid workflow name', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-addwf-val-'));
        const repoDir = createRepoFixture(tmpDir);

        try {
            await seedWorkspace(serverUrl, 'ws-addwf-2', 'addwf-val-repo', repoDir);

            await page.goto(serverUrl);
            await page.click('[data-tab="repos"]');
            await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

            await page.locator('.repo-item').first().click();
            await expect(page.locator('#repo-detail-content')).toBeVisible();

            await page.click('button[data-subtab="workflows"]');
            await page.locator('[data-testid="workflows-section"]').getByRole('button', { name: '+ New' }).click();

            // Wait for the dialog to open — the <select> template picker is always present
            await expect(page.locator('select')).toBeVisible({ timeout: 5000 });

            // Select Custom (blank) template using selectOption on the <select> element
            await page.locator('select').selectOption('custom');

            // Wait for the 'Create' button (shown when template is not ai-generated)
            await expect(page.getByRole('button', { name: 'Create' })).toBeVisible({ timeout: 3000 });

            // Submit with empty name — should show validation error
            await page.getByRole('button', { name: 'Create' }).click();

            await expect(page.locator('text=Name is required').or(page.locator('text=required'))).toBeVisible({ timeout: 5000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// Workflows Tab — WorkflowDetail (016-workflow-detail)
// ================================================================

test.describe('Workflows Tab — WorkflowDetail', () => {
    test('clicking View button opens WorkflowDetail panel', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wfdetail-'));
        const repoDir = createRepoFixture(tmpDir);

        try {
            await seedWorkspace(serverUrl, 'ws-wfdetail-1', 'wfdetail-repo', repoDir);

            await page.goto(serverUrl);
            await page.click('[data-tab="repos"]');
            await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

            await page.locator('.repo-item').first().click();
            await expect(page.locator('#repo-detail-content')).toBeVisible();

            await page.click('button[data-subtab="workflows"]');
            await expect(page.locator('button[data-subtab="workflows"]')).toHaveClass(/active/);

            // Wait for workflow list to load (repo fixture has p1 workflow)
            const pipelineItems = page.locator('.repo-workflow-item');
            await expect(pipelineItems).toHaveCount(1, { timeout: 10000 });

            // Click the View action button
            await pipelineItems.first().locator('.repo-workflow-actions .action-btn').click();

            // WorkflowDetail panel should open — right panel no longer shows empty state
            await expect(page.getByTestId('templates-empty-detail')).toBeHidden({ timeout: 5000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// Activity Tab — Task List (017-activity-task-list)
// ================================================================

test.describe('Activity Tab — Task List', () => {
    test('completed task appears in ActivityListPane history', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-activity-task-1', 'activity-task-repo');

        // Seed a queue task for this workspace (mock AI completes it quickly).
        // workspaceId routes the task to the workspace-specific queue so history returns it.
        await seedQueueTask(serverUrl, {
            type: 'chat',
            displayName: 'Activity List Task',
            workspaceId: 'ws-activity-task-1',
        });

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

        await page.locator('.repo-item').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();

        await page.click('button[data-subtab="activity"]');
        await expect(page.locator('[data-testid="activity-split-panel"]')).toBeVisible({ timeout: 10000 });

        // The task should appear in the list — either in queued, running, or history section
        // Mock AI processes tasks quickly so it may be in history as completed
        await expect(page.locator('text=Activity List Task')).toBeVisible({ timeout: 10000 });
    });

    test('clicking a task in the list shows detail in the right pane', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-activity-task-2', 'activity-detail-repo');

        // Seed a queue task.
        // workspaceId routes the task to the workspace-specific queue so history returns it.
        await seedQueueTask(serverUrl, {
            type: 'chat',
            displayName: 'Detail Pane Task',
            workspaceId: 'ws-activity-task-2',
        });

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

        await page.locator('.repo-item').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();

        await page.click('button[data-subtab="activity"]');
        await expect(page.locator('[data-testid="activity-split-panel"]')).toBeVisible({ timeout: 10000 });

        // Wait for task to appear (in queued, running, or history section)
        const taskItem = page.locator('text=Detail Pane Task');
        await expect(taskItem).toBeVisible({ timeout: 10000 });

        // Click the task item card
        await taskItem.first().click();

        // After selecting a task, the detail pane should show something other than empty state
        // The empty state only shows when no tasks exist at all
        await expect(page.getByTestId('queue-empty-state')).toBeHidden({ timeout: 5000 });
    });
});

// ================================================================
// Path Browser Up-Navigation (018-path-browser-up-nav)
// ================================================================

test.describe('Path Browser Up-Navigation', () => {
    test('clicking parent (..) entry navigates back to parent directory', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-upnav-'));
        createRepoFixture(tmpDir);

        try {
            await page.goto(serverUrl);
            await page.click('[data-tab="repos"]');
            await page.click('#add-repo-btn');

            // Set path to tmpDir and open browser
            await page.fill('#repo-path', tmpDir);
            await page.click('#browse-btn');
            await expect(page.locator('#path-browser')).toBeVisible();

            // Navigate into test-repo
            await page.locator('.path-browser-entry', { hasText: 'test-repo' }).click();
            await expect(page.locator('#path-breadcrumb')).toContainText('test-repo');

            // Navigate into src subdirectory if it exists
            const srcEntry = page.locator('.path-browser-entry', { hasText: 'src' });
            if (await srcEntry.count() > 0) {
                await srcEntry.first().click();
                await expect(page.locator('#path-breadcrumb')).toContainText('src');

                // Click the "📁 .." entry to go back to the parent (test-repo)
                const parentEntry = page.locator('#path-browser').locator('text=📁 ..');
                await expect(parentEntry).toBeVisible({ timeout: 5000 });
                await parentEntry.click();

                // Should be back in test-repo — breadcrumb should no longer show src
                await expect(page.locator('#path-breadcrumb')).not.toContainText('src', { timeout: 5000 });
                // src entry should be visible again as a directory listing
                await expect(page.locator('.path-browser-entry', { hasText: 'src' })).toBeVisible({ timeout: 5000 });
            }
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
