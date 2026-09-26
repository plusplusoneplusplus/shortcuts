/**
 * Tests PUT /api/workspaces/:id/pin-order (drag-and-drop reorder of pinned chats and group pins).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '../../src/server/types';
import { GroupPinStore } from '../../src/server/processes/group-pin-store';
import { MAX_PIN_ORDER_ENTRIES } from '../../src/server/processes/pin-order-handler';

function request(
    url: string,
    options: { method?: string; body?: string } = {},
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') }));
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

const send = (method: string, url: string, data: unknown) => request(url, { method, body: JSON.stringify(data) });

describe('Pin order REST API', () => {
    let server: ExecutionServer;
    let store: SqliteProcessStore;
    let tmpDir: string;
    let baseUrl: string;
    let wsA: string;
    let wsB: string;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-pin-order-'));
        store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
        await store.registerWorkspace({ id: 'ws-order-a', name: 'Workspace A', rootPath: '/tmp/pin-order-a' });
        await store.registerWorkspace({ id: 'ws-order-b', name: 'Workspace B', rootPath: '/tmp/pin-order-b' });
        server = await createExecutionServer({ port: 0, dataDir: tmpDir, store });
        baseUrl = server.url;
        const workspaces = await store.getWorkspaces();
        wsA = workspaces.find(w => w.name === 'Workspace A')!.id;
        wsB = workspaces.find(w => w.name === 'Workspace B')!.id;
    });

    afterEach(async () => {
        await server.close();
        store.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    async function addChat(id: string, workspaceId: string, pinnedAt?: string) {
        await store.addProcess({
            id,
            type: 'chat',
            promptPreview: id,
            fullPrompt: id,
            status: 'completed',
            startTime: new Date('2026-01-01T00:00:00.000Z'),
            endTime: new Date('2026-01-01T00:01:00.000Z'),
            metadata: { type: 'chat', workspaceId },
        } as any);
        if (pinnedAt) store.pinProcess(id, pinnedAt);
    }

    const orderUrl = (ws: string) => `${baseUrl}/api/workspaces/${encodeURIComponent(ws)}/pin-order`;

    async function pinnedIds(ws: string): Promise<string[]> {
        const res = await request(`${baseUrl}/api/workspaces/${encodeURIComponent(ws)}/pinned`);
        return JSON.parse(res.body).entries.map((e: { id: string }) => e.id);
    }

    async function groupPins(ws: string): Promise<Array<{ type: string; groupId: string; pinnedAt: string }>> {
        const res = await request(`${baseUrl}/api/workspaces/${encodeURIComponent(ws)}/group-pins`);
        return JSON.parse(res.body).pins;
    }

    it('reorders chats and group pins with strictly decreasing stamps', async () => {
        await addChat('c1', wsA, '2026-01-03T00:00:00.000Z');
        await addChat('c2', wsA, '2026-01-02T00:00:00.000Z');
        await send('PATCH', `${baseUrl}/api/workspaces/${wsA}/group-pins/ralph-session/r1`, { pinned: true });

        const res = await send('PUT', orderUrl(wsA), {
            entries: [
                { kind: 'chat', id: 'c2' },
                { kind: 'group', type: 'ralph-session', groupId: 'r1' },
                { kind: 'chat', id: 'c1' },
            ],
        });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.chats.map((c: { id: string }) => c.id)).toEqual(['c2', 'c1']);
        expect(body.groups).toEqual([expect.objectContaining({ type: 'ralph-session', groupId: 'r1' })]);

        const stamps = [body.chats[0].pinnedAt, body.groups[0].pinnedAt, body.chats[1].pinnedAt];
        expect(stamps[0] > stamps[1]).toBe(true);
        expect(stamps[1] > stamps[2]).toBe(true);

        expect(await pinnedIds(wsA)).toEqual(['c2', 'c1']);
        expect((await groupPins(wsA))[0].pinnedAt).toBe(stamps[1]);
    });

    it('skips unpinned ids and leaves them unpinned', async () => {
        await addChat('c1', wsA, '2026-01-03T00:00:00.000Z');
        await addChat('loose', wsA);

        const res = await send('PUT', orderUrl(wsA), {
            entries: [{ kind: 'chat', id: 'loose' }, { kind: 'chat', id: 'c1' }, { kind: 'group', type: 'ralph-session', groupId: 'nope' }],
        });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.chats.map((c: { id: string }) => c.id)).toEqual(['c1']);
        expect(body.groups).toEqual([]);
        expect((await store.getProcess('loose'))!.pinnedAt).toBeUndefined();
        expect(await groupPins(wsA)).toEqual([]);
    });

    it('does not touch another workspace (multi-repo)', async () => {
        await addChat('a1', wsA, '2026-01-01T00:00:00.000Z');
        await addChat('b1', wsB, '2026-01-02T00:00:00.000Z');

        const res = await send('PUT', orderUrl(wsA), { entries: [{ kind: 'chat', id: 'b1' }, { kind: 'chat', id: 'a1' }] });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).chats.map((c: { id: string }) => c.id)).toEqual(['a1']);
        expect((await store.getProcess('b1'))!.pinnedAt).toBe('2026-01-02T00:00:00.000Z');
    });

    it.each([
        ['missing entries', {}],
        ['empty entries', { entries: [] }],
        ['unknown kind', { entries: [{ kind: 'folder', id: 'x' }] }],
        ['duplicate', { entries: [{ kind: 'chat', id: 'x' }, { kind: 'chat', id: 'x' }] }],
        ['bad group type', { entries: [{ kind: 'group', type: '  ', groupId: 'g' }] }],
        ['bad group id', { entries: [{ kind: 'group', type: 'ralph-session', groupId: '' }] }],
        ['over cap', { entries: Array.from({ length: MAX_PIN_ORDER_ENTRIES + 1 }, (_, i) => ({ kind: 'chat', id: `c${i}` })) }],
    ])('returns 400 for %s', async (_label, body) => {
        const res = await send('PUT', orderUrl(wsA), body);
        expect(res.status).toBe(400);
    });

    it('returns 404 for an unknown workspace', async () => {
        const res = await send('PUT', orderUrl('ws-missing'), { entries: [{ kind: 'chat', id: 'x' }] });
        expect(res.status).toBe(404);
    });

    it('a new pin after a reorder goes to the top', async () => {
        await addChat('c1', wsA, '2026-01-03T00:00:00.000Z');
        await addChat('c2', wsA, '2026-01-02T00:00:00.000Z');
        await addChat('c3', wsA);
        await send('PUT', orderUrl(wsA), { entries: [{ kind: 'chat', id: 'c2' }, { kind: 'chat', id: 'c1' }] });
        await new Promise(resolve => setTimeout(resolve, 5));

        await send('PATCH', `${baseUrl}/api/processes/c3/pin`, { pinned: true });
        expect(await pinnedIds(wsA)).toEqual(['c3', 'c2', 'c1']);
    });
});

describe('GroupPinStore.setPinOrder', () => {
    let tmpDir: string;
    beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-group-pin-order-')); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

    it('restamps existing pins only and keeps state repo-scoped', () => {
        const pinStore = new GroupPinStore(tmpDir);
        pinStore.setPin('ws1', 'ralph-session', 'r1', '2026-01-01T00:00:00.000Z');
        pinStore.setPin('ws1', 'for-each-run', 'f1', '2026-01-02T00:00:00.000Z');

        const pins = pinStore.setPinOrder('ws1', [
            { type: 'ralph-session', groupId: 'r1', pinnedAt: '2026-02-01T00:00:00.001Z' },
            { type: 'map-reduce-run', groupId: 'missing', pinnedAt: '2026-02-01T00:00:00.000Z' },
        ], '2026-02-01T00:00:00.001Z');

        expect(pins.map(p => p.groupId)).toEqual(['r1', 'f1']);
        expect(pinStore.listPins('ws1').map(p => p.groupId)).toEqual(['r1', 'f1']);
        expect(pinStore.listPins('ws2')).toEqual([]);
        expect(fs.existsSync(path.join(tmpDir, 'repos', 'ws1', 'group-pins.json'))).toBe(true);
    });
});
