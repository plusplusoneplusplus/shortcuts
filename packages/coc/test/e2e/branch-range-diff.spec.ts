/**
 * Mock-e2e coverage of BranchRangeOverview's focused GitFileReview:
 * grouped file selection, overview/read-diff transitions, deep-link restoration,
 * empty ranges, comments, full patches, server truncation, base and commit scope.
 * API interception keeps the tests independent of a real Git repository.
 */
import { test, expect, type Page } from './fixtures/server-fixture';
import { request, seedWorkspace } from './fixtures/seed';
import { gotoWorkspace } from './fixtures/remote-shell';

const DEFAULT_FILES = [
    { path: 'src/feature.ts', status: 'A', additions: 5, deletions: 0 },
    { path: 'src/feature-utils.ts', status: 'A', additions: 3, deletions: 0 },
];

const RANGE_COMMIT = {
    hash: 'a'.repeat(40),
    shortHash: 'aaaaaaa',
    subject: 'Add feature',
    author: 'Test Author',
    date: '2026-10-01T12:00:00.000Z',
    parentHashes: ['b'.repeat(40)],
};

const DEFAULT_BRANCH_RANGE = {
    onDefaultBranch: false,
    branchName: 'feature/test-branch',
    baseRef: 'origin/main',
    headRef: 'HEAD',
    commitCount: 2,
    additions: 8,
    deletions: 0,
    fileCount: 2,
    behindCount: 0,
    mergeBase: 'b'.repeat(40),
    baseSha: 'b'.repeat(40),
    headSha: RANGE_COMMIT.hash,
    commits: [
        RANGE_COMMIT,
        { ...RANGE_COMMIT, hash: 'c'.repeat(40), shortHash: 'ccccccc', subject: 'Add utilities' },
    ],
    files: DEFAULT_FILES,
};

function addedFileDiff(path: string, lines: string[]): string {
    return [
        `diff --git a/${path} b/${path}`,
        '--- /dev/null',
        `+++ b/${path}`,
        `@@ -0,0 +1,${lines.length} @@`,
        ...lines.map(line => `+${line}`),
    ].join('\n');
}

const SAMPLE_DIFF = addedFileDiff('src/feature.ts', [
    'export const feature = true;',
    '',
    'export function run() {',
    '  return feature;',
    '}',
]);
const UTILS_DIFF = addedFileDiff('src/feature-utils.ts', [
    'export function helper() {',
    '  return "utility";',
    '}',
]);
const UNPUSHED_DIFF = addedFileDiff('src/unpushed.ts', [
    'export function unpushed() {',
    '  return "not pushed yet";',
    '}',
    '',
]);

const UNPUSHED_BRANCH_RANGE = {
    ...DEFAULT_BRANCH_RANGE,
    baseRef: 'origin/feature/test-branch',
    baseMode: 'upstream',
    commitCount: 1,
    additions: 4,
    fileCount: 1,
    commits: [RANGE_COMMIT],
    files: [{ path: 'src/unpushed.ts', status: 'A', additions: 4, deletions: 0 }],
};

type MockOptions = {
    branchRange?: Partial<typeof DEFAULT_BRANCH_RANGE>;
    files?: typeof DEFAULT_FILES;
    fileDiff?: string;
    comments?: object[];
    truncated?: boolean;
    totalLines?: number;
    fullFileDiff?: string;
    upstreamRange?: typeof UNPUSHED_BRANCH_RANGE;
};

async function mockGitRoutes(page: Page, wsId: string, opts: MockOptions = {}): Promise<void> {
    const branchRange = { ...DEFAULT_BRANCH_RANGE, ...opts.branchRange };
    // The summary, not a separate file-list response, populates the review.
    const files = opts.files ?? branchRange.files;
    await page.addInitScript(() => localStorage.setItem('coc-diff-engine', 'legacy'));

    // Empty sidebar history deliberately differs from the range's commit scope.
    await page.route(
        url => url.pathname.endsWith(`/workspaces/${wsId}/git/commits`),
        route => route.fulfill({ json: { commits: [], unpushedCount: 0 } }),
    );
    await page.route(
        url => url.pathname.endsWith(`/workspaces/${wsId}/git/branch-range`),
        route => {
            const base = new URL(route.request().url()).searchParams.get('base');
            return route.fulfill({
                json: base === 'upstream' && opts.upstreamRange
                    ? opts.upstreamRange : { ...branchRange, files },
            });
        },
    );
    await page.route(
        url => url.pathname.endsWith(`/workspaces/${wsId}/git/branch-range/files`),
        route => route.fulfill({ json: { files } }),
    );
    await page.route(
        url => url.pathname.includes(`/workspaces/${wsId}/git/branch-range/files/`)
            && url.pathname.endsWith('/diff'),
        route => {
            const url = new URL(route.request().url());
            const full = url.searchParams.get('full') === 'true';
            const path = decodeURIComponent(url.pathname.split('/branch-range/files/')[1].replace(/\/diff$/, ''));
            const diff = opts.fileDiff ?? (path === 'src/feature-utils.ts' ? UTILS_DIFF
                : path === 'src/unpushed.ts' ? UNPUSHED_DIFF : SAMPLE_DIFF);
            return route.fulfill({
                json: {
                    diff: full ? opts.fullFileDiff ?? diff : diff,
                    truncated: !full && (opts.truncated ?? false),
                    totalLines: opts.totalLines,
                },
            });
        },
    );
    await page.route(
        url => url.pathname.includes(`/workspaces/${wsId}/git/changes`),
        route => route.fulfill({ json: { changes: [] } }),
    );
    await page.route(
        url => url.pathname.includes(`/workspaces/${wsId}/skills`),
        route => route.fulfill({ json: { skills: [] } }),
    );
    await page.route(
        url => url.pathname.includes('/git/ops/latest'),
        route => route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
    );
    await page.route(
        url => url.pathname.includes(`/diff-comments/${wsId}`),
        route => route.fulfill({ json: { comments: opts.comments ?? [] } }),
    );
    // Make the Git tab available for the fixture's non-Git temporary workspace.
    await page.route(
        url => url.pathname.includes('/git-info/batch'),
        route => route.fulfill({
            json: {
                results: {
                    [wsId]: {
                        isGitRepo: true, branch: 'feature/test-branch', dirty: false,
                        ahead: 2, behind: 0, remoteUrl: null,
                    },
                },
            },
        }),
    );
}

async function openBranchRangeOverview(
    page: Page, serverUrl: string, wsId: string, opts: MockOptions = {},
): Promise<void> {
    await seedWorkspace(serverUrl, wsId, `${wsId}-repo`);
    await request(`${serverUrl}/api/preferences`, {
        method: 'PATCH',
        body: JSON.stringify({
            hasSeenWelcome: true,
            onboardingProgress: { dismissed: true, hasCompletedTour: true },
            // Patch assertions intentionally exercise the Classic renderer.
            diffEngine: 'legacy',
        }),
    });
    await mockGitRoutes(page, wsId, opts);
    await gotoWorkspace(page, serverUrl, wsId, 'git');
    await expect(page.getByTestId('split-workspace-panel')).toBeVisible();
    await expect(page.getByTestId('git-split-workspace-list')).toBeVisible();
    await expect(page.getByTestId('branch-changes')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('branch-changes-header').click();
    await expect(page.getByTestId('branch-range-review')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('combobox', { name: 'Commit scope', exact: true })).toBeVisible();
}

/** Narrow review containers expose the same file navigator in a drawer. */
async function openFileNavigator(page: Page): Promise<void> {
    const navigator = page.getByRole('complementary', { name: 'Changed files', exact: true });
    if (!await navigator.isVisible()) {
        await page.getByTestId('git-file-review').getByRole('button', { name: /^Files ·/ }).click();
    }
    await expect(navigator).toBeVisible();
}

async function expectFocusedPatch(page: Page, filePath: string, content: string): Promise<void> {
    await expect(page.getByTestId('file-diff-panel')).toHaveCount(1);
    await expect(page.getByTestId('file-diff-path')).toContainText(filePath.split('/').pop()!);
    await expect(page.getByTestId('file-diff-content')).toContainText(content, { timeout: 10_000 });
    await expect(page.getByTestId('file-diff-error')).toBeHidden();
}

test.describe('BranchRangeOverview — file list', () => {
    test('shows range scope and grouped files with one focused patch', async ({ page, serverUrl }) => {
        await openBranchRangeOverview(page, serverUrl, 'ws-bro-fl-1');
        await expect(page.getByTestId('branch-commit-strip-header')).toContainText('feature/test-branch');
        const scope = page.getByRole('combobox', { name: 'Commit scope', exact: true });
        await expect(scope).toHaveValue('');
        await expect(scope).toContainText('All 2 commits');
        await expectFocusedPatch(page, 'src/feature-utils.ts', 'return "utility";');
        await openFileNavigator(page);
        const navigator = page.getByRole('complementary', { name: 'Changed files', exact: true });
        await expect(navigator.getByRole('button', { name: 'src 2 files', exact: true })).toBeVisible();
        await expect(navigator.locator('[data-file-path]')).toHaveCount(2);
        await expect(navigator.locator('[data-file-path="src/feature.ts"]')).toContainText('+5');
        await expect(navigator.locator('[data-file-path="src/feature-utils.ts"]')).toHaveAttribute('aria-current', 'true');
    });

    test('commit scope uses range commits and returning to all commits restores the range', async ({ page, serverUrl }) => {
        const wsId = 'ws-bro-scope';
        await openBranchRangeOverview(page, serverUrl, wsId);
        const commitFile = { path: 'src/commit-only.ts', status: 'A', additions: 1, deletions: 0 };
        await page.route(
            url => url.pathname.endsWith(`/workspaces/${wsId}/git/commits/${RANGE_COMMIT.hash}/files`),
            route => route.fulfill({ json: { files: [commitFile] } }),
        );
        await page.route(
            url => url.pathname.includes(`/workspaces/${wsId}/git/commits/${RANGE_COMMIT.hash}/files/`)
                && url.pathname.endsWith('/diff'),
            route => route.fulfill({
                json: { diff: addedFileDiff(commitFile.path, ['export const commitOnly = true;']) },
            }),
        );
        // Sidebar history is empty: choices must come from embedded range commits.
        const scope = page.getByRole('combobox', { name: 'Commit scope', exact: true });
        await expect(scope.locator(`option[value="${RANGE_COMMIT.hash}"]`)).toHaveText('aaaaaaa Add feature');
        await scope.selectOption(RANGE_COMMIT.hash);
        await expectFocusedPatch(page, commitFile.path, 'export const commitOnly = true;');
        await expect(page.getByTestId('file-diff-content')).not.toContainText('return "utility";');
        await scope.selectOption('');
        await expectFocusedPatch(page, 'src/feature-utils.ts', 'return "utility";');
        await openFileNavigator(page);
        await expect(page.locator('.git-review-nav [data-file-path]')).toHaveCount(2);
        await expect(page.locator('.git-review-nav [data-file-path="src/commit-only.ts"]')).toHaveCount(0);
    });
});

test.describe('BranchRangeOverview — focused file review', () => {
    test('selecting files replaces the focused patch and updates navigation boundaries', async ({ page, serverUrl }) => {
        await openBranchRangeOverview(page, serverUrl, 'ws-bro-id-1');
        const review = page.getByTestId('git-file-review');
        await expectFocusedPatch(page, 'src/feature-utils.ts', 'return "utility";');
        await expect(review.getByRole('button', { name: 'Previous file', exact: true })).toBeDisabled();
        await openFileNavigator(page);
        await review.locator('.git-review-nav [data-file-path="src/feature.ts"]').click();
        await expectFocusedPatch(page, 'src/feature.ts', 'export const feature = true;');
        await expect(page.getByTestId('file-diff-content')).not.toContainText('return "utility";');
        await expect(review.getByRole('button', { name: 'Next file', exact: true })).toBeDisabled();
        await expect(page).toHaveURL(/\/git\/branch-range\/src%2Ffeature\.ts$/);
        await review.getByRole('button', { name: 'Previous file', exact: true }).click();
        await expectFocusedPatch(page, 'src/feature-utils.ts', 'return "utility";');
        await expect(review.getByRole('button', { name: 'Next file', exact: true })).toBeEnabled();
    });

    test('Overview hides the patch and Read diff restores the selected file', async ({ page, serverUrl }) => {
        await openBranchRangeOverview(page, serverUrl, 'ws-bro-id-2', {
            branchRange: { fileCount: 1, additions: 5 },
            files: [DEFAULT_FILES[0]],
        });
        await expectFocusedPatch(page, 'src/feature.ts', 'export const feature = true;');
        const review = page.getByTestId('git-file-review');
        await review.getByRole('button', { name: 'Overview', exact: true }).click();
        await expect(review.getByRole('button', { name: 'Read diff', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(review.locator('.git-review-overview-summary')).toContainText('1 files · 1 directories');
        await expect(review.locator('.git-review-overview [data-file-path="src/feature.ts"]')).toContainText('+5');
        await expect(page.getByTestId('file-diff-panel')).toHaveCount(0);
        await review.getByRole('button', { name: 'Read diff', exact: true }).click();
        await expectFocusedPatch(page, 'src/feature.ts', 'export const feature = true;');
        await expect(review.locator('.git-review-overview')).toHaveCount(0);
    });
});

test.describe('BranchRangeOverview — open file in diff panel', () => {
    test('selecting an overview file opens its patch and survives a deep-link reload', async ({ page, serverUrl }) => {
        await openBranchRangeOverview(page, serverUrl, 'ws-bro-op-1');
        const review = page.getByTestId('git-file-review');
        await review.getByRole('button', { name: 'Overview', exact: true }).click();
        await review.locator('.git-review-overview [data-file-path="src/feature.ts"]').click();
        await expectFocusedPatch(page, 'src/feature.ts', 'export const feature = true;');
        await expect(page).toHaveURL(/\/git\/branch-range\/src%2Ffeature\.ts$/);
        await page.reload();
        await expectFocusedPatch(page, 'src/feature.ts', 'export const feature = true;');
        await openFileNavigator(page);
        await expect(review.locator('.git-review-nav [data-file-path="src/feature.ts"]'))
            .toHaveAttribute('aria-current', 'true');
        await expect(review.locator('.git-review-nav [data-file-path]')).toHaveCount(2);
    });
});

test.describe('BranchRangeOverview — empty state', () => {
    test('shows "No file changes" when the embedded summary has no files', async ({ page, serverUrl }) => {
        await openBranchRangeOverview(page, serverUrl, 'ws-bro-em-1', {
            branchRange: { fileCount: 0, additions: 0, deletions: 0 },
            files: [],
        });
        await expect(page.getByRole('main', { name: 'Focused file diff', exact: true }))
            .toHaveText('No file changes.', { timeout: 5_000 });
        await expect(page.getByTestId('file-diff-panel')).toHaveCount(0);
        await expect(page.getByTestId('git-file-review').getByRole('button', { name: 'Next file', exact: true }))
            .toBeDisabled();
        await openFileNavigator(page);
        await expect(page.locator('.git-review-nav [data-file-path]')).toHaveCount(0);
    });
});

test.describe('BranchRangeOverview — all comments panel', () => {
    test('the comments action replaces file review with the empty all-comments panel', async ({ page, serverUrl }) => {
        await openBranchRangeOverview(page, serverUrl, 'ws-bro-ac-1');
        await page.getByRole('button', { name: 'Show all branch comments', exact: true }).click();
        await expect(page.getByTestId('branch-range-all-comments')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId('branch-range-all-comments').getByTestId('empty-comments'))
            .toHaveText('No comments match the current filter.');
        await expect(page.getByTestId('branch-range-review')).toHaveCount(0);
    });

    test('the all-comments header identifies the branch', async ({ page, serverUrl }) => {
        await openBranchRangeOverview(page, serverUrl, 'ws-bro-ac-2');
        await page.getByRole('button', { name: 'Show all branch comments', exact: true }).click();
        await expect(page.getByTestId('branch-range-all-comments'))
            .toContainText('Branch Changes: feature/test-branch — All Comments', { timeout: 10_000 });
    });

    test('the comments count and all-comments panel include a fetched open comment', async ({ page, serverUrl }) => {
        const mockComment = {
            id: 'c-001',
            status: 'open',
            comment: 'Needs review.',
            selectedText: 'export const feature = true;',
            context: {
                filePath: 'src/feature.ts',
                repositoryId: 'ws-bro-ac-3',
                oldRef: 'origin/main',
                newRef: 'HEAD',
            },
            selection: { diffLineStart: 1, diffLineEnd: 1, side: 'right' },
            createdAt: '2026-10-01T12:00:00.000Z',
            updatedAt: '2026-10-01T12:00:00.000Z',
        };
        await openBranchRangeOverview(page, serverUrl, 'ws-bro-ac-3', { comments: [mockComment] });
        const commentsButton = page.getByRole('button', { name: 'Show all branch comments', exact: true });
        await expect(commentsButton).toContainText('Comments · 1', { timeout: 5_000 });
        await commentsButton.click();
        const panel = page.getByTestId('branch-range-all-comments');
        await expect(panel).toContainText('feature.ts', { timeout: 10_000 });
        await expect(panel).toContainText('Needs review.');
    });
});

test.describe('BranchRangeOverview — large patches', () => {
    function buildLargeDiff(lineCount: number): string {
        return addedFileDiff('src/big.ts', Array.from({ length: lineCount }, (_, i) => `const x${i} = ${i};`));
    }

    test('a patch beyond 200 lines is rendered in full without a preview step', async ({ page, serverUrl }) => {
        await openBranchRangeOverview(page, serverUrl, 'ws-bro-ld-1', {
            branchRange: { fileCount: 1, additions: 250 },
            files: [{ path: 'src/big.ts', status: 'A', additions: 250, deletions: 0 }],
            fileDiff: buildLargeDiff(250),
        });
        await expectFocusedPatch(page, 'src/big.ts', 'const x249 = 249;');
        await expect(page.getByTestId('file-diff-content')).toContainText('const x0 = 0;');
        await expect(page.getByTestId('diff-truncation-banner')).toHaveCount(0);
    });

    test('Load full diff requests full=true and replaces a server-truncated patch', async ({ page, serverUrl }) => {
        const fullPatch = buildLargeDiff(6000);
        await openBranchRangeOverview(page, serverUrl, 'ws-bro-ld-2', {
            branchRange: { fileCount: 1, additions: 6000 },
            files: [{ path: 'src/big.ts', status: 'A', additions: 6000, deletions: 0 }],
            fileDiff: fullPatch.split('\n').slice(0, 5000).join('\n'),
            truncated: true,
            totalLines: 6004,
            fullFileDiff: fullPatch,
        });
        await expectFocusedPatch(page, 'src/big.ts', 'const x0 = 0;');
        await expect(page.getByTestId('diff-truncation-banner')).toContainText('6,004 lines');
        await page.getByTestId('file-diff-section').focus();
        await page.keyboard.press('ControlOrMeta+f');
        await page.getByTestId('diff-find-input').fill('const x5999 = 5999;');
        await expect(page.getByTestId('diff-find-count')).toHaveText('No results');

        const fullRequest = page.waitForRequest(request => {
            const url = new URL(request.url());
            return url.pathname.includes('/branch-range/files/') && url.pathname.endsWith('/diff')
                && url.searchParams.get('full') === 'true';
        });
        await page.getByTestId('load-full-diff-btn').click();
        await fullRequest;
        await expect(page.getByTestId('diff-find-count')).toHaveText('1 of 1', { timeout: 10_000 });
        await expectFocusedPatch(page, 'src/big.ts', 'const x5999 = 5999;');
        await expect(page.getByTestId('diff-truncation-banner')).toHaveCount(0);
    });
});

test.describe('BranchRangeOverview — base mode toggle', () => {
    test('switching to unpushed refetches summary and patch with base=upstream', async ({ page, serverUrl }) => {
        const requestedBases: string[] = [];
        page.on('request', request => {
            const url = new URL(request.url());
            if (url.pathname.endsWith('/git/branch-range')) {
                requestedBases.push(url.searchParams.get('base') ?? 'default-branch');
            }
        });
        await openBranchRangeOverview(page, serverUrl, 'ws-bro-bm-1', { upstreamRange: UNPUSHED_BRANCH_RANGE });
        const baseSelect = page.getByRole('combobox', { name: 'Comparison base', exact: true });
        await expect(baseSelect).toHaveValue('default-branch');
        await expect(baseSelect.locator('option:checked')).toHaveText('vs origin/main');
        await expectFocusedPatch(page, 'src/feature-utils.ts', 'return "utility";');
        expect(requestedBases[0]).toBe('default-branch');

        const upstreamPatch = page.waitForRequest(request => {
            const url = new URL(request.url());
            return url.pathname.includes('/branch-range/files/') && url.pathname.endsWith('/diff')
                && url.searchParams.get('base') === 'upstream';
        });
        await baseSelect.selectOption('upstream');
        await upstreamPatch;
        await expect(baseSelect.locator('option:checked')).toHaveText('Unpushed · origin/feature/test-branch', { timeout: 10_000 });
        expect(requestedBases).toContain('upstream');
        await expectFocusedPatch(page, 'src/unpushed.ts', 'return "not pushed yet";');
        await expect(page).toHaveURL(/\/git\/branch-range\/src%2Funpushed\.ts$/);
        await openFileNavigator(page);
        await expect(page.locator('.git-review-nav [data-file-path="src/unpushed.ts"]')).toBeVisible();
        await expect(page.locator('.git-review-nav [data-file-path]')).toHaveCount(1);
        await expect(page.locator('.git-review-nav [data-file-path="src/feature.ts"]')).toHaveCount(0);
    });

    test('switching back to vs main restores the default-branch files and patch', async ({ page, serverUrl }) => {
        await openBranchRangeOverview(page, serverUrl, 'ws-bro-bm-2', { upstreamRange: UNPUSHED_BRANCH_RANGE });
        const baseSelect = page.getByRole('combobox', { name: 'Comparison base', exact: true });
        await baseSelect.selectOption('upstream');
        await expectFocusedPatch(page, 'src/unpushed.ts', 'return "not pushed yet";');
        await baseSelect.selectOption('default-branch');
        await expect(baseSelect.locator('option:checked')).toHaveText('vs origin/main', { timeout: 10_000 });
        await expectFocusedPatch(page, 'src/feature-utils.ts', 'return "utility";');
        await openFileNavigator(page);
        await expect(page.locator('.git-review-nav [data-file-path="src/feature.ts"]')).toBeVisible();
        await expect(page.locator('.git-review-nav [data-file-path]')).toHaveCount(2);
        await expect(page.locator('.git-review-nav [data-file-path="src/unpushed.ts"]')).toHaveCount(0);
    });
});
