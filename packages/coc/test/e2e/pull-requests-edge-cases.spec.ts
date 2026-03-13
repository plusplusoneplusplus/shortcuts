import { test, expect } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { createMockPullRequest } from './fixtures/pr-fixtures';
import { setupPrRoutes } from './fixtures/pr-mock';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Navigate to the pull-requests sub-tab for the first repo in the list. */
async function openPrTab(page: any, serverUrl: string): Promise<void> {
    await page.goto(serverUrl);
    await page.click('[data-tab="repos"]');
    await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
    await page.locator('.repo-item').first().click();
    await page.click('button[data-subtab="pull-requests"]');
}

// ---------------------------------------------------------------------------
// Unconfigured provider
// ---------------------------------------------------------------------------

test.describe('Pull Requests — unconfigured provider', () => {
    const repoId = 'ws-pr-edge-unconfigured';

    test.beforeEach(async ({ serverUrl }) => {
        await seedWorkspace(serverUrl, repoId, 'edge-case-repo', '/tmp/edge-repo');
    });

    test('shows ProviderConfigPanel when provider is not configured', async ({
        page,
        serverUrl,
    }) => {
        // Intercept ALL pull-request routes for this repo with an unconfigured 401.
        // Using ** so query-param URLs (list) and sub-path URLs (detail) are both covered.
        const prApiBase = `${serverUrl}/api/repos/${repoId}/pull-requests`;
        await page.route(`${prApiBase}**`, (route) => {
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

        await openPrTab(page, serverUrl);

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
        const prApiBase = `${serverUrl}/api/repos/${repoId}/pull-requests`;
        await page.route(`${prApiBase}**`, (route) => {
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

        await openPrTab(page, serverUrl);

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
    const repoId = 'ws-pr-edge-hash';
    const prId = 42;

    test.beforeEach(async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, repoId, 'hash-nav-repo', '/tmp/hash-nav-repo');
        const deepLinkPr = createMockPullRequest({
            id: prId,
            title: 'Deep-link target PR',
            number: prId,
        });
        await setupPrRoutes(page, serverUrl, repoId, {
            pullRequests: [deepLinkPr],
            prDetail: deepLinkPr,
        });
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
            page.locator('[data-testid="pr-detail"]').getByText('Deep-link target PR'),
        ).toBeVisible({ timeout: 10000 });
    });
});
