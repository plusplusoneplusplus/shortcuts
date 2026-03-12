/**
 * Task Search E2E Tests (017)
 *
 * Tests the task search input: query filtering, empty state,
 * keyboard shortcuts (Ctrl+F to focus, Escape to clear).
 *
 * Depends on createRepoFixture + createTasksFixture for on-disk task files.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { createRepoFixture, createTasksFixture } from './fixtures/repo-fixtures';

/** Helper: create a repo with tasks, seed it as a workspace, navigate to Tasks sub-tab. */
async function setupRepoWithTasks(
    page: import('@playwright/test').Page,
    serverUrl: string,
    tmpDir: string,
    wsId = 'ws-search',
): Promise<string> {
    const repoDir = createRepoFixture(tmpDir);
    createTasksFixture(repoDir);

    await seedWorkspace(serverUrl, wsId, 'search-repo', repoDir);

    await page.goto(serverUrl);
    await page.click('[data-tab="repos"]');
    await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

    await page.locator('.repo-item').first().click();
    await expect(page.locator('#repo-detail-content')).toBeVisible();

    await page.click('.repo-sub-tab[data-subtab="tasks"]');
    await expect(page.locator('.repo-sub-tab[data-subtab="tasks"]')).toHaveClass(/active/);
    await expect(page.locator('[data-testid="task-tree"]')).toBeVisible({ timeout: 10000 });

    return repoDir;
}

test.describe('Task Search (017)', () => {

    test('17.1 search input filters results in TaskSearchResults', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-search-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir);

            // Search input should be present
            const searchInput = page.locator('[data-testid="task-search-input"]');
            await expect(searchInput).toBeVisible();

            // Type a query that matches task-a.md
            await searchInput.fill('task-a');

            // Miller columns should hide, search results should appear
            await expect(page.locator('[data-testid="search-results-list"]')).toBeVisible({ timeout: 10000 });
            await expect(page.locator('[data-testid="task-tree"]')).toBeHidden({ timeout: 5000 });

            // The matching file should appear in results
            await expect(page.locator('[data-testid="search-result-task-a"]')).toBeVisible({ timeout: 5000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('17.2 search empty state when no results match', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-search-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir);

            const searchInput = page.locator('[data-testid="task-search-input"]');
            await expect(searchInput).toBeVisible();

            // Type a query that matches nothing
            await searchInput.fill('xyznonexistent');

            // Empty state should appear
            await expect(page.locator('[data-testid="search-empty-state"]')).toBeVisible({ timeout: 10000 });
            await expect(page.locator('[data-testid="task-tree"]')).toBeHidden();
            await expect(page.locator('[data-testid="search-results-list"]')).toBeHidden();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('17.3 clear button resets search and restores task tree', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-search-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir);

            const searchInput = page.locator('[data-testid="task-search-input"]');
            await searchInput.fill('task-a');
            await expect(page.locator('[data-testid="search-results-list"]')).toBeVisible({ timeout: 10000 });

            // Click the clear button
            const clearBtn = page.locator('[data-testid="task-search-clear"]');
            await expect(clearBtn).toBeVisible();
            await clearBtn.click();

            // Task tree should be restored
            await expect(page.locator('[data-testid="task-tree"]')).toBeVisible({ timeout: 10000 });
            await expect(page.locator('[data-testid="search-results-list"]')).toBeHidden();

            // Input should be empty
            await expect(searchInput).toHaveValue('');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('17.4 Ctrl+F focuses the search input', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-search-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir);

            const searchInput = page.locator('[data-testid="task-search-input"]');

            // Press Ctrl+F — should focus the search input
            await page.keyboard.press('Control+f');

            // Search input should be focused
            await expect(searchInput).toBeFocused({ timeout: 5000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('17.5 Escape clears search and blurs input', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-search-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir);

            const searchInput = page.locator('[data-testid="task-search-input"]');
            await searchInput.fill('task-a');
            await expect(page.locator('[data-testid="search-results-list"]')).toBeVisible({ timeout: 10000 });

            // Press Escape — should clear search and restore task tree
            await page.keyboard.press('Escape');

            await expect(page.locator('[data-testid="task-tree"]')).toBeVisible({ timeout: 10000 });
            await expect(searchInput).toHaveValue('');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('17.6 clicking search result opens file preview', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-search-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir);

            const searchInput = page.locator('[data-testid="task-search-input"]');
            await searchInput.fill('task-a');
            await expect(page.locator('[data-testid="search-results-list"]')).toBeVisible({ timeout: 10000 });

            // Click the matching result
            const resultItem = page.locator('[data-testid="search-result-task-a"]');
            await expect(resultItem).toBeVisible();
            await resultItem.click();

            // File preview or content panel should open
            await expect(page.locator('#task-preview-body')).toBeVisible({ timeout: 10000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
