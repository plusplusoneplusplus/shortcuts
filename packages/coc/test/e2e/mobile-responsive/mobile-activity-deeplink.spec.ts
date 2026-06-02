/**
 * Mobile Activity Deep Link Tests — verify the per-repo Activity tab opens a
 * completed chat in detail view at mobile viewport without showing a blank
 * pane.
 *
 * Regression context (mobile blank-screen bug):
 *
 * On mobile, tapping a just-finished chat on the per-repo Activity page used
 * to render a blank screen. Two factors combined:
 *
 *   1. The Router unconditionally redirected `/activity` → `/chats` for
 *      non-virtual repos.
 *   2. In classic UI mode (the default), `RepoDetail` only rendered the
 *      chat surface when `activeSubTab === 'activity'`. The redirected
 *      `'chats'` value collapsed the wrapper to `display:none` ⇒ 0×0
 *      detail pane ⇒ blank screen.
 *
 * The fix (1) removes the redirect so `/activity/<id>` deep-links keep
 * `activeSubTab='activity'`, and (2) makes the `RepoDetail` chat-surface
 * wrapper accept BOTH `'activity'` and `'chats'` keys interchangeably so
 * cross-mode URLs render in either layout mode.
 *
 * These tests pin both URL forms × both layout modes to prevent regression.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, type Page } from '../fixtures/server-fixture';
import {
    request,
    seedQueueTask,
    seedWorkspace,
} from '../fixtures/seed';
import { MOBILE } from './viewports';

function makeTmpRoot(name: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), `coc-mob-${name}-`));
}

/**
 * Force a specific UI layout mode on the server so the test deterministically
 * exercises the classic-vs-dev-workflow rendering branch we want to cover.
 * The mode is global, so subsequent tests reset it to their desired value.
 */
async function setUiLayoutMode(serverUrl: string, mode: 'classic' | 'dev-workflow'): Promise<void> {
    const res = await request(`${serverUrl}/api/preferences`, {
        method: 'PATCH',
        body: JSON.stringify({ uiLayoutMode: mode }),
    });
    if (res.status >= 400) {
        throw new Error(`Failed to set uiLayoutMode=${mode}: ${res.status} ${res.body}`);
    }
}

/**
 * Clear client-side state that would mask the bug:
 *   - resizable left-panel widths (could leave a non-zero detail pane on a
 *     re-run even when the regression is back)
 *   - mobile-detail vs list view toggles
 *   - any cached layout-mode hint
 *
 * Must run after `page.goto` for at least one navigation so `localStorage` is
 * accessible (origin must be set).
 */
async function clearClientState(page: Page): Promise<void> {
    await page.evaluate(() => {
        try {
            localStorage.clear();
            sessionStorage.clear();
        } catch {
            // ignore — some test environments throw for cross-origin storage access.
        }
    });
}

/** Seed a queue chat task and wait for the executor to materialize a process. */
async function seedAndWaitForChat(
    serverUrl: string,
    overrides: Record<string, unknown>,
    timeoutMs = 10_000,
): Promise<{ taskId: string; processId: string }> {
    const task = await seedQueueTask(serverUrl, overrides as any);
    const taskId = task.id as string;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const res = await request(`${serverUrl}/api/queue/${taskId}`);
        if (res.status === 200) {
            const json = JSON.parse(res.body);
            const t = (json.task ?? json) as Record<string, unknown>;
            if (['completed', 'failed'].includes(t.status as string)) {
                const processId = (t.processId as string) ?? `queue_${taskId}`;
                return { taskId, processId };
            }
        }
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`Task ${taskId} did not complete within ${timeoutMs}ms`);
}

test.use({ viewport: MOBILE, hasTouch: true });

async function seedCompletedChat(
    serverUrl: string,
    workspaceId: string,
    displayName: string,
): Promise<{ taskId: string; processId: string }> {
    return seedAndWaitForChat(serverUrl, {
        type: 'chat',
        displayName,
        repoId: workspaceId,
        payload: { prompt: `Hello from ${displayName}`, workspaceId },
    });
}

/**
 * Hard-reload the page to `/#` so the SPA mounts fresh and picks up the
 * server-side uiLayoutMode preference.
 *
 * IMPORTANT: Workspaces must be seeded BEFORE calling this function so that
 * the repos list is populated when `fetchRepos()` fires on mount. A hash
 * change away from `/#` later (same origin) does NOT trigger a new page load
 * and will not re-fetch repos — the list must already contain the workspace.
 */
async function reloadWithMode(page: Page, serverUrl: string, mode: 'classic' | 'dev-workflow'): Promise<void> {
    await setUiLayoutMode(serverUrl, mode);
    await page.goto(`${serverUrl}/#`);
    await clearClientState(page);
}

/**
 * Walk through both URL aliases (`/activity/<id>` and `/chats/<id>`) under
 * the given UI layout mode. The chat detail must render with a non-zero
 * width in every cell.
 */
async function assertDeepLinkRendersDetail(
    page: Page,
    serverUrl: string,
    wsId: string,
    processId: string,
    urlSegment: 'activity' | 'chats',
): Promise<void> {
    // Hash change to the deep link.  The repos list is already populated
    // (workspace was seeded before page.goto(/#)), so selectedRepo resolves
    // immediately and RepoChatTab mounts with the correct selectedTaskId.
    await page.goto(`${serverUrl}/#repos/${wsId}/${urlSegment}/${encodeURIComponent(processId)}`);

    const detail = page.locator('[data-testid="activity-chat-detail"]');
    await expect(detail).toBeVisible({ timeout: 10000 });

    // The conversation pane must have a real width — the regression collapsed
    // it to 0px on the first paint even though the element existed.
    await expect.poll(
        async () => {
            const box = await detail.boundingBox();
            return box?.width ?? 0;
        },
        `activity-chat-detail (${urlSegment}) should have non-zero width on mobile`,
    ).toBeGreaterThan(200);

    // The mobile list should not also be visible — the detail pane replaces it.
    await expect(page.locator('[data-testid="activity-mobile-list"]')).toHaveCount(0);
}

test.describe('Mobile Activity Deep Link', () => {
    test.beforeEach(async ({ page }) => {
        // Ensure no stale localStorage from a previous spec leaks in
        await page.context().clearCookies();
    });

    test('mobile (classic mode): /activity/<taskId> deep-link renders detail pane with non-zero width', async ({ page, serverUrl }) => {
        // Seed workspace BEFORE reloadWithMode so fetchRepos() on page load
        // returns the workspace and the subsequent hash-change navigation finds it.
        const wsId = 'ws-mob-act-classic';
        await seedWorkspace(serverUrl, wsId, 'mob-act-classic-repo', makeTmpRoot('act-classic'));
        const { processId } = await seedCompletedChat(serverUrl, wsId, 'Mobile Activity Classic');

        await reloadWithMode(page, serverUrl, 'classic');
        await assertDeepLinkRendersDetail(page, serverUrl, wsId, processId, 'activity');
    });

    test('mobile (classic mode): /chats/<taskId> deep-link renders detail pane with non-zero width', async ({ page, serverUrl }) => {
        const wsId = 'ws-mob-chat-classic';
        await seedWorkspace(serverUrl, wsId, 'mob-chat-classic-repo', makeTmpRoot('chat-classic'));
        const { processId } = await seedCompletedChat(serverUrl, wsId, 'Mobile Chats Classic');

        await reloadWithMode(page, serverUrl, 'classic');
        await assertDeepLinkRendersDetail(page, serverUrl, wsId, processId, 'chats');
    });

    test('mobile (dev-workflow mode): /activity/<taskId> deep-link renders detail pane with non-zero width', async ({ page, serverUrl }) => {
        const wsId = 'ws-mob-act-dev';
        await seedWorkspace(serverUrl, wsId, 'mob-act-dev-repo', makeTmpRoot('act-dev'));
        const { processId } = await seedCompletedChat(serverUrl, wsId, 'Mobile Activity Dev');

        await reloadWithMode(page, serverUrl, 'dev-workflow');
        await assertDeepLinkRendersDetail(page, serverUrl, wsId, processId, 'activity');
    });

    test('mobile (dev-workflow mode): /chats/<taskId> deep-link renders detail pane with non-zero width', async ({ page, serverUrl }) => {
        const wsId = 'ws-mob-chat-dev';
        await seedWorkspace(serverUrl, wsId, 'mob-chat-dev-repo', makeTmpRoot('chat-dev'));
        const { processId } = await seedCompletedChat(serverUrl, wsId, 'Mobile Chats Dev');

        await reloadWithMode(page, serverUrl, 'dev-workflow');
        await assertDeepLinkRendersDetail(page, serverUrl, wsId, processId, 'chats');
    });

    test('mobile (classic mode): tap a just-completed chat in the activity list opens the detail pane full-width', async ({ page, serverUrl }) => {
        const wsId = 'ws-mob-tap-classic';
        await seedWorkspace(serverUrl, wsId, 'mob-tap-classic-repo', makeTmpRoot('tap-classic'));
        await seedCompletedChat(serverUrl, wsId, 'Just Finished Chat (Classic)');

        await reloadWithMode(page, serverUrl, 'classic');

        await page.goto(`${serverUrl}/#repos/${wsId}/activity`);

        // Wait for the activity list to render the seeded task
        await expect(page.locator('[data-testid="activity-mobile-list"]')).toBeVisible({ timeout: 10000 });
        const item = page.locator('[data-testid="activity-mobile-list"] [data-task-id]').first();
        await expect(item).toBeVisible({ timeout: 10000 });

        await item.tap();

        const detail = page.locator('[data-testid="activity-chat-detail"]');
        await expect(detail).toBeVisible({ timeout: 10000 });

        await expect.poll(async () => {
            const box = await detail.boundingBox();
            return box?.width ?? 0;
        }, 'activity-chat-detail should have non-zero width after tap').toBeGreaterThan(200);

        // After tapping a completed chat, the list pane is replaced by the detail.
        await expect(page.locator('[data-testid="activity-mobile-list"]')).toHaveCount(0);
    });

    test('mobile (dev-workflow mode): tap a just-completed chat in the chats list opens the detail pane full-width', async ({ page, serverUrl }) => {
        const wsId = 'ws-mob-tap-dev';
        await seedWorkspace(serverUrl, wsId, 'mob-tap-dev-repo', makeTmpRoot('tap-dev'));
        await seedCompletedChat(serverUrl, wsId, 'Just Finished Chat (Dev)');

        await reloadWithMode(page, serverUrl, 'dev-workflow');

        await page.goto(`${serverUrl}/#repos/${wsId}/chats`);

        await expect(page.locator('[data-testid="activity-mobile-list"]')).toBeVisible({ timeout: 10000 });
        const item = page.locator('[data-testid="activity-mobile-list"] [data-task-id]').first();
        await expect(item).toBeVisible({ timeout: 10000 });

        await item.tap();

        const detail = page.locator('[data-testid="activity-chat-detail"]');
        await expect(detail).toBeVisible({ timeout: 10000 });

        await expect.poll(async () => {
            const box = await detail.boundingBox();
            return box?.width ?? 0;
        }, 'activity-chat-detail should have non-zero width after tap').toBeGreaterThan(200);

        await expect(page.locator('[data-testid="activity-mobile-list"]')).toHaveCount(0);
    });
});
