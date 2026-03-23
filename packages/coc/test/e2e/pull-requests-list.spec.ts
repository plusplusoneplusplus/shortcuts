import { test, expect } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { setupPrRoutes } from './fixtures/pr-mock';
import {
    MOCK_PR_LIST,
    MOCK_PR_OPEN,
    createMockPrList,
    createMockPullRequest,
} from './fixtures/pr-fixtures';

/** Navigate to the PR sub-tab for the first repo in the list. */
async function openPrTab(page: any, serverUrl: string, repoId: string) {
    await page.goto(serverUrl);
    await page.click('[data-tab="repos"]');
    await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10000 });
    await page.locator('[data-testid="repo-tab"]').first().click();
    await page.click('button[data-subtab="pull-requests"]');
}

test.describe('Pull Requests tab — list', () => {
    test('sub-tab button is visible and clickable', async ({ page, serverUrl }) => {
        const { id: repoId } = await seedWorkspace(serverUrl, 'ws-1', 'My Repo', '/tmp/repo');
        const cleanup = await setupPrRoutes(page, serverUrl, repoId);

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10000 });
        await page.locator('[data-testid="repo-tab"]').first().click();

        const prSubTab = page.locator('button[data-subtab="pull-requests"]');
        await expect(prSubTab).toBeVisible({ timeout: 10000 });
        await prSubTab.click();

        await cleanup();
    });

    test('renders PR rows with title, number, status badge, and branches', async ({
        page,
        serverUrl,
    }) => {
        const { id: repoId } = await seedWorkspace(serverUrl, 'ws-2', 'My Repo', '/tmp/repo');
        const cleanup = await setupPrRoutes(page, serverUrl, repoId, {
            pullRequests: MOCK_PR_LIST,
        });

        await openPrTab(page, serverUrl, repoId);

        // Three rows rendered
        await expect(page.locator('.pr-row')).toHaveCount(3, { timeout: 10000 });

        const firstRow = page.locator('.pr-row').first();

        // Title
        await expect(firstRow.locator('.pr-title')).toHaveText(MOCK_PR_LIST[0].title, {
            timeout: 10000,
        });

        // PR number
        await expect(firstRow.locator('.pr-number')).toContainText(
            `#${MOCK_PR_LIST[0].id}`,
            { timeout: 10000 },
        );

        // Branch text (source → target)
        await expect(firstRow.locator('.pr-branches')).toContainText(
            MOCK_PR_LIST[0].sourceBranch,
            { timeout: 10000 },
        );
        await expect(firstRow.locator('.pr-branches')).toContainText(
            MOCK_PR_LIST[0].targetBranch,
            { timeout: 10000 },
        );

        // Status badge present
        await expect(firstRow.locator('.pr-status-badge')).toBeVisible({ timeout: 10000 });

        await cleanup();
    });

    test('shows author name in each row', async ({ page, serverUrl }) => {
        const { id: repoId } = await seedWorkspace(serverUrl, 'ws-3', 'My Repo', '/tmp/repo');
        const cleanup = await setupPrRoutes(page, serverUrl, repoId, {
            pullRequests: MOCK_PR_LIST,
        });

        await openPrTab(page, serverUrl, repoId);

        await expect(page.locator('.pr-row')).toHaveCount(3, { timeout: 10000 });

        const firstRow = page.locator('.pr-row').first();
        await expect(firstRow.locator('.pr-author')).toContainText(
            MOCK_PR_LIST[0].author!.displayName!,
            { timeout: 10000 },
        );

        await cleanup();
    });

    test('shows relative time in each row', async ({ page, serverUrl }) => {
        const { id: repoId } = await seedWorkspace(serverUrl, 'ws-4', 'My Repo', '/tmp/repo');
        const cleanup = await setupPrRoutes(page, serverUrl, repoId, {
            pullRequests: MOCK_PR_LIST,
        });

        await openPrTab(page, serverUrl, repoId);

        await expect(page.locator('.pr-row')).toHaveCount(3, { timeout: 10000 });

        // Every row should contain a timestamp string showing "Updated"
        const rows = page.locator('.pr-row');
        const count = await rows.count();
        for (let i = 0; i < count; i++) {
            await expect(rows.nth(i).locator('.pr-time')).toContainText('Updated', {
                timeout: 10000,
            });
        }

        await cleanup();
    });

    test('status filter changes visible rows', async ({ page, serverUrl }) => {
        const { id: repoId } = await seedWorkspace(serverUrl, 'ws-5', 'My Repo', '/tmp/repo');
        // MOCK_PR_LIST contains open, draft, merged — 1 merged PR
        const cleanup = await setupPrRoutes(page, serverUrl, repoId, {
            pullRequests: MOCK_PR_LIST,
        });

        await openPrTab(page, serverUrl, repoId);
        await expect(page.locator('[data-testid="pr-row"]')).toHaveCount(3, { timeout: 10000 });

        // Select "merged" from the status filter
        await page.locator('[data-testid="status-filter"]').selectOption('merged');

        await expect(page.locator('[data-testid="pr-row"]')).toHaveCount(1, { timeout: 10000 });
        await expect(
            page.locator('[data-testid="pr-row"]').first().locator('.pr-status-badge'),
        ).toContainText('Merged', { timeout: 10000 });

        await cleanup();
    });

    test('search filter narrows results by title', async ({ page, serverUrl }) => {
        const { id: repoId } = await seedWorkspace(serverUrl, 'ws-6', 'My Repo', '/tmp/repo');
        const uniqueTitle = 'ZZZ-unique-search-term';
        const prWithUniqueTitle = createMockPullRequest({
            id: 99,
            title: uniqueTitle,
            status: 'active',
        });
        const cleanup = await setupPrRoutes(page, serverUrl, repoId, {
            pullRequests: [...MOCK_PR_LIST, prWithUniqueTitle],
        });

        await openPrTab(page, serverUrl, repoId);
        await expect(page.locator('[data-testid="pr-row"]')).toHaveCount(4, { timeout: 10000 });

        await page.locator('[data-testid="search-input"]').fill(uniqueTitle);

        await expect(page.locator('[data-testid="pr-row"]')).toHaveCount(1, { timeout: 10000 });
        await expect(
            page.locator('[data-testid="pr-row"]').first().locator('.pr-title'),
        ).toHaveText(uniqueTitle, { timeout: 10000 });

        await cleanup();
    });

    test('shows empty state when no PRs returned', async ({ page, serverUrl }) => {
        const { id: repoId } = await seedWorkspace(serverUrl, 'ws-7', 'My Repo', '/tmp/repo');
        const cleanup = await setupPrRoutes(page, serverUrl, repoId, {
            pullRequests: [],
        });

        await openPrTab(page, serverUrl, repoId);

        await expect(page.locator('.pr-empty-state')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('.pr-row')).toHaveCount(0, { timeout: 10000 });

        await cleanup();
    });

    test('clicking a PR row shows detail in right panel while list remains visible', async ({ page, serverUrl }) => {
        const { id: repoId } = await seedWorkspace(serverUrl, 'ws-8', 'My Repo', '/tmp/repo');
        const cleanup = await setupPrRoutes(page, serverUrl, repoId, {
            pullRequests: MOCK_PR_LIST,
            prDetail: MOCK_PR_OPEN,
        });

        await openPrTab(page, serverUrl, repoId);
        await expect(page.locator('.pr-row')).toHaveCount(3, { timeout: 10000 });

        await page.locator('.pr-row').first().click();

        // Detail panel appears in the right panel
        await expect(
            page.locator('[data-testid="pr-detail"], .pr-detail'),
        ).toBeVisible({ timeout: 10000 });

        // List panel stays visible (split-panel layout)
        await expect(page.locator('[data-testid="pr-list-panel"]')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('.pr-row').first()).toBeVisible({ timeout: 10000 });

        await cleanup();
    });

    test('uses cached data when navigating away and back (no second fetch)', async ({ page, serverUrl }) => {
        const { id: repoId } = await seedWorkspace(serverUrl, 'ws-cache-1', 'My Repo', '/tmp/repo');
        let fetchCount = 0;
        const prApiBase = `${serverUrl}/api/repos/${repoId}/pull-requests`;

        await page.route(`${prApiBase}?*`, (route) => {
            fetchCount++;
            route.fulfill({
                status: 200,
                json: { pullRequests: MOCK_PR_LIST, fetchedAt: Date.now() },
            });
        });

        await openPrTab(page, serverUrl, repoId);
        await expect(page.locator('.pr-row')).toHaveCount(3, { timeout: 10000 });
        expect(fetchCount).toBe(1);

        // Navigate away to a different main tab
        await page.click('[data-tab="processes"]');
        await expect(page.locator('[data-testid="pr-list"]')).not.toBeVisible({ timeout: 5000 });

        // Navigate back to the PR tab (without full page reload)
        await page.click('[data-tab="repos"]');
        await page.locator('[data-testid="repo-tab"]').first().click();
        await page.click('button[data-subtab="pull-requests"]');
        await expect(page.locator('.pr-row')).toHaveCount(3, { timeout: 10000 });

        // No additional fetch — cache was used
        expect(fetchCount).toBe(1);

        await page.unroute(`${prApiBase}?*`);
    });

    test('refresh button triggers a fetch even with cached data', async ({ page, serverUrl }) => {
        const { id: repoId } = await seedWorkspace(serverUrl, 'ws-cache-2', 'My Repo', '/tmp/repo');
        let fetchCount = 0;
        const prApiBase = `${serverUrl}/api/repos/${repoId}/pull-requests`;

        await page.route(`${prApiBase}?*`, (route) => {
            fetchCount++;
            route.fulfill({
                status: 200,
                json: { pullRequests: MOCK_PR_LIST, fetchedAt: Date.now() },
            });
        });

        await openPrTab(page, serverUrl, repoId);
        await expect(page.locator('.pr-row')).toHaveCount(3, { timeout: 10000 });
        expect(fetchCount).toBe(1);

        // Click refresh — should bypass cache
        await page.click('[data-testid="refresh-button"]');
        await expect(page.locator('.pr-row')).toHaveCount(3, { timeout: 10000 });

        expect(fetchCount).toBe(2);

        await page.unroute(`${prApiBase}?*`);
    });
});
