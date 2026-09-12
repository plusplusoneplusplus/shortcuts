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
const GROUP_MEMBER_A = 'ws-rp-qo-group-a';
const GROUP_MEMBER_B = 'ws-rp-qo-group-b';
const GROUP_TARGET_PATH = 'group-only/member-b-target.ts';
const GROUP_TARGET_NAME = 'member-b-target.ts';

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

    // The panel starts collapsed; the single header toggle is the way in.
    const panel = page.locator('[data-testid="unified-right-panel"]');
    const panelToggle = page.locator('[data-testid="workspace-dock-toggle"]').first();
    await expect(panelToggle).toBeVisible({ timeout: 15_000 });
    if ((await panel.getAttribute('data-open')) !== 'true') {
        await panelToggle.click();
    }
    await expect(panel).toHaveAttribute('data-open', 'true', { timeout: 10_000 });

    // The whole point: no file-tree column, so on the old code there is no
    // ExplorerPanel mounted and therefore no Ctrl+P listener anywhere.
    await expect(page.locator('[data-testid="unified-panel-tree"]')).toHaveCount(0);

    return tmpDir;
}

async function openGroupWithClosedPanel(
    page: Page,
    serverUrl: string,
): Promise<{ tmpDir: string; groupId: string }> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-rp-qo-group-'));
    const repoA = createMultiCommitRepo(path.join(tmpDir, 'a'));
    const repoB = createMultiCommitRepo(path.join(tmpDir, 'b'));
    const target = path.join(repoB, GROUP_TARGET_PATH);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'export const memberB = true;\n');

    const config = await request(`${serverUrl}/api/admin/config`, {
        method: 'PUT',
        body: JSON.stringify({ 'features.splitWorkspacePanel': true }),
    });
    if (config.status !== 200) {
        throw new Error(`Failed to enable splitWorkspacePanel: ${config.status} ${config.body}`);
    }
    await seedWorkspace(serverUrl, GROUP_MEMBER_A, 'group-member-a', repoA);
    await seedWorkspace(serverUrl, GROUP_MEMBER_B, 'group-member-b', repoB);
    const group = await request(`${serverUrl}/api/repo-groups`, {
        method: 'POST',
        body: JSON.stringify({
            name: 'Quick Open Group',
            members: [GROUP_MEMBER_A, GROUP_MEMBER_B],
        }),
    });
    if (group.status !== 201) {
        throw new Error(`Failed to create repo group: ${group.status} ${group.body}`);
    }
    const groupId = JSON.parse(group.body).workspace.id as string;
    await request(`${serverUrl}/api/preferences`, {
        method: 'PATCH',
        body: JSON.stringify({
            hasSeenWelcome: true,
            onboardingProgress: { dismissed: true, hasCompletedTour: true },
        }),
    });

    await page.goto(`${serverUrl}/#repos/${groupId}`);
    await expect(page.getByTestId('repo-group-view')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('unified-right-panel')).toHaveAttribute('data-open', 'false');
    return { tmpDir, groupId };
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

    test('Ctrl+P in a group with the panel closed searches all members and opens the owning repo', async ({ page, serverUrl }) => {
        const { tmpDir, groupId } = await openGroupWithClosedPanel(page, serverUrl);
        try {
            await page.keyboard.press('Control+p');
            const dialog = page.getByTestId('quick-open-dialog');
            await expect(dialog).toBeVisible({ timeout: 10_000 });
            await expect(page.getByTestId('unified-right-panel')).toHaveAttribute('data-open', 'false');

            await page.getByTestId('quick-open-input').fill(GROUP_TARGET_NAME);
            const result = page.getByRole('option', {
                name: `${GROUP_TARGET_NAME}, group-only, group-member-b`,
            });
            await expect(result).toBeVisible({ timeout: 15_000 });
            await expect(result.getByTestId('quick-open-repo-0')).toHaveText('group-member-b');
            await page.keyboard.press('Enter');

            await expect(dialog).toHaveCount(0, { timeout: 10_000 });
            const panel = page.getByTestId('unified-right-panel');
            await expect(panel).toHaveAttribute('data-open', 'true', { timeout: 10_000 });
            await expect(
                panel.locator('[data-testid^="unified-panel-tab-label-"]').filter({ hasText: GROUP_TARGET_NAME }),
            ).toHaveCount(1);

            await panel.getByTestId('unified-panel-open-menu').click();
            await expect(panel.getByTestId('unified-panel-open-menu-repo')).toHaveValue(GROUP_MEMBER_B);
            await expect(panel.getByTestId('unified-panel-tree')).toBeVisible();
            await expect(panel.getByTestId(`tree-node-${GROUP_TARGET_PATH}`)).toBeVisible({ timeout: 15_000 });
            await expect(page.getByTestId('repo-group-view')).toHaveAttribute('data-workspace', groupId);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
