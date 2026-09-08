/**
 * Mobile Workspace panel at 390×844 — the one-pane-at-a-time layout.
 *
 * On a phone the split "Workspace" panel used to stack the chat list, the git
 * list and the shared detail in one scrolling column, so a new chat and the
 * existing chat fought for the same viewport and the git half rendered its own
 * bulky inline header on top of the hoisted one. `SplitWorkspacePanel`'s
 * `isMobile` branch now shows a `Chats | Git` segmented control, exactly one
 * list at a time (the other kept alive with `display:none`), and pushes the
 * shared detail full-screen with a back control.
 *
 * The E2E server pins `features.splitWorkspacePanel: false` (see
 * fixtures/e2e-server-config.ts — the rest of the suite targets the classic
 * shell), so every test here flips it back on through the live admin API.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import type { Page } from '@playwright/test';
import { request, seedProcess, seedWorkspace } from './fixtures/seed';
import { createMultiCommitRepo } from './fixtures/git-fixtures';

/** iPhone 14/15-class viewport — the narrowest shape the layout targets. */
const PHONE = { width: 390, height: 844 };

const WS_ID = 'ws-mobile-workspace';
const WS_NAME = 'mobile-workspace-repo';
const CHAT_PREVIEW = 'Mobile workspace chat';

test.use({ viewport: PHONE, hasTouch: true });

/** Turn the split Workspace panel back on for this server instance. */
async function enableSplitWorkspacePanel(serverUrl: string): Promise<void> {
    const res = await request(`${serverUrl}/api/admin/config`, {
        method: 'PUT',
        body: JSON.stringify({ 'features.splitWorkspacePanel': true }),
    });
    if (res.status !== 200) {
        throw new Error(`Failed to enable splitWorkspacePanel: ${res.status} ${res.body}`);
    }
}

/**
 * Seed a git-backed workspace plus one chat, open its Workspace tab on a phone
 * and wait for the narrow split panel. Returns the temp dir the caller must
 * clean up.
 */
async function openMobileWorkspace(page: Page, serverUrl: string): Promise<string> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-mobile-ws-'));
    const repoDir = createMultiCommitRepo(tmpDir);

    await enableSplitWorkspacePanel(serverUrl);
    await seedWorkspace(serverUrl, WS_ID, WS_NAME, repoDir);
    await seedProcess(serverUrl, 'proc-mobile-ws-1', {
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

    // The Workspace tab keeps the chat tab's key — `chats` in the dev-workflow
    // shell, `activity` in classic — so accept either.
    const workspaceTab = page.locator(
        '[data-testid="mobile-tab-bar"] button[data-tab="chats"], [data-testid="mobile-tab-bar"] button[data-tab="activity"]',
    ).first();
    if (await workspaceTab.count() > 0) {
        await workspaceTab.tap();
    }

    const panel = page.locator('[data-testid="split-workspace-panel"][data-narrow="true"]');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    return tmpDir;
}

/** Switch to the Git segment and wait for the git list to take the viewport. */
async function showGitSegment(page: Page): Promise<void> {
    await page.locator('[data-testid="split-workspace-mobile-pane-git"]').tap();
    await expect(page.locator('[data-testid="split-workspace-git"]')).toBeVisible();
}

test.describe('Mobile Workspace panel (390×844)', () => {
    test('shows the segmented control and exactly one list pane at a time', async ({ page, serverUrl }) => {
        const tmpDir = await openMobileWorkspace(page, serverUrl);
        try {
            await expect(page.locator('[data-testid="split-workspace-mobile-switcher"]')).toBeVisible();

            const chatPane = page.locator('[data-testid="split-workspace-chat"]');
            const gitPane = page.locator('[data-testid="split-workspace-git"]');

            // Chats is the default segment: its pane is the only one in the
            // accessible tree, but the git pane stays mounted (keep-alive).
            await expect(chatPane).toBeVisible();
            await expect(gitPane).toBeHidden();
            await expect(gitPane).toHaveCount(1);

            await showGitSegment(page);
            await expect(chatPane).toBeHidden();
            await expect(chatPane).toHaveCount(1);

            // And back — still one pane, no unmount in either direction.
            await page.locator('[data-testid="split-workspace-mobile-pane-chat"]').tap();
            await expect(chatPane).toBeVisible();
            await expect(gitPane).toBeHidden();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('tapping a chat pushes the detail full-screen and back returns to the list', async ({ page, serverUrl }) => {
        const tmpDir = await openMobileWorkspace(page, serverUrl);
        try {
            const chatPane = page.locator('[data-testid="split-workspace-chat"]');
            const row = chatPane.locator('[data-task-id]').first();
            await expect(row).toBeVisible({ timeout: 15_000 });
            await row.tap();

            const detail = page.locator('[data-testid="split-workspace-detail"]');
            await expect(detail).toBeVisible({ timeout: 15_000 });
            // Full-screen means the list is gone and the switcher is replaced by
            // the back bar — no list and detail sharing the column.
            await expect(chatPane).toBeHidden();
            await expect(page.locator('[data-testid="split-workspace-mobile-switcher"]')).toHaveCount(0);

            await page.locator('[data-testid="split-workspace-mobile-back"]').tap();
            await expect(detail).toBeHidden();
            await expect(chatPane).toBeVisible();
            await expect(page.locator('[data-testid="split-workspace-mobile-switcher"]')).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('tapping a commit pushes the detail and back returns to the Git segment', async ({ page, serverUrl }) => {
        const tmpDir = await openMobileWorkspace(page, serverUrl);
        try {
            await showGitSegment(page);

            const commitRow = page.locator('[data-testid^="commit-row-"]').first();
            await expect(commitRow).toBeVisible({ timeout: 15_000 });
            await commitRow.tap();

            const detail = page.locator('[data-testid="split-workspace-detail"]');
            await expect(detail).toBeVisible({ timeout: 15_000 });
            await expect(page.locator('[data-testid="split-workspace-git"]')).toBeHidden();

            await page.locator('[data-testid="split-workspace-mobile-back"]').tap();
            // Back lands on the segment the user came from, not on Chats.
            await expect(page.locator('[data-testid="split-workspace-git"]')).toBeVisible();
            await expect(page.locator('[data-testid="split-workspace-panel"]')).toHaveAttribute('data-mobile-pane', 'git');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('renders exactly one git toolbar on the Git segment', async ({ page, serverUrl }) => {
        const tmpDir = await openMobileWorkspace(page, serverUrl);
        try {
            await showGitSegment(page);

            // The toolbar is hoisted into the panel's header slot and rendered
            // compact — the full inline branch-pill / Pull / sync block must not
            // also appear inside the git list.
            const header = page.locator('[data-testid="git-panel-header"]');
            await expect(header).toBeVisible({ timeout: 15_000 });
            await expect(header).toHaveCount(1);
            await expect(page.locator('[data-testid="split-workspace-git-header-extra"] [data-testid="git-panel-header"]')).toHaveCount(1);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('restores the last-used segment after a reload', async ({ page, serverUrl }) => {
        const tmpDir = await openMobileWorkspace(page, serverUrl);
        try {
            await showGitSegment(page);

            await page.reload();
            const panel = page.locator('[data-testid="split-workspace-panel"][data-narrow="true"]');
            await expect(panel).toBeVisible({ timeout: 15_000 });
            await expect(panel).toHaveAttribute('data-mobile-pane', 'git');
            await expect(page.locator('[data-testid="split-workspace-git"]')).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
