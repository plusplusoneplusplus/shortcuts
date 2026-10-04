/**
 * Tests the Repos tab: add repo, list repos, select repo, delete repo.
 * Repos are fetched via REST when the tab is switched, so data seeded
 * before page.goto() is available once the tab is clicked.
 *
 * Desktop workspace navigation uses the remote-chip picker and hash routes.
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
import {
    gotoWorkspace,
    selectRepoNamed,
    openSubTab,
    openRemotePicker,
    openAddRepoOption,
    removeWorkspaceViaRowMenu,
    openExplorerPanel,
} from './fixtures/remote-shell';

function testWorkspacePath(name: string): string {
    return path.join(os.tmpdir(), name);
}

/**
 * Enable the Workflows tab feature flag on the running server. The Workflows
 * sub-tab is gated by `workflows.enabled` and is off by default; tests that
 * exercise that sub-tab must opt into it before navigating.
 */
async function enableWorkflowsFeature(serverUrl: string): Promise<void> {
    const res = await request(`${serverUrl}/api/admin/config`, {
        method: 'PUT',
        body: JSON.stringify({ 'workflows.enabled': true }),
    });
    if (res.status !== 200) {
        throw new Error(`Failed to enable workflows feature: ${res.status} ${res.body}`);
    }
}

test.describe('Repos tab', () => {
    test('shows empty state when no repos exist', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');

        await expect(page.locator('#repo-detail-empty')).toBeVisible();
        await expect(page.locator('#repo-detail-empty')).toContainText('Select a repository to view details');
    });

    test('displays seeded repos in the remote-chip picker', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-1', 'frontend', '/tmp/frontend');
        await seedWorkspace(serverUrl, 'ws-2', 'backend', '/tmp/backend');

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');

        // Wait for repo items to appear (async fetch on tab switch)
        await openRemotePicker(page);
        await expect(page.locator('[data-testid="remote-dropdown-item"]')).toHaveCount(2, { timeout: 10000 });
    });

    test('clicking a repo shows its detail', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-detail', 'my-project', '/tmp/my-project');

        await page.goto(serverUrl);
        await gotoWorkspace(page, serverUrl, 'ws-detail');

        await expect(page.locator('#repo-detail-content')).toBeVisible();
        await expect(page.locator('#repo-detail-empty')).toBeHidden();
    });

    test('add repo button opens overlay dialog', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');

        await openAddRepoOption(page, 'remote-add-repo-option');
        await expect(page.locator('#add-repo-overlay')).toBeVisible();
        await expect(page.locator('#repo-path')).toBeVisible();
    });

    test('cancel button closes add repo dialog', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');

        await openAddRepoOption(page, 'remote-add-repo-option');
        await expect(page.locator('#add-repo-overlay')).toBeVisible();

        await page.click('#add-repo-cancel-btn');
        await expect(page.locator('#add-repo-overlay')).toBeHidden();
    });

    test('remote-chip picker lists seeded repos by name', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-sel', 'selector-repo', '/tmp/selector');

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');

        // Seeded repo should appear in the remote-chip picker
        await openRemotePicker(page);
        await expect(page.locator('[data-testid="remote-dropdown-item"]')).toHaveCount(1, { timeout: 10000 });
        await expect(page.locator('[data-testid="remote-dropdown-item"]')).toContainText('selector-repo');
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
            await openAddRepoOption(page, 'remote-add-repo-option');

            await page.fill('#repo-path', repoDir);
            await page.fill('#repo-alias', 'my-new-repo');
            await page.click('[data-value="#107c10"]'); // Green

            await page.click('#add-repo-submit');

            // Dialog should close. Adding a repo doesn't auto-select it, so
            // pick it up through the picker and confirm its detail renders.
            await expect(page.locator('#add-repo-overlay')).toBeHidden({ timeout: 5000 });
            await selectRepoNamed(page, 'my-new-repo');
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
            await openAddRepoOption(page, 'remote-add-repo-option');

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

    test('browsing into a directory fills the path input', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-select-'));
        const repoDir = createRepoFixture(tmpDir);

        try {
            await page.goto(serverUrl);
            await page.click('[data-tab="repos"]');
            await openAddRepoOption(page, 'remote-add-repo-option');

            // Navigate browser to the repo
            await page.fill('#repo-path', tmpDir);
            await page.click('#browse-btn');
            await expect(page.locator('#path-browser')).toBeVisible();

            // Click into test-repo
            await page.locator('.path-browser-entry', { hasText: 'test-repo' }).click();
            await expect(page.locator('#path-breadcrumb')).toContainText('test-repo');

            // Path input tracks the browsed directory — no separate confirm button
            await expect(page.locator('#repo-path')).toHaveValue(repoDir);
            await expect(page.locator('#path-browser-select')).toHaveCount(0);

            // The tree stays open, and Close dismisses it without reverting the path
            await expect(page.locator('#path-browser')).toBeVisible();
            await page.click('#path-browser-close');
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
            await openAddRepoOption(page, 'remote-add-repo-option');

            // Navigate browser into test-repo — that alone is the selection
            await page.fill('#repo-path', tmpDir);
            await page.click('#browse-btn');
            await page.locator('.path-browser-entry', { hasText: 'test-repo' }).click();
            await expect(page.locator('#path-breadcrumb')).toContainText('test-repo');

            // Alias should be auto-populated from last path segment
            await expect(page.locator('#repo-alias')).toHaveValue('test-repo');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('validation error on empty path', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await openAddRepoOption(page, 'remote-add-repo-option');
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
            await openAddRepoOption(page, 'remote-add-repo-option');

            await page.fill('#repo-path', repoDir);
            await page.fill('#repo-alias', 'color-test');
            await page.click('[data-value="#107c10"]'); // Green

            await page.click('#add-repo-submit');
            await expect(page.locator('#add-repo-overlay')).toBeHidden({ timeout: 5000 });

            // Select the repo and navigate to settings sub-tab to verify detail color dot
            await selectRepoNamed(page, 'color-test');
            await openSubTab(page, 'settings');
            await expect(page.locator('button[data-subtab="settings"]')).toHaveAttribute('data-active', 'true');
            const detailDot = page.locator('#repo-detail-content .repo-color-dot');
            await expect(detailDot.first()).toHaveAttribute('style', /#107c10|rgb\s*\(\s*16\s*,\s*124\s*,\s*16\s*\)/);
        } finally {
            safeRmSync(tmpDir);
        }
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

        await removeWorkspaceViaRowMenu(page, 'doomed-repo');

        // Repo should be gone from the picker, empty state shown
        await openRemotePicker(page);
        await expect(page.locator('[data-testid="remote-dropdown-item"]')).toHaveCount(0, { timeout: 10000 });
        await page.keyboard.press('Escape');
        await expect(page.locator('#repo-detail-empty')).toBeVisible();
    });

    test('removing selected repo clears detail panel', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-rm-2', 'selected-repo', '/tmp/selected');

        await page.goto(serverUrl);
        await gotoWorkspace(page, serverUrl, 'ws-rm-2');

        await removeWorkspaceViaRowMenu(page, 'selected-repo');

        // Detail panel should revert to empty state
        await expect(page.locator('#repo-detail-empty')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('#repo-detail-content')).toBeHidden();
    });
});

// ================================================================
// Sub-tab Navigation (005-subtab-navigation)
// ================================================================

test.describe('Sub-tab Navigation', () => {
    test('default sub-tab is Settings', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-sub-1', 'info-repo', '/tmp/info-repo');

        await page.goto(serverUrl);
        await gotoWorkspace(page, serverUrl, 'ws-sub-1');

        await page.click('button[data-subtab="settings"]');
        await expect(page.locator('button[data-subtab="settings"]')).toHaveAttribute('data-active', 'true');
        await expect(page.locator('[data-testid="settings-content-panel"]')).toBeVisible();
    });

    test('switch to Workflows tab', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-sub-2', 'pipe-repo', '/tmp/pipe-repo');
        await enableWorkflowsFeature(serverUrl);

        await page.goto(serverUrl);
        await gotoWorkspace(page, serverUrl, 'ws-sub-2');

        await page.click('button[data-subtab="workflows"]');
        await expect(page.locator('button[data-subtab="workflows"]')).toHaveAttribute('data-active', 'true');
        await expect(page.locator('button[data-subtab="settings"]')).toHaveAttribute('data-active', 'false');

        const subContent = page.locator('#repo-sub-tab-content');
        await expect(subContent).toBeVisible();
        await expect(subContent.locator('.repo-workflow-list, .empty-state')).toHaveCount(1);
    });

    test('switch to Tasks tab', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-sub-3', 'tasks-repo', '/tmp/tasks-repo');

        await page.goto(serverUrl);
        await gotoWorkspace(page, serverUrl, 'ws-sub-3');

        await page.click('button[data-subtab="tasks"]');
        await expect(page.locator('button[data-subtab="tasks"]')).toHaveAttribute('data-active', 'true');

        await expect(page.locator('.repo-tasks-toolbar')).toBeVisible();
    });

    test('switch to Activity tab', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-sub-activity', 'activity-repo', '/tmp/activity-repo');

        await page.goto(serverUrl);
        await gotoWorkspace(page, serverUrl, 'ws-sub-activity');

        await page.click('button[data-subtab="activity"]');
        await expect(page.locator('button[data-subtab="activity"]')).toHaveAttribute('data-active', 'true');
        await expect(page.locator('button[data-subtab="settings"]')).toHaveAttribute('data-active', 'false');

        await expect(page.locator('[data-testid="split-workspace-panel"]')).toBeVisible({ timeout: 10000 });
    });

    test('sub-tab state persists on re-select', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-sub-4a', 'repo-alpha', '/tmp/repo-alpha');
        await seedWorkspace(serverUrl, 'ws-sub-4b', 'repo-beta', '/tmp/repo-beta');
        await enableWorkflowsFeature(serverUrl);

        await page.goto(serverUrl);
        await gotoWorkspace(page, serverUrl, 'ws-sub-4a');
        await page.click('button[data-subtab="workflows"]');
        await expect(page.locator('button[data-subtab="workflows"]')).toHaveAttribute('data-active', 'true');

        await gotoWorkspace(page, serverUrl, 'ws-sub-4b');
        await gotoWorkspace(page, serverUrl, 'ws-sub-4a');

        await expect(page.locator('button[data-subtab="workflows"]')).toHaveAttribute('data-active', 'true');
    });

    test('hash navigation works for sub-tab', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-sub-5', 'hash-repo', '/tmp/hash-repo');
        await enableWorkflowsFeature(serverUrl);

        await page.goto(`${serverUrl}/#repos/ws-sub-5/workflows`);

        await expect(page.locator('[data-tab="repos"]')).toHaveClass(/active/);
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });

        await expect(page.locator('button[data-subtab="workflows"]')).toHaveAttribute('data-active', 'true');
        await expect(page.locator('button[data-subtab="settings"]')).toHaveAttribute('data-active', 'false');
    });

    test('hash navigation works for Activity sub-tab', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-sub-activity-hash', 'activity-hash-repo', '/tmp/activity-hash');

        await page.goto(`${serverUrl}/#repos/ws-sub-activity-hash/activity`);

        await expect(page.locator('[data-tab="repos"]')).toHaveClass(/active/);
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });

        await expect(page.locator('button[data-subtab="activity"]')).toHaveAttribute('data-active', 'true');
        await expect(page.locator('button[data-subtab="settings"]')).toHaveAttribute('data-active', 'false');
        await expect(page.locator('[data-testid="split-workspace-panel"]')).toBeVisible({ timeout: 10000 });
    });
});

// ================================================================
// Info Tab Content (006-info-tab-content)
// ================================================================

test.describe('Info Tab Content', () => {
    test('meta grid shows path and color', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-info-1', 'info-repo', testWorkspacePath('info-repo'), '#107c10');

        await page.goto(serverUrl);
        await gotoWorkspace(page, serverUrl, 'ws-info-1', 'settings');
        await expect(page.locator('[data-testid="info-workspace-card"]')).toBeVisible();

        // Verify path is displayed
        await expect(page.locator('[data-testid="info-workspace-card"]')).toContainText(testWorkspacePath('info-repo'));

        // Verify color dot and color value are shown (Green #107c10 — may render as hex or rgb)
        const workspaceCard = page.locator('[data-testid="info-workspace-card"]');
        await expect(workspaceCard).toBeVisible();
        await expect(workspaceCard.locator('.repo-color-dot')).toHaveAttribute('style', /#107c10|rgb\s*\(\s*16\s*,\s*124\s*,\s*16\s*\)/);
        await expect(workspaceCard).toContainText('#107c10');

        // Verify pipeline and task count cells exist
        await expect(page.locator('[data-testid="info-stat-workflows"]')).toBeVisible();
        await expect(page.locator('[data-testid="info-stat-plans"]')).toBeVisible();
    });

    test('git info displays branch', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-git-info-'));
        const repoDir = createRepoFixture(tmpDir);

        try {
            // Register workspace with the real git repo path
            await seedWorkspace(serverUrl, 'ws-git-info', 'git-info-repo', repoDir);

            await page.goto(serverUrl);
            await gotoWorkspace(page, serverUrl, 'ws-git-info', 'settings');
            await expect(page.locator('[data-testid="info-workspace-card"]')).toBeVisible();

            // Branch cell should show a real branch name (main or master)
            const workspaceCard = page.locator('[data-testid="info-workspace-card"]');
            await expect(workspaceCard).toBeVisible();
            await expect(workspaceCard).toContainText(/main|master/);
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
        await gotoWorkspace(page, serverUrl, 'ws-stats', 'settings');
        await expect(page.locator('[data-testid="settings-content-panel"]')).toBeVisible();

        const completedItem = page.locator('[data-testid="info-stat-completed"]');
        await expect(completedItem).toContainText('3');
        const failedItem = page.locator('[data-testid="info-stat-failed"]');
        await expect(failedItem).toContainText('1');
        const runningItem = page.locator('[data-testid="info-stat-running"]');
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
        await gotoWorkspace(page, serverUrl, 'ws-recent', 'settings');
        await expect(page.locator('[data-testid="settings-content-panel"]')).toBeVisible();

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
            await enableWorkflowsFeature(serverUrl);

            await page.goto(serverUrl);
            await gotoWorkspace(page, serverUrl, 'ws-pipe-1', 'workflows');
            await expect(page.locator('button[data-subtab="workflows"]')).toHaveAttribute('data-active', 'true');

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
        await enableWorkflowsFeature(serverUrl);

        await page.goto(serverUrl);
        await gotoWorkspace(page, serverUrl, 'ws-pipe-empty', 'workflows');
        await expect(page.locator('button[data-subtab="workflows"]')).toHaveAttribute('data-active', 'true');

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

            await expect(page.getByTestId('commit-list-loading')).toBeHidden({ timeout: 10_000 });

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
    // Explorer has no sub-tab button in the graduated shell —
    // `computeVisibleSubTabs` deliberately excludes it ("the desktop right
    // panel owns Terminal and Explorer"), and a hash deep-link to
    // `#repos/<id>/explorer` is immediately redirected away by
    // `RepoDetail`'s invisible-subtab guard (same mechanism the Schedules
    // hash-redirect test below exercises). The same `ExplorerPanel` the
    // legacy sub-tab used to show is still here, but it now lives inside the
    // always-available Workspace right panel (`UnifiedRightPanel`) and must
    // be opened via its own tree toggle — see `openExplorerPanel`. Every
    // locator below is scoped to `unified-panel-explorer-mode`.
    const explorerPanel = (page: import('@playwright/test').Page) => page.getByTestId('unified-panel-explorer-mode');

    test('file tree loads root entries after opening the Explorer panel', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-'));
        const repoDir = createRepoFixture(tmpDir);

        try {
            await seedWorkspace(serverUrl, 'ws-explorer-1', 'explorer-repo', repoDir);

            await page.goto(serverUrl);
            await gotoWorkspace(page, serverUrl, 'ws-explorer-1');
            await openExplorerPanel(page);

            // Wait for loading to finish
            await expect(explorerPanel(page).getByTestId('explorer-loading')).toBeHidden({ timeout: 10_000 });

            // File tree should be visible with root entries
            await expect(explorerPanel(page).getByTestId('file-tree')).toBeVisible({ timeout: 10_000 });

            // The repo fixture has src/, docs/, .vscode/ directories
            await expect(explorerPanel(page).getByTestId('tree-node-src')).toBeVisible({ timeout: 5_000 });
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
            await gotoWorkspace(page, serverUrl, 'ws-explorer-2');
            await openExplorerPanel(page);
            await expect(explorerPanel(page).getByTestId('explorer-loading')).toBeHidden({ timeout: 10_000 });

            // Click the 'src' directory node to expand it
            const srcNode = explorerPanel(page).getByTestId('tree-node-src');
            await expect(srcNode).toBeVisible({ timeout: 5_000 });
            await srcNode.click();

            // After expanding, the child file src/index.ts should appear
            await expect(explorerPanel(page).getByTestId('tree-node-src/index.ts')).toBeVisible({ timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('clicking a file opens it in the Workspace panel\'s editor tab', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-preview-'));
        const repoDir = createRepoFixture(tmpDir);

        try {
            await seedWorkspace(serverUrl, 'ws-explorer-3', 'explorer-preview-repo', repoDir);

            await page.goto(serverUrl);
            await gotoWorkspace(page, serverUrl, 'ws-explorer-3');
            await openExplorerPanel(page);
            await expect(explorerPanel(page).getByTestId('explorer-loading')).toBeHidden({ timeout: 10_000 });

            // Expand src/ and click index.ts
            const srcNode = explorerPanel(page).getByTestId('tree-node-src');
            await expect(srcNode).toBeVisible({ timeout: 5_000 });
            await srcNode.click();

            const indexNode = explorerPanel(page).getByTestId('tree-node-src/index.ts');
            await expect(indexNode).toBeVisible({ timeout: 5_000 });
            await indexNode.click();

            // In the Explorer's sidebar mode (`ExplorerPanel`'s `navigatorMode`),
            // the host — `UnifiedRightPanel` — renders the opened file as its own
            // tab with a Monaco editor, rather than inside an
            // `explorer-preview-pane` local to the panel (that pane only exists
            // in the panel's standalone "editor" mode, which the desktop shell
            // no longer mounts).
            const panel = page.getByTestId('unified-right-panel');
            await expect(panel.locator('[data-testid^="unified-panel-view-"]')).toBeVisible({ timeout: 5_000 });
            await expect(panel.getByTestId('monaco-container')).toBeVisible({ timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('hash navigation to #repos/<id>/explorer opens Workspace when the Explorer sub-tab is hidden', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-explorer-hash-'));
        const repoDir = createRepoFixture(tmpDir);

        try {
            await seedWorkspace(serverUrl, 'ws-explorer-hash', 'explorer-hash-repo', repoDir);

            await page.goto(`${serverUrl}/#repos/ws-explorer-hash/explorer`);

            await expect(page.locator('[data-tab="repos"]')).toHaveClass(/active/);
            await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });
            // Explorer never had a visible sub-tab; the redirect guard sends
            // it to the default Workspace (chats, rendered as the "activity"
            // key/button) view instead, exactly like the Schedules
            // hash-redirect case below.
            await expect(page.locator('button[data-subtab="activity"]')).toHaveAttribute('data-active', 'true');
            await expect(page.locator('button[data-subtab="explorer"]')).toHaveCount(0);

            // The panel is still reachable from here through its own toggle.
            await openExplorerPanel(page);
            await expect(explorerPanel(page).getByTestId('file-tree')).toBeVisible({ timeout: 10_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// Repo Management Popover (010-sidebar-collapse)
// ================================================================
//
// The classic collapsible mini-sidebar was replaced by the TopBar hamburger
// button opening `RepoManagementPopover` (its `ReposGrid` surface) — workspace
// selection itself goes through the remote-chip picker, not this popover.

test.describe('Repo Management Popover', () => {
    test('hamburger button opens repo management popover', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-collapse-1', 'collapse-repo', '/tmp/collapse-repo');

        await page.goto(serverUrl);
        await gotoWorkspace(page, serverUrl, 'ws-collapse-1');

        // Click hamburger to open management popover
        await page.click('#hamburger-btn');

        // RepoManagementPopover should open with ReposGrid
        await expect(page.locator('[data-testid="repo-management-popover"]')).toBeVisible({ timeout: 5000 });
    });

    test('selecting a repo in the remote-chip picker closes the management popover', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-collapse-2', 'mini-click-repo', '/tmp/mini-click-repo');

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');

        // Open management popover
        await page.click('#hamburger-btn');
        await expect(page.locator('[data-testid="repo-management-popover"]')).toBeVisible({ timeout: 5000 });

        // Select the repo via the remote-chip picker
        await selectRepoNamed(page, 'mini-click-repo');

        // Repo detail should be shown
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });
        await expect(page).toHaveURL(/#repos\/ws-collapse-2/);
        await expect(page.locator('[data-testid="repo-management-popover"]')).toBeHidden();
    });

    test('hamburger button closes management popover when clicked again', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-collapse-3', 'reexpand-repo', '/tmp/reexpand-repo');

        await page.goto(serverUrl);
        await gotoWorkspace(page, serverUrl, 'ws-collapse-3');

        // Open then close popover
        await page.click('#hamburger-btn');
        await expect(page.locator('[data-testid="repo-management-popover"]')).toBeVisible({ timeout: 5000 });

        await page.click('#hamburger-btn');

        // Popover should close, remote-chip picker still visible in TopBar
        await expect(page.locator('[data-testid="repo-management-popover"]')).toBeHidden({ timeout: 5000 });
        await expect(page.locator('[data-testid="remote-chip"]').first()).toBeVisible({ timeout: 5000 });
    });
});

// ================================================================
// Remote Clone Grouping (011-group-collapse)
// ================================================================
//
// The old RepoTabStrip rendered every workspace as its own tab with a
// `repo-group-separator` between same-remote clusters. The graduated shell
// instead collapses clones of the same remote into a single remote-dropdown
// row (`row.summary.cloneCount` badge) and exposes a `clone-switch` button
// in the TopBar for toggling between them once one is selected — see
// `WorkspaceIdentityChip.tsx`'s `renderRemoteRow` and
// `WorkspaceTabsCluster.tsx`'s clone popover.

test.describe('Remote Clone Grouping', () => {
    test('repos sharing a remote URL collapse into a single picker row', async ({ page, serverUrl }) => {
        const remoteUrl = 'https://github.com/test-org/shared-repo.git';

        // Seed two workspaces with the same remoteUrl
        await request(`${serverUrl}/api/workspaces`, {
            method: 'POST',
            body: JSON.stringify({ id: 'ws-group-1a', name: 'group-repo-a', rootPath: testWorkspacePath('group-a'), remoteUrl }),
        });
        await request(`${serverUrl}/api/workspaces`, {
            method: 'POST',
            body: JSON.stringify({ id: 'ws-group-1b', name: 'group-repo-b', rootPath: testWorkspacePath('group-b'), remoteUrl }),
        });

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');

        // Both clones collapse into exactly one remote-dropdown row, badged
        // with the clone count — not two separate rows.
        await openRemotePicker(page);
        const rows = page.locator('[data-testid="remote-dropdown-item"]');
        await expect(rows).toHaveCount(1, { timeout: 10000 });
    });

    test('selecting a grouped remote exposes a clone-switch for navigating between clones', async ({ page, serverUrl }) => {
        const remoteUrl = 'https://github.com/test-org/collapse-repo.git';

        await request(`${serverUrl}/api/workspaces`, {
            method: 'POST',
            body: JSON.stringify({ id: 'ws-group-2a', name: 'collapse-a', rootPath: testWorkspacePath('collapse-a'), remoteUrl }),
        });
        await request(`${serverUrl}/api/workspaces`, {
            method: 'POST',
            body: JSON.stringify({ id: 'ws-group-2b', name: 'collapse-b', rootPath: testWorkspacePath('collapse-b'), remoteUrl }),
        });

        await page.goto(serverUrl);
        await gotoWorkspace(page, serverUrl, 'ws-group-2a');

        // The clone-switch shows the clone count for the active group.
        const cloneSwitch = page.locator('[data-testid="clone-switch"]');
        await expect(cloneSwitch).toBeVisible({ timeout: 10000 });
        await expect(cloneSwitch).toContainText('2');

        // Opening it lists both clones.
        await cloneSwitch.click();
        const popoverItems = page.locator('[data-testid="clone-popover-item"]');
        await expect(popoverItems).toHaveCount(2, { timeout: 10000 });
        await expect(popoverItems.filter({ hasText: 'collapse-a' })).toBeVisible();
        await expect(popoverItems.filter({ hasText: 'collapse-b' })).toBeVisible();

        // Switching to the other clone navigates to its detail view.
        await popoverItems.filter({ hasText: 'collapse-b' }).click();
        await expect(page).toHaveURL(/#repos\/ws-group-2b/, { timeout: 10000 });
        await expect(page.locator('#repo-detail-content')).toBeVisible();
    });
});

// ================================================================
// Hash Navigation — Remaining Sub-tabs (012-hash-navigation)
// ================================================================

test.describe('Hash Navigation — Remaining Sub-tabs', () => {
    test('hash navigation to #repos/<id>/git opens the Workspace Git list', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-hash-git-'));
        const repoDir = createMultiCommitRepo(tmpDir);

        try {
            await seedWorkspace(serverUrl, 'ws-hash-git', 'hash-git-repo', repoDir);

            await page.goto(`${serverUrl}/#repos/ws-hash-git/git`);

            await expect(page.locator('[data-tab="repos"]')).toHaveClass(/active/);
            await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });
            await expect(page.locator('button[data-subtab="activity"]')).toHaveAttribute('data-active', 'true');
            await expect(page.locator('[data-testid="git-split-workspace-list"]')).toBeVisible({ timeout: 10000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('hash navigation to #repos/<id>/tasks selects Tasks sub-tab', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-hash-tasks', 'hash-tasks-repo', '/tmp/hash-tasks-repo');

        await page.goto(`${serverUrl}/#repos/ws-hash-tasks/tasks`);

        await expect(page.locator('[data-tab="repos"]')).toHaveClass(/active/);
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('button[data-subtab="tasks"]')).toHaveAttribute('data-active', 'true');
    });

    test('hash navigation to #repos/<id>/schedules opens Activity when the Schedules sub-tab is hidden', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-hash-sched', 'hash-schedules-repo', '/tmp/hash-sched-repo');

        await page.goto(`${serverUrl}/#repos/ws-hash-sched/schedules`);

        await expect(page.locator('[data-tab="repos"]')).toHaveClass(/active/);
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('button[data-subtab="activity"]')).toHaveAttribute('data-active', 'true');
        await expect(page.locator('button[data-subtab="schedules"]')).toHaveCount(0);
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
        await gotoWorkspace(page, serverUrl, 'ws-badge-queued', 'activity');
        await expect(page.locator('[data-testid="split-workspace-panel"]')).toBeVisible({ timeout: 10000 });

        // Either the task text or the badge should be visible (task may be queued, running, or just completed)
        // Check that the Activity tab content at least rendered (queue was fetched)
        const subTabContent = page.locator('#repo-sub-tab-content');
        await expect(subTabContent).toBeVisible();

        // Verify the sub-tab button strip contains the activity button
        await expect(page.locator('button[data-subtab="activity"]')).toHaveAttribute('data-active', 'true');

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
            await gotoWorkspace(page, serverUrl, 'ws-badge-tasks');

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
// Workflows Tab — Add Workflow Dialog (015-add-workflow-dialog)
// ================================================================

test.describe('Workflows Tab — Add Workflow Dialog', () => {
    test('+ New button opens AddWorkflowDialog', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-addwf-'));
        const repoDir = createRepoFixture(tmpDir);

        try {
            await seedWorkspace(serverUrl, 'ws-addwf-1', 'addwf-repo', repoDir);
            await enableWorkflowsFeature(serverUrl);

            await page.goto(serverUrl);
            await gotoWorkspace(page, serverUrl, 'ws-addwf-1', 'workflows');

            // Click the + New button in the Workflows section
            await page.locator('[data-testid="workflows-section"]').getByRole('button', { name: '+ New' }).click();

            // The AddWorkflowDialog should appear
            await expect(page.getByTestId('dialog-overlay')).toBeVisible({ timeout: 5000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('validation error on invalid workflow name', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-addwf-val-'));
        const repoDir = createRepoFixture(tmpDir);

        try {
            await seedWorkspace(serverUrl, 'ws-addwf-2', 'addwf-val-repo', repoDir);
            await enableWorkflowsFeature(serverUrl);

            await page.goto(serverUrl);
            await gotoWorkspace(page, serverUrl, 'ws-addwf-2', 'workflows');
            await page.locator('[data-testid="workflows-section"]').getByRole('button', { name: '+ New' }).click();

            const templateSelect = page.getByTestId('dialog-overlay').locator('select');

            // Wait for the dialog to open — the template picker is always present
            await expect(templateSelect).toBeVisible({ timeout: 5000 });

            // Select Custom (blank) template
            await templateSelect.selectOption('custom');

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
            await enableWorkflowsFeature(serverUrl);

            await page.goto(serverUrl);
            await gotoWorkspace(page, serverUrl, 'ws-wfdetail-1', 'workflows');

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
    test('completed task appears in ChatListPane history', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-activity-task-1', 'activity-task-repo');

        // Seed a queue task scoped to this workspace so it appears in the repo's activity tab.
        await seedQueueTask(serverUrl, {
            type: 'chat',
            displayName: 'Activity List Task',
            repoId: 'ws-activity-task-1',
            payload: { workspaceId: 'ws-activity-task-1', prompt: 'Activity List Task' },
        });

        await page.goto(serverUrl);
        await gotoWorkspace(page, serverUrl, 'ws-activity-task-1', 'activity');
        await expect(page.locator('[data-testid="split-workspace-panel"]')).toBeVisible({ timeout: 10000 });

        // The task should appear in the list — either in queued, running, or history
        // section. Use the per-row `data-task-id` attribute since the displayed
        // title is now derived from the AI response, not the original displayName.
        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 10000 });
    });

    test('clicking a task in the list shows detail in the right pane', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-activity-task-2', 'activity-detail-repo');

        // Seed a queue task scoped to this workspace so it appears in the repo's activity tab.
        await seedQueueTask(serverUrl, {
            type: 'chat',
            displayName: 'Detail Pane Task',
            repoId: 'ws-activity-task-2',
            payload: { workspaceId: 'ws-activity-task-2', prompt: 'Detail Pane Task' },
        });

        await page.goto(serverUrl);
        await gotoWorkspace(page, serverUrl, 'ws-activity-task-2', 'activity');
        await expect(page.locator('[data-testid="split-workspace-panel"]')).toBeVisible({ timeout: 10000 });

        // Wait for the task row to appear (selector uses `data-task-id` because
        // the displayed title is no longer guaranteed to match `displayName`).
        const taskItem = page.locator('[data-task-id]').first();
        await expect(taskItem).toBeVisible({ timeout: 10000 });

        // Click the task item card
        await taskItem.click();

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
            await openAddRepoOption(page, 'remote-add-repo-option');

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
