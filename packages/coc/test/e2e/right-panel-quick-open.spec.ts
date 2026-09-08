/**
 * Ctrl+P / Ctrl+O in the desktop unified right panel.
 *
 * The regression: the shortcut handler lived inside `ExplorerPanel`, and the
 * panel only mounts one while its file-tree column is open — so with the column
 * collapsed (the default) nothing listened at all, and Ctrl+P in the right panel
 * did nothing but offer to print the page.
 *
 * These cases drive the real thing end to end: open the panel with its tree
 * column collapsed, press Ctrl+P, pick a nested file, and check that it lands as
 * a right-panel tab with the tree column revealed on it.
 *
 * The E2E server pins `features.splitWorkspacePanel: false` (see
 * fixtures/e2e-server-config.ts — the rest of the suite targets the classic
 * shell), so each test flips it back on through the live admin API.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Page } from '@playwright/test';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { request, seedProcess, seedWorkspace } from './fixtures/seed';
import { createMultiCommitRepo } from './fixtures/git-fixtures';

const WS_ID = 'ws-rp-quick-open';
const WS_NAME = 'rp-quick-open-repo';
const CHAT_PREVIEW = 'Right panel quick open chat';

/** The nested file the picker is pointed at — `src/` must expand to reveal it. */
const TARGET_PATH = 'src/utils.ts';
const TARGET_NAME = 'utils.ts';

/**
 * Seed a git-backed workspace plus one chat, open its detail page on a desktop
 * viewport, and open the right panel with its tree column still collapsed.
 * Returns the temp dir the caller must clean up.
 */
async function openRightPanel(page: Page, serverUrl: string): Promise<string> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-rp-qo-'));
    const repoDir = createMultiCommitRepo(tmpDir);

    const res = await request(`${serverUrl}/api/admin/config`, {
        method: 'PUT',
        body: JSON.stringify({ 'features.splitWorkspacePanel': true }),
    });
    if (res.status !== 200) {
        throw new Error(`Failed to enable splitWorkspacePanel: ${res.status} ${res.body}`);
    }

    await seedWorkspace(serverUrl, WS_ID, WS_NAME, repoDir);
    await seedProcess(serverUrl, 'proc-rp-qo-1', {
        workspaceId: WS_ID,
        promptPreview: CHAT_PREVIEW,
        type: 'chat',
        status: 'completed',
    });
    await request(`${serverUrl}/api/preferences`, {
        method: 'PATCH',
        body: JSON.stringify({
            hasSeenWelcome: true,
            onboardingProgress: { dismissed: true, hasCompletedTour: true },
        }),
    });

    await page.goto(`${serverUrl}/#repos/${WS_ID}`);
    await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 15_000 });

    // The panel starts collapsed; the header toggle is the way in.
    const panel = page.locator('[data-testid="unified-right-panel"]');
    const toggle = page.locator('[data-testid="workspace-dock-toggle"]').first();
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    if ((await panel.getAttribute('data-open')) !== 'true') {
        await toggle.click();
    }
    await expect(panel).toHaveAttribute('data-open', 'true', { timeout: 10_000 });

    // The whole point: no file-tree column, so on the old code there is no
    // ExplorerPanel mounted and therefore no Ctrl+P listener anywhere.
    await expect(page.locator('[data-testid="unified-panel-tree"]')).toHaveCount(0);

    return tmpDir;
}

test.describe('Right panel quick open', () => {
    test('Ctrl+P with the tree column collapsed opens a file as a panel tab and reveals it', async ({ page, serverUrl }) => {
        const tmpDir = await openRightPanel(page, serverUrl);
        try {
            await page.keyboard.press('Control+p');

            const dialog = page.locator('[data-testid="quick-open-dialog"]');
            await expect(dialog).toBeVisible({ timeout: 10_000 });

            await page.locator('[data-testid="quick-open-input"]').fill(TARGET_NAME);
            await expect(page.locator('[data-testid="quick-open-item-0"]')).toBeVisible({ timeout: 10_000 });
            await page.keyboard.press('Enter');

            await expect(dialog).toHaveCount(0, { timeout: 10_000 });

            // The file is a right-panel tab, not an Explorer-tab buffer.
            const tabLabel = page
                .locator('[data-testid="unified-right-panel"] [data-testid^="unified-panel-tab-label-"]')
                .filter({ hasText: TARGET_NAME });
            await expect(tabLabel).toHaveCount(1, { timeout: 10_000 });

            // Picking auto-opens the tree column and expands the file's
            // ancestors, so the row itself is on screen — not just the column.
            const tree = page.locator('[data-testid="unified-panel-tree"]');
            await expect(tree).toBeVisible({ timeout: 10_000 });
            await expect(tree.locator(`[data-testid="tree-node-${TARGET_PATH}"]`)).toBeVisible({ timeout: 15_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('Ctrl+P works from inside a panel file buffer, and opens exactly one dialog', async ({ page, serverUrl }) => {
        const tmpDir = await openRightPanel(page, serverUrl);
        try {
            // First file, so there is a Monaco buffer in the panel to focus.
            await page.keyboard.press('Control+p');
            await expect(page.locator('[data-testid="quick-open-dialog"]')).toBeVisible({ timeout: 10_000 });
            await page.locator('[data-testid="quick-open-input"]').fill('index.ts');
            await expect(page.locator('[data-testid="quick-open-item-0"]')).toBeVisible({ timeout: 10_000 });
            await page.keyboard.press('Enter');
            await expect(page.locator('[data-testid="quick-open-dialog"]')).toHaveCount(0, { timeout: 10_000 });

            // Click into the code. Ctrl+P there used to reach Monaco's own
            // keybinding (or the browser's print dialog) rather than the panel.
            const editor = page.locator('[data-testid="unified-right-panel"] .monaco-editor').first();
            await expect(editor).toBeVisible({ timeout: 20_000 });
            await editor.click();

            await page.keyboard.press('Control+p');
            // Exactly one — never the Explorer tab's dialog stacked on the
            // panel's, which is what two document listeners used to produce.
            await expect(page.locator('[data-testid="quick-open-dialog"]')).toHaveCount(1, { timeout: 10_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('Ctrl+O opens Exact Open against the panel', async ({ page, serverUrl }) => {
        const tmpDir = await openRightPanel(page, serverUrl);
        try {
            await page.keyboard.press('Control+o');
            await expect(page.locator('[data-testid="exact-open-dialog"]')).toBeVisible({ timeout: 10_000 });
            await expect(page.locator('[data-testid="quick-open-dialog"]')).toHaveCount(0);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
