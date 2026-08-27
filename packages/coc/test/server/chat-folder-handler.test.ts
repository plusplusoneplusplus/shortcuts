/**
 * Chat Folder Handler Tests
 *
 * Tests the REST API for user-created chat folders against a real
 * SqliteProcessStore + SqliteTaskGroupStore, through the actual server.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteProcessStore, SqliteTaskGroupStore, CHAT_FOLDER_GROUP_TYPE } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '../../src/server/types';
import {
    MAX_CHAT_FOLDER_NAME_LENGTH,
    normalizeChatFolderName,
    sortChatFolders,
    type ChatFolder,
} from '../../src/server/processes/chat-folder-handler';

// ============================================================================
// HTTP helpers
// ============================================================================

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

describe('chat folder name validation', () => {
    it('trims, strips newlines, and rejects empty or over-long names', () => {
        expect(normalizeChatFolderName('  Auth rewrite  ')).toEqual({ ok: true, value: 'Auth rewrite' });
        expect(normalizeChatFolderName('one\ntwo\r\nthree')).toEqual({ ok: true, value: 'one two three' });
        expect(normalizeChatFolderName('   ').ok).toBe(false);
        expect(normalizeChatFolderName('\n\n').ok).toBe(false);
        expect(normalizeChatFolderName(42).ok).toBe(false);
        expect(normalizeChatFolderName('x'.repeat(MAX_CHAT_FOLDER_NAME_LENGTH)).ok).toBe(true);
        expect(normalizeChatFolderName('x'.repeat(MAX_CHAT_FOLDER_NAME_LENGTH + 1)).ok).toBe(false);
    });
});

describe('sortChatFolders', () => {
    it('orders by sortIndex ascending, breaking ties on createdAt descending', () => {
        const make = (id: string, sortIndex: number, createdAt: string): ChatFolder => ({
            id, name: id, color: 'blue', sortIndex, createdAt, updatedAt: createdAt,
        });
        const sorted = sortChatFolders([
            make('c', 1, '2026-01-01T00:00:00.000Z'),
            make('a', 0, '2026-01-01T00:00:00.000Z'),
            make('b', 0, '2026-02-01T00:00:00.000Z'),
        ]);
        expect(sorted.map(f => f.id)).toEqual(['b', 'a', 'c']);
    });
});

// ============================================================================
// Routes
// ============================================================================

describe('Chat Folder REST API', () => {
    let server: ExecutionServer;
    let baseUrl: string;
    let tmpDir: string;
    let store: SqliteProcessStore;
    let groups: SqliteTaskGroupStore;

    // Server startup re-keys legacy workspace ids to the machine-scoped
    // `ws-v2-…` scheme, so the ids these tests address are read back from the
    // store after the server is up rather than assumed.
    let wsId: string;
    let otherWsId: string;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-chat-folder-'));
        store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
        groups = new SqliteTaskGroupStore(store.getDatabase());

        await store.registerWorkspace({ id: 'ws-folder-test', name: 'Test Workspace', rootPath: '/tmp/test-repo' });
        await store.registerWorkspace({ id: 'ws-folder-other', name: 'Other Workspace', rootPath: '/tmp/other-repo' });

        server = await createExecutionServer({ port: 0, dataDir: tmpDir, store });
        baseUrl = server.url;

        const workspaces = await store.getWorkspaces();
        wsId = workspaces.find(ws => ws.name === 'Test Workspace')!.id;
        otherWsId = workspaces.find(ws => ws.name === 'Other Workspace')!.id;
    });

    afterEach(async () => {
        await server.close();
        store.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    async function addProcess(id: string, workspaceId?: string) {
        const targetWorkspace = workspaceId ?? wsId;
        await store.addProcess({
            id,
            type: 'ai',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'completed',
            startTime: new Date('2026-01-01T00:00:00Z'),
            endTime: new Date('2026-01-01T00:01:00Z'),
            metadata: { type: 'ai', workspaceId: targetWorkspace },
        });
    }

    async function createFolder(name: string, color?: string, workspaceId?: string): Promise<ChatFolder> {
        const res = await postJSON(`${baseUrl}/api/workspaces/${workspaceId ?? wsId}/chat-folders`, { name, color });
        expect(res.status).toBe(200);
        return JSON.parse(res.body).folder as ChatFolder;
    }

    async function listFolders(workspaceId?: string): Promise<ChatFolder[]> {
        const res = await request(`${baseUrl}/api/workspaces/${workspaceId ?? wsId}/chat-folders`);
        expect(res.status).toBe(200);
        return JSON.parse(res.body).folders as ChatFolder[];
    }

    // ── Create / list ──────────────────────────────────────────────────

    describe('POST + GET /api/workspaces/:id/chat-folders', () => {
        it('creates a folder at the top and shifts existing folders down', async () => {
            const first = await createFolder('Auth rewrite', 'purple');
            expect(first.sortIndex).toBe(0);
            expect(first.color).toBe('purple');
            expect(first.id.startsWith('folder-')).toBe(true);

            const second = await createFolder('Perf: chat list', 'green');
            expect(second.sortIndex).toBe(0);

            const folders = await listFolders();
            expect(folders.map(f => f.name)).toEqual(['Perf: chat list', 'Auth rewrite']);
            expect(folders[1].sortIndex).toBe(1);
        });

        it('defaults the color and allows duplicate names', async () => {
            const a = await createFolder('Release 1.9');
            const b = await createFolder('Release 1.9');
            expect(a.color).toBe('blue');
            expect(a.id).not.toBe(b.id);
            expect((await listFolders()).length).toBe(2);
        });

        it('trims and strips newlines from the stored name', async () => {
            const folder = await createFolder('  Auth\nrewrite  ');
            expect(folder.name).toBe('Auth rewrite');
        });

        it('scopes folders per workspace', async () => {
            await createFolder('Only here');
            expect(await listFolders(otherWsId)).toEqual([]);
        });

        it('never returns run-style groups, and folders never leak into them', async () => {
            await createFolder('Auth rewrite');
            const stamp = '2026-08-26T00:00:00.000Z';
            for (const type of ['for-each', 'map-reduce', 'ralph', 'dream']) {
                groups.upsertGroup({
                    groupId: `run-${type}`, workspaceId: wsId, type,
                    status: 'running', createdAt: stamp, updatedAt: stamp,
                });
            }

            const folders = await listFolders();
            expect(folders.map(f => f.name)).toEqual(['Auth rewrite']);
            expect(groups.listGroups(wsId, { type: 'for-each' }).map(g => g.groupId)).toEqual(['run-for-each']);
        });

        it('rejects an empty name, an over-long name, and an unknown color', async () => {
            const url = `${baseUrl}/api/workspaces/${wsId}/chat-folders`;
            expect((await postJSON(url, { name: '   ' })).status).toBe(400);
            expect((await postJSON(url, {})).status).toBe(400);
            expect((await postJSON(url, { name: 'x'.repeat(61) })).status).toBe(400);
            expect((await postJSON(url, { name: 'ok', color: 'chartreuse' })).status).toBe(400);
            expect(await listFolders()).toEqual([]);
        });

        it('404s on an unknown workspace', async () => {
            expect((await request(`${baseUrl}/api/workspaces/ws-nope/chat-folders`)).status).toBe(404);
            expect((await postJSON(`${baseUrl}/api/workspaces/ws-nope/chat-folders`, { name: 'x' })).status).toBe(404);
        });
    });

    // ── Update ─────────────────────────────────────────────────────────

    describe('PATCH /api/workspaces/:id/chat-folders/:folderId', () => {
        it('renames, recolors, and reorders independently', async () => {
            const folder = await createFolder('Auth rewrite', 'purple');
            const url = `${baseUrl}/api/workspaces/${wsId}/chat-folders/${folder.id}`;

            const renamed = JSON.parse((await patchJSON(url, { name: '  Auth  ' })).body).folder as ChatFolder;
            expect(renamed.name).toBe('Auth');
            expect(renamed.color).toBe('purple');

            const recolored = JSON.parse((await patchJSON(url, { color: 'amber' })).body).folder as ChatFolder;
            expect(recolored.name).toBe('Auth');
            expect(recolored.color).toBe('amber');

            const reordered = JSON.parse((await patchJSON(url, { sortIndex: 7 })).body).folder as ChatFolder;
            expect(reordered.sortIndex).toBe(7);
            expect(reordered.color).toBe('amber');
        });

        it('rejects an invalid name, color, or sortIndex', async () => {
            const folder = await createFolder('Auth rewrite');
            const url = `${baseUrl}/api/workspaces/${wsId}/chat-folders/${folder.id}`;
            expect((await patchJSON(url, { name: '' })).status).toBe(400);
            expect((await patchJSON(url, { name: 'x'.repeat(61) })).status).toBe(400);
            expect((await patchJSON(url, { color: 'neon' })).status).toBe(400);
            expect((await patchJSON(url, { sortIndex: 'first' })).status).toBe(400);
            expect((await listFolders())[0].name).toBe('Auth rewrite');
        });

        it('404s on an unknown folder, an unknown workspace, and a non-folder group', async () => {
            const stamp = '2026-08-26T00:00:00.000Z';
            groups.upsertGroup({
                groupId: 'run-1', workspaceId: wsId, type: 'for-each',
                status: 'running', createdAt: stamp, updatedAt: stamp,
            });
            expect((await patchJSON(`${baseUrl}/api/workspaces/${wsId}/chat-folders/nope`, { name: 'x' })).status).toBe(404);
            expect((await patchJSON(`${baseUrl}/api/workspaces/ws-nope/chat-folders/x`, { name: 'x' })).status).toBe(404);
            // A live run's group record must not be mutable through this namespace.
            expect((await patchJSON(`${baseUrl}/api/workspaces/${wsId}/chat-folders/run-1`, { name: 'x' })).status).toBe(404);
            expect(groups.getGroup(wsId, 'run-1')!.title).toBeUndefined();
        });
    });

    // ── Delete ─────────────────────────────────────────────────────────

    describe('DELETE /api/workspaces/:id/chat-folders/:folderId', () => {
        it('deletes the folder, unfiles its members, and reports them', async () => {
            const folder = await createFolder('Auth rewrite');
            await addProcess('p1');
            await addProcess('p2');
            await patchJSON(`${baseUrl}/api/processes/p1/folder`, { folderId: folder.id });
            await patchJSON(`${baseUrl}/api/processes/p2/folder`, { folderId: folder.id });

            const res = await deleteJSON(`${baseUrl}/api/workspaces/${wsId}/chat-folders/${folder.id}`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.deleted).toBe(true);
            expect(body.unfiled.sort()).toEqual(['p1', 'p2']);

            expect(await listFolders()).toEqual([]);
            // No orphaned member rows — an orphan would render a phantom count.
            expect(groups.getChildren(wsId, folder.id)).toEqual([]);
            const { entries } = await store.getProcessSummaries!({ workspaceId: wsId });
            expect(entries.every(entry => entry.folderId === undefined)).toBe(true);
        });

        it('reports an empty member list for an empty folder', async () => {
            const folder = await createFolder('Release 1.9');
            const body = JSON.parse((await deleteJSON(`${baseUrl}/api/workspaces/${wsId}/chat-folders/${folder.id}`)).body);
            expect(body).toEqual({ deleted: true, unfiled: [] });
        });

        it('404s on an unknown folder', async () => {
            expect((await deleteJSON(`${baseUrl}/api/workspaces/${wsId}/chat-folders/nope`)).status).toBe(404);
        });
    });

    // ── Single move ────────────────────────────────────────────────────

    describe('PATCH /api/processes/:id/folder', () => {
        it('files a process, then re-files it into another folder without leaving two memberships', async () => {
            const a = await createFolder('Auth rewrite');
            const b = await createFolder('Perf: chat list');
            await addProcess('p1');

            let res = await patchJSON(`${baseUrl}/api/processes/p1/folder`, { folderId: a.id });
            expect(res.status).toBe(200);
            expect(JSON.parse(res.body)).toEqual({ id: 'p1', folderId: a.id });

            res = await patchJSON(`${baseUrl}/api/processes/p1/folder`, { folderId: b.id });
            expect(res.status).toBe(200);
            expect(groups.getChildren(wsId, a.id)).toEqual([]);
            expect(groups.getChildren(wsId, b.id).map(c => c.processId)).toEqual(['p1']);
            expect(groups.findMembership(wsId, 'p1', { type: CHAT_FOLDER_GROUP_TYPE })!.groupId).toBe(b.id);
        });

        it('unfiles with folderId: null', async () => {
            const folder = await createFolder('Auth rewrite');
            await addProcess('p1');
            await patchJSON(`${baseUrl}/api/processes/p1/folder`, { folderId: folder.id });

            const res = await patchJSON(`${baseUrl}/api/processes/p1/folder`, { folderId: null });
            expect(res.status).toBe(200);
            expect(JSON.parse(res.body)).toEqual({ id: 'p1', folderId: null });
            expect(groups.getChildren(wsId, folder.id)).toEqual([]);
        });

        it('is a no-op when the process is already in the target folder', async () => {
            const folder = await createFolder('Auth rewrite');
            await addProcess('p1');
            await patchJSON(`${baseUrl}/api/processes/p1/folder`, { folderId: folder.id });
            const linkedAt = groups.getChildren(wsId, folder.id)[0].linkedAt;

            await patchJSON(`${baseUrl}/api/processes/p1/folder`, { folderId: folder.id });
            const children = groups.getChildren(wsId, folder.id);
            expect(children).toHaveLength(1);
            expect(children[0].linkedAt).toBe(linkedAt);
        });

        it('surfaces membership as folderId on the process index entry', async () => {
            const folder = await createFolder('Auth rewrite');
            await addProcess('p1');
            await addProcess('p2');
            await patchJSON(`${baseUrl}/api/processes/p1/folder`, { folderId: folder.id });

            const { entries } = await store.getProcessSummaries!({ workspaceId: wsId });
            const byId = new Map(entries.map(entry => [entry.id, entry]));
            expect(byId.get('p1')!.folderId).toBe(folder.id);
            expect(byId.get('p2')!.folderId).toBeUndefined();
        });

        it('404s on an unknown process, an unknown folder, and a deleted folder', async () => {
            const folder = await createFolder('Auth rewrite');
            await addProcess('p1');
            expect((await patchJSON(`${baseUrl}/api/processes/nope/folder`, { folderId: null })).status).toBe(404);
            expect((await patchJSON(`${baseUrl}/api/processes/p1/folder`, { folderId: 'folder-nope' })).status).toBe(404);

            // Concurrent delete + move: the folder reference is checked at write time.
            await deleteJSON(`${baseUrl}/api/workspaces/${wsId}/chat-folders/${folder.id}`);
            expect((await patchJSON(`${baseUrl}/api/processes/p1/folder`, { folderId: folder.id })).status).toBe(404);
        });

        it('400s on a cross-workspace folder and on an invalid folderId', async () => {
            const foreign = await createFolder('Elsewhere', 'blue', otherWsId);
            await addProcess('p1');
            const url = `${baseUrl}/api/processes/p1/folder`;

            expect((await patchJSON(url, { folderId: foreign.id })).status).toBe(400);
            expect((await patchJSON(url, {})).status).toBe(400);
            expect((await patchJSON(url, { folderId: 42 })).status).toBe(400);
            expect((await patchJSON(url, { folderId: '' })).status).toBe(400);
            expect(groups.findMembership(wsId, 'p1', { type: CHAT_FOLDER_GROUP_TYPE })).toBeUndefined();
        });
    });

    // ── Archive interaction (AC-09) ────────────────────────────────────

    describe('archive endpoints leave folder membership alone', () => {
        it('keeps the membership row through archive and unarchive', async () => {
            const folder = await createFolder('Auth rewrite');
            await addProcess('p1');
            await patchJSON(`${baseUrl}/api/processes/p1/folder`, { folderId: folder.id });

            expect((await patchJSON(`${baseUrl}/api/processes/p1/archive`, { archived: true })).status).toBe(200);
            expect(groups.getChildren(wsId, folder.id).map(c => c.processId)).toEqual(['p1']);
            expect(groups.findMembership(wsId, 'p1', { type: CHAT_FOLDER_GROUP_TYPE })!.groupId).toBe(folder.id);

            expect((await patchJSON(`${baseUrl}/api/processes/p1/archive`, { archived: false })).status).toBe(200);
            expect(groups.findMembership(wsId, 'p1', { type: CHAT_FOLDER_GROUP_TYPE })!.groupId).toBe(folder.id);
        });

        it('keeps every membership row through a batch archive of a whole folder', async () => {
            const folder = await createFolder('Auth rewrite');
            await addProcess('p1');
            await addProcess('p2');
            await postJSON(`${baseUrl}/api/processes/folder`, { ids: ['p1', 'p2'], folderId: folder.id });

            const res = await postJSON(`${baseUrl}/api/processes/archive`, { ids: ['p1', 'p2'] });
            expect(res.status).toBe(200);
            // The folder survives the archive-all, with both members still filed.
            expect((await listFolders()).map(f => f.id)).toContain(folder.id);
            expect(groups.getChildren(wsId, folder.id).map(c => c.processId).sort()).toEqual(['p1', 'p2']);

            const { entries } = await store.getProcessSummaries!({ workspaceId: wsId });
            const byId = new Map(entries.map(entry => [entry.id, entry]));
            expect(byId.get('p1')!.folderId).toBe(folder.id);
            expect(byId.get('p2')!.folderId).toBe(folder.id);

            expect((await postJSON(`${baseUrl}/api/processes/unarchive`, { ids: ['p1', 'p2'] })).status).toBe(200);
            expect(groups.getChildren(wsId, folder.id).map(c => c.processId).sort()).toEqual(['p1', 'p2']);
        });

        it('keeps the membership row when pinning auto-unarchives a filed chat', async () => {
            const folder = await createFolder('Auth rewrite');
            await addProcess('p1');
            await patchJSON(`${baseUrl}/api/processes/p1/folder`, { folderId: folder.id });
            await patchJSON(`${baseUrl}/api/processes/p1/archive`, { archived: true });

            expect((await patchJSON(`${baseUrl}/api/processes/p1/pin`, { pinned: true })).status).toBe(200);
            expect(groups.findMembership(wsId, 'p1', { type: CHAT_FOLDER_GROUP_TYPE })!.groupId).toBe(folder.id);
        });
    });

    // ── Batch move ─────────────────────────────────────────────────────

    describe('POST /api/processes/folder', () => {
        it('moves a mixed-membership selection into one folder', async () => {
            const a = await createFolder('Auth rewrite');
            const b = await createFolder('Perf: chat list');
            await addProcess('p1');
            await addProcess('p2');
            await addProcess('p3');
            await patchJSON(`${baseUrl}/api/processes/p1/folder`, { folderId: a.id });
            await patchJSON(`${baseUrl}/api/processes/p2/folder`, { folderId: b.id });

            const res = await postJSON(`${baseUrl}/api/processes/folder`, { ids: ['p1', 'p2', 'p3'], folderId: b.id });
            expect(res.status).toBe(200);
            expect(JSON.parse(res.body)).toEqual({ updated: ['p1', 'p2', 'p3'], folderId: b.id });
            expect(groups.getChildren(wsId, a.id)).toEqual([]);
            expect(groups.getChildren(wsId, b.id).map(c => c.processId).sort()).toEqual(['p1', 'p2', 'p3']);
        });

        it('skips ids that no longer exist and reports only the ones it moved', async () => {
            const folder = await createFolder('Auth rewrite');
            await addProcess('p1');

            const res = await postJSON(`${baseUrl}/api/processes/folder`, { ids: ['p1', 'gone'], folderId: folder.id });
            expect(res.status).toBe(200);
            expect(JSON.parse(res.body).updated).toEqual(['p1']);
        });

        it('unfiles a batch with folderId: null', async () => {
            const folder = await createFolder('Auth rewrite');
            await addProcess('p1');
            await addProcess('p2');
            await postJSON(`${baseUrl}/api/processes/folder`, { ids: ['p1', 'p2'], folderId: folder.id });

            const res = await postJSON(`${baseUrl}/api/processes/folder`, { ids: ['p1', 'p2'], folderId: null });
            expect(res.status).toBe(200);
            expect(JSON.parse(res.body)).toEqual({ updated: ['p1', 'p2'], folderId: null });
            expect(groups.getChildren(wsId, folder.id)).toEqual([]);
        });

        it('rejects a cross-workspace batch without moving any row', async () => {
            const folder = await createFolder('Auth rewrite');
            await addProcess('p1');
            await addProcess('p-other', otherWsId);

            const res = await postJSON(`${baseUrl}/api/processes/folder`, { ids: ['p1', 'p-other'], folderId: folder.id });
            expect(res.status).toBe(400);
            expect(groups.getChildren(wsId, folder.id)).toEqual([]);
        });

        it('400s on a malformed ids array or folderId, and 404s on an unknown folder', async () => {
            await addProcess('p1');
            const url = `${baseUrl}/api/processes/folder`;
            expect((await postJSON(url, { folderId: null })).status).toBe(400);
            expect((await postJSON(url, { ids: 'p1', folderId: null })).status).toBe(400);
            expect((await postJSON(url, { ids: [1, 2], folderId: null })).status).toBe(400);
            expect((await postJSON(url, { ids: ['p1'] })).status).toBe(400);
            expect((await postJSON(url, { ids: ['p1'], folderId: 'folder-nope' })).status).toBe(404);
        });
    });
});
