/**
 * Verifies task preview does not show the legacy comment sidebar when no
 * comments exist (NoteEditor uses noopCommentBackend for task preview).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { createRepoFixture, createTasksFixture } from './fixtures/repo-fixtures';
import { gotoWorkspace } from './fixtures/remote-shell';

async function navigateToTask(
    page: import('@playwright/test').Page,
    serverUrl: string,
    wsId: string,
    taskName: string,
): Promise<void> {
    await gotoWorkspace(page, serverUrl, wsId, 'tasks');
    await expect(page.locator('[data-testid="task-tree"]')).toBeVisible({ timeout: 10000 });

    const taskItem = page.locator(`[data-testid="task-tree-item-${taskName}"]`);
    await expect(taskItem).toBeVisible({ timeout: 5000 });
    await taskItem.click();
}

test.describe('Comment Sidebar Layout', () => {
    test('sidebar is not shown when there are no comments', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-sidebar-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, 'ws-no-comments', 'no-comments-repo', repoDir);

            await navigateToTask(page, serverUrl, 'ws-no-comments', 'task-b');

            await expect(page.locator('#task-preview-body')).toBeVisible({ timeout: 10000 });

            await expect(page.locator('[data-testid="comment-sidebar"]')).toHaveCount(0);
            await expect(page.locator('[data-testid="markdown-review-status-bar"]')).toHaveCount(0);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
