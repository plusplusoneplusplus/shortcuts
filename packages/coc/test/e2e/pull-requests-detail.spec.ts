import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { expect, test } from './fixtures/server-fixture';
import { safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { MOCK_PR_OPEN, MOCK_PR_THREADS } from './fixtures/pr-fixtures';
import { setupPrRoutes } from './fixtures/pr-mock';

test.describe('Pull Requests — detail view', () => {
    let tmpDir: string;
    const repoId = 'ws-pr-detail';

    test.beforeEach(async ({ page, serverUrl }) => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-pr-detail-'));
        await seedWorkspace(serverUrl, repoId, 'pr-detail-project', tmpDir);
        await setupPrRoutes(page, serverUrl, repoId, {
            prDetail: MOCK_PR_OPEN,
            threads: MOCK_PR_THREADS,
        });

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');
        await expect(page.locator('.repo-item').first()).toBeVisible({ timeout: 10000 });
        await page.locator('.repo-item').first().click();
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
            MOCK_PR_OPEN.createdBy!.displayName!,
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

    test('switching to Threads sub-tab shows thread list', async ({ page }) => {
        await page.getByTestId('tab-threads').click();
        await expect(page.getByTestId('thread-list')).toBeVisible({ timeout: 10000 });
    });

    test('thread list shows file path and comment content', async ({ page }) => {
        await page.getByTestId('tab-threads').click();
        await expect(page.getByTestId('thread-list')).toBeVisible({ timeout: 10000 });

        const firstThread = MOCK_PR_THREADS[0];
        await expect(page.getByTestId('thread-list')).toContainText(
            firstThread.threadContext!.filePath!,
            { timeout: 10000 },
        );
        await expect(page.getByTestId('thread-list')).toContainText(
            firstThread.comments[0].content,
            { timeout: 10000 },
        );
    });
});
