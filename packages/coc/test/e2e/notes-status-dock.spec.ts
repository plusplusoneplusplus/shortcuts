/**
 * Notes page — status dock regression (remote-first shell)
 *
 * Regression: on a workspace's Notes sub-tab the app-wide `GlobalStatusDock`
 * painted a partial-width bottom band the width of the left sidebar column,
 * leaving an empty white strip beneath the note editor to its right — because
 * the notes view was never registered among the pages that dock the status
 * cluster in their own left-column footer (Admin, My Work, chat/activity).
 *
 * Fix: `NotesView` docks the cluster in its own `NotesSidebar` footer
 * (`dockStatusFooter`) and `GlobalStatusDock` stands down on the notes sub-tab,
 * so the editor pane keeps full height and no partial-width band is painted.
 *
 * The default E2E config pins `features.remoteShell` off (the classic shell has
 * no docked status cluster at all), so this spec forces the remote-first shell
 * on by overriding GET /api/config/runtime.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { createRepoFixture } from './fixtures/repo-fixtures';

const WS_ID = 'ws-notes-dock';

/**
 * Force the remote-first shell on regardless of the E2E server's pinned-off
 * config by merging `remoteShellEnabled: true` into GET /api/config/runtime.
 * The App renders only after `loadRuntimeConfig()` resolves, so the flag is in
 * effect on the very first render.
 */
async function enableRemoteShell(page: import('@playwright/test').Page): Promise<void> {
    await page.route('**/api/config/runtime', async (route) => {
        try {
            const resp = await route.fetch();
            const json = await resp.json();
            const features = { ...(json.features ?? {}), remoteShellEnabled: true };
            await route.fulfill({
                status: resp.status(),
                headers: { ...resp.headers(), 'content-type': 'application/json' },
                body: JSON.stringify({ ...json, features }),
            });
        } catch {
            await route.continue().catch(() => {});
        }
    });
}

test.describe('Notes page — status dock (remote-first shell)', () => {
    test('notes sub-tab docks the status cluster in its own sidebar, no global band', async ({
        page,
        serverUrl,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-notes-dock-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, WS_ID, `${WS_ID}-repo`, repoDir);
            await enableRemoteShell(page);

            // Control: on a non-notes surface (the repos landing) the app-wide
            // GlobalStatusDock band IS rendered — proving the remote-first shell
            // is genuinely active and the dock renders when appropriate. This
            // makes the "absent on notes" assertion below meaningful.
            await page.goto(serverUrl);
            await expect(page.locator('[data-testid="global-status-dock"]')).toBeVisible({
                timeout: 15_000,
            });

            // Navigate to the workspace Notes sub-tab.
            await page.evaluate((id) => {
                location.hash = `#repos/${id}/notes`;
            }, WS_ID);

            // The notes view (with its own left sidebar) renders.
            const sidebar = page.locator('[data-testid="notes-sidebar"]');
            await expect(sidebar).toBeVisible({ timeout: 15_000 });
            await expect(page.locator('[data-testid="notes-content"]')).toBeVisible({ timeout: 5_000 });

            // Fix #1 — the app-wide partial-width status band stands down on the
            // notes sub-tab, so no empty strip is painted beside the editor.
            await expect(page.locator('[data-testid="global-status-dock"]')).toHaveCount(0, {
                timeout: 5_000,
            });

            // Fix #2 — the status/action cluster is now docked INSIDE the notes
            // sidebar footer, keeping the editor pane full height.
            await expect(sidebar.locator('[data-testid="sidebar-status-actions"]')).toBeVisible({
                timeout: 5_000,
            });

            // The editor column extends to (near) the viewport bottom — there is
            // no reserved band beneath it. The docked footer lives in the left
            // sidebar column, not below the editor.
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
