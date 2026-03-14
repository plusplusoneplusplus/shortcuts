/**
 * Per-file diff view — hunk navigation regression tests.
 *
 * Verifies that the ▲/▼ (prev/next hunk) buttons in CommitDetail (per-file view)
 * correctly scroll between diff hunks when a file-specific diff is rendered.
 *
 * This is a mock-based test — all git API responses are intercepted via
 * page.route() so no real repository is required.
 *
 * Regression: scrollToNextHunk / scrollToPrevHunk called scrollTo() on the
 * wrong (non-scrollable) parent element inside CommitDetail.  The fix is
 * getScrollableAncestor() walking up the DOM to find the nearest element
 * with overflow:auto/scroll.
 */

import { test, expect } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';

const COMMIT_HASH = 'aabbccdd11223344556677889900aabbccdd1122';
const FILE_PATH = 'src/index.ts';

/**
 * Build a unified diff with two widely-separated change hunks so they cannot
 * both fit in a 400 px tall viewport at once.
 */
function makeMultiHunkDiff(separatorLines = 50): string {
    const separator = Array.from(
        { length: separatorLines },
        (_, i) => ` const ctx${String(i + 10).padStart(3, '0')} = ${i + 10};`,
    ).join('\n');

    return [
        'diff --git a/src/index.ts b/src/index.ts',
        'index 1111111..2222222 100644',
        '--- a/src/index.ts',
        '+++ b/src/index.ts',
        '@@ -1,6 +1,6 @@',
        ' const a = 1;',
        '-const b = 2;',
        '+const b = 99;',
        ' const c = 3;',
        ' const d = 4;',
        ' const e = 5;',
        separator,
        `@@ -${separatorLines + 10},6 +${separatorLines + 10},6 @@`,
        ` const x = ${separatorLines + 10};`,
        `-const y = ${separatorLines + 11};`,
        `+const y = 999;`,
        ` const z = ${separatorLines + 12};`,
        ` const w = ${separatorLines + 13};`,
        ` const v = ${separatorLines + 14};`,
    ].join('\n');
}

/** Register page.route() mocks for all git API endpoints needed by the per-file diff view. */
async function setupMocks(
    page: Parameters<Parameters<typeof test>[1]>[0],
    wsId: string,
    commitHash: string,
): Promise<void> {
    // Mock git commits list
    await page.route(
        (url: string) => new URL(url).pathname.includes(`/workspaces/${wsId}/git/commits`) &&
            !new URL(url).pathname.includes('/files'),
        (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    commits: [
                        {
                            hash: commitHash,
                            shortHash: commitHash.slice(0, 7),
                            subject: 'chore: multi-hunk change for nav test',
                            author: 'Test Author',
                            authorEmail: 'test@example.com',
                            date: new Date().toISOString(),
                            parentHashes: [],
                        },
                    ],
                    unpushedCount: 0,
                }),
            }),
    );

    // Mock branch-range (on default branch — suppresses BranchChanges section)
    await page.route(
        (url: string) => new URL(url).pathname.includes(`/workspaces/${wsId}/git/branch-range`),
        (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ onDefaultBranch: true, branchName: 'main' }),
            }),
    );

    // Mock the per-file diff endpoint
    await page.route(
        (url: string) => {
            const p = new URL(url).pathname;
            return (
                p.includes(`/workspaces/${wsId}/git/commits/${commitHash}/files/`) &&
                p.endsWith('/diff')
            );
        },
        (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ diff: makeMultiHunkDiff(50) }),
            }),
    );

    // Stub diff-comments so CommitDetail doesn't show comment errors
    await page.route(
        (url: string) => new URL(url).pathname.includes('/diff-comments'),
        (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ comments: [] }),
            }),
    );
}

test.describe('Per-file diff view — hunk navigation (prev/next)', () => {
    test('▼ next-hunk scrolls the commit-detail container to the second hunk', async ({
        page,
        serverUrl,
    }) => {
        const wsId = 'ws-hunk-next';
        await seedWorkspace(serverUrl, wsId, 'hunk-nav-repo');
        await setupMocks(page, wsId, COMMIT_HASH);

        // Navigate directly to the per-file diff via deep link
        await page.goto(
            `${serverUrl}/#repos/${wsId}/git/${COMMIT_HASH}/${encodeURIComponent(FILE_PATH)}`,
        );

        // Per-file header (file path bar) and diff content must appear
        await expect(page.getByTestId('diff-file-path')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId('diff-content')).toBeVisible({ timeout: 5_000 });

        // Both nav buttons must be rendered
        await expect(page.getByTestId('next-hunk-btn')).toBeVisible();
        await expect(page.getByTestId('prev-hunk-btn')).toBeVisible();

        // Use a short viewport so both hunks cannot be visible simultaneously
        await page.setViewportSize({ width: 1280, height: 400 });

        // Verify the diff is actually taller than the viewport (i.e. scrolling is required)
        // diff-section is the actual scrollable container (overflow-auto); commit-detail is overflow-hidden
        const scrollContainer = page.getByTestId('diff-section');
        const metrics = await scrollContainer.evaluate((el: HTMLElement) => ({
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
        }));
        expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

        const scrollBefore = await scrollContainer.evaluate((el: HTMLElement) => el.scrollTop);

        // Click ▼ next hunk
        await page.getByTestId('next-hunk-btn').click();
        // Wait for smooth-scroll animation to settle
        await page.waitForTimeout(700);

        const scrollAfter = await scrollContainer.evaluate((el: HTMLElement) => el.scrollTop);

        // The scroll container must have moved downward toward the second hunk
        expect(scrollAfter).toBeGreaterThan(scrollBefore);
    });

    test('▲ prev-hunk scrolls the commit-detail container back toward the first hunk', async ({
        page,
        serverUrl,
    }) => {
        const wsId = 'ws-hunk-prev';
        await seedWorkspace(serverUrl, wsId, 'hunk-nav-repo');
        await setupMocks(page, wsId, COMMIT_HASH);

        await page.goto(
            `${serverUrl}/#repos/${wsId}/git/${COMMIT_HASH}/${encodeURIComponent(FILE_PATH)}`,
        );

        await expect(page.getByTestId('diff-file-path')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId('diff-content')).toBeVisible({ timeout: 5_000 });

        await page.setViewportSize({ width: 1280, height: 400 });

        // diff-section is the actual scrollable container (overflow-auto); commit-detail is overflow-hidden
        const scrollContainer = page.getByTestId('diff-section');

        // Scroll to the very bottom so at least one hunk is above the fold
        await scrollContainer.evaluate((el: HTMLElement) => {
            el.scrollTop = el.scrollHeight;
        });
        await page.waitForTimeout(100);
        const scrollAtBottom = await scrollContainer.evaluate((el: HTMLElement) => el.scrollTop);

        // Sanity: we really are scrolled down
        expect(scrollAtBottom).toBeGreaterThan(0);

        // Click ▲ prev hunk
        await page.getByTestId('prev-hunk-btn').click();
        await page.waitForTimeout(700);

        const scrollAfterPrev = await scrollContainer.evaluate((el: HTMLElement) => el.scrollTop);

        // Must have scrolled upward from the bottom
        expect(scrollAfterPrev).toBeLessThan(scrollAtBottom);
    });
});
