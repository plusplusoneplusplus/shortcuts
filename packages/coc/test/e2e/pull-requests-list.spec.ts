import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace, request } from './fixtures/seed';
import { setupPrRoutes } from './fixtures/pr-mock';
import {
    MOCK_PR_LIST,
    MOCK_PR_OPEN,
    createMockPrList,
    createMockPullRequest,
} from './fixtures/pr-fixtures';

/** Enable the Pull Requests feature flag on the running server. */
async function enablePullRequestsFeature(serverUrl: string): Promise<void> {
    const res = await request(`${serverUrl}/api/admin/config`, {
        method: 'PUT',
        body: JSON.stringify({ 'pullRequests.enabled': true }),
    });
    if (res.status !== 200) {
        throw new Error(`Failed to enable PR feature: ${res.status} ${res.body}`);
    }
}

/**
 * Mock the `git-info` endpoints so the SPA treats the seeded workspace as a
 * real git repo (required for the Pull Requests sub-tab to render).
 */
async function mockGitInfo(page: any, wsId: string): Promise<void> {
    await page.route(
        (url: string) => new URL(url).pathname === '/api/git-info/batch',
        (route: any) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                results: { [wsId]: { isGitRepo: true, branch: 'main', dirty: false } },
            }),
        }),
    );
    await page.route(
        (url: string) => new URL(url).pathname.endsWith(`/workspaces/${wsId}/git-info`),
        (route: any) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ isGitRepo: true, branch: 'main', dirty: false }),
        }),
    );
}

/**
 * Seed a workspace for PR tests. Runs `git init` on the temp dir so the
 * server's GET /api/workspaces reports isGitRepo=true (required so the
 * Pull Requests sub-tab isn't filtered out on initial render, before the
 * mocked git-info response arrives). Mocked routes still handle the rest
 * of the git surface.
 */
async function seedPrWorkspace(
    serverUrl: string,
    id: string,
    name: string,
): Promise<{ id: string; cleanup: () => void }> {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), `e2e-pr-${id}-`));
    execSync('git init', { cwd: rootPath, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test.com" commit -m "init" --allow-empty', { cwd: rootPath, stdio: 'ignore' });
    await seedWorkspace(serverUrl, id, name, rootPath);
    return { id, cleanup: () => safeRmSync(rootPath) };
}

/** Navigate to the PR sub-tab for the first repo in the list. */
async function openPrTab(page: any, serverUrl: string, wsId: string) {
    await enablePullRequestsFeature(serverUrl);
    await mockGitInfo(page, wsId);
    await page.goto(serverUrl);
    await page.click('[data-tab="repos"]');
    await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10000 });
    await page.locator('[data-testid="repo-tab"]').first().click();
    await page.click('button[data-subtab="pull-requests"]');
}

test.describe('Pull Requests tab — list', () => {
    test('sub-tab button is visible and clickable', async ({ page, serverUrl }) => {
        const { id: repoId, cleanup } = await seedPrWorkspace(serverUrl, 'ws-1', 'My Repo');
        const routeCleanup = await setupPrRoutes(page, serverUrl, repoId);
        try {
            await enablePullRequestsFeature(serverUrl);
            await mockGitInfo(page, repoId);
            await page.goto(serverUrl);
            await page.click('[data-tab="repos"]');
            await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10000 });
            await page.locator('[data-testid="repo-tab"]').first().click();

            const prSubTab = page.locator('button[data-subtab="pull-requests"]');
            await expect(prSubTab).toBeVisible({ timeout: 10000 });
            await prSubTab.click();
        } finally {
            await routeCleanup();
            cleanup();
        }
    });

    test('renders queue header, filter pills, and PR rows with title and number', async ({
        page,
        serverUrl,
    }) => {
        const { id: repoId, cleanup } = await seedPrWorkspace(serverUrl, 'ws-2', 'My Repo');
        const routeCleanup = await setupPrRoutes(page, serverUrl, repoId, {
            pullRequests: MOCK_PR_LIST,
        });
        try {
            await openPrTab(page, serverUrl, repoId);

            // Queue chrome
            await expect(page.locator('[data-testid="pr-queue-filter-all"]')).toBeVisible({ timeout: 10000 });
            await expect(page.locator('[data-testid="pr-queue-filter-mine"]')).toBeVisible({ timeout: 10000 });
            await expect(page.locator('[data-testid="pr-queue-filter-blocked"]')).toBeVisible({ timeout: 10000 });
            await expect(page.locator('[data-testid="pr-queue-filter-ready"]')).toBeVisible({ timeout: 10000 });
            await expect(page.locator('[data-testid="pr-queue-footer"]')).toBeVisible({ timeout: 10000 });

            // Three rows rendered
            await expect(page.locator('.pr-row')).toHaveCount(3, { timeout: 10000 });

            const firstRow = page.locator('.pr-row').first();
            await expect(firstRow.locator('.pr-title')).toHaveText(MOCK_PR_LIST[0].title, { timeout: 10000 });
            await expect(firstRow.locator('.pr-number')).toContainText(`#${MOCK_PR_LIST[0].id}`, { timeout: 10000 });
            await expect(firstRow.locator('[data-testid="pr-state-dot"]')).toBeVisible({ timeout: 10000 });
            await expect(firstRow.locator('[data-testid="pr-risk-pill"]')).toBeVisible({ timeout: 10000 });
        } finally {
            await routeCleanup();
            cleanup();
        }
    });

    test('shows file count and review minutes in each row meta line', async ({ page, serverUrl }) => {
        const { id: repoId, cleanup } = await seedPrWorkspace(serverUrl, 'ws-4', 'My Repo');
        const routeCleanup = await setupPrRoutes(page, serverUrl, repoId, {
            pullRequests: MOCK_PR_LIST,
        });
        try {
            await openPrTab(page, serverUrl, repoId);

            await expect(page.locator('.pr-row')).toHaveCount(3, { timeout: 10000 });

            const rows = page.locator('.pr-row');
            const count = await rows.count();
            for (let i = 0; i < count; i++) {
                await expect(rows.nth(i).locator('.pr-meta')).toContainText(/\d+ files/, { timeout: 10000 });
                await expect(rows.nth(i).locator('.pr-meta')).toContainText(/\d+ min/, { timeout: 10000 });
            }
        } finally {
            await routeCleanup();
            cleanup();
        }
    });

    test('queue grouping renders Needs review and Ready after checks sections', async ({ page, serverUrl }) => {
        const { id: repoId, cleanup } = await seedPrWorkspace(serverUrl, 'ws-5', 'My Repo');
        const routeCleanup = await setupPrRoutes(page, serverUrl, repoId, {
            pullRequests: [
                createMockPullRequest({
                    id: 1, title: 'Needs review one', status: 'active',
                    reviewers: [{ identity: { displayName: 'R' }, vote: 'waitingForAuthor' }],
                }),
                createMockPullRequest({
                    id: 2, title: 'Ready one', status: 'active',
                    reviewers: [{ identity: { displayName: 'R' }, vote: 'approved' }],
                }),
            ],
        });
        try {
            await openPrTab(page, serverUrl, repoId);
            await expect(page.locator('[data-testid="pr-row"]')).toHaveCount(2, { timeout: 10000 });
            await expect(page.locator('[data-queue-section="needs-review"]')).toBeVisible({ timeout: 10000 });
            await expect(page.locator('[data-queue-section="ready"]')).toBeVisible({ timeout: 10000 });
        } finally {
            await routeCleanup();
            cleanup();
        }
    });

    test('search filter narrows results by title', async ({ page, serverUrl }) => {
        const { id: repoId, cleanup } = await seedPrWorkspace(serverUrl, 'ws-6', 'My Repo');
        const uniqueTitle = 'ZZZ-unique-search-term';
        const prWithUniqueTitle = createMockPullRequest({
            id: 99,
            title: uniqueTitle,
            status: 'active',
        });
        const routeCleanup = await setupPrRoutes(page, serverUrl, repoId, {
            pullRequests: [...MOCK_PR_LIST, prWithUniqueTitle],
        });
        try {
            await openPrTab(page, serverUrl, repoId);
            await expect(page.locator('[data-testid="pr-row"]')).toHaveCount(4, { timeout: 10000 });

            await page.locator('[data-testid="search-input"]').fill(uniqueTitle);

            await expect(page.locator('[data-testid="pr-row"]')).toHaveCount(1, { timeout: 10000 });
            await expect(
                page.locator('[data-testid="pr-row"]').first().locator('.pr-title'),
            ).toHaveText(uniqueTitle, { timeout: 10000 });
        } finally {
            await routeCleanup();
            cleanup();
        }
    });

    test('shows empty state when no PRs returned', async ({ page, serverUrl }) => {
        const { id: repoId, cleanup } = await seedPrWorkspace(serverUrl, 'ws-7', 'My Repo');
        const routeCleanup = await setupPrRoutes(page, serverUrl, repoId, {
            pullRequests: [],
        });
        try {
            await openPrTab(page, serverUrl, repoId);

            await expect(page.locator('.pr-empty-state')).toBeVisible({ timeout: 10000 });
            await expect(page.locator('.pr-row')).toHaveCount(0, { timeout: 10000 });
        } finally {
            await routeCleanup();
            cleanup();
        }
    });

    test('clicking a PR row shows detail in right panel while list remains visible', async ({ page, serverUrl }) => {
        const { id: repoId, cleanup } = await seedPrWorkspace(serverUrl, 'ws-8', 'My Repo');
        const routeCleanup = await setupPrRoutes(page, serverUrl, repoId, {
            pullRequests: MOCK_PR_LIST,
            prDetail: MOCK_PR_OPEN,
        });
        try {
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
        } finally {
            await routeCleanup();
            cleanup();
        }
    });

    test('uses cached data when navigating away and back (no second fetch)', async ({ page, serverUrl }) => {
        const { id: repoId, cleanup } = await seedPrWorkspace(serverUrl, 'ws-cache-1', 'My Repo');
        let fetchCount = 0;
        const prApiBase = `${serverUrl}/api/repos/${repoId}/pull-requests`;

        await page.route(`${prApiBase}?*`, (route) => {
            fetchCount++;
            route.fulfill({
                status: 200,
                json: { pullRequests: MOCK_PR_LIST, fetchedAt: Date.now() },
            });
        });
        try {
            await openPrTab(page, serverUrl, repoId);
            await expect(page.locator('.pr-row')).toHaveCount(3, { timeout: 10000 });
            expect(fetchCount).toBe(1);

            // Navigate away to a different view (standalone Processes tab removed; use Admin toggle)
            await page.click('#admin-toggle');
            await expect(page.locator('[data-testid="pr-list"]')).not.toBeVisible({ timeout: 5000 });

            // Navigate back to the PR tab (without full page reload)
            await page.click('[data-tab="repos"]');
            await page.locator('[data-testid="repo-tab"]').first().click();
            await page.click('button[data-subtab="pull-requests"]');
            await expect(page.locator('.pr-row')).toHaveCount(3, { timeout: 10000 });

            // No additional fetch — cache was used
            expect(fetchCount).toBe(1);
        } finally {
            await page.unroute(`${prApiBase}?*`);
            cleanup();
        }
    });

    test('refresh button triggers a fetch even with cached data', async ({ page, serverUrl }) => {
        const { id: repoId, cleanup } = await seedPrWorkspace(serverUrl, 'ws-cache-2', 'My Repo');
        let fetchCount = 0;
        const prApiBase = `${serverUrl}/api/repos/${repoId}/pull-requests`;

        await page.route(`${prApiBase}?*`, (route) => {
            fetchCount++;
            route.fulfill({
                status: 200,
                json: { pullRequests: MOCK_PR_LIST, fetchedAt: Date.now() },
            });
        });
        try {
            await openPrTab(page, serverUrl, repoId);
            await expect(page.locator('.pr-row')).toHaveCount(3, { timeout: 10000 });
            expect(fetchCount).toBe(1);

            // Click refresh — should bypass cache
            await page.click('[data-testid="refresh-button"]');
            await expect(page.locator('.pr-row')).toHaveCount(3, { timeout: 10000 });

            expect(fetchCount).toBe(2);
        } finally {
            await page.unroute(`${prApiBase}?*`);
            cleanup();
        }
    });
});
