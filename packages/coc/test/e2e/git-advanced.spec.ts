/**
 * Tests advanced git sub-tab interactions:
 *   Unpushed commits separator   — visual separator when unpushedCount > 0
 *   Branch file review           — open a focused file diff from BranchChanges (mock-based)
 *   CommitList keyboard nav      — ArrowUp/ArrowDown navigation
 *   Commit hover tooltip         — tooltip after 1000ms hover delay
 *   Branch large diff            — focused file review for diffs > 500 lines
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import {
    createMultiCommitRepo,
    createFeatureBranchRepo,
    createRepoWithUnpushedCommits,
    navigateToGitTab,
} from './fixtures/git-fixtures';
import { request, seedWorkspace } from './fixtures/seed';
import { gotoWorkspace } from './fixtures/remote-shell';

// ================================================================
// Unpushed commits separator
// ================================================================

test.describe('Git advanced — Unpushed commits separator', () => {
    test('unpushed separator visible when repo has unpushed commits', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-git-ups-'));
        try {
            const repoDir = createRepoWithUnpushedCommits(tmpDir);
            await navigateToGitTab(page, serverUrl, 'ws-ups-1', 'ups-repo', repoDir);

            await expect(page.getByTestId('commit-list-loading')).toBeHidden({ timeout: 10_000 });

            await expect(page.getByTestId('unpushed-separator')).toBeVisible({ timeout: 5_000 });
            await expect(page.getByTestId('unpushed-separator')).toContainText(/unpushed/i);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// Branch focused file review (mock-based)
// ================================================================

test.describe('Git advanced — Branch file review', () => {
    test('branch changes opens the focused file diff', async ({ page, serverUrl }) => {
        const wsId = 'ws-bid-1';
        await seedWorkspace(serverUrl, wsId, 'bid-repo');

        // The Git sub-tab is filtered out unless `gitInfo.isGitRepo` is true.
        // Mock the per-workspace and batch git-info endpoints so the SPA
        // renders the Git tab even though the seeded workspace isn't backed
        // by a real git repo on disk.
        await page.route(
            (url: string) => new URL(url).pathname === '/api/git-info/batch',
            (route) => route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    results: { [wsId]: { isGitRepo: true, branch: 'feature/test', dirty: false } },
                }),
            }),
        );
        await page.route(
            (url: string) => new URL(url).pathname.endsWith(`/workspaces/${wsId}/git-info`),
            (route) => route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ isGitRepo: true, branch: 'feature/test', dirty: false }),
            }),
        );

        // Mock all git API endpoints
        await page.route(
            (url: string) => new URL(url).pathname.includes(`/workspaces/${wsId}/git/commits`) &&
                !new URL(url).pathname.includes('/files'),
            (route) => route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ commits: [], unpushedCount: 0 }),
            }),
        );

        // Mock branch-range to be on a feature branch
        await page.route(
            (url: string) => {
                const p = new URL(url).pathname;
                return p.includes(`/workspaces/${wsId}/git/branch-range`) &&
                    !p.includes('/files');
            },
            (route) => route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    onDefaultBranch: false,
                    branchName: 'feature/test',
                    baseRef: 'origin/main',
                    headRef: 'HEAD',
                    commitCount: 1,
                    additions: 10,
                    deletions: 2,
                    fileCount: 1,
                    files: [{ path: 'src/app.ts', status: 'M', additions: 10, deletions: 2 }],
                    behindCount: 0,
                }),
            }),
        );

        // Mock the focused file's patch.
        await page.route(
            (url: string) => {
                const p = new URL(url).pathname;
                return p.includes(`/workspaces/${wsId}/git/branch-range/files/`) &&
                    p.endsWith('/diff');
            },
            (route) => route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    diff: [
                        'diff --git a/src/app.ts b/src/app.ts',
                        '--- a/src/app.ts',
                        '+++ b/src/app.ts',
                        '@@ -1,3 +1,3 @@',
                        ' const a = 1;',
                        '-const b = 2;',
                        '+const b = 99;',
                        ' const c = 3;',
                    ].join('\n'),
                }),
            }),
        );

        // Mock changes, skills, diff-comments
        await page.route(
            (url: string) => new URL(url).pathname.includes(`/workspaces/${wsId}/git/changes`),
            (route) => route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ changes: [] }),
            }),
        );
        await page.route(
            (url: string) => new URL(url).pathname.includes(`/workspaces/${wsId}/skills`),
            (route) => route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ skills: [] }),
            }),
        );
        await page.route(
            (url: string) => new URL(url).pathname.includes('/git/ops/latest'),
            (route) => route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(null),
            }),
        );

        await gotoWorkspace(page, serverUrl, wsId, 'git');
        await expect(page.getByTestId('split-workspace-panel')).toBeVisible();
        await expect(page.getByTestId('git-split-workspace-list')).toBeVisible();

        // BranchChanges should be visible
        await expect(page.getByTestId('branch-changes')).toBeVisible({ timeout: 10_000 });

        // Expand files
        await page.getByTestId('branch-changes-header').click();
        await expect(page.getByTestId('branch-changes-files')).toBeVisible({ timeout: 5_000 });

        await page.getByTestId('branch-file-row-src/app.ts').click();

        await expect(page.getByTestId('branch-range-review')).toBeVisible();
        await expect(page.getByTestId('git-file-review')).toBeVisible();
        await expect(page.getByTestId('file-diff-panel')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId('file-diff-header')).toContainText('app.ts');
    });
});

// ================================================================
// CommitList keyboard navigation
// ================================================================

test.describe('Git advanced — Keyboard navigation', () => {
    test('ArrowDown/ArrowUp navigates commit list', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-git-kbn-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            await navigateToGitTab(page, serverUrl, 'ws-kbn-1', 'kbn-repo', repoDir);

            await expect(page.getByTestId('commit-list-loading')).toBeHidden({ timeout: 10_000 });

            const rows = page.locator('[data-testid^="commit-row-"]');
            await expect(rows).toHaveCount(3, { timeout: 10_000 });

            // Click the first row to select it
            await rows.first().click();
            await expect(rows.first()).toHaveAttribute('aria-selected', 'true');

            // Focus the listbox and press ArrowDown
            const listbox = page.locator('[role="listbox"]');
            await listbox.press('ArrowDown');

            // Second row should now be selected
            await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');

            // Press ArrowUp to go back
            await listbox.press('ArrowUp');

            // First row should be selected again
            await expect(rows.first()).toHaveAttribute('aria-selected', 'true');
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// Commit hover tooltip
// ================================================================

test.describe('Git advanced — Commit hover tooltip', () => {
    test('hovering a commit row shows tooltip after delay', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-git-tt-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            await navigateToGitTab(page, serverUrl, 'ws-tt-1', 'tt-repo', repoDir);

            await expect(page.getByTestId('commit-list-loading')).toBeHidden({ timeout: 10_000 });

            const firstRow = page.locator('[data-testid^="commit-row-"]').first();
            await expect(firstRow).toBeVisible();

            // Hover over the first commit row
            await firstRow.hover();

            // Tooltip should appear after ~1000ms
            await expect(page.getByTestId('commit-tooltip')).toBeVisible({ timeout: 3_000 });

            // Move mouse away — tooltip should disappear
            await page.mouse.move(0, 0);
            await expect(page.getByTestId('commit-tooltip')).toBeHidden({ timeout: 2_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// Branch large diff — focused file review
// ================================================================

test.describe('Git advanced — Branch large diff', () => {
    test('large diff loads in the focused file review', async ({ page, serverUrl }) => {
        const wsId = 'ws-showall-1';
        await seedWorkspace(serverUrl, wsId, 'showall-repo');
        // This patch-only fixture exercises the Classic renderer.
        const preferences = await request(`${serverUrl}/api/preferences`, {
            method: 'PATCH',
            body: JSON.stringify({ diffEngine: 'legacy' }),
        });
        expect(preferences.status).toBe(200);
        await page.addInitScript(() => localStorage.setItem('coc-diff-engine', 'legacy'));

        // The Git sub-tab is filtered out unless `gitInfo.isGitRepo` is true.
        // Mock the per-workspace and batch git-info endpoints so the SPA
        // renders the Git tab even though the seeded workspace isn't backed
        // by a real git repo on disk.
        await page.route(
            (url: string) => new URL(url).pathname === '/api/git-info/batch',
            (route) => route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    results: { [wsId]: { isGitRepo: true, branch: 'feature/big', dirty: false } },
                }),
            }),
        );
        await page.route(
            (url: string) => new URL(url).pathname.endsWith(`/workspaces/${wsId}/git-info`),
            (route) => route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ isGitRepo: true, branch: 'feature/big', dirty: false }),
            }),
        );

        // Build a diff with > 500 lines
        const diffLines = [
            'diff --git a/src/big.ts b/src/big.ts',
            '--- a/src/big.ts',
            '+++ b/src/big.ts',
            '@@ -1,551 +1,551 @@',
        ];
        for (let i = 0; i < 550; i++) {
            diffLines.push(` const line${i} = ${i};`);
        }
        diffLines.push('-const old = true;');
        diffLines.push('+const old = false;');
        const bigDiff = diffLines.join('\n');

        // Mock endpoints
        await page.route(
            (url: string) => new URL(url).pathname.includes(`/workspaces/${wsId}/git/commits`) &&
                !new URL(url).pathname.includes('/files'),
            (route) => route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ commits: [], unpushedCount: 0 }),
            }),
        );

        await page.route(
            (url: string) => {
                const p = new URL(url).pathname;
                return p.includes(`/workspaces/${wsId}/git/branch-range`) &&
                    !p.includes('/files');
            },
            (route) => route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    onDefaultBranch: false,
                    branchName: 'feature/big',
                    baseRef: 'origin/main',
                    headRef: 'HEAD',
                    commitCount: 1,
                    additions: 550,
                    deletions: 1,
                    fileCount: 1,
                    files: [{ path: 'src/big.ts', status: 'M', additions: 550, deletions: 1 }],
                    behindCount: 0,
                }),
            }),
        );

        await page.route(
            (url: string) => {
                const p = new URL(url).pathname;
                return p.includes(`/workspaces/${wsId}/git/branch-range/files/`) &&
                    p.endsWith('/diff');
            },
            (route) => route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ diff: bigDiff }),
            }),
        );

        await page.route(
            (url: string) => new URL(url).pathname.includes(`/workspaces/${wsId}/git/changes`),
            (route) => route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ changes: [] }),
            }),
        );
        await page.route(
            (url: string) => new URL(url).pathname.includes(`/workspaces/${wsId}/skills`),
            (route) => route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ skills: [] }),
            }),
        );
        await page.route(
            (url: string) => new URL(url).pathname.includes('/git/ops/latest'),
            (route) => route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(null),
            }),
        );
        await page.route(
            (url: string) => new URL(url).pathname.includes('/diff-comments'),
            (route) => route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ comments: [] }),
            }),
        );

        await gotoWorkspace(page, serverUrl, wsId, 'git');
        await expect(page.getByTestId('split-workspace-panel')).toBeVisible();
        await expect(page.getByTestId('git-split-workspace-list')).toBeVisible();

        // BranchChanges should be visible
        await expect(page.getByTestId('branch-changes')).toBeVisible({ timeout: 10_000 });

        // Expand branch changes
        await page.getByTestId('branch-changes-header').click();
        await expect(page.getByTestId('branch-changes-files')).toBeVisible({ timeout: 5_000 });

        // Click the file — opens in right panel
        await page.getByTestId('branch-file-row-src/big.ts').click();

        await expect(page.getByTestId('branch-range-review')).toBeVisible();
        await expect(page.getByTestId('file-diff-panel')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId('file-diff-loading')).toBeHidden({ timeout: 10_000 });

        await expect(page.getByTestId('file-diff-content')).toBeVisible({ timeout: 5_000 });
    });
});

// ================================================================
// Commit context menu — Copy Row
// ================================================================

test.describe('Git advanced — Copy Row context menu item', () => {
    test('right-clicking a commit row shows Copy Row item and it copies hash, subject, and author', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-git-cr-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            await navigateToGitTab(page, serverUrl, 'ws-cr-1', 'cr-repo', repoDir);

            await expect(page.getByTestId('commit-list-loading')).toBeHidden({ timeout: 10_000 });

            // Mock clipboard to capture writeText calls without permission
            await page.evaluate(() => {
                (window as unknown as Record<string, unknown>).__clipboardContent = '';
                Object.defineProperty(navigator, 'clipboard', {
                    configurable: true,
                    value: {
                        writeText: (text: string) => {
                            (window as unknown as Record<string, unknown>).__clipboardContent = text;
                            return Promise.resolve();
                        },
                    },
                });
            });

            // Right-click the first (HEAD) commit row
            const headRow = page.locator('[data-testid^="commit-row-"]').first();
            await expect(headRow).toBeVisible({ timeout: 10_000 });
            await headRow.click({ button: 'right' });

            const menu = page.locator('[data-testid="context-menu"]');
            await expect(menu).toBeVisible({ timeout: 5_000 });

            // "Copy Row" item should be present
            await expect(menu.getByRole('menuitem', { name: /Copy Row/ })).toBeVisible();

            // Click Copy Row
            await menu.getByRole('menuitem', { name: /Copy Row/ }).click();

            // Clipboard should contain: shortHash — subject — author
            const clipboardContent = await page.evaluate(
                () => (window as unknown as Record<string, unknown>).__clipboardContent as string,
            );
            // The HEAD commit is "fix: update index" with author "test"
            expect(clipboardContent).toMatch(/^[0-9a-f]+ — fix: update index — test$/);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
