import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { expect, test } from './fixtures/server-fixture';
import { safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace, request } from './fixtures/seed';
import { MOCK_PR_OPEN, MOCK_PR_THREADS } from './fixtures/pr-fixtures';
import { setupPrRoutes } from './fixtures/pr-mock';

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

test.describe('Pull Requests — detail view', () => {
    let tmpDir: string;
    const repoId = 'ws-pr-detail';

    test.beforeEach(async ({ page, serverUrl }) => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-pr-detail-'));
        // git init so the server reports isGitRepo=true for the seeded workspace.
        execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
        await seedWorkspace(serverUrl, repoId, 'pr-detail-project', tmpDir);
        await enablePullRequestsFeature(serverUrl);
        await mockGitInfo(page, repoId);
        await setupPrRoutes(page, serverUrl, repoId, {
            prDetail: MOCK_PR_OPEN,
            threads: MOCK_PR_THREADS,
        });

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('[data-testid="repo-tab"]').first()).toBeVisible({ timeout: 10000 });
        await page.locator('[data-testid="repo-tab"]').first().click();
        await page.click('button[data-subtab="pull-requests"]');
        await expect(page.getByTestId('pr-list')).toBeVisible({ timeout: 10000 });
        await page.getByTestId('pr-row').first().click();
        await expect(page.getByTestId('pr-detail')).toBeVisible({ timeout: 10000 });
    });

    test.afterEach(() => {
        safeRmSync(tmpDir);
    });

    test('shows PR title and number in detail panel', async ({ page }) => {
        await expect(page.getByTestId('pr-title')).toContainText(MOCK_PR_OPEN.title, {
            timeout: 10000,
        });
        await expect(page.getByTestId('pr-detail')).toContainText(
            `#${MOCK_PR_OPEN.number}`,
            { timeout: 10000 },
        );
    });

    test('shows status badge in detail panel', async ({ page }) => {
        // MOCK_PR_OPEN.status === 'open' → renders "🟢 Open"
        await expect(page.getByTestId('pr-status-badge')).toContainText('🟢', {
            timeout: 10000,
        });
        await expect(page.getByTestId('pr-status-badge')).toContainText('Open', {
            timeout: 10000,
        });
    });

    test('shows source and target branches', async ({ page }) => {
        const branchEl = page.getByTestId('pr-branches');
        await expect(branchEl).toContainText(MOCK_PR_OPEN.sourceBranch, { timeout: 10000 });
        await expect(branchEl).toContainText(MOCK_PR_OPEN.targetBranch, { timeout: 10000 });
    });

    test('shows author display name', async ({ page }) => {
        await expect(page.getByTestId('pr-detail')).toContainText(
            MOCK_PR_OPEN.author!.displayName!,
            { timeout: 10000 },
        );
    });

    test('shows PR description', async ({ page }) => {
        await expect(page.getByTestId('pr-description')).toContainText(
            MOCK_PR_OPEN.description!,
            { timeout: 10000 },
        );
    });

    test('shows reviewer badges with vote icons', async ({ page }) => {
        const reviewersSection = page.getByTestId('reviewers-section');
        await expect(reviewersSection).toBeVisible({ timeout: 10000 });

        // All reviewer display names must appear
        for (const reviewer of MOCK_PR_OPEN.reviewers!) {
            await expect(reviewersSection).toContainText(reviewer.identity.displayName!, {
                timeout: 10000,
            });
        }

        // At least one reviewer badge shows an approved vote icon (✅)
        // MOCK_PR_OPEN contains a reviewer with vote: 'approved'
        await expect(page.getByTestId('reviewer-badge').first()).toContainText('✅', {
            timeout: 10000,
        });
    });

    test('Overview tab shows the embedded thread list when comments exist', async ({ page }) => {
        await expect(page.getByTestId('overview-tab')).toBeVisible({ timeout: 10000 });
        await expect(page.getByTestId('thread-list')).toBeVisible({ timeout: 10000 });
    });

    test('thread list shows file path and comment content', async ({ page }) => {
        await expect(page.getByTestId('thread-list')).toBeVisible({ timeout: 10000 });

        const firstThread = MOCK_PR_THREADS[0];
        await expect(page.getByTestId('thread-list')).toContainText(
            firstThread.threadContext!.filePath!,
            { timeout: 10000 },
        );
        await expect(page.getByTestId('thread-list')).toContainText(
            firstThread.comments[0].body,
            { timeout: 10000 },
        );
    });

    test('AI review summary is rendered for the PR', async ({ page }) => {
        await expect(page.getByTestId('pr-ai-summary')).toBeVisible({ timeout: 10000 });
        await expect(page.getByTestId('pr-ai-metrics')).toBeVisible({ timeout: 10000 });
    });

    test('switching to Files tab renders the AI files panel', async ({ page }) => {
        await page.getByTestId('tab-files').click();
        await expect(page.getByTestId('pr-files-panel')).toBeVisible({ timeout: 10000 });
    });

    test('switching to Commits tab renders the commit intent table', async ({ page }) => {
        await page.getByTestId('tab-commits').click();
        await expect(page.getByTestId('pr-commit-table')).toBeVisible({ timeout: 10000 });
    });

    test('switching to Checks tab renders checks table and merge readiness', async ({ page }) => {
        await page.getByTestId('tab-checks').click();
        await expect(page.getByTestId('pr-checks-table')).toBeVisible({ timeout: 10000 });
        await expect(page.getByTestId('pr-merge-readiness')).toBeVisible({ timeout: 10000 });
    });

    test('Ask AI button opens the AI assistant drawer', async ({ page }) => {
        await page.getByTestId('pr-open-ai-assistant').click();
        await expect(page.getByTestId('pr-ai-assistant')).toBeVisible({ timeout: 10000 });
        await page.getByTestId('pr-ai-assistant-close').click();
    });
});
