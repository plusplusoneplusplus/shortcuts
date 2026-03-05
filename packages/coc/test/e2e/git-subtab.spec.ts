/**
 * Git Sub-Tab E2E Tests
 *
 * Tests the three sub-components rendered by RepoGitTab:
 *   CommitList  — commit history, expand/collapse, lazy file loading
 *   WorkingTree — staged/unstaged/untracked sections, stage/unstage/discard
 *   BranchChanges — feature-branch summary and file list
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

// ================================================================
// CommitList
// ================================================================

test.describe('Git sub-tab — CommitList', () => {
    test('displays commit history after navigating to git tab', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-git-cl-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            await navigateToGitTab(page, serverUrl, 'ws-cl-1', 'cl-repo', repoDir);

            // Wait for commit list to finish loading
            await expect(page.getByTestId('commit-list-loading')).toBeHidden({ timeout: 10_000 });

            // Should have at least 3 commit rows
            const rows = page.locator('[data-testid^="commit-row-"]');
            await expect(rows).toHaveCount(3, { timeout: 10_000 });

            // Verify commit subjects are visible (newest first)
            const listPanel = page.getByTestId('git-commit-list-panel');
            await expect(listPanel).toContainText('fix: update index');
            await expect(listPanel).toContainText('feat: add utils');
            await expect(listPanel).toContainText('feat: initial setup');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('expanding a commit row shows changed files', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-git-cl-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            await navigateToGitTab(page, serverUrl, 'ws-cl-2', 'cl-expand', repoDir);

            await expect(page.getByTestId('commit-list-loading')).toBeHidden({ timeout: 10_000 });

            // Click the first commit row (most recent: "fix: update index")
            const firstRow = page.locator('[data-testid^="commit-row-"]').first();
            const testIdAttr = await firstRow.getAttribute('data-testid');
            const shortHash = testIdAttr!.replace('commit-row-', '');

            await firstRow.click();

            // Wait for file list to load
            await expect(page.getByTestId(`commit-files-${shortHash}`)).toBeVisible({ timeout: 5_000 });
            await expect(page.getByTestId('commit-files-loading')).toBeHidden({ timeout: 5_000 });

            // Should show at least one file entry
            await expect(page.getByTestId('commit-file-list')).toBeVisible();
            await expect(page.getByTestId('commit-file-0')).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('collapsing an expanded commit row hides files', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-git-cl-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            await navigateToGitTab(page, serverUrl, 'ws-cl-3', 'cl-collapse', repoDir);

            await expect(page.getByTestId('commit-list-loading')).toBeHidden({ timeout: 10_000 });

            // Expand
            const firstRow = page.locator('[data-testid^="commit-row-"]').first();
            const testIdAttr = await firstRow.getAttribute('data-testid');
            const shortHash = testIdAttr!.replace('commit-row-', '');

            await firstRow.click();
            await expect(page.getByTestId(`commit-files-${shortHash}`)).toBeVisible({ timeout: 5_000 });

            // Collapse by clicking again
            await firstRow.click();
            await expect(page.getByTestId(`commit-files-${shortHash}`)).toBeHidden();
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// WorkingTree
// ================================================================

test.describe('Git sub-tab — WorkingTree', () => {
    // Helpers: file rows use absolute paths in data-testid. We match by prefix+text instead.
    const fileRow = (section: any, fileName: string) =>
        section.locator('[data-testid^="working-tree-file-row-"]').filter({ hasText: fileName });
    const actionBtn = (row: any, prefix: string) =>
        row.locator(`[data-testid^="${prefix}-"]`);

    test('shows staged, unstaged, and untracked changes', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-git-wt-'));
        try {
            const repoDir = createDirtyWorkingTreeRepo(tmpDir);
            await navigateToGitTab(page, serverUrl, 'ws-wt-1', 'wt-repo', repoDir);

            // Wait for working tree to load — auto-expands when changes.length > 0
            await expect(page.getByTestId('working-tree')).toBeVisible({ timeout: 10_000 });
            await expect(page.getByTestId('working-changes-content')).toBeVisible({ timeout: 10_000 });

            // Staged section should contain staged.ts
            const staged = page.getByTestId('working-tree-staged');
            await expect(staged).toBeVisible();
            await expect(fileRow(staged, 'staged.ts')).toBeVisible();

            // Unstaged section should contain index.ts
            const unstaged = page.getByTestId('working-tree-unstaged');
            await expect(unstaged).toBeVisible();
            await expect(fileRow(unstaged, 'index.ts')).toBeVisible();

            // Untracked section should contain untracked.ts (auto-expands when count > 0)
            const untracked = page.getByTestId('working-tree-untracked');
            await expect(untracked).toBeVisible();
            await expect(fileRow(untracked, 'untracked.ts')).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('stage action moves file from unstaged to staged', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-git-wt-'));
        try {
            const repoDir = createDirtyWorkingTreeRepo(tmpDir);
            await navigateToGitTab(page, serverUrl, 'ws-wt-2', 'wt-stage', repoDir);

            await expect(page.getByTestId('working-tree')).toBeVisible({ timeout: 10_000 });
            await expect(page.getByTestId('working-changes-content')).toBeVisible({ timeout: 10_000 });

            // Verify index.ts is in unstaged section
            const unstaged = page.getByTestId('working-tree-unstaged');
            const indexRow = fileRow(unstaged, 'index.ts');
            await expect(indexRow).toBeVisible();

            // Stage it (force click since buttons are hidden until hover)
            const stageBtn = actionBtn(indexRow, 'stage-btn');
            const [stageResp] = await Promise.all([
                page.waitForResponse(resp =>
                    resp.url().includes('/git/changes/stage') && resp.status() === 200,
                ),
                stageBtn.click({ force: true }),
            ]);

            // After stage, index.ts should appear in staged section
            const staged = page.getByTestId('working-tree-staged');
            await expect(fileRow(staged, 'index.ts')).toBeVisible({ timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('unstage action moves file from staged to unstaged', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-git-wt-'));
        try {
            const repoDir = createDirtyWorkingTreeRepo(tmpDir);
            await navigateToGitTab(page, serverUrl, 'ws-wt-3', 'wt-unstage', repoDir);

            await expect(page.getByTestId('working-tree')).toBeVisible({ timeout: 10_000 });
            await expect(page.getByTestId('working-changes-content')).toBeVisible({ timeout: 10_000 });

            // Verify staged.ts is in staged section
            const staged = page.getByTestId('working-tree-staged');
            const stagedRow = fileRow(staged, 'staged.ts');
            await expect(stagedRow).toBeVisible();

            // Unstage it
            const unstageBtn = actionBtn(stagedRow, 'unstage-btn');
            const [unstageResp] = await Promise.all([
                page.waitForResponse(resp =>
                    resp.url().includes('/git/changes/unstage') && resp.status() === 200,
                ),
                unstageBtn.click({ force: true }),
            ]);

            // After unstage, staged.ts should move to untracked section (it was a new file)
            const untracked = page.getByTestId('working-tree-untracked');
            await expect(fileRow(untracked, 'staged.ts')).toBeVisible({ timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('discard action removes unstaged change', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-git-wt-'));
        try {
            const repoDir = createDirtyWorkingTreeRepo(tmpDir);
            await navigateToGitTab(page, serverUrl, 'ws-wt-4', 'wt-discard', repoDir);

            await expect(page.getByTestId('working-tree')).toBeVisible({ timeout: 10_000 });
            await expect(page.getByTestId('working-changes-content')).toBeVisible({ timeout: 10_000 });

            // Verify index.ts is in unstaged section
            const unstaged = page.getByTestId('working-tree-unstaged');
            const indexRow = fileRow(unstaged, 'index.ts');
            await expect(indexRow).toBeVisible();

            // Discard it
            const discardBtn = actionBtn(indexRow, 'discard-btn');
            const [discardResp] = await Promise.all([
                page.waitForResponse(resp =>
                    resp.url().includes('/git/changes/discard') && resp.status() === 200,
                ),
                discardBtn.click({ force: true }),
            ]);

            // After discard, index.ts should no longer appear in unstaged section
            await expect(fileRow(unstaged, 'index.ts')).toBeHidden({ timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// BranchChanges
// ================================================================

test.describe('Git sub-tab — BranchChanges', () => {
    test('branch changes section appears on feature branch', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-git-bc-'));
        try {
            const repoDir = createFeatureBranchRepo(tmpDir);
            await navigateToGitTab(page, serverUrl, 'ws-bc-1', 'bc-feature', repoDir);

            // BranchChanges should be visible
            await expect(page.getByTestId('branch-changes')).toBeVisible({ timeout: 10_000 });

            // Summary should mention 2 commits ahead
            const summary = page.getByTestId('branch-changes-summary');
            await expect(summary).toContainText('2 commits ahead');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('branch changes section hidden on default branch', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-git-bc-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            await navigateToGitTab(page, serverUrl, 'ws-bc-2', 'bc-default', repoDir);

            // Wait for the commit list to load (ensures git tab is fully rendered)
            await expect(page.getByTestId('commit-list-loading')).toBeHidden({ timeout: 10_000 });

            // BranchChanges should NOT be visible (returns null on default branch)
            await expect(page.getByTestId('branch-changes')).toBeHidden();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('expanding branch changes shows changed files', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-git-bc-'));
        try {
            const repoDir = createFeatureBranchRepo(tmpDir);
            await navigateToGitTab(page, serverUrl, 'ws-bc-3', 'bc-files', repoDir);

            await expect(page.getByTestId('branch-changes')).toBeVisible({ timeout: 10_000 });

            // Click header to expand file list
            await page.getByTestId('branch-changes-header').click();
            await expect(page.getByTestId('branch-changes-files')).toBeVisible({ timeout: 5_000 });
            await expect(page.getByTestId('branch-changes-files-loading')).toBeHidden({ timeout: 5_000 });

            // Should list the two feature-branch files
            await expect(page.getByTestId('branch-file-row-src/feature.ts')).toBeVisible();
            await expect(page.getByTestId('branch-file-row-src/feature-utils.ts')).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
