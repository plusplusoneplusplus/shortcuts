import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '../../src/server/types';

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
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
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf-8'),
                    });
                });
            }
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function getJSON(url: string) {
    return request(url);
}

function patchJSON(url: string, data: unknown) {
    return request(url, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('Group Pin REST API', () => {
    let server: ExecutionServer | undefined;
    let baseUrl: string;
    let tmpDir: string;
    let dbPath: string;
    let store: SqliteProcessStore | undefined;

    const legacyWsA = 'ws-group-pins-a';
    const legacyWsB = 'ws-group-pins-b';
    let wsA: string;
    let wsB: string;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-group-pins-'));
        dbPath = path.join(tmpDir, 'test.db');
        await startServer();
    });

    afterEach(async () => {
        await server?.close();
        store?.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    async function startServer() {
        store = new SqliteProcessStore({ dbPath });
        if ((await store.getWorkspaces()).length === 0) {
            await store.registerWorkspace({
                id: legacyWsA,
                name: 'Workspace A',
                rootPath: '/tmp/group-pins-a',
            });
            await store.registerWorkspace({
                id: legacyWsB,
                name: 'Workspace B',
                rootPath: '/tmp/group-pins-b',
            });
        }
        server = await createExecutionServer({ port: 0, dataDir: tmpDir, store });
        baseUrl = server.url;
        const workspaces = await store.getWorkspaces();
        const workspaceA = workspaces.find(workspace => workspace.name === 'Workspace A');
        const workspaceB = workspaces.find(workspace => workspace.name === 'Workspace B');
        if (!workspaceA || !workspaceB) {
            throw new Error('Expected group pin test workspaces to be registered');
        }
        wsA = workspaceA.id;
        wsB = workspaceB.id;
    }

    async function restartServer() {
        await server?.close();
        server = undefined;
        store?.close();
        store = undefined;
        await startServer();
    }

    function groupPinsUrl(workspaceId: string, type?: string, groupId?: string) {
        const base = `${baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/group-pins`;
        if (!type || !groupId) return base;
        return `${base}/${encodeURIComponent(type)}/${encodeURIComponent(groupId)}`;
    }

    async function addChildProcess() {
        await store!.addProcess({
            id: 'child-process',
            type: 'chat',
            promptPreview: 'child',
            fullPrompt: 'child',
            status: 'completed',
            startTime: new Date('2026-01-01T00:00:00.000Z'),
            endTime: new Date('2026-01-01T00:01:00.000Z'),
            metadata: { type: 'chat', workspaceId: wsA },
        });
        store!.pinProcess('child-process', '2026-01-02T00:00:00.000Z');
        store!.archiveProcess('child-process');
    }

    it('sets, lists, clears, and persists workspace-scoped group pins without mutating child processes', async () => {
        await addChildProcess();

        const ralphRes = await patchJSON(groupPinsUrl(wsA, 'ralph-session', 'ralph-session-1'), { pinned: true });
        expect(ralphRes.status).toBe(200);
        expect(JSON.parse(ralphRes.body)).toMatchObject({
            pin: { type: 'ralph-session', groupId: 'ralph-session-1', pinnedAt: expect.any(String) },
        });

        await new Promise(resolve => setTimeout(resolve, 5));

        const forEachRes = await patchJSON(groupPinsUrl(wsA, 'for-each-run', 'for-each-run-1'), { pinned: true });
        expect(forEachRes.status).toBe(200);
        await new Promise(resolve => setTimeout(resolve, 5));

        const mapReduceRes = await patchJSON(groupPinsUrl(wsA, 'map-reduce-run', 'map-reduce-run-1'), { pinned: true });
        expect(mapReduceRes.status).toBe(200);

        const childAfterPins = await store!.getProcess('child-process');
        expect(childAfterPins!.pinnedAt).toBe('2026-01-02T00:00:00.000Z');
        expect(childAfterPins!.archived).toBe(true);

        const listA = await getJSON(groupPinsUrl(wsA));
        expect(listA.status).toBe(200);
        expect(JSON.parse(listA.body).pins).toEqual([
            expect.objectContaining({ type: 'map-reduce-run', groupId: 'map-reduce-run-1' }),
            expect.objectContaining({ type: 'for-each-run', groupId: 'for-each-run-1' }),
            expect.objectContaining({ type: 'ralph-session', groupId: 'ralph-session-1' }),
        ]);

        const listB = await getJSON(groupPinsUrl(wsB));
        expect(listB.status).toBe(200);
        expect(JSON.parse(listB.body).pins).toEqual([]);

        await restartServer();

        const persisted = await getJSON(groupPinsUrl(wsA));
        expect(persisted.status).toBe(200);
        expect(JSON.parse(persisted.body).pins.map((pin: { type: string; groupId: string }) => [pin.type, pin.groupId])).toEqual([
            ['map-reduce-run', 'map-reduce-run-1'],
            ['for-each-run', 'for-each-run-1'],
            ['ralph-session', 'ralph-session-1'],
        ]);

        const clearRes = await patchJSON(groupPinsUrl(wsA, 'ralph-session', 'ralph-session-1'), { pinned: false });
        expect(clearRes.status).toBe(200);
        expect(JSON.parse(clearRes.body)).toEqual({ pin: null });

        const afterClear = await getJSON(groupPinsUrl(wsA));
        expect(JSON.parse(afterClear.body).pins.map((pin: { type: string; groupId: string }) => [pin.type, pin.groupId])).toEqual([
            ['map-reduce-run', 'map-reduce-run-1'],
            ['for-each-run', 'for-each-run-1'],
        ]);

        const clearForEachRes = await patchJSON(groupPinsUrl(wsA, 'for-each-run', 'for-each-run-1'), { pinned: false });
        expect(clearForEachRes.status).toBe(200);
        expect(JSON.parse(clearForEachRes.body)).toEqual({ pin: null });

        const clearMapReduceRes = await patchJSON(groupPinsUrl(wsA, 'map-reduce-run', 'map-reduce-run-1'), { pinned: false });
        expect(clearMapReduceRes.status).toBe(200);
        expect(JSON.parse(clearMapReduceRes.body)).toEqual({ pin: null });

        const afterClearingAll = await getJSON(groupPinsUrl(wsA));
        expect(JSON.parse(afterClearingAll.body).pins).toEqual([]);

        const childAfterClear = await store!.getProcess('child-process');
        expect(childAfterClear!.pinnedAt).toBe('2026-01-02T00:00:00.000Z');
        expect(childAfterClear!.archived).toBe(true);
    });

    it('accepts open pin types for registered task-group types', async () => {
        const novelType = await patchJSON(groupPinsUrl(wsA, 'dream', 'dream-run-1'), { pinned: true });
        expect(novelType.status).toBe(200);
        expect(JSON.parse(novelType.body)).toMatchObject({
            pin: { type: 'dream', groupId: 'dream-run-1', pinnedAt: expect.any(String) },
        });

        const list = await getJSON(groupPinsUrl(wsA));
        expect(JSON.parse(list.body).pins).toEqual([
            expect.objectContaining({ type: 'dream', groupId: 'dream-run-1' }),
        ]);
    });

    it('rejects invalid group pin inputs', async () => {
        const badType = await patchJSON(groupPinsUrl(wsA, ' ', 'group-1'), { pinned: true });
        expect(badType.status).toBe(400);
        expect(JSON.parse(badType.body).error).toBe('Invalid group pin type');

        const badBody = await patchJSON(groupPinsUrl(wsA, 'ralph-session', 'group-1'), { pinned: 'yes' });
        expect(badBody.status).toBe(400);
        expect(JSON.parse(badBody.body).error).toBe('Body must contain pinned: boolean');

        const missingWorkspace = await getJSON(groupPinsUrl('missing-workspace'));
        expect(missingWorkspace.status).toBe(404);
    });
});
