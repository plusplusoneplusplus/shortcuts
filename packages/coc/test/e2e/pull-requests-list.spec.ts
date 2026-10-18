import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace, request } from './fixtures/seed';
import { setupPrRoutes } from './fixtures/pr-mock';
import { resolveCanonicalOriginId } from '@plusplusoneplusplus/forge';
import { gotoWorkspace } from './fixtures/remote-shell';
import { expandPrPanel, openPrPanel, prPanelHash } from './fixtures/pr-navigation';
import {
    MOCK_PR_LIST,
    MOCK_PR_LIST_WITH_DIFF_STATS,
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
 * real git repo for the owner-specific Pull Requests resource.
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
 * server's GET /api/workspaces reports isGitRepo=true before the mocked
 * git-info response arrives. Mocked routes handle the rest of the git surface.
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

/** Navigate to a workspace and open its PR resource from the panel menu. */
async function openPrTab(page: any, serverUrl: string, wsId: string) {
    await enablePullRequestsFeature(serverUrl);
    await mockGitInfo(page, wsId);
    await gotoWorkspace(page, serverUrl, wsId);
    await openPrPanel(page);
}

/**
 * Returns the fixture PRs in the order the list renders them: newest created
 * first. Every `createMockPullRequest` shares the same `createdAt`, so for the
 * fixture lists the tie-break (PR number descending) decides — the
 * highest-numbered PR lands in row 0.
 */
function inDisplayOrder<T extends { id: number; number?: number }>(prs: readonly T[]): T[] {
    return [...prs].sort((a, b) => (b.number ?? b.id) - (a.number ?? a.id));
}

async function expectRosterEntryPersisted(
    serverUrl: string,
    repoId: string,
    expected: { id: string; displayName: string },
): Promise<void> {
    const originId = resolveCanonicalOriginId({ workspaceId: repoId });
    const params = new URLSearchParams({ workspaceId: repoId, repoId });
    const res = await request(`${serverUrl}/api/origins/${encodeURIComponent(originId)}/pull-requests/coworker-roster?${params.toString()}`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.entries).toEqual(expect.arrayContaining([
        expect.objectContaining(expected),
    ]));
}

async function searchAndSelectCoworker(page: any, query: string, displayName: string): Promise<void> {
    const picker = page.locator('[data-testid="team-coworker-picker"]');
    await expect(picker).toHaveAttribute('role', 'combobox', { timeout: 10000 });
    await picker.fill(query);
    const option = page.locator('[data-testid="team-coworker-option"]').filter({ hasText: displayName });
    await expect(option).toBeVisible({ timeout: 10000 });
    await option.click();
    await expect(page.locator('[data-testid="team-coworker-search-status"]')).toContainText(`Selected ${displayName}`, { timeout: 10000 });
}

async function runTeamFilterProviderDemo(
    page: any,
    serverUrl: string,
    scenario: {
        repoId: string;
        teammateId: string | number;
        teammateDisplayName: string;
        teammateTitle: string;
        otherId: string | number;
        otherDisplayName: string;
        otherTitle: string;
    },
): Promise<void> {
    const { id: repoId, cleanup } = await seedPrWorkspace(serverUrl, scenario.repoId, 'My Repo');
    const routeCleanup = await setupPrRoutes(page, serverUrl, repoId, {
        pullRequests: [
            createMockPullRequest({
                id: 1,
                number: 1,
                title: scenario.teammateTitle,
                author: {
                    id: scenario.teammateId,
                    displayName: scenario.teammateDisplayName,
                    email: `${String(scenario.repoId).replace(/[^a-z0-9-]/gi, '-')}@example.invalid`,
                },
            }),
            createMockPullRequest({
                id: 2,
                number: 2,
                title: scenario.otherTitle,
                author: {
                    id: scenario.otherId,
                    displayName: scenario.otherDisplayName,
                },
            }),
        ],
    });

    try {
        await openPrTab(page, serverUrl, repoId);
        await expect(page.locator('[data-testid="pr-row"]')).toHaveCount(2, { timeout: 10000 });

        const teamFilter = page.locator('[data-testid="pr-queue-filter-team"]');
        await expect(teamFilter).toContainText('0', { timeout: 10000 });
        await teamFilter.click();

        await expect(page.locator('[data-testid="team-roster-toolbar"]')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('[data-testid="team-roster-empty"]')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('[data-testid="pr-row"]')).toHaveCount(0, { timeout: 10000 });

        await expect(page.locator('[data-testid="team-coworker-search-status"]')).toContainText('Search repo PR authors', { timeout: 10000 });
        await searchAndSelectCoworker(page, 'Team', scenario.teammateDisplayName);
        await page.locator('[data-testid="team-coworker-add"]').click();

        await expect(page.locator('[data-testid="team-coworker-chip"]')).toContainText(scenario.teammateDisplayName, { timeout: 10000 });
        await expect(teamFilter).toContainText('1', { timeout: 10000 });
        await expect(page.locator('[data-testid="pr-row"]')).toHaveCount(1, { timeout: 10000 });
        await expect(page.locator('[data-testid="pr-row"]').first().locator('.pr-title')).toHaveText(scenario.teammateTitle, { timeout: 10000 });
        await expect(page.getByText(scenario.otherTitle)).toHaveCount(0);

        await expectRosterEntryPersisted(serverUrl, repoId, {
            id: String(scenario.teammateId),
            displayName: scenario.teammateDisplayName,
        });
    } finally {
        await routeCleanup();
        cleanup();
    }
}

/** PR panel entry, queue interactions, split layout, and keep-alive regression coverage. */
test.describe('Pull Requests panel — list', () => {
    test('resource menu opens the owner-specific Pull Requests tab', async ({ page, serverUrl }) => {
        const { id: repoId, cleanup } = await seedPrWorkspace(serverUrl, 'ws-1', 'My Repo');
        const routeCleanup = await setupPrRoutes(page, serverUrl, repoId);
        try {
            await enablePullRequestsFeature(serverUrl);
            await mockGitInfo(page, repoId);
            await gotoWorkspace(page, serverUrl, repoId);
            const workspaceUrl = page.url();

            await openPrPanel(page);
            await expect(page.getByTestId('pr-list')).toBeVisible({ timeout: 10000 });
            const tab = page.locator('[role="tab"][data-kind="pull-requests"]');
            await expect(tab).toHaveCount(1);
            await expect(tab).toHaveAttribute('aria-selected', 'true');
            // Opening a resource must not navigate away from the current chat view.
            await expect(page).toHaveURL(workspaceUrl);
            await expect(page.getByTestId('pr-row')).toHaveCount(MOCK_PR_LIST.length);
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
            // PrQueueFooter was removed — verify it's absent
            await expect(page.locator('[data-testid="pr-queue-footer"]')).toHaveCount(0);

            // Three rows rendered
            await expect(page.locator('.pr-row')).toHaveCount(3, { timeout: 10000 });

            const expected = inDisplayOrder(MOCK_PR_LIST);
            const firstRow = page.locator('.pr-row').first();
            await expect(firstRow.locator('.pr-title')).toHaveText(expected[0].title, { timeout: 10000 });
            await expect(firstRow.locator('.pr-number')).toContainText(`#${expected[0].id}`, { timeout: 10000 });
            await expect(firstRow.locator('[data-testid="pr-state-dot"]')).toBeVisible({ timeout: 10000 });
            await expect(firstRow.locator('[data-testid="pr-risk-pill"]')).toBeVisible({ timeout: 10000 });
        } finally {
            await routeCleanup();
            cleanup();
        }
    });

    test('Load more appends the next PR page and keeps title search working', async ({ page, serverUrl }) => {
        const { id: repoId, cleanup } = await seedPrWorkspace(serverUrl, 'ws-load-more', 'My Repo');
        const routeCleanup = await setupPrRoutes(page, serverUrl, repoId, {
            pullRequests: createMockPrList(30),
        });
        try {
            await openPrTab(page, serverUrl, repoId);

            await expect(page.locator('[data-testid="pr-row"]')).toHaveCount(25, { timeout: 10000 });
            await expect(page.locator('[data-testid="load-more"]')).toBeVisible({ timeout: 10000 });

            await page.locator('[data-testid="load-more"]').click();

            await expect(page.locator('[data-testid="pr-row"]')).toHaveCount(30, { timeout: 10000 });
            await expect(page.locator('[data-testid="load-more"]')).toHaveCount(0);

            await page.locator('[data-testid="search-input"]').fill('number 30');
            await expect(page.locator('[data-testid="pr-row"]')).toHaveCount(1, { timeout: 10000 });
            await expect(page.locator('[data-testid="pr-row"]').first().locator('.pr-title')).toHaveText('feat: pull request number 30', { timeout: 10000 });
        } finally {
            await routeCleanup();
            cleanup();
        }
    });

    test('shows file count in each row meta line', async ({ page, serverUrl }) => {
        const { id: repoId, cleanup } = await seedPrWorkspace(serverUrl, 'ws-4', 'My Repo');
        const routeCleanup = await setupPrRoutes(page, serverUrl, repoId, {
            pullRequests: MOCK_PR_LIST_WITH_DIFF_STATS,
        });
        try {
            await openPrTab(page, serverUrl, repoId);

            await expect(page.locator('.pr-row')).toHaveCount(3, { timeout: 10000 });

            const rows = page.locator('.pr-row');
            const expected = inDisplayOrder(MOCK_PR_LIST_WITH_DIFF_STATS);
            for (let i = 0; i < expected.length; i++) {
                const changed = expected[i].diffStats!.changedFiles;
                await expect(rows.nth(i).locator('.pr-meta')).toContainText(
                    `${changed} file${changed === 1 ? '' : 's'}`,
                    { timeout: 10000 },
                );
            }
            // Review-minutes estimate was removed from the row meta line.
            await expect(rows.nth(0).locator('.pr-meta')).not.toContainText(/\d+ min/, { timeout: 10000 });
        } finally {
            await routeCleanup();
            cleanup();
        }
    });

    test('orders rows by created time, newest first', async ({ page, serverUrl }) => {
        const { id: repoId, cleanup } = await seedPrWorkspace(serverUrl, 'ws-created-order', 'My Repo');
        // Deliberately unsorted, with creation times that disagree with the PR numbers.
        const routeCleanup = await setupPrRoutes(page, serverUrl, repoId, {
            pullRequests: [
                createMockPullRequest({ id: 1, number: 1, title: 'oldest pull request', createdAt: '2024-01-01T00:00:00.000Z' }),
                createMockPullRequest({ id: 2, number: 2, title: 'newest pull request', createdAt: '2024-06-01T00:00:00.000Z' }),
                createMockPullRequest({ id: 3, number: 3, title: 'middle pull request', createdAt: '2024-03-01T00:00:00.000Z' }),
            ],
        });
        try {
            await openPrTab(page, serverUrl, repoId);
            await expect(page.locator('[data-testid="pr-row"]')).toHaveCount(3, { timeout: 10000 });
            await expect(page.locator('[data-testid="pr-row"] .pr-title')).toHaveText(
                ['newest pull request', 'middle pull request', 'oldest pull request'],
                { timeout: 10000 },
            );
        } finally {
            await routeCleanup();
            cleanup();
        }
    });

    test('list renders flat with no attention section headers', async ({ page, serverUrl }) => {
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
            await expect(page.locator('[data-testid="pr-queue-group"]')).toHaveCount(0);
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

    test('expanding the panel shows PR detail alongside the list', async ({ page, serverUrl }) => {
        const { id: repoId, cleanup } = await seedPrWorkspace(serverUrl, 'ws-8', 'My Repo');
        const routeCleanup = await setupPrRoutes(page, serverUrl, repoId, {
            pullRequests: MOCK_PR_LIST,
            prDetail: MOCK_PR_LIST[2],
        });
        try {
            await openPrTab(page, serverUrl, repoId);
            await expandPrPanel(page);
            await expect(page.locator('.pr-row')).toHaveCount(3, { timeout: 10000 });

            await page.locator('.pr-row').first().click();

            // Detail panel appears in the right panel
            await expect(
                page.locator('[data-testid="pr-detail"], .pr-detail'),
            ).toBeVisible({ timeout: 10000 });
            await expect(page.getByTestId('pr-title')).toHaveText(MOCK_PR_LIST[2].title);
            await expect(page).toHaveURL(`${serverUrl}/${prPanelHash(repoId, '3/overview')}`);

            // List panel stays visible (split-panel layout)
            await expect(page.locator('[data-testid="pr-list-panel"]')).toBeVisible({ timeout: 10000 });
            await expect(page.locator('.pr-row').first()).toBeVisible({ timeout: 10000 });
        } finally {
            await routeCleanup();
            cleanup();
        }
    });

    test('closing and reopening the PR tab preserves search and selection without refetching', async ({ page, serverUrl }) => {
        const { id: repoId, cleanup } = await seedPrWorkspace(serverUrl, 'ws-cache-1', 'My Repo');
        let fetchCount = 0;
        const prListPattern = (url: string) => {
            const parsed = new URL(url);
            return parsed.pathname.startsWith('/api/origins/') && parsed.pathname.endsWith('/pull-requests');
        };

        const routeCleanup = await setupPrRoutes(page, serverUrl, repoId, {
            pullRequests: [MOCK_PR_OPEN, ...MOCK_PR_LIST],
        });
        await page.route(prListPattern, (route) => {
            fetchCount++;
            route.fulfill({
                status: 200,
                json: { pullRequests: [MOCK_PR_OPEN, ...MOCK_PR_LIST], fetchedAt: Date.now() },
            });
        });
        try {
            await openPrTab(page, serverUrl, repoId);
            await expect(page.locator('.pr-row')).toHaveCount(4, { timeout: 10000 });
            expect(fetchCount).toBe(1);

            await page.getByTestId('search-input').fill(MOCK_PR_OPEN.title);
            await expect(page.getByTestId('pr-row')).toHaveCount(1, { timeout: 10000 });
            await page.getByTestId('pr-row').click();
            await expect(page.getByTestId('pr-title')).toHaveText(MOCK_PR_OPEN.title, { timeout: 10000 });
            const tab = page.locator('[role="tab"][data-kind="pull-requests"]');
            await tab.getByRole('button', { name: 'Close Pull Requests', exact: true }).click();
            await expect(tab).toHaveCount(0);
            // A closed work resource stays mounted, but hidden.
            await expect(page.getByTestId('pr-detail')).toBeAttached();
            await expect(page.getByTestId('pr-detail')).toBeHidden();

            await openPrPanel(page);
            await expect(page.getByTestId('pr-title')).toHaveText(MOCK_PR_OPEN.title, { timeout: 10000 });
            await expect(page.getByTestId('pr-detail')).toBeVisible();
            await page.getByTestId('back-button').click();
            await expect(page.getByTestId('search-input')).toHaveValue(MOCK_PR_OPEN.title);
            await expect(page.getByTestId('pr-row')).toHaveCount(1, { timeout: 10000 });
            await expect(page.getByTestId('pr-row')).toContainText(MOCK_PR_OPEN.title);
            expect(fetchCount).toBe(1);
        } finally {
            await page.unroute(prListPattern);
            await routeCleanup();
            cleanup();
        }
    });

    test('refresh button triggers a fetch even with cached data', async ({ page, serverUrl }) => {
        const { id: repoId, cleanup } = await seedPrWorkspace(serverUrl, 'ws-cache-2', 'My Repo');
        let fetchCount = 0;
        const prListPattern = (url: string) => {
            const parsed = new URL(url);
            return parsed.pathname.startsWith('/api/origins/') && parsed.pathname.endsWith('/pull-requests');
        };

        await page.route(prListPattern, (route) => {
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

            await expect.poll(() => fetchCount).toBe(2);
        } finally {
            await page.unroute(prListPattern);
            cleanup();
        }
    });

    test('Team filter add flow works with GitHub numeric author ids', async ({ page, serverUrl }) => {
        await runTeamFilterProviderDemo(page, serverUrl, {
            repoId: 'ws-team-github',
            teammateId: 123456789,
            teammateDisplayName: 'GitHub Teammate',
            teammateTitle: 'GitHub teammate PR',
            otherId: 987654321,
            otherDisplayName: 'GitHub Other',
            otherTitle: 'GitHub other PR',
        });
    });

    test('Team filter add flow works with Azure DevOps GUID author ids', async ({ page, serverUrl }) => {
        await runTeamFilterProviderDemo(page, serverUrl, {
            repoId: 'ws-team-ado',
            teammateId: '3f4d2f1a-7b7a-4b58-9a3d-8a8f4a5e2b6c',
            teammateDisplayName: 'ADO Teammate',
            teammateTitle: 'ADO teammate PR',
            otherId: '8d7d43ed-343e-4f23-bf2f-7ec9cf391ccb',
            otherDisplayName: 'ADO Other',
            otherTitle: 'ADO other PR',
        });
    });

    test('Team coworker picker adds API candidates that are not in loaded PR rows', async ({ page, serverUrl }) => {
        const { id: repoId, cleanup } = await seedPrWorkspace(serverUrl, 'ws-team-api-candidate', 'My Repo');
        const routeCleanup = await setupPrRoutes(page, serverUrl, repoId, {
            pullRequests: [
                createMockPullRequest({
                    id: 1,
                    number: 1,
                    title: 'Loaded author PR',
                    author: { id: 'loaded-author', displayName: 'Loaded Author' },
                }),
            ],
            coworkerCandidates: [
                {
                    id: 'remote-author',
                    displayName: 'Remote Candidate',
                    email: 'remote@example.invalid',
                    prCount: 7,
                },
            ],
        });
        try {
            await openPrTab(page, serverUrl, repoId);
            await expect(page.locator('[data-testid="pr-row"]')).toHaveCount(1, { timeout: 10000 });

            const teamFilter = page.locator('[data-testid="pr-queue-filter-team"]');
            await teamFilter.click();
            await expect(page.locator('[data-testid="team-roster-empty"]')).toContainText('Search repo PR authors', { timeout: 10000 });

            await searchAndSelectCoworker(page, 'Remote', 'Remote Candidate');
            await page.locator('[data-testid="team-coworker-add"]').click();

            await expect(page.locator('[data-testid="team-coworker-chip"]')).toContainText('Remote Candidate', { timeout: 10000 });
            await expect(page.locator('[data-testid="pr-row"]')).toHaveCount(0, { timeout: 10000 });
            await expectRosterEntryPersisted(serverUrl, repoId, {
                id: 'remote-author',
                displayName: 'Remote Candidate',
            });
        } finally {
            await routeCleanup();
            cleanup();
        }
    });

    test('Team coworker picker shows minimum-length and no-results states', async ({ page, serverUrl }) => {
        const { id: repoId, cleanup } = await seedPrWorkspace(serverUrl, 'ws-team-no-results', 'My Repo');
        let releaseCandidateSearch!: () => void;
        const candidateSearchResponseGate = new Promise<void>(resolve => {
            releaseCandidateSearch = resolve;
        });
        const routeCleanup = await setupPrRoutes(page, serverUrl, repoId, {
            pullRequests: MOCK_PR_LIST,
            coworkerCandidates: [],
            coworkerCandidateResponseGate: candidateSearchResponseGate,
        });
        try {
            await openPrTab(page, serverUrl, repoId);
            await page.locator('[data-testid="pr-queue-filter-team"]').click();

            const picker = page.locator('[data-testid="team-coworker-picker"]');
            await picker.fill('z');
            await expect(page.locator('[data-testid="team-coworker-search-status"]')).toContainText('Type at least 2 characters', { timeout: 10000 });
            await expect(page.locator('[data-testid="team-coworker-add"]')).toBeDisabled({ timeout: 10000 });

            await picker.fill('zz');
            await expect(page.locator('[data-testid="team-coworker-search-status"]')).toContainText('Searching repo PR authors', { timeout: 10000 });
            releaseCandidateSearch();
            await expect(page.locator('[data-testid="team-coworker-search-status"]')).toContainText('No matching repo PR authors found', { timeout: 10000 });
            await expect(page.locator('[data-testid="team-coworker-option"]')).toHaveCount(0);
        } finally {
            releaseCandidateSearch();
            await routeCleanup();
            cleanup();
        }
    });

    test('Team coworker picker surfaces candidate search API errors', async ({ page, serverUrl }) => {
        const { id: repoId, cleanup } = await seedPrWorkspace(serverUrl, 'ws-team-search-error', 'My Repo');
        const routeCleanup = await setupPrRoutes(page, serverUrl, repoId, {
            pullRequests: MOCK_PR_LIST,
            coworkerCandidateError: {
                status: 503,
                body: { error: 'candidate search temporarily unavailable' },
            },
        });
        try {
            await openPrTab(page, serverUrl, repoId);
            await page.locator('[data-testid="pr-queue-filter-team"]').click();

            await page.locator('[data-testid="team-coworker-picker"]').fill('al');
            await expect(page.locator('[data-testid="team-coworker-search-status"]')).toContainText('candidate search temporarily unavailable', { timeout: 10000 });
            await expect(page.locator('[data-testid="team-coworker-add"]')).toBeDisabled({ timeout: 10000 });
        } finally {
            await routeCleanup();
            cleanup();
        }
    });
});
