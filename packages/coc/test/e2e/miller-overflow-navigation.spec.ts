/**
 * Miller Column Overflow & Navigation E2E Tests
 *
 * Tests column overflow indicator, navigate-back, deep-link via URL hash,
 * file-click column collapse, and idempotent folder click.
 *
 * Uses createDeepTasksFixture for a 4-level structure that triggers
 * the MAX_VISIBLE_COLUMNS=2 overflow behavior.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { createRepoFixture, createDeepTasksFixture } from './fixtures/repo-fixtures';

async function setupDeepRepo(
    page: import('@playwright/test').Page,
    serverUrl: string,
    tmpDir: string,
    wsId = 'ws-overflow',
): Promise<string> {
    const repoDir = createRepoFixture(tmpDir);
    createDeepTasksFixture(repoDir);

    await seedWorkspace(serverUrl, wsId, 'overflow-repo', repoDir);

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

test.describe('Miller Column Overflow & Navigation', () => {

    test('overflow indicator appears when columns exceed MAX_VISIBLE_COLUMNS', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-overflow-'));
        try {
            await setupDeepRepo(page, serverUrl, tmpDir);

            // Drill level1 → level2 → 3 columns total (root + level1 + level2)
            await page.locator('[data-testid="task-tree-item-level1"]').click();
            await expect(page.locator('[data-testid="miller-column-1"]')).toBeVisible({ timeout: 5000 });

            await page.locator('[data-testid="task-tree-item-level2"]').click();
            await expect(page.locator('[data-testid="miller-column-2"]')).toBeVisible({ timeout: 5000 });

            // 3 columns with MAX_VISIBLE=2 → overflow indicator should appear showing '‹ 1'
            const indicator = page.locator('[data-testid="column-overflow-indicator"]');
            await expect(indicator).toBeVisible();
            await expect(indicator).toContainText('1');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('overflow indicator shows correct hidden count for deeply nested columns', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-overflow-'));
        try {
            await setupDeepRepo(page, serverUrl, tmpDir);

            // Drill level1 → level2 → level3 → 4 columns total
            await page.locator('[data-testid="task-tree-item-level1"]').click();
            await expect(page.locator('[data-testid="miller-column-1"]')).toBeVisible({ timeout: 5000 });

            await page.locator('[data-testid="task-tree-item-level2"]').click();
            await expect(page.locator('[data-testid="miller-column-2"]')).toBeVisible({ timeout: 5000 });

            await page.locator('[data-testid="task-tree-item-level3"]').click();
            await expect(page.locator('[data-testid="miller-column-3"]')).toBeVisible({ timeout: 5000 });

            // 4 columns with MAX_VISIBLE=2 → overflow indicator should show '‹ 2'
            const indicator = page.locator('[data-testid="column-overflow-indicator"]');
            await expect(indicator).toBeVisible();
            await expect(indicator).toContainText('2');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('clicking overflow indicator navigates back and decrements hidden count', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-overflow-'));
        try {
            await setupDeepRepo(page, serverUrl, tmpDir);

            // Drill level1 → level2 → level3 → 4 columns (overflow = 2)
            await page.locator('[data-testid="task-tree-item-level1"]').click();
            await expect(page.locator('[data-testid="miller-column-1"]')).toBeVisible({ timeout: 5000 });

            await page.locator('[data-testid="task-tree-item-level2"]').click();
            await expect(page.locator('[data-testid="miller-column-2"]')).toBeVisible({ timeout: 5000 });

            await page.locator('[data-testid="task-tree-item-level3"]').click();
            await expect(page.locator('[data-testid="miller-column-3"]')).toBeVisible({ timeout: 5000 });

            const indicator = page.locator('[data-testid="column-overflow-indicator"]');
            await expect(indicator).toContainText('2');

            // Click overflow indicator to go back one level
            await indicator.click();

            // Now 3 columns → overflow shows '‹ 1'
            await expect(indicator).toContainText('1');
            // Column 3 should be gone
            await expect(page.locator('[data-testid="miller-column-3"]')).toHaveCount(0);

            // Click again — back to 2 columns, no overflow
            await indicator.click();
            await expect(page.locator('[data-testid="column-overflow-indicator"]')).toHaveCount(0, { timeout: 5000 });
            // Should show columns 0 and 1
            await expect(page.locator('[data-testid="miller-column-0"]')).toBeVisible();
            await expect(page.locator('[data-testid="miller-column-1"]')).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('navigate-back updates URL hash to parent folder path', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-overflow-'));
        try {
            const wsId = 'ws-overflow';
            await setupDeepRepo(page, serverUrl, tmpDir, wsId);

            // Drill into level1 → level2
            await page.locator('[data-testid="task-tree-item-level1"]').click();
            await expect(page.locator('[data-testid="miller-column-1"]')).toBeVisible({ timeout: 5000 });

            await page.locator('[data-testid="task-tree-item-level2"]').click();
            await expect(page.locator('[data-testid="miller-column-2"]')).toBeVisible({ timeout: 5000 });

            // Click overflow indicator to go back
            await page.locator('[data-testid="column-overflow-indicator"]').click();

            // URL hash should reflect the parent folder path
            const hash = await page.evaluate(() => window.location.hash);
            expect(hash).toContain('tasks/level1');
            expect(hash).not.toContain('level2');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('opening a file collapses stale deeper folder columns', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-overflow-'));
        try {
            await setupDeepRepo(page, serverUrl, tmpDir);

            // Drill into level1 → level2 (3 columns visible as overflow window)
            await page.locator('[data-testid="task-tree-item-level1"]').click();
            await expect(page.locator('[data-testid="miller-column-1"]')).toBeVisible({ timeout: 5000 });

            await page.locator('[data-testid="task-tree-item-level2"]').click();
            await expect(page.locator('[data-testid="miller-column-2"]')).toBeVisible({ timeout: 5000 });

            // Now click a file in column 1 (task-l1 in level1 folder)
            await page.locator('[data-testid="task-tree-item-task-l1"]').click();

            // Column 2 (level2) should be removed — stale deeper column collapsed
            await expect(page.locator('[data-testid="miller-column-2"]')).toHaveCount(0, { timeout: 5000 });

            // Preview should open with the file content
            await expect(page.locator('#task-preview-body')).toBeVisible({ timeout: 10000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('deep-link via URL hash restores columns after page reload', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-overflow-'));
        try {
            const wsId = 'ws-overflow';
            await setupDeepRepo(page, serverUrl, tmpDir, wsId);

            // Drill into level1 → level2 to establish navigation state + URL hash
            await page.locator('[data-testid="task-tree-item-level1"]').click();
            await expect(page.locator('[data-testid="miller-column-1"]')).toBeVisible({ timeout: 5000 });

            await page.locator('[data-testid="task-tree-item-level2"]').click();
            await expect(page.locator('[data-testid="miller-column-2"]')).toBeVisible({ timeout: 5000 });

            // Verify the URL hash was set
            const hashBefore = await page.evaluate(() => window.location.hash);
            expect(hashBefore).toContain('level1');
            expect(hashBefore).toContain('level2');

            // Capture the full URL with hash for reload
            const fullUrl = await page.evaluate(() => window.location.href);

            // Reload the page — hash persists in URL
            await page.goto(fullUrl);

            // Re-navigate through the UI (the SPA needs manual repo selection)
            await page.click('[data-tab="repos"]');
            await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
            await page.locator('.repo-item').first().click();
            await expect(page.locator('#repo-detail-content')).toBeVisible();
            await page.click('.repo-sub-tab[data-subtab="tasks"]');
            await expect(page.locator('[data-testid="task-tree"]')).toBeVisible({ timeout: 10000 });

            // The deep-link should restore columns from hash: root → level1 → level2
            // With MAX_VISIBLE=2, columns 1 and 2 should be visible
            await expect(page.locator('[data-testid="miller-column-2"]')).toBeVisible({ timeout: 10000 });

            // level2's children should be visible (task-l2 and level3 folder)
            const col2 = page.locator('[data-testid="miller-column-2"]');
            await expect(col2.locator('[data-testid="task-tree-item-level3"]')).toBeVisible({ timeout: 5000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('clicking active folder again does NOT create duplicate column', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-overflow-'));
        try {
            await setupDeepRepo(page, serverUrl, tmpDir);

            // Click level1 folder → column 1 appears
            await page.locator('[data-testid="task-tree-item-level1"]').click();
            await expect(page.locator('[data-testid="miller-column-1"]')).toBeVisible({ timeout: 5000 });

            // Exactly 2 columns should exist
            await expect(page.locator('[data-testid^="miller-column-"]')).toHaveCount(2);

            // Click level1 again — should be idempotent
            await page.locator('[data-testid="task-tree-item-level1"]').click();
            await page.waitForTimeout(300);

            // Still exactly 2 columns, not 3
            await expect(page.locator('[data-testid^="miller-column-"]')).toHaveCount(2);

            // No overflow indicator (only 2 columns = MAX_VISIBLE)
            await expect(page.locator('[data-testid="column-overflow-indicator"]')).toHaveCount(0);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
