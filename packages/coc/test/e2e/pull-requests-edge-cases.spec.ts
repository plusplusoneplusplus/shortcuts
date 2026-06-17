import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace, request } from './fixtures/seed';
import { createMockPullRequest } from './fixtures/pr-fixtures';
import { setupPrRoutes } from './fixtures/pr-mock';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
): Promise<{ id: string; rootPath: string; cleanup: () => void }> {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), `e2e-pr-edge-${id}-`));
    execSync('git init', { cwd: rootPath, stdio: 'ignore' });
    await seedWorkspace(serverUrl, id, name, rootPath);
    return { id, rootPath, cleanup: () => safeRmSync(rootPath) };
}

/** Navigate to the pull-requests sub-tab for the first repo in the list. */
async function openPrTab(page: any, serverUrl: string, wsId: string): Promise<void> {
    await enablePullRequestsFeature(serverUrl);
    await mockGitInfo(page, wsId);
    await page.goto(serverUrl);
    await page.click('[data-tab="repos"]');
    await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10000 });
    await page.locator('[data-testid="repo-tab"]').first().click();
    await page.click('button[data-subtab="pull-requests"]');
}

function isOriginPullRequestRoute(url: string): boolean {
    const pathname = new URL(url).pathname;
    return pathname.startsWith('/api/origins/') && pathname.includes('/pull-requests');
}

function isOriginPullRequestListRoute(url: string): boolean {
    const pathname = new URL(url).pathname;
    return pathname.startsWith('/api/origins/') && pathname.endsWith('/pull-requests');
}

// ---------------------------------------------------------------------------
// Unconfigured provider
// ---------------------------------------------------------------------------

test.describe('Pull Requests — unconfigured provider', () => {
    let cleanup: () => void;
    const repoId = 'ws-pr-edge-unconfigured';

    test.beforeEach(async ({ serverUrl }) => {
        ({ cleanup } = await seedPrWorkspace(serverUrl, repoId, 'edge-case-repo'));
    });

    test.afterEach(() => {
        cleanup?.();
    });

    test('shows ProviderConfigPanel when provider is not configured', async ({
        page,
        serverUrl,
    }) => {
        await page.route(isOriginPullRequestRoute, (route) => {
            route.fulfill({
                status: 401,
                contentType: 'application/json',
                body: JSON.stringify({
                    error: 'unconfigured',
                    detected: 'github',
                    remoteUrl: 'https://github.com/example/repo',
                }),
            });
        });

        await openPrTab(page, serverUrl, repoId);

        await expect(page.locator('[data-testid="provider-config-panel"]')).toBeVisible({
            timeout: 10000,
        });
        // No PR rows rendered when provider is unconfigured
        await expect(page.locator('[data-testid="pr-list"] .pr-row')).toHaveCount(0, {
            timeout: 10000,
        });
    });

    test('shows detected provider type in config panel', async ({
        page,
        serverUrl,
    }) => {
        await page.route(isOriginPullRequestRoute, (route) => {
            route.fulfill({
                status: 401,
                contentType: 'application/json',
                body: JSON.stringify({
                    error: 'unconfigured',
                    detected: 'github',
                    remoteUrl: 'https://github.com/example/repo',
                }),
            });
        });

        await openPrTab(page, serverUrl, repoId);

        const configPanel = page.locator('[data-testid="provider-config-panel"]');
        await expect(configPanel).toBeVisible({ timeout: 10000 });
        // Panel should mention the detected provider (case-insensitive)
        await expect(configPanel).toContainText(/github/i, { timeout: 10000 });
    });
});

// ---------------------------------------------------------------------------
// Hash navigation
// ---------------------------------------------------------------------------

test.describe('Pull Requests — hash navigation', () => {
    let cleanup: () => void;
    const repoId = 'ws-pr-edge-hash';
    const prId = 42;

    test.beforeEach(async ({ page, serverUrl }) => {
        ({ cleanup } = await seedPrWorkspace(serverUrl, repoId, 'hash-nav-repo'));
        const deepLinkPr = createMockPullRequest({
            id: prId,
            title: 'Deep-link target PR',
            number: prId,
        });
        await enablePullRequestsFeature(serverUrl);
        await mockGitInfo(page, repoId);
        await setupPrRoutes(page, serverUrl, repoId, {
            pullRequests: [deepLinkPr],
            prDetail: deepLinkPr,
        });
    });

    test.afterEach(() => {
        cleanup?.();
    });

    test('#repos/:id/pull-requests navigates directly to PR list', async ({
        page,
        serverUrl,
    }) => {
        await page.goto(`${serverUrl}#repos/${repoId}/pull-requests`);

        await expect(page.locator('[data-testid="pr-list"]')).toBeVisible({
            timeout: 10000,
        });
        // Detail panel must not be rendered when no PR is selected
        await expect(page.locator('[data-testid="pr-detail"]')).not.toBeVisible({
            timeout: 10000,
        });
    });

    test('#repos/:id/pull-requests/:prId navigates directly to PR detail', async ({
        page,
        serverUrl,
    }) => {
        await page.goto(`${serverUrl}#repos/${repoId}/pull-requests/${prId}`);

        await expect(page.locator('[data-testid="pr-detail"]')).toBeVisible({
            timeout: 10000,
        });
        // Detail panel should display the correct PR title
        await expect(
            page.locator('[data-testid="pr-detail"]').getByTestId('pr-title'),
        ).toHaveText('Deep-link target PR', { timeout: 10000 });
    });
});

// ---------------------------------------------------------------------------
// Cache edge cases
// ---------------------------------------------------------------------------

test.describe('Pull Requests — cache edge cases', () => {
    test('error responses are not cached (re-fetch on return)', async ({ page, serverUrl }) => {
        const { id: repoId, cleanup } = await seedPrWorkspace(serverUrl, 'ws-pr-cache-err', 'cache-err-repo');
        let fetchCount = 0;

        // Return an error for PR list requests
        await page.route(isOriginPullRequestListRoute, (route) => {
            fetchCount++;
            route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ message: 'Internal server error' }),
            });
        });
        try {
            await openPrTab(page, serverUrl, repoId);

            await expect(page.locator('[data-testid="error-message"]')).toBeVisible({ timeout: 10000 });
            expect(fetchCount).toBe(1);

            // Navigate away (standalone Processes tab removed; use Admin toggle to leave repos view)
            await page.click('#admin-toggle');
            await expect(page.locator('[data-testid="pr-list"]')).not.toBeVisible({ timeout: 5000 });

            // Navigate back — should fetch again (error was not cached)
            await page.click('[data-tab="repos"]');
            await page.locator('[data-testid="repo-tab"]').first().click();
            await page.click('button[data-subtab="pull-requests"]');

            await expect(page.locator('[data-testid="error-message"]')).toBeVisible({ timeout: 10000 });
            expect(fetchCount).toBe(2);
        } finally {
            await page.unroute(isOriginPullRequestListRoute);
            cleanup();
        }
    });
});
