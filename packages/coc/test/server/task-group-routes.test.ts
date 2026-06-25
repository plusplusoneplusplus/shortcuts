import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteProcessStore, SqliteTaskGroupStore } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '../../src/server/types';

function getJSON(url: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: 'GET',
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') });
                });
            }
        );
        req.on('error', reject);
        req.end();
    });
}

describe('Task Group REST API', () => {
    let server: ExecutionServer | undefined;
    let baseUrl: string;
    let tmpDir: string;
    let store: SqliteProcessStore | undefined;

    const legacyWsA = 'ws-task-groups-a';
    const legacyWsB = 'ws-task-groups-b';
    let wsA: string;
    let wsB: string;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-task-groups-'));
        store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
        await store.registerWorkspace({ id: legacyWsA, name: 'Workspace A', rootPath: '/tmp/task-groups-a' });
        await store.registerWorkspace({ id: legacyWsB, name: 'Workspace B', rootPath: '/tmp/task-groups-b' });

        // Seed the registry through the shared database, as feature
        // orchestrators do via TaskGroupService.
        const registry = new SqliteTaskGroupStore(store.getDatabase());
        registry.upsertGroup({
            groupId: 'run-1',
            workspaceId: legacyWsA,
            type: 'for-each',
            title: 'Process 2 items',
            status: 'running',
            originProcessId: 'proc-gen',
            createdAt: '2026-06-11T10:00:00.000Z',
            updatedAt: '2026-06-11T10:05:00.000Z',
            extra: { itemCount: 2 },
        });
        registry.linkChild(legacyWsA, 'run-1', { role: 'generation', processId: 'proc-gen' });
        registry.linkChild(legacyWsA, 'run-1', { role: 'item', taskId: 'task-a', itemKey: 'item-a', memberIndex: 1 });
        registry.upsertGroup({
            groupId: 'dream-1',
            workspaceId: legacyWsA,
            type: 'dream',
            status: 'completed',
            hidden: true,
            createdAt: '2026-06-11T09:00:00.000Z',
            updatedAt: '2026-06-11T09:10:00.000Z',
        });
        registry.upsertGroup({
            groupId: 'session-1',
            workspaceId: legacyWsB,
            type: 'ralph',
            status: 'running',
            createdAt: '2026-06-11T08:00:00.000Z',
            updatedAt: '2026-06-11T08:30:00.000Z',
        });

        server = await createExecutionServer({ port: 0, dataDir: tmpDir, store });
        baseUrl = server.url;
        const workspaces = await store.getWorkspaces();
        const workspaceA = workspaces.find(workspace => workspace.name === 'Workspace A');
        const workspaceB = workspaces.find(workspace => workspace.name === 'Workspace B');
        if (!workspaceA || !workspaceB) {
            throw new Error('Expected task group test workspaces to be registered');
        }
        wsA = workspaceA.id;
        wsB = workspaceB.id;
    });

    afterEach(async () => {
        await server?.close();
        store?.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function groupsUrl(workspaceId: string, suffix = ''): string {
        return `${baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/task-groups${suffix}`;
    }

    it('lists workspace-scoped visible groups with children', async () => {
        const res = await getJSON(groupsUrl(wsA));
        expect(res.status).toBe(200);
        const { groups } = JSON.parse(res.body);
        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({
            groupId: 'run-1',
            type: 'for-each',
            status: 'running',
            originProcessId: 'proc-gen',
            childCount: 2,
            extra: { itemCount: 2 },
        });
        expect(groups[0].children.map((child: { role: string }) => child.role)).toEqual(['generation', 'item']);
    });

    it('includes hidden groups only when requested', async () => {
        const withHidden = await getJSON(groupsUrl(wsA, '?includeHidden=true'));
        const { groups } = JSON.parse(withHidden.body);
        expect(groups.map((group: { groupId: string }) => group.groupId).sort()).toEqual(['dream-1', 'run-1']);
    });

    it('filters by type', async () => {
        const res = await getJSON(groupsUrl(wsA, '?type=map-reduce'));
        expect(JSON.parse(res.body).groups).toEqual([]);

        const forEach = await getJSON(groupsUrl(wsA, '?type=for-each'));
        expect(JSON.parse(forEach.body).groups).toHaveLength(1);
    });

    it('returns a single group and 404 for missing ones', async () => {
        const res = await getJSON(groupsUrl(wsA, '/run-1'));
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).group.groupId).toBe('run-1');

        const missing = await getJSON(groupsUrl(wsA, '/nope'));
        expect(missing.status).toBe(404);
    });

    it('is workspace-scoped', async () => {
        const res = await getJSON(groupsUrl(wsB));
        const { groups } = JSON.parse(res.body);
        expect(groups).toHaveLength(1);
        expect(groups[0].groupId).toBe('session-1');

        const missingWorkspace = await getJSON(groupsUrl('missing-workspace'));
        expect(missingWorkspace.status).toBe(404);
    });
});
