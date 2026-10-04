/**
 * Mobile Activity Deep Link Tests — verify the per-repo Activity tab opens a
 * completed chat in detail view at mobile viewport without showing a blank
 * pane.
 *
 * Both URL aliases must open the outer Workspace detail, not merely mount a
 * conversation inside its hidden keep-alive slot.
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


/** Clear persisted layout state before the first SPA mount. */
async function clearClientState(page: Page): Promise<void> {
    await page.addInitScript(() => {
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
 * Walk through both URL aliases (`/activity/<id>` and `/chats/<id>`) under
 * the classic Workspace layout. The chat detail must render with a non-zero
 * width in every cell.
 */
async function assertDeepLinkRendersDetail(
    page: Page,
    serverUrl: string,
    wsId: string,
    processId: string,
    urlSegment: 'activity' | 'chats',
): Promise<void> {
    // Cold-load directly at the process link so selection precedes shell mount.
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

    await expect(page.getByTestId('split-workspace-panel')).toHaveAttribute('data-mobile-detail', 'true');
    await expect(page.getByTestId('split-workspace-chat')).toBeHidden();
    await expect(page.getByTestId('split-workspace-mobile-back')).toBeVisible();

    await page.reload();
    await expect(detail).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('split-workspace-chat')).toBeHidden();
}

test.describe('Mobile Activity Deep Link', () => {
    test.beforeEach(async ({ page }) => {
        // Ensure no stale localStorage from a previous spec leaks in
        await page.context().clearCookies();
        await clearClientState(page);
    });

    test('mobile (classic mode): /activity/<taskId> deep-link renders detail pane with non-zero width', async ({ page, serverUrl }) => {
        const wsId = 'ws-mob-act-classic';
        await seedWorkspace(serverUrl, wsId, 'mob-act-classic-repo', makeTmpRoot('act-classic'));
        const { processId } = await seedCompletedChat(serverUrl, wsId, 'Mobile Activity Classic');

        await assertDeepLinkRendersDetail(page, serverUrl, wsId, processId, 'activity');
    });

    test('mobile (classic mode): /chats/<taskId> deep-link renders detail pane with non-zero width', async ({ page, serverUrl }) => {
        const wsId = 'ws-mob-chat-classic';
        await seedWorkspace(serverUrl, wsId, 'mob-chat-classic-repo', makeTmpRoot('chat-classic'));
        const { processId } = await seedCompletedChat(serverUrl, wsId, 'Mobile Chats Classic');

        await assertDeepLinkRendersDetail(page, serverUrl, wsId, processId, 'chats');
    });

    test('mobile (classic mode): tap a just-completed chat in the activity list opens the detail pane full-width', async ({ page, serverUrl }) => {
        const wsId = 'ws-mob-tap-classic';
        await seedWorkspace(serverUrl, wsId, 'mob-tap-classic-repo', makeTmpRoot('tap-classic'));
        await seedCompletedChat(serverUrl, wsId, 'Just Finished Chat (Classic)');

        await page.goto(`${serverUrl}/#repos/${wsId}/activity`);

        // Wait for the activity list to render the seeded task
        const list = page.getByTestId('split-workspace-chat');
        await expect(list).toBeVisible({ timeout: 10000 });
        const item = list.locator('[data-task-id]').first();
        await expect(item).toBeVisible({ timeout: 10000 });

        await item.tap();

        const detail = page.locator('[data-testid="activity-chat-detail"]');
        await expect(detail).toBeVisible({ timeout: 10000 });

        await expect.poll(async () => {
            const box = await detail.boundingBox();
            return box?.width ?? 0;
        }, 'activity-chat-detail should have non-zero width after tap').toBeGreaterThan(200);

        await expect(list).toBeHidden();
        await page.getByTestId('split-workspace-mobile-back').tap();
        await expect(list).toBeVisible();
        await expect(detail).toBeHidden();
        await item.tap();
        await expect(detail).toBeVisible();
    });
});
