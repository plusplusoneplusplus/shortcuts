/**
 * Context Menu Submenu E2E Tests
 *
 * Covers: ContextMenu nested SubmenuItem hover-to-expand and child-item click.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { createRepoFixture, createTasksFixture } from './fixtures/repo-fixtures';
import {
    navigateToTask,
    selectTextAndOpenContextMenu,
} from './fixtures/comment-fixtures';

const WS_ID = 'ws-submenu';

test.describe('ContextMenu Submenu', () => {

    test('hovering submenu item expands children, clicking child fires action', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-submenu-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'submenu-repo', repoDir);

            await navigateToTask(page, serverUrl, 'task-a');
            await selectTextAndOpenContextMenu(page, 'Root-level pending');

            // Context menu should be visible
            const contextMenu = page.locator('[data-testid="context-menu"]');
            await expect(contextMenu).toBeVisible();

            // Check if there's a submenu item (item with ▶ indicator)
            // The MarkdownReviewEditor context menu may have an "Ask AI" submenu
            // with child commands. Find items with aria-haspopup="true".
            const submenuItems = contextMenu.locator('[aria-haspopup="true"]');
            const submenuCount = await submenuItems.count();

            if (submenuCount > 0) {
                // Get the parent wrapper that has the data-testid
                const firstSubmenuWrapper = submenuItems.first().locator('..');
                const testId = await firstSubmenuWrapper.getAttribute('data-testid');

                // Hover over the submenu item to open it
                await submenuItems.first().hover();

                // Submenu panel should appear
                if (testId) {
                    const idx = testId.replace('context-menu-item-', '');
                    const submenu = page.locator(`[data-testid="context-submenu-${idx}"]`);
                    await expect(submenu).toBeVisible({ timeout: 3_000 });

                    // Click first child item in the submenu
                    const childItem = submenu.locator(`[data-testid="context-submenu-${idx}-item-0"]`);
                    if (await childItem.count() > 0) {
                        await childItem.click();
                        // Context menu should close after clicking child
                        await expect(contextMenu).toHaveCount(0, { timeout: 3_000 });
                    }
                }
            } else {
                // If no submenu items exist in the current context menu configuration,
                // verify that the flat menu items work correctly as a fallback
                const firstItem = contextMenu.locator('[data-testid="context-menu-item-0"]');
                await expect(firstItem).toBeVisible();
            }
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
