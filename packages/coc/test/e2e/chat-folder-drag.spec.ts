/**
 * Chat Folders — drag to file, and it stays filed (AC-07 DoD 4).
 *
 * The jsdom suites cover the drop-target arithmetic; this one covers the part
 * jsdom cannot: a real HTML5 drag in a real browser, and the membership
 * surviving a reload. Everything else about folders (menus, create, archive)
 * has its own unit coverage — this spec deliberately stays narrow.
 *
 * DOM contract:
 *   Folder subtree:   [data-testid="chat-folder"][data-folder-id="<id>"]
 *   Folder row:       [data-testid="chat-folder-row"]
 *   Folder members:   [data-testid="chat-folder-children"] > [data-task-id]
 *   Member count:     [data-testid="chat-folder-count"]
 *   Chat row:         [data-task-id="<processId>"]
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { request, seedWorkspace } from './fixtures/seed';
import { seedPlainChat } from './fixtures/chat-groups-seed';
import type { Page } from '@playwright/test';

/**
 * `features.chatFolders` defaults to false and the shared E2E server config
 * keeps it off. It is a `runtime: 'live'` flag, so this must run BEFORE the
 * page load that should see folders.
 */
async function enableChatFolders(baseURL: string): Promise<void> {
    const res = await request(`${baseURL}/api/admin/config`, {
        method: 'PUT',
        body: JSON.stringify({ 'features.chatFolders': true }),
    });
    if (res.status !== 200) {
        throw new Error(`Failed to enable chat folders: ${res.status} ${res.body}`);
    }
}

async function createFolder(baseURL: string, wsId: string, name: string): Promise<string> {
    const res = await request(`${baseURL}/api/workspaces/${encodeURIComponent(wsId)}/chat-folders`, {
        method: 'POST',
        body: JSON.stringify({ name, color: 'purple' }),
    });
    if (res.status !== 200 && res.status !== 201) {
        throw new Error(`Failed to create chat folder: ${res.status} ${res.body}`);
    }
    return JSON.parse(res.body).folder.id as string;
}

async function gotoActivity(page: Page, serverUrl: string, wsId: string): Promise<void> {
    await page.goto(`${serverUrl}/#repos/${encodeURIComponent(wsId)}/activity`);
    await expect(page.locator('[data-testid="activity-split-panel"]')).toBeVisible({ timeout: 10_000 });
}

/** The rows currently rendered inside a folder, by process id. */
function folderMembers(page: Page, folderId: string) {
    return page.locator(
        `[data-testid="chat-folder"][data-folder-id="${folderId}"] [data-testid="chat-folder-children"] [data-task-id]`,
    );
}

test.describe('Chat folders — drag and drop (AC-07)', () => {
    let cleanup: () => void = () => {};

    test.afterEach(() => {
        cleanup();
        cleanup = () => {};
    });

    test('dragging a chat onto a folder files it, and it is still filed after a reload', async ({ page, serverUrl }) => {
        const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-folder-dnd-'));
        cleanup = () => safeRmSync(rootPath);
        const wsId = `folderdnd-${Date.now().toString(36)}`;
        await seedWorkspace(serverUrl, wsId, 'folderdnd', rootPath);

        await seedPlainChat(serverUrl, wsId, 'proc-dnd-a', 0, 'draggable chat');
        await seedPlainChat(serverUrl, wsId, 'proc-dnd-b', 1, 'bystander chat');
        await enableChatFolders(serverUrl);
        const folderId = await createFolder(serverUrl, wsId, 'Auth rewrite');

        await gotoActivity(page, serverUrl, wsId);

        const folder = page.locator(`[data-testid="chat-folder"][data-folder-id="${folderId}"]`);
        await expect(folder).toBeVisible({ timeout: 10_000 });
        await expect(folderMembers(page, folderId)).toHaveCount(0);

        const chatRow = page.locator('[data-task-id="proc-dnd-a"]').first();
        await expect(chatRow).toBeVisible();
        await chatRow.dragTo(folder.locator('[data-testid="chat-folder-row"]'));

        // The row leaves its date bucket and reappears under the folder.
        await expect(folderMembers(page, folderId)).toHaveCount(1, { timeout: 10_000 });
        await expect(folderMembers(page, folderId).first()).toHaveAttribute('data-task-id', 'proc-dnd-a');
        await expect(folder.locator('[data-testid="chat-folder-count"]')).toHaveText('1');

        // Filing is a server-side membership row, not local state — so it
        // survives a full reload of the SPA.
        await gotoActivity(page, serverUrl, wsId);
        await expect(folderMembers(page, folderId)).toHaveCount(1, { timeout: 10_000 });
        await expect(folderMembers(page, folderId).first()).toHaveAttribute('data-task-id', 'proc-dnd-a');
        // The chat that was never dragged stays where it was.
        await expect(page.locator(`[data-testid="chat-folder"][data-folder-id="${folderId}"] [data-task-id="proc-dnd-b"]`))
            .toHaveCount(0);
    });
});
