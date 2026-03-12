/**
 * Git Right-Panel E2E Tests
 *
 * Tests the right-panel diff views rendered by RepoGitTab:
 *   CommitDetail     — per-file diff when clicking a file in CommitList
 *   WorkingTreeFileDiff — diff when clicking a working-tree file
 *   BranchFileDiff   — diff when clicking a branch-change file
 *   CommitDetail     — commit info header (full-commit view)
 *   GitPanelHeader   — refresh button triggers reload
 *   Deep link        — per-file diff restored on page load from URL hash
 *   Copy hash        — feedback when copying commit hash
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import {
    createMultiCommitRepo,
    createDirtyWorkingTreeRepo,
    createFeatureBranchRepo,
    navigateToGitTab,
} from './fixtures/git-fixtures';
import { seedWorkspace } from './fixtures/seed';

// ================================================================
// CommitDetail — per-file diff
// ================================================================

test.describe('Git right-panel — CommitDetail per-file', () => {
    test('clicking a file in CommitList opens per-file CommitDetail diff', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-git-rpf-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            await navigateToGitTab(page, serverUrl, 'ws-rpf-1', 'rpf-repo', repoDir);

            await expect(page.getByTestId('commit-list-loading')).toBeHidden({ timeout: 10_000 });

            // Expand the first commit row
            const firstRow = page.locator('[data-testid^="commit-row-"]').first();
            await firstRow.click();

            const testIdAttr = await firstRow.getAttribute('data-testid');
            const shortHash = testIdAttr!.replace('commit-row-', '');
            await expect(page.getByTestId(`commit-files-${shortHash}`)).toBeVisible({ timeout: 5_000 });
            await expect(page.getByTestId('commit-files-loading')).toBeHidden({ timeout: 5_000 });

            // Click the first file entry
            await page.getByTestId('commit-file-0').click();

            // Right panel should show per-file diff
            await expect(page.getByTestId('diff-file-path')).toBeVisible({ timeout: 10_000 });
            await expect(page.getByTestId('diff-section')).toBeVisible();
            // Diff content or empty diff should appear (diff-loading should resolve)
            await expect(page.getByTestId('diff-loading')).toBeHidden({ timeout: 10_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// WorkingTreeFileDiff
// ================================================================

test.describe('Git right-panel — WorkingTreeFileDiff', () => {
    const fileRow = (section: any, fileName: string) =>
        section.locator('[data-testid^="working-tree-file-row-"]').filter({ hasText: fileName });

    test('clicking a working-tree file opens WorkingTreeFileDiff', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-git-wfd-'));
        try {
            const repoDir = createDirtyWorkingTreeRepo(tmpDir);
            await navigateToGitTab(page, serverUrl, 'ws-wfd-1', 'wfd-repo', repoDir);

            await expect(page.getByTestId('working-tree')).toBeVisible({ timeout: 10_000 });
            await expect(page.getByTestId('working-changes-content')).toBeVisible({ timeout: 10_000 });

            // Click unstaged file (index.ts)
            const unstaged = page.getByTestId('working-tree-unstaged');
            const indexRow = fileRow(unstaged, 'index.ts');
            await expect(indexRow).toBeVisible();
            await indexRow.click();

            // Right panel should show WorkingTreeFileDiff
            await expect(page.getByTestId('working-tree-file-diff')).toBeVisible({ timeout: 10_000 });
            await expect(page.getByTestId('working-tree-file-diff-header')).toBeVisible();
            // Wait for diff to load
            await expect(page.getByTestId('working-tree-file-diff-loading')).toBeHidden({ timeout: 10_000 });
            // Should show diff content (the file was modified)
            await expect(page.getByTestId('working-tree-file-diff-content')).toBeVisible({ timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// BranchFileDiff
// ================================================================

test.describe('Git right-panel — BranchFileDiff', () => {
    test('clicking a branch-change file opens BranchFileDiff', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-git-bfd-'));
        try {
            const repoDir = createFeatureBranchRepo(tmpDir);
            await navigateToGitTab(page, serverUrl, 'ws-bfd-1', 'bfd-repo', repoDir);

            await expect(page.getByTestId('branch-changes')).toBeVisible({ timeout: 10_000 });

            // Expand branch changes
            await page.getByTestId('branch-changes-header').click();
            await expect(page.getByTestId('branch-changes-files')).toBeVisible({ timeout: 5_000 });
            await expect(page.getByTestId('branch-changes-files-loading')).toBeHidden({ timeout: 5_000 });

            // Click a file row
            await page.getByTestId('branch-file-row-src/feature.ts').click();

            // Right panel should show BranchFileDiff
            await expect(page.getByTestId('branch-file-diff')).toBeVisible({ timeout: 10_000 });
            await expect(page.getByTestId('branch-file-diff-header')).toBeVisible();
            await expect(page.getByTestId('branch-file-diff-loading')).toBeHidden({ timeout: 10_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// GitPanelHeader — refresh
// ================================================================

test.describe('Git right-panel — GitPanelHeader refresh', () => {
    test('refresh button triggers commit list reload', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-git-ref-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            await navigateToGitTab(page, serverUrl, 'ws-ref-1', 'ref-repo', repoDir);

            await expect(page.getByTestId('commit-list-loading')).toBeHidden({ timeout: 10_000 });

            // Verify initial commit count
            const rows = page.locator('[data-testid^="commit-row-"]');
            await expect(rows).toHaveCount(3, { timeout: 10_000 });

            // Verify refresh button is visible
            await expect(page.getByTestId('git-refresh-btn')).toBeVisible();

            // Click refresh and wait for the commits endpoint to be called
            const [refreshResp] = await Promise.all([
                page.waitForResponse(resp =>
                    resp.url().includes('/git/commits') && resp.status() === 200,
                ),
                page.getByTestId('git-refresh-btn').click(),
            ]);

            // After refresh, commits should still be present (data unchanged)
            await expect(rows).toHaveCount(3, { timeout: 10_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// CommitDetail — commit info header (full-commit view)
// ================================================================

test.describe('Git right-panel — CommitDetail commit info header', () => {
    test('selecting a commit row shows commit info header with metadata', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-git-cih-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            await navigateToGitTab(page, serverUrl, 'ws-cih-1', 'cih-repo', repoDir);

            await expect(page.getByTestId('commit-list-loading')).toBeHidden({ timeout: 10_000 });

            // Click a commit row (selects it, triggers full-commit detail view)
            const firstRow = page.locator('[data-testid^="commit-row-"]').first();
            await firstRow.click();

            // On desktop, the auto-selected first commit should already show the header
            // but clicking explicitly ensures it. Wait for commit-detail to be visible.
            await expect(page.getByTestId('commit-detail')).toBeVisible({ timeout: 10_000 });

            // Verify commit info header metadata
            await expect(page.getByTestId('commit-info-header')).toBeVisible({ timeout: 5_000 });
            await expect(page.getByTestId('commit-info-subject')).toContainText('fix: update index');
            await expect(page.getByTestId('commit-info-author')).toContainText('test');
            await expect(page.getByTestId('commit-info-date')).toBeVisible();
            await expect(page.getByTestId('commit-info-hash')).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// CommitDetail — Copy hash button feedback
// ================================================================

test.describe('Git right-panel — Copy hash feedback', () => {
    test('copy hash button shows Copied! feedback', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-git-cph-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            await navigateToGitTab(page, serverUrl, 'ws-cph-1', 'cph-repo', repoDir);

            await expect(page.getByTestId('commit-list-loading')).toBeHidden({ timeout: 10_000 });

            // Click first commit to show detail
            await page.locator('[data-testid^="commit-row-"]').first().click();
            await expect(page.getByTestId('commit-info-header')).toBeVisible({ timeout: 5_000 });

            // Grant clipboard permission and click Copy
            await page.context().grantPermissions(['clipboard-write']);
            const copyBtn = page.getByTestId('commit-info-copy-hash');
            await expect(copyBtn).toContainText('Copy');
            await copyBtn.click();

            // Should show 'Copied!' feedback
            await expect(copyBtn).toContainText('Copied!', { timeout: 3_000 });

            // After 2s, should revert back to 'Copy'
            await expect(copyBtn).toContainText('Copy', { timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// Deep link — per-file CommitDetail on page load
// ================================================================

test.describe('Git right-panel — Deep link', () => {
    test('deep link URL resolves to per-file CommitDetail on page load', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-git-dl-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            const wsId = 'ws-dl-1';
            await seedWorkspace(serverUrl, wsId, 'dl-repo', repoDir);

            // Get the latest commit hash
            const { execSync } = require('child_process');
            const hash = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
            const filePath = 'src/index.ts';

            // Navigate directly to deep link URL
            await page.goto(
                `${serverUrl}/#repos/${wsId}/git/${hash}/${encodeURIComponent(filePath)}`,
            );

            // Per-file diff view should load directly
            await expect(page.getByTestId('diff-file-path')).toBeVisible({ timeout: 15_000 });
            await expect(page.getByTestId('diff-section')).toBeVisible();
            await expect(page.getByTestId('diff-loading')).toBeHidden({ timeout: 10_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
