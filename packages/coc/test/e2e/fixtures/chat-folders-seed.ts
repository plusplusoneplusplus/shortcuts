/**
 * The folder REST surface (AC-02) is the fastest way to put a workspace into a
 * known folder state before the SPA loads, so the browser part of a spec can
 * stay focused on the interaction under test rather than on setup clicking.
 *
 * `features.chatFolders` defaults to false and the shared E2E server config
 * keeps it off. It is a `runtime: 'live'` flag, so `enableChatFolders` must run
 * BEFORE the page load that should see folders.
 */

import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { request } from './seed';

export interface SeededChatFolder {
    id: string;
    name: string;
    color: string;
    sortIndex: number;
}

/** Turn the folder feature on for the whole server. Call before `page.goto`. */
export async function enableChatFolders(baseURL: string): Promise<void> {
    const res = await request(`${baseURL}/api/admin/config`, {
        method: 'PUT',
        body: JSON.stringify({ 'features.chatFolders': true }),
    });
    if (res.status !== 200) {
        throw new Error(`Failed to enable chat folders: ${res.status} ${res.body}`);
    }
}

/** Create one folder via the REST API. Returns its id. */
export async function createChatFolder(
    baseURL: string,
    wsId: string,
    name: string,
    color = 'purple',
): Promise<string> {
    const res = await request(`${baseURL}/api/workspaces/${encodeURIComponent(wsId)}/chat-folders`, {
        method: 'POST',
        body: JSON.stringify({ name, color }),
    });
    if (res.status !== 200 && res.status !== 201) {
        throw new Error(`Failed to create chat folder: ${res.status} ${res.body}`);
    }
    return JSON.parse(res.body).folder.id as string;
}

/** The folders a workspace currently has, in the server's own order. */
export async function listChatFolders(baseURL: string, wsId: string): Promise<SeededChatFolder[]> {
    const res = await request(`${baseURL}/api/workspaces/${encodeURIComponent(wsId)}/chat-folders`);
    if (res.status !== 200) {
        throw new Error(`Failed to list chat folders: ${res.status} ${res.body}`);
    }
    return JSON.parse(res.body).folders as SeededChatFolder[];
}

/** File one process into a folder (or unfile it with `null`). */
export async function fileChatInFolder(
    baseURL: string,
    processId: string,
    folderId: string | null,
): Promise<void> {
    const res = await request(`${baseURL}/api/processes/${encodeURIComponent(processId)}/folder`, {
        method: 'PATCH',
        body: JSON.stringify({ folderId }),
    });
    if (res.status !== 200) {
        throw new Error(`Failed to file ${processId}: ${res.status} ${res.body}`);
    }
}

/** Load a workspace's Activity tab and wait for the list to be up. */
export async function gotoActivity(page: Page, serverUrl: string, wsId: string): Promise<void> {
    await page.goto(`${serverUrl}/#repos/${encodeURIComponent(wsId)}/activity`);
    await expect(page.locator('[data-testid="activity-split-panel"]')).toBeVisible({ timeout: 10_000 });
}

/**
 * Reload the SPA from scratch.
 *
 * NOT `gotoActivity` twice: navigating to the URL the page is already on is a
 * same-document hash navigation, so React state (and anything optimistic in
 * it) survives — which would quietly turn a "does this persist?" assertion
 * into a no-op. `page.reload()` really tears the app down.
 */
export async function reloadActivity(page: Page): Promise<void> {
    await page.reload();
    await expect(page.locator('[data-testid="activity-split-panel"]')).toBeVisible({ timeout: 10_000 });
}

/** The folder subtree node, addressed by id — never by position. */
export function folderNode(page: Page, folderId: string) {
    return page.locator(`[data-testid="chat-folder"][data-folder-id="${folderId}"]`);
}

/** The rows currently rendered inside a folder, by process id. */
export function folderMembers(page: Page, folderId: string) {
    return folderNode(page, folderId).locator('[data-testid="chat-folder-children"] [data-task-id]');
}
