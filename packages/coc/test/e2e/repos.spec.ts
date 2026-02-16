/**
 * Repos E2E Tests
 *
 * Tests the Repos tab: add repo, list repos, select repo, delete repo.
 * Repos are fetched via REST when the tab is switched, so data seeded
 * before page.goto() is available once the tab is clicked.
 */

import { test, expect } from './fixtures/server-fixture';
import { seedWorkspace, request } from './fixtures/seed';

test.describe('Repos tab', () => {
    test('shows empty state when no repos exist', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');

        await expect(page.locator('#repos-empty')).toBeVisible();
        await expect(page.locator('#repos-empty')).toContainText('No repos registered');
    });

    test('displays seeded repos in the sidebar', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-1', 'frontend', '/tmp/frontend');
        await seedWorkspace(serverUrl, 'ws-2', 'backend', '/tmp/backend');

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');

        // Wait for repo items to appear (async fetch on tab switch)
        await expect(page.locator('.repo-item')).toHaveCount(2, { timeout: 10000 });
        await expect(page.locator('#repos-empty')).toBeHidden();
    });

    test('clicking a repo shows its detail', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-detail', 'my-project', '/tmp/my-project');

        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');

        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
        await page.locator('.repo-item').first().click();
        await expect(page.locator('#repo-detail-content')).toBeVisible();
        await expect(page.locator('#repo-detail-empty')).toBeHidden();
    });

    test('add repo button opens overlay dialog', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');

        await page.click('#add-repo-btn');
        await expect(page.locator('#add-repo-overlay')).toBeVisible();
        await expect(page.locator('#repo-path')).toBeVisible();
    });

    test('cancel button closes add repo dialog', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('[data-tab="repos"]');

        await page.click('#add-repo-btn');
        await expect(page.locator('#add-repo-overlay')).toBeVisible();

        await page.click('#add-repo-cancel-btn');
        await expect(page.locator('#add-repo-overlay')).toBeHidden();
    });

    test('workspace select dropdown populates with repos', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-sel', 'selector-repo', '/tmp/selector');

        await page.goto(serverUrl);

        // Wait for workspaces to load and populate dropdown
        await expect(page.locator('#workspace-select option')).toHaveCount(2, { timeout: 5000 });
    });
});
