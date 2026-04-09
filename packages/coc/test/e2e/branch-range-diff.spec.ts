/**
 * Branch Range Diff E2E Tests — BranchRangeOverview
 *
 * Tests the right-panel BranchRangeOverview component that renders when the
 * user clicks the Branch Changes header in the Git sub-tab:
 *   - File list rendered in lower panel (BranchAllFilesDiff)
 *   - Inline diff expand / collapse per file
 *   - "Open →" button navigates to FileDiffPanel
 *   - Empty state when no files changed
 *   - "All Comments" button reveals BranchRangeAllComments panel
 *   - Large diff truncation + Show full diff → FileDiffPanel
 *
 * All tests are mock-e2e: API routes are intercepted so no real git repo is
 * required and tests run deterministically across platforms.
 */

import { test, expect } from './fixtures/server-fixture';
import { request, seedWorkspace } from './fixtures/seed';

// ── Shared mock data ────────────────────────────────────────────────────────

const DEFAULT_FILES = [
    { path: 'src/feature.ts',       status: 'A', additions: 5, deletions: 0 },
    { path: 'src/feature-utils.ts', status: 'A', additions: 3, deletions: 0 },
];

const DEFAULT_BRANCH_RANGE = {
    onDefaultBranch: false,
    branchName:      'feature/test-branch',
    baseRef:         'origin/main',
    headRef:         'HEAD',
    commitCount:     2,
    additions:       8,
    deletions:       0,
    fileCount:       2,
    behindCount:     0,
    mergeBase:       'abc1234',
    files:           DEFAULT_FILES,
};

const SAMPLE_DIFF = [
    'diff --git a/src/feature.ts b/src/feature.ts',
    '--- /dev/null',
    '+++ b/src/feature.ts',
    '@@ -0,0 +1,5 @@',
    '+export const feature = true;',
    '+',
    '+export function run() {',
    '+  return feature;',
    '+}',
].join('\n');

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Pre-seed hasSeenWelcome so the onboarding modal does not block pointer events.
 * Must be called before page.goto().
 */
async function dismissOnboarding(serverUrl: string): Promise<void> {
    await request(`${serverUrl}/api/preferences`, {
        method: 'PATCH',
        body: JSON.stringify({
            hasSeenWelcome:      true,
            onboardingProgress:  { dismissed: true, hasCompletedTour: true },
        }),
    });
}

/**
 * Register all Playwright route intercepts needed for the git sub-tab to render
 * on a mocked feature branch.
 *
 * Pass overrides to replace the defaults for a specific test scenario.
 */
async function mockGitRoutes(
    page:   any,
    wsId:   string,
    opts:   {
        branchRange?: object;
        files?:       object[];
        fileDiff?:    string;
        comments?:    object[];
    } = {},
): Promise<void> {
    const branchRange = opts.branchRange ?? DEFAULT_BRANCH_RANGE;
    const files       = opts.files       ?? DEFAULT_FILES;
    const fileDiff    = opts.fileDiff    ?? SAMPLE_DIFF;
    const comments    = opts.comments    ?? [];

    // Git commit history
    await page.route(
        (url: string) =>
            new URL(url).pathname.includes(`/workspaces/${wsId}/git/commits`) &&
            !new URL(url).pathname.includes('/files'),
        (route: any) => route.fulfill({
            status:      200,
            contentType: 'application/json',
            body:        JSON.stringify({ commits: [], unpushedCount: 0 }),
        }),
    );

    // Branch-range summary (the response includes files[] so RepoGitTab can
    // populate branchRangeFiles without a second round-trip)
    await page.route(
        (url: string) => {
            const p = new URL(url).pathname;
            return p.includes(`/workspaces/${wsId}/git/branch-range`) && !p.includes('/files');
        },
        (route: any) => route.fulfill({
            status:      200,
            contentType: 'application/json',
            body:        JSON.stringify(branchRange),
        }),
    );

    // Branch-range file list (used by BranchChanges when it fetches separately)
    await page.route(
        (url: string) => {
            const p = new URL(url).pathname;
            return p.includes(`/workspaces/${wsId}/git/branch-range/files`) && !p.includes('/diff');
        },
        (route: any) => route.fulfill({
            status:      200,
            contentType: 'application/json',
            body:        JSON.stringify({ files }),
        }),
    );

    // Per-file inline diff (lazy-loaded when a file row is expanded)
    await page.route(
        (url: string) => {
            const p = new URL(url).pathname;
            return p.includes(`/workspaces/${wsId}/git/branch-range/files/`) && p.endsWith('/diff');
        },
        (route: any) => route.fulfill({
            status:      200,
            contentType: 'application/json',
            body:        JSON.stringify({ diff: fileDiff }),
        }),
    );

    // Working-tree changes (needed by WorkingTree component in the left panel)
    await page.route(
        (url: string) => new URL(url).pathname.includes(`/workspaces/${wsId}/git/changes`),
        (route: any) => route.fulfill({
            status:      200,
            contentType: 'application/json',
            body:        JSON.stringify({ changes: [] }),
        }),
    );

    // Skills list
    await page.route(
        (url: string) => new URL(url).pathname.includes(`/workspaces/${wsId}/skills`),
        (route: any) => route.fulfill({
            status:      200,
            contentType: 'application/json',
            body:        JSON.stringify({ skills: [] }),
        }),
    );

    // Latest git background operation
    await page.route(
        (url: string) => new URL(url).pathname.includes('/git/ops/latest'),
        (route: any) => route.fulfill({
            status:      200,
            contentType: 'application/json',
            body:        JSON.stringify(null),
        }),
    );

    // Diff-comments: used by BranchRangeOverview (comment count badge) and
    // BranchRangeAllComments (full list)
    await page.route(
        (url: string) => new URL(url).pathname.includes(`/diff-comments/${wsId}`),
        (route: any) => route.fulfill({
            status:      200,
            contentType: 'application/json',
            body:        JSON.stringify({ comments }),
        }),
    );

    // Git-info batch: ReposContext fetches this to determine isGitRepo flag.
    // Without this mock the git sub-tab would be hidden (non-git temp directory).
    await page.route(
        (url: string) => new URL(url).pathname.includes('/git-info/batch'),
        (route: any) => route.fulfill({
            status:      200,
            contentType: 'application/json',
            body:        JSON.stringify({
                results: {
                    [wsId]: {
                        isGitRepo:  true,
                        branch:     'feature/test-branch',
                        dirty:      false,
                        ahead:      2,
                        behind:     0,
                        remoteUrl:  null,
                    },
                },
            }),
        }),
    );
}

/**
 * Seed a workspace, dismiss onboarding, register mocked git routes, navigate to
 * the git sub-tab, and open BranchRangeOverview by clicking the branch-changes
 * header.
 *
 * Returns after `branch-commit-strip` is visible (BranchRangeOverview is rendered).
 */
async function openBranchRangeOverview(
    page:      any,
    serverUrl: string,
    wsId:      string,
    mockOpts:  Parameters<typeof mockGitRoutes>[2] = {},
): Promise<void> {
    await seedWorkspace(serverUrl, wsId, `${wsId}-repo`);
    await dismissOnboarding(serverUrl);
    await mockGitRoutes(page, wsId, mockOpts);

    await page.goto(serverUrl);
    await page.click('[data-tab="repos"]');
    await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10_000 });
    await page.locator('[data-testid="repo-tab"]').first().click();
    await expect(page.locator('#repo-detail-content')).toBeVisible();
    await page.click('.repo-sub-tab[data-subtab="git"]');
    await expect(page.locator('.repo-sub-tab[data-subtab="git"]')).toHaveClass(/active/);

    // Wait for the branch-changes summary to appear, then click to select overview
    await expect(page.getByTestId('branch-changes')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('branch-changes-header').click();

    // BranchRangeOverview is now in the right panel
    await expect(page.getByTestId('branch-commit-strip')).toBeVisible({ timeout: 10_000 });
}

// ================================================================
// File list rendered
// ================================================================

test.describe('BranchRangeOverview — file list', () => {
    test('shows commit strip and both file rows after clicking branch-changes header', async ({ page, serverUrl }) => {
        await openBranchRangeOverview(page, serverUrl, 'ws-bro-fl-1');

        // Upper panel: commit strip with branch label
        await expect(page.getByTestId('branch-commit-strip-header')).toBeVisible();
        await expect(page.getByTestId('branch-commit-strip-header')).toContainText('feature/test-branch');

        // Draggable divider must exist
        await expect(page.getByTestId('branch-range-overview-divider')).toBeVisible();

        // Lower panel: file list
        await expect(page.getByTestId('branch-range-overview-lower')).toBeVisible();
        await expect(page.getByTestId('branch-all-files-diff')).toBeVisible({ timeout: 5_000 });
        await expect(page.getByTestId('branch-all-file-row-src/feature.ts')).toBeVisible();
        await expect(page.getByTestId('branch-all-file-row-src/feature-utils.ts')).toBeVisible();
    });
});

// ================================================================
// Inline diff expand / collapse
// ================================================================

test.describe('BranchRangeOverview — inline diff expand/collapse', () => {
    test('clicking file toggle expands its inline diff', async ({ page, serverUrl }) => {
        const singleFile = [{ path: 'src/feature.ts', status: 'A', additions: 5, deletions: 0 }];
        await openBranchRangeOverview(page, serverUrl, 'ws-bro-id-1', {
            branchRange: { ...DEFAULT_BRANCH_RANGE, files: singleFile, fileCount: 1 },
            files:       singleFile,
        });

        await expect(page.getByTestId('branch-all-file-row-src/feature.ts')).toBeVisible({ timeout: 5_000 });

        // Expand
        await page.getByTestId('branch-all-file-toggle-src/feature.ts').click();

        // Diff container and rendered diff content appear
        await expect(page.getByTestId('branch-all-file-diff-src/feature.ts')).toBeVisible({ timeout: 5_000 });
        await expect(page.getByTestId('branch-all-file-diff-content-src/feature.ts')).toBeVisible({ timeout: 5_000 });
    });

    test('clicking file toggle again collapses the inline diff', async ({ page, serverUrl }) => {
        const singleFile = [{ path: 'src/feature.ts', status: 'A', additions: 5, deletions: 0 }];
        await openBranchRangeOverview(page, serverUrl, 'ws-bro-id-2', {
            branchRange: { ...DEFAULT_BRANCH_RANGE, files: singleFile, fileCount: 1 },
            files:       singleFile,
        });

        await expect(page.getByTestId('branch-all-file-row-src/feature.ts')).toBeVisible({ timeout: 5_000 });

        // Expand then collapse
        await page.getByTestId('branch-all-file-toggle-src/feature.ts').click();
        await expect(page.getByTestId('branch-all-file-diff-src/feature.ts')).toBeVisible({ timeout: 5_000 });

        await page.getByTestId('branch-all-file-toggle-src/feature.ts').click();
        await expect(page.getByTestId('branch-all-file-diff-src/feature.ts')).toBeHidden();
    });
});

// ================================================================
// "Open →" navigates to FileDiffPanel
// ================================================================

test.describe('BranchRangeOverview — Open file in diff panel', () => {
    test('clicking Open → switches right panel to FileDiffPanel', async ({ page, serverUrl }) => {
        const singleFile = [{ path: 'src/feature.ts', status: 'A', additions: 5, deletions: 0 }];
        await openBranchRangeOverview(page, serverUrl, 'ws-bro-op-1', {
            branchRange: { ...DEFAULT_BRANCH_RANGE, files: singleFile, fileCount: 1 },
            files:       singleFile,
        });

        await expect(page.getByTestId('branch-all-file-row-src/feature.ts')).toBeVisible({ timeout: 5_000 });

        // Click the "Open →" link for the file
        await page.getByTestId('branch-all-file-open-src/feature.ts').click();

        // Right panel now shows FileDiffPanel
        await expect(page.getByTestId('file-diff-panel')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId('file-diff-header')).toBeVisible();
        await expect(page.getByTestId('file-diff-loading')).toBeHidden({ timeout: 10_000 });
    });
});

// ================================================================
// Empty state — no changed files
// ================================================================

test.describe('BranchRangeOverview — empty state', () => {
    test('shows "No file changes" message when branch has no changed files', async ({ page, serverUrl }) => {
        await openBranchRangeOverview(page, serverUrl, 'ws-bro-em-1', {
            branchRange: { ...DEFAULT_BRANCH_RANGE, files: [], fileCount: 0 },
            files:       [],
        });

        // BranchAllFilesDiff renders empty state instead of a file list
        await expect(page.getByTestId('branch-all-files-empty')).toBeVisible({ timeout: 5_000 });
        await expect(page.getByTestId('branch-all-files-empty')).toContainText('No file changes in range');
        await expect(page.getByTestId('branch-all-files-diff')).toHaveCount(0);
    });
});

// ================================================================
// All-comments panel (BranchRangeAllComments)
// ================================================================

test.describe('BranchRangeOverview — all comments panel', () => {
    test('clicking all-comments button switches right panel to BranchRangeAllComments', async ({ page, serverUrl }) => {
        await openBranchRangeOverview(page, serverUrl, 'ws-bro-ac-1', { comments: [] });

        // Click the "Show all branch comments" button inside BranchCommitStrip
        await page.getByTestId('branch-range-all-comments-btn').click();

        // Right panel switches from BranchRangeOverview to BranchRangeAllComments
        await expect(page.getByTestId('branch-range-all-comments-loading')).toBeHidden({ timeout: 10_000 });
        await expect(page.getByTestId('branch-range-all-comments')).toBeVisible({ timeout: 10_000 });
    });

    test('BranchRangeAllComments header shows branch label', async ({ page, serverUrl }) => {
        await openBranchRangeOverview(page, serverUrl, 'ws-bro-ac-2', { comments: [] });

        await page.getByTestId('branch-range-all-comments-btn').click();

        await expect(page.getByTestId('branch-range-all-comments')).toBeVisible({ timeout: 10_000 });
        // The panel header identifies the branch
        await expect(page.getByTestId('branch-range-all-comments'))
            .toContainText('feature/test-branch');
    });

    test('BranchRangeAllComments renders a fetched open comment', async ({ page, serverUrl }) => {
        const mockComment = {
            id:           'c-001',
            status:       'open',
            comment:      'Needs review.',
            selectedText: 'export const feature = true;',
            context: {
                filePath:    'src/feature.ts',
                workspaceId: 'ws-bro-ac-3',
                oldRef:      'origin/main',
                newRef:      'HEAD',
            },
            selection: { diffLineStart: 1, diffLineEnd: 1, side: 'right' },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        await openBranchRangeOverview(page, serverUrl, 'ws-bro-ac-3', {
            comments: [mockComment],
        });

        await page.getByTestId('branch-range-all-comments-btn').click();
        await expect(page.getByTestId('branch-range-all-comments')).toBeVisible({ timeout: 10_000 });

        // CommentSidebar shows the file's basename (path may be truncated in the UI)
        await expect(page.getByTestId('branch-range-all-comments')).toContainText('feature.ts');
    });
});

// ================================================================
// Large diff truncation
// ================================================================

test.describe('BranchRangeOverview — large diff truncation', () => {
    /** Build a unified diff that exceeds the 200-line display limit. */
    function buildLargeDiff(lineCount: number): string {
        const header = [
            'diff --git a/src/big.ts b/src/big.ts',
            '--- /dev/null',
            '+++ b/src/big.ts',
            `@@ -0,0 +1,${lineCount} @@`,
        ];
        const body = Array.from({ length: lineCount }, (_, i) => `+const x${i} = ${i};`);
        return [...header, ...body].join('\n');
    }

    test('diff with more than 200 lines shows "Show full diff" link', async ({ page, serverUrl }) => {
        const bigFile = [{ path: 'src/big.ts', status: 'A', additions: 250, deletions: 0 }];
        await openBranchRangeOverview(page, serverUrl, 'ws-bro-ld-1', {
            branchRange: { ...DEFAULT_BRANCH_RANGE, files: bigFile, fileCount: 1 },
            files:       bigFile,
            fileDiff:    buildLargeDiff(250),
        });

        await expect(page.getByTestId('branch-all-file-row-src/big.ts')).toBeVisible({ timeout: 5_000 });

        // Expand the file to trigger lazy diff load
        await page.getByTestId('branch-all-file-toggle-src/big.ts').click();
        await expect(page.getByTestId('branch-all-file-diff-src/big.ts')).toBeVisible({ timeout: 5_000 });

        // Truncation link should appear (diff > 200 lines)
        await expect(page.getByTestId('branch-all-file-show-full-src/big.ts')).toBeVisible({ timeout: 5_000 });
        await expect(page.getByTestId('branch-all-file-show-full-src/big.ts'))
            .toContainText('Show full diff');
    });

    test('clicking "Show full diff" opens FileDiffPanel', async ({ page, serverUrl }) => {
        const bigFile = [{ path: 'src/big.ts', status: 'A', additions: 250, deletions: 0 }];
        await openBranchRangeOverview(page, serverUrl, 'ws-bro-ld-2', {
            branchRange: { ...DEFAULT_BRANCH_RANGE, files: bigFile, fileCount: 1 },
            files:       bigFile,
            fileDiff:    buildLargeDiff(250),
        });

        await expect(page.getByTestId('branch-all-file-row-src/big.ts')).toBeVisible({ timeout: 5_000 });

        await page.getByTestId('branch-all-file-toggle-src/big.ts').click();
        await expect(page.getByTestId('branch-all-file-show-full-src/big.ts')).toBeVisible({ timeout: 5_000 });

        // "Show full diff" routes via onFileSelect → FileDiffPanel
        await page.getByTestId('branch-all-file-show-full-src/big.ts').click();
        await expect(page.getByTestId('file-diff-panel')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId('file-diff-loading')).toBeHidden({ timeout: 10_000 });
    });
});
