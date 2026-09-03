/**
 * Tests the REST API for filing whole chat *groups* into chat folders, plus
 * the JSON sidecar behind it, against a real SqliteProcessStore through the
 * actual server.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '../../src/server/types';
import type { ChatFolder } from '../../src/server/processes/chat-folder-handler';
import {
    GROUP_FOLDER_TYPES,
    GroupFolderStore,
    getGroupFolderKey,
    normalizeGroupFolderId,
    normalizeGroupFolderType,
    parseGroupFolderKey,
} from '../../src/server/processes/group-folder-store';

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: options.headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') });
                });
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function withJSON(method: string) {
    return (url: string, data?: unknown) =>
        request(url, {
            method,
            body: data === undefined ? undefined : JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        });
}

const postJSON = withJSON('POST');
const patchJSON = withJSON('PATCH');
const deleteJSON = withJSON('DELETE');

// ============================================================================
// Pure helpers
// ============================================================================

describe('group folder keys', () => {
    it('accepts exactly the four group types and rejects anything else', () => {
        for (const type of GROUP_FOLDER_TYPES) {
            expect(normalizeGroupFolderType(type)).toBe(type);
        }
        expect(normalizeGroupFolderType('spawned-tree')).toBe('spawned-tree');
        expect(normalizeGroupFolderType('chat-folder')).toBeUndefined();
        expect(normalizeGroupFolderType('')).toBeUndefined();
        expect(normalizeGroupFolderType(7)).toBeUndefined();
    });

    it('round-trips a group id that itself contains a colon', () => {
        const key = getGroupFolderKey('spawned-tree', 'proc:123:abc');
        expect(parseGroupFolderKey(key)).toEqual({ type: 'spawned-tree', groupId: 'proc:123:abc' });
        expect(parseGroupFolderKey('nope:1')).toBeUndefined();
        expect(parseGroupFolderKey(':1')).toBeUndefined();
        expect(parseGroupFolderKey('ralph-session')).toBeUndefined();
    });

    it('trims group ids and rejects blank ones', () => {
        expect(normalizeGroupFolderId('  run-1 ')).toBe('run-1');
        expect(normalizeGroupFolderId('   ')).toBeUndefined();
        expect(normalizeGroupFolderId(null)).toBeUndefined();
    });
});

describe('GroupFolderStore', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-group-folder-store-'));
    });
    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('sets, reads, overwrites and clears an assignment', () => {
        const store = new GroupFolderStore(tmpDir);
        expect(store.getFolderMap('ws-1')).toEqual({});

        store.setFolder('ws-1', 'ralph-session', 'sess-1', 'folder-a', '2026-01-01T00:00:00.000Z');
        expect(store.getFolderId('ws-1', 'ralph-session', 'sess-1')).toBe('folder-a');

        store.setFolder('ws-1', 'ralph-session', 'sess-1', 'folder-b', '2026-01-02T00:00:00.000Z');
        expect(store.getFolderMap('ws-1')).toEqual({ 'ralph-session:sess-1': 'folder-b' });

        store.clearFolder('ws-1', 'ralph-session', 'sess-1', '2026-01-03T00:00:00.000Z');
        expect(store.getFolderMap('ws-1')).toEqual({});
    });

    it('keeps workspaces isolated', () => {
        const store = new GroupFolderStore(tmpDir);
        store.setFolder('ws-1', 'for-each-run', 'run-1', 'folder-a', '2026-01-01T00:00:00.000Z');
        expect(store.getFolderMap('ws-2')).toEqual({});
    });

    it('clearFolderEverywhere unfiles only the groups in that folder', () => {
        const store = new GroupFolderStore(tmpDir);
        const at = '2026-01-01T00:00:00.000Z';
        store.setFolder('ws-1', 'ralph-session', 'sess-1', 'folder-a', at);
        store.setFolder('ws-1', 'spawned-tree', 'root-1', 'folder-a', at);
        store.setFolder('ws-1', 'map-reduce-run', 'run-9', 'folder-b', at);

        const removed = store.clearFolderEverywhere('ws-1', 'folder-a', '2026-01-02T00:00:00.000Z');
        expect(removed.sort()).toEqual(['ralph-session:sess-1', 'spawned-tree:root-1']);
        expect(store.getFolderMap('ws-1')).toEqual({ 'map-reduce-run:run-9': 'folder-b' });

        // Nothing left pointing at folder-a — a second delete is a no-op.
        expect(store.clearFolderEverywhere('ws-1', 'folder-a', '2026-01-03T00:00:00.000Z')).toEqual([]);
    });

    it('drops entries whose key no longer parses instead of throwing', () => {
        const store = new GroupFolderStore(tmpDir);
        store.setFolder('ws-1', 'ralph-session', 'sess-1', 'folder-a', '2026-01-01T00:00:00.000Z');

        const statePath = (store as unknown as { statePath(ws: string): string })['statePath']('ws-1');
        const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
        state.groups['retired-group-type:x'] = 'folder-a';
        state.groups['ralph-session:ok-but-blank'] = '';
        fs.writeFileSync(statePath, JSON.stringify(state));

        expect(store.getFolderMap('ws-1')).toEqual({ 'ralph-session:sess-1': 'folder-a' });
    });
});

// ============================================================================
// Routes
// ============================================================================

describe('Group Folder REST API', () => {
    let server: ExecutionServer;
    let baseUrl: string;
    let tmpDir: string;
    let store: SqliteProcessStore;
    let wsId: string;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-group-folder-'));
        store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
        await store.registerWorkspace({ id: 'ws-group-folder', name: 'Group Folder WS', rootPath: '/tmp/test-repo' });

        server = await createExecutionServer({ port: 0, dataDir: tmpDir, store });
        baseUrl = server.url;

        const workspaces = await store.getWorkspaces();
        wsId = workspaces.find(ws => ws.name === 'Group Folder WS')!.id;
    });

    afterEach(async () => {
        await server.close();
        store.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    async function createFolder(name: string): Promise<ChatFolder> {
        const res = await postJSON(`${baseUrl}/api/workspaces/${wsId}/chat-folders`, { name });
        expect(res.status).toBe(200);
        return JSON.parse(res.body).folder as ChatFolder;
    }

    async function readGroupFolders(): Promise<Record<string, string>> {
        const res = await request(`${baseUrl}/api/workspaces/${wsId}/group-folders`);
        expect(res.status).toBe(200);
        return JSON.parse(res.body).groups as Record<string, string>;
    }

    function groupFolderUrl(type: string, groupId: string) {
        return `${baseUrl}/api/workspaces/${wsId}/group-folders/${encodeURIComponent(type)}/${encodeURIComponent(groupId)}`;
    }

    it('files a ralph session, then unfiles it with null', async () => {
        const folder = await createFolder('Auth rewrite');

        const filed = await patchJSON(groupFolderUrl('ralph-session', 'sess-1'), { folderId: folder.id });
        expect(filed.status).toBe(200);
        expect(JSON.parse(filed.body)).toMatchObject({
            type: 'ralph-session',
            groupId: 'sess-1',
            folderId: folder.id,
        });

        expect(await readGroupFolders()).toEqual({ [`ralph-session:sess-1`]: folder.id });

        const unfiled = await patchJSON(groupFolderUrl('ralph-session', 'sess-1'), { folderId: null });
        expect(unfiled.status).toBe(200);
        expect(JSON.parse(unfiled.body).folderId).toBeNull();
        expect(await readGroupFolders()).toEqual({});
    });

    it('files each of the four group types, including spawned-tree', async () => {
        const folder = await createFolder('Everything');
        for (const type of GROUP_FOLDER_TYPES) {
            const res = await patchJSON(groupFolderUrl(type, `g-${type}`), { folderId: folder.id });
            expect(res.status).toBe(200);
        }
        const map = await readGroupFolders();
        expect(Object.keys(map).sort()).toEqual(
            GROUP_FOLDER_TYPES.map(type => `${type}:g-${type}`).sort(),
        );
    });

    it('moves a group between folders without leaving the old assignment', async () => {
        const a = await createFolder('A');
        const b = await createFolder('B');
        await patchJSON(groupFolderUrl('for-each-run', 'run-1'), { folderId: a.id });
        await patchJSON(groupFolderUrl('for-each-run', 'run-1'), { folderId: b.id });
        expect(await readGroupFolders()).toEqual({ 'for-each-run:run-1': b.id });
    });

    it('rejects an unknown group type with 400', async () => {
        const folder = await createFolder('Auth rewrite');
        const res = await patchJSON(groupFolderUrl('chat-folder', 'sess-1'), { folderId: folder.id });
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).error).toMatch(/group type/i);
    });

    it('rejects a missing folder with 404 and a bad body with 400', async () => {
        const missing = await patchJSON(groupFolderUrl('ralph-session', 'sess-1'), { folderId: 'folder-nope' });
        expect(missing.status).toBe(404);

        const bad = await patchJSON(groupFolderUrl('ralph-session', 'sess-1'), { folderId: 42 });
        expect(bad.status).toBe(400);

        expect(await readGroupFolders()).toEqual({});
    });

    it('404s an unknown workspace', async () => {
        const res = await request(`${baseUrl}/api/workspaces/ws-does-not-exist/group-folders`);
        expect(res.status).toBe(404);
    });

    it('deleting the folder unfiles its groups and reports them', async () => {
        const folder = await createFolder('Auth rewrite');
        const other = await createFolder('Keep me');
        await patchJSON(groupFolderUrl('ralph-session', 'sess-1'), { folderId: folder.id });
        await patchJSON(groupFolderUrl('spawned-tree', 'root-1'), { folderId: folder.id });
        await patchJSON(groupFolderUrl('map-reduce-run', 'run-9'), { folderId: other.id });

        const res = await deleteJSON(`${baseUrl}/api/workspaces/${wsId}/chat-folders/${folder.id}`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.deleted).toBe(true);
        expect([...body.unfiledGroups].sort()).toEqual(['ralph-session:sess-1', 'spawned-tree:root-1']);

        expect(await readGroupFolders()).toEqual({ 'map-reduce-run:run-9': other.id });
    });
});
