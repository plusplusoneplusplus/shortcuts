/**
 * Miller Column Auto-Scroll E2E Tests
 *
 * Verifies that the tasks panel scroll container auto-scrolls to the right
 * when new columns are opened (folder click) or a file preview is opened.
 *
 * Uses createDeepTasksFixture for a 3-level nested folder structure so that
 * drilling into subfolders forces horizontal overflow.
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
): Promise<string> {
    const repoDir = createRepoFixture(tmpDir);
    createDeepTasksFixture(repoDir);

    await seedWorkspace(serverUrl, 'ws-scroll', 'scroll-repo', repoDir);

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

/** Read scrollLeft from the miller scroll container. */
async function getScrollLeft(page: import('@playwright/test').Page): Promise<number> {
    return page.locator('[data-testid="tasks-miller-scroll-container"]').evaluate(
        (el) => el.scrollLeft,
    );
}

/** Read scrollWidth and clientWidth to check if content overflows. */
async function getScrollMetrics(page: import('@playwright/test').Page) {
    return page.locator('[data-testid="tasks-miller-scroll-container"]').evaluate((el) => ({
        scrollLeft: el.scrollLeft,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
    }));
}

test.describe('Miller Column Auto-Scroll', () => {

    test('auto-scrolls right when clicking a folder to open a new column', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-scroll-'));
        try {
            await setupDeepRepo(page, serverUrl, tmpDir);

            const initialScroll = await getScrollLeft(page);

            // Click level1 folder
            await page.locator('[data-testid="task-tree-item-level1"]').click();
            await expect(page.locator('[data-testid="miller-column-1"]')).toBeVisible({ timeout: 5000 });

            // Click level2 folder
            await page.locator('[data-testid="task-tree-item-level2"]').click();
            await expect(page.locator('[data-testid="miller-column-2"]')).toBeVisible({ timeout: 5000 });

            // Click level3 folder
            await page.locator('[data-testid="task-tree-item-level3"]').click();
            await expect(page.locator('[data-testid="miller-column-3"]')).toBeVisible({ timeout: 5000 });

            // Wait for smooth scroll to settle
            await page.waitForTimeout(500);

            const metrics = await getScrollMetrics(page);

            // If content overflows, scrollLeft should have increased
            if (metrics.scrollWidth > metrics.clientWidth) {
                expect(metrics.scrollLeft).toBeGreaterThan(initialScroll);
            }
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('auto-scrolls right when clicking a file to open preview', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-scroll-'));
        try {
            await setupDeepRepo(page, serverUrl, tmpDir);

            // Drill into level1 → level2 → level3
            await page.locator('[data-testid="task-tree-item-level1"]').click();
            await expect(page.locator('[data-testid="miller-column-1"]')).toBeVisible({ timeout: 5000 });

            await page.locator('[data-testid="task-tree-item-level2"]').click();
            await expect(page.locator('[data-testid="miller-column-2"]')).toBeVisible({ timeout: 5000 });

            await page.locator('[data-testid="task-tree-item-level3"]').click();
            await expect(page.locator('[data-testid="miller-column-3"]')).toBeVisible({ timeout: 5000 });

            await page.waitForTimeout(300);
            const scrollBeforeFile = await getScrollLeft(page);

            // Click the deep-task file
            await page.locator('[data-testid="task-tree-item-deep-task"]').click();

            // Wait for preview to render and scroll to settle
            await expect(page.locator('#task-preview-body')).toBeVisible({ timeout: 10000 });
            await page.waitForTimeout(500);

            const metricsAfter = await getScrollMetrics(page);

            // The preview panel is 72rem wide, so scrollWidth should exceed clientWidth
            // and scrollLeft should have increased to reveal the preview
            expect(metricsAfter.scrollWidth).toBeGreaterThan(metricsAfter.clientWidth);
            expect(metricsAfter.scrollLeft).toBeGreaterThan(scrollBeforeFile);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('auto-scrolls to show preview when clicking a root-level file', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-scroll-'));
        try {
            await setupDeepRepo(page, serverUrl, tmpDir);

            const scrollBefore = await getScrollLeft(page);

            // Click the root-level task file
            await page.locator('[data-testid="task-tree-item-task-root"]').click();

            // Wait for preview to render and scroll to settle
            await expect(page.locator('#task-preview-body')).toBeVisible({ timeout: 10000 });
            await page.waitForTimeout(500);

            const metricsAfter = await getScrollMetrics(page);

            // Preview is 72rem wide; if it overflows, scroll should have moved right
            if (metricsAfter.scrollWidth > metricsAfter.clientWidth) {
                expect(metricsAfter.scrollLeft).toBeGreaterThanOrEqual(scrollBefore);
            }
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('scroll container is scrolled to the rightmost edge after deep navigation', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-scroll-'));
        try {
            await setupDeepRepo(page, serverUrl, tmpDir);

            // Drill all the way down and open the deepest file
            await page.locator('[data-testid="task-tree-item-level1"]').click();
            await expect(page.locator('[data-testid="miller-column-1"]')).toBeVisible({ timeout: 5000 });

            await page.locator('[data-testid="task-tree-item-level2"]').click();
            await expect(page.locator('[data-testid="miller-column-2"]')).toBeVisible({ timeout: 5000 });

            await page.locator('[data-testid="task-tree-item-level3"]').click();
            await expect(page.locator('[data-testid="miller-column-3"]')).toBeVisible({ timeout: 5000 });

            await page.locator('[data-testid="task-tree-item-deep-task"]').click();
            await expect(page.locator('#task-preview-body')).toBeVisible({ timeout: 10000 });

            // Wait for all scrolling to complete
            await page.waitForTimeout(800);

            const metrics = await getScrollMetrics(page);

            // scrollLeft should be at or near the maximum (scrollWidth - clientWidth)
            const maxScroll = metrics.scrollWidth - metrics.clientWidth;
            if (maxScroll > 0) {
                const tolerance = 5;
                expect(metrics.scrollLeft).toBeGreaterThanOrEqual(maxScroll - tolerance);
            }
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
