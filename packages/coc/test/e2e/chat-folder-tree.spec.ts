/**
 * Chat Folders — the tree, its CRUD, and filing from the row menu.
 *
 * This spec is the headless stand-in for the manual demos the goal spec
 * attaches to AC-04, AC-05 and AC-06 (each "Definition of Done 4"). Those
 * demos are all "enable the flag, reload, click through it and see it stick",
 * which is exactly what a real browser plus a real server can assert without a
 * human. The jsdom suites already cover the arithmetic and the per-mode
 * rendering; what only a live run can show is that the flag, the REST layer,
 * the optimistic update and the reload path agree with each other.
 *
 * DOM contract (kept in sync with ChatFolderSection.tsx):
 *   Section:        [data-section="folders"]
 *   Folder subtree: [data-testid="chat-folder"][data-folder-id="<id>"]
 *   Folder row:     [data-testid="chat-folder-row"]
 *   Members:        [data-testid="chat-folder-children"] > [data-task-id]
 *   Count:          [data-testid="chat-folder-count"]
 *   Chip on a row:  [data-testid="chat-folder-chip"]
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { nowRelativeIso, seedPlainChatAt } from './fixtures/chat-groups-seed';
import {
    createChatFolder,
    enableChatFolders,
    fileChatInFolder,
    folderMembers,
    folderNode,
    gotoActivity,
    listChatFolders,
    reloadActivity,
} from './fixtures/chat-folders-seed';
import type { Page } from '@playwright/test';

/** A completed chat that lands in the Today bucket. */
async function seedTodayChat(serverUrl: string, wsId: string, id: string, title: string): Promise<string> {
    return seedPlainChatAt(serverUrl, wsId, id, nowRelativeIso(-5), title);
}

/** Right-click a chat row and wait for the real portal menu. */
async function openRowMenu(page: Page, processId: string): Promise<void> {
    await page.locator(`[data-task-id="${processId}"]`).first().click({ button: 'right' });
    await expect(page.locator('[data-testid="context-menu"]')).toBeVisible({ timeout: 5_000 });
}

/** Click a menu item by its visible label, in the menu or in an open submenu. */
function menuItem(page: Page, label: string) {
    return page.locator('[role="menuitem"]', { hasText: label }).first();
}

async function makeWorkspace(serverUrl: string, slug: string): Promise<{ wsId: string; cleanup: () => void }> {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), `e2e-${slug}-`));
    const wsId = `${slug}-${Date.now().toString(36)}`;
    await seedWorkspace(serverUrl, wsId, slug, rootPath);
    return { wsId, cleanup: () => safeRmSync(rootPath) };
}

// Chat-folder membership is only visible to the SPA through the process
// summaries index, which only the SQLite store denormalizes `folderId` onto —
// and that is the product's default backend.
test.use({ processStoreBackend: 'sqlite' });

test.describe('Chat folders — tree, CRUD and filing', () => {
    let cleanup: () => void = () => {};

    test.afterEach(() => {
        cleanup();
        cleanup = () => {};
    });

    // ── AC-04 DoD 4 ────────────────────────────────────────────────────────
    test('filed chats leave their date bucket and collapse survives a reload', async ({ page, serverUrl }) => {
        const ws = await makeWorkspace(serverUrl, 'foldertree');
        cleanup = ws.cleanup;

        await seedTodayChat(serverUrl, ws.wsId, 'tree-filed-a', 'filed chat one');
        await seedTodayChat(serverUrl, ws.wsId, 'tree-filed-b', 'filed chat two');
        await seedTodayChat(serverUrl, ws.wsId, 'tree-loose', 'unfiled chat');
        await enableChatFolders(serverUrl);
        const folderId = await createChatFolder(serverUrl, ws.wsId, 'Auth rewrite');
        const emptyId = await createChatFolder(serverUrl, ws.wsId, 'Release 1.9');
        for (const id of ['tree-filed-a', 'tree-filed-b']) {
            await fileChatInFolder(serverUrl, id, folderId);
        }

        await gotoActivity(page, serverUrl, ws.wsId);

        // The section sits above the date buckets and shows both folders — an
        // empty-everywhere folder still renders, dimmed at 0.
        await expect(page.locator('[data-section="folders"]')).toBeVisible({ timeout: 10_000 });
        await expect(folderMembers(page, folderId)).toHaveCount(2);
        await expect(folderNode(page, folderId).locator('[data-testid="chat-folder-count"]')).toHaveText('2');
        await expect(folderNode(page, emptyId).locator('[data-testid="chat-folder-count"]')).toHaveText('0');

        // Filed rows are gone from Today; the unfiled one is still there.
        const today = page.locator('[data-section="completed-today"]');
        await expect(today.locator('[data-task-id="tree-loose"]')).toHaveCount(1);
        await expect(today.locator('[data-task-id="tree-filed-a"]')).toHaveCount(0);
        await expect(today.locator('[data-task-id="tree-filed-b"]')).toHaveCount(0);

        // The remaining half of the demo — a *running* filed chat keeping its
        // Running row and gaining a folder chip — is asserted in jsdom
        // (ChatListPane-folders.test.tsx) rather than here: the Running bucket
        // is fed by the in-memory task queue, not by process records, so an
        // e2e run cannot fabricate a running chat without driving a real
        // execution. What e2e does add is the filed row leaving Today, which
        // is the part that depends on the server round-trip.

        // Collapse is persisted client-side, per workspace — it survives a reload.
        await folderNode(page, folderId).locator('[data-testid="chat-folder-row"]').click();
        await expect(folderNode(page, folderId)).toHaveAttribute('data-expanded', 'false');

        await reloadActivity(page);
        await expect(folderNode(page, folderId)).toHaveAttribute('data-expanded', 'false', { timeout: 10_000 });
        await expect(folderMembers(page, folderId)).toHaveCount(0);
        // Still filed, though — collapsed is not unfiled.
        await expect(page.locator('[data-section="completed-today"] [data-task-id="tree-filed-a"]')).toHaveCount(0);
    });

    // ── AC-05 DoD 4 ────────────────────────────────────────────────────────
    test('create from the toolbar, rename with F2, and delete with undo', async ({ page, serverUrl }) => {
        const ws = await makeWorkspace(serverUrl, 'foldercrud');
        cleanup = ws.cleanup;

        await seedTodayChat(serverUrl, ws.wsId, 'crud-chat-a', 'chat to file');
        await seedTodayChat(serverUrl, ws.wsId, 'crud-loose', 'untouched chat');
        await enableChatFolders(serverUrl);

        await gotoActivity(page, serverUrl, ws.wsId);

        // Create: ＋folder, type, Enter.
        await page.locator('[data-testid="chat-list-new-folder-btn"]').first().click();
        const input = page.locator('[data-testid="chat-folder-name-input"]');
        await expect(input).toBeFocused();
        await input.fill('Password reset');
        await input.press('Enter');

        await expect(page.locator('[data-testid="chat-folder-name"]')).toHaveText('Password reset', { timeout: 10_000 });
        const folders = await listChatFolders(serverUrl, ws.wsId);
        expect(folders.map(f => f.name)).toEqual(['Password reset']);
        const folderId = folders[0].id;

        // Rename: F2 opens the inline editor, Esc reverts and writes nothing.
        const row = folderNode(page, folderId).locator('[data-testid="chat-folder-row"]');
        await row.focus();
        await row.press('F2');
        const renameInput = page.locator('[data-testid="chat-folder-name-input"]');
        await expect(renameInput).toBeVisible();
        await renameInput.fill('Something else');
        await renameInput.press('Escape');
        await expect(page.locator('[data-testid="chat-folder-name"]')).toHaveText('Password reset');
        expect((await listChatFolders(serverUrl, ws.wsId))[0].name).toBe('Password reset');

        // Rename again, this time committing.
        await row.focus();
        await row.press('F2');
        await page.locator('[data-testid="chat-folder-name-input"]').fill('Password reset flow');
        await page.locator('[data-testid="chat-folder-name-input"]').press('Enter');
        await expect(page.locator('[data-testid="chat-folder-name"]')).toHaveText('Password reset flow');
        await expect.poll(async () => (await listChatFolders(serverUrl, ws.wsId))[0].name).toBe('Password reset flow');

        // File a chat so the delete confirm has a count to name.
        await fileChatInFolder(serverUrl, 'crud-chat-a', folderId);
        await reloadActivity(page);
        await expect(folderMembers(page, folderId)).toHaveCount(1, { timeout: 10_000 });

        // Delete: the confirm must say the conversations survive.
        await folderNode(page, folderId).locator('[data-testid="chat-folder-menu-btn"]').click();
        await menuItem(page, 'Delete folder').click();
        const copy = page.locator('[data-testid="chat-folder-delete-copy"]');
        await expect(copy).toBeVisible();
        await expect(copy).toContainText('1 chat');
        await expect(copy).toContainText(/no conversations (are|will be)/i);
        await page.locator('[data-testid="chat-folder-delete-confirm"]').click();

        await expect(folderNode(page, folderId)).toHaveCount(0, { timeout: 10_000 });
        // The chat itself is untouched — it just falls back into Today.
        await expect(page.locator('[data-section="completed-today"] [data-task-id="crud-chat-a"]')).toHaveCount(1);

        // Undo restores the folder *and* its membership.
        await page.locator('[data-testid="chat-folder-undo-btn"]').click();
        await expect(page.locator('[data-testid="chat-folder-name"]')).toHaveText('Password reset flow', { timeout: 10_000 });
        const restored = await listChatFolders(serverUrl, ws.wsId);
        expect(restored).toHaveLength(1);
        await expect(folderMembers(page, restored[0].id)).toHaveCount(1);
        await expect(folderMembers(page, restored[0].id).first()).toHaveAttribute('data-task-id', 'crud-chat-a');
    });

    // ── AC-06 DoD 4 ────────────────────────────────────────────────────────
    test('move a chat into a folder from the row menu, then remove it again', async ({ page, serverUrl }) => {
        const ws = await makeWorkspace(serverUrl, 'foldermove');
        cleanup = ws.cleanup;

        await seedTodayChat(serverUrl, ws.wsId, 'move-chat', 'chat to move');
        await seedTodayChat(serverUrl, ws.wsId, 'move-other', 'other chat');
        await enableChatFolders(serverUrl);
        const folderId = await createChatFolder(serverUrl, ws.wsId, 'Perf: chat list', 'green');

        await gotoActivity(page, serverUrl, ws.wsId);
        await expect(folderNode(page, folderId)).toBeVisible({ timeout: 10_000 });

        await openRowMenu(page, 'move-chat');
        await menuItem(page, 'Move to folder').hover();
        await menuItem(page, 'Perf: chat list').click();

        await expect(folderMembers(page, folderId)).toHaveCount(1, { timeout: 10_000 });
        await expect(folderMembers(page, folderId).first()).toHaveAttribute('data-task-id', 'move-chat');
        await expect(page.locator('[data-section="completed-today"] [data-task-id="move-chat"]')).toHaveCount(0);

        // It is a real membership row, so a reload sees it too.
        await reloadActivity(page);
        await expect(folderMembers(page, folderId)).toHaveCount(1, { timeout: 10_000 });

        // "Remove from folder" only appears for a filed row, and puts it back.
        await openRowMenu(page, 'move-chat');
        await menuItem(page, 'Remove from folder').click();
        await expect(folderMembers(page, folderId)).toHaveCount(0, { timeout: 10_000 });
        await expect(page.locator('[data-section="completed-today"] [data-task-id="move-chat"]')).toHaveCount(1);

        // An unfiled row has nothing to remove.
        await openRowMenu(page, 'move-other');
        await expect(page.locator('[role="menuitem"]', { hasText: 'Remove from folder' })).toHaveCount(0);
    });
});
