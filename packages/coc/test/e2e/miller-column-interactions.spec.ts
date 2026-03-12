/**
 * Miller Column Interaction E2E Tests
 *
 * Tests context menus, file double-click, empty folder placeholder,
 * and archived/future file styling.
 *
 * Uses createTasksFixture (with empty folder extension) for the standard
 * task structure with folders and various file statuses.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { createRepoFixture, createTasksWithEmptyFolderFixture } from './fixtures/repo-fixtures';

async function setupRepoWithTasks(
    page: import('@playwright/test').Page,
    serverUrl: string,
    tmpDir: string,
    wsId = 'ws-interact',
): Promise<string> {
    const repoDir = createRepoFixture(tmpDir);
    createTasksWithEmptyFolderFixture(repoDir);

    await seedWorkspace(serverUrl, wsId, 'interact-repo', repoDir);

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

test.describe('Miller Column Interactions', () => {

    test('file double-click dispatches coc-open-markdown-review event', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-interact-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir);

            // Set up a listener for the custom event before double-clicking
            await page.evaluate(() => {
                (window as any).__cocOpenEvents = [];
                window.addEventListener('coc-open-markdown-review', (e: Event) => {
                    const detail = (e as CustomEvent).detail;
                    (window as any).__cocOpenEvents.push(detail);
                });
            });

            // Double-click task-a file
            await page.locator('[data-testid="task-tree-item-task-a"]').dblclick();

            // Check that the event was fired with correct details
            const events = await page.evaluate(() => (window as any).__cocOpenEvents);
            expect(events.length).toBeGreaterThanOrEqual(1);
            expect(events[0].filePath).toContain('task-a');
            expect(events[0].wsId).toBe('ws-interact');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('folder right-click opens context menu with expected actions', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-interact-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir);

            // Right-click the backlog folder
            await page.locator('[data-testid="task-tree-item-backlog"]').click({ button: 'right' });

            // Context menu should appear
            const contextMenu = page.locator('[data-testid="context-menu"]');
            await expect(contextMenu).toBeVisible({ timeout: 5000 });

            // Should contain expected folder action items
            await expect(contextMenu.getByRole('menuitem', { name: /rename/i })).toBeVisible();
            await expect(contextMenu.getByRole('menuitem', { name: /create/i }).first()).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('file right-click opens context menu with expected actions', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-interact-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir);

            // Right-click task-a file
            await page.locator('[data-testid="task-tree-item-task-a"]').click({ button: 'right' });

            // Context menu should appear
            const contextMenu = page.locator('[data-testid="context-menu"]');
            await expect(contextMenu).toBeVisible({ timeout: 5000 });

            // Should contain expected file action items
            await expect(contextMenu.getByRole('menuitem', { name: /change status/i })).toBeVisible();
            await expect(contextMenu.getByRole('menuitem', { name: /archive/i })).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('file checkbox is rendered and toggleable', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-interact-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir);

            // File rows should have checkboxes
            const taskARow = page.locator('[data-testid="task-tree-item-task-a"]');
            const checkbox = taskARow.locator('input.task-checkbox');
            await expect(checkbox).toBeVisible();
            await expect(checkbox).not.toBeChecked();

            // Click the checkbox
            await checkbox.click();
            await expect(checkbox).toBeChecked();

            // Click again to uncheck
            await checkbox.click();
            await expect(checkbox).not.toBeChecked();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('future-status file renders with dimmed italic styling', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-interact-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir);

            // Navigate into backlog folder which contains item.md with status: future
            await page.locator('[data-testid="task-tree-item-backlog"]').click();
            await expect(page.locator('[data-testid="miller-column-1"]')).toBeVisible({ timeout: 5000 });

            // The item row should have italic and opacity styling
            const itemRow = page.locator('[data-testid="task-tree-item-item"]');
            await expect(itemRow).toBeVisible();

            // Check for italic and opacity-60 CSS classes (applied via cn() for future status)
            const classes = await itemRow.getAttribute('class');
            expect(classes).toContain('italic');
            expect(classes).toContain('opacity-60');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('archived folder renders with dimmed italic styling', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-interact-'));
        try {
            await setupRepoWithTasks(page, serverUrl, tmpDir);

            // The archive folder row itself should have dimmed italic styling
            const archiveRow = page.locator('[data-testid="task-tree-item-archive"]');
            await expect(archiveRow).toBeVisible();

            const classes = await archiveRow.getAttribute('class');
            expect(classes).toContain('italic');
            expect(classes).toContain('opacity-60');
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
