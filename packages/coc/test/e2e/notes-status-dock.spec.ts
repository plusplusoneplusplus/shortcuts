/** Notes in a workspace panel leaves status actions in the workspace sidebar. */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { gotoWorkspace, openWorkspacePanel } from './fixtures/remote-shell';
import { seedWorkspace } from './fixtures/seed';
import { createRepoFixture } from './fixtures/repo-fixtures';

const WS_ID = 'ws-notes-dock';

test.describe('Notes page — status dock (remote-first shell)', () => {
    test('Notes panel keeps one workspace status footer and no global band', async ({
        page,
        serverUrl,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-notes-dock-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, WS_ID, `${WS_ID}-repo`, repoDir);
            // Control: on a non-notes surface (the repos landing) the app-wide
            // GlobalStatusDock band IS rendered — proving the remote-first shell
            // is genuinely active and the dock renders when appropriate. This
            // makes the "absent on notes" assertion below meaningful.
            await page.goto(serverUrl);
            await expect(page.locator('[data-testid="global-status-dock"]')).toBeVisible({
                timeout: 15_000,
            });

            await gotoWorkspace(page, serverUrl, WS_ID);
            await openWorkspacePanel(page, 'notes');

            // The notes view (with its own left sidebar) renders.
            const sidebar = page.locator('[data-testid="notes-sidebar"]');
            await expect(sidebar).toBeVisible({ timeout: 15_000 });
            await expect(page.locator('[data-testid="notes-content"]')).toBeVisible({ timeout: 5_000 });

            await page.getByTestId('unified-right-panel').locator('[role="tab"][data-kind="notes"]').focus();
            await page.keyboard.press('Escape');
            await expect(page.getByTestId('unified-right-panel')).toHaveAttribute('data-expanded', 'false');
            await expect(page.getByTestId('global-status-dock')).toHaveCount(0);
            await expect(sidebar.getByTestId('sidebar-status-actions')).toHaveCount(0);
            await expect(page.getByTestId('sidebar-status-actions')).toBeVisible();

            // The panel reaches the viewport bottom without reserving space
            // for another status footer below the editor.
            const viewport = page.viewportSize();
            const contentBox = await page.locator('[data-testid="notes-content"]').boundingBox();
            expect(contentBox).not.toBeNull();
            if (viewport && contentBox) {
                expect(contentBox.y + contentBox.height).toBeGreaterThan(viewport.height - 24);
            }
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
