/**
 * Repo-group chat feed (`GET /api/repo-groups/:id/chats`): read-only
 * aggregation of group-owned and member chats on the group's owning server.
 *
 * Covers owner tagging, global latest-activity ordering across members,
 * k-way-merged pagination without omissions or duplicates, queue/history
 * de-duplication, filters, exact counts, partial sources, stale cursors,
 * and the HTTP route wiring.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import {
    buildRepoGroupChatFeed,
    parseRepoGroupChatFeedQuery,
    StaleRepoGroupCursorError,
    InvalidRepoGroupChatQueryError,
    type RepoGroupChatFeedDeps,
} from '../../src/server/workspaces/repo-group-chat-feed';
import type { RepoGroupMember } from '../../src/server/workspaces/repo-group-workspace';
import { registerRepoGroupRoutes } from '../../src/server/workspaces/repo-group-handler';
import { createRequestHandler } from '../../src/server/router';
import type { Route } from '../../src/server/types';

const GROUP = 'group-platform';
const A = 'repo-a';
const B = 'repo-b';

function member(workspaceId: string, extra: Partial<RepoGroupMember> = {}): RepoGroupMember {
    return { workspaceId, stale: false, name: workspaceId.toUpperCase(), readOnly: false, ...extra };
}

function query(params: Record<string, string> = {}) {
    return parseRepoGroupChatFeedQuery(new URLSearchParams(params));
}

describe('buildRepoGroupChatFeed', () => {
    let tmpDir: string;
    let store: SqliteProcessStore;
    let queues: Record<string, { running: Record<string, unknown>[]; queued: Record<string, unknown>[] }>;
    let failingQueues: Set<string>;
    let deps: RepoGroupChatFeedDeps;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-group-chat-feed-'));
        store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
        for (const id of [GROUP, A, B]) {
            await store.registerWorkspace({ id, name: id, rootPath: path.join(tmpDir, id) });
        }
        queues = {};
        failingQueues = new Set();
        deps = {
            store,
            readQueue: async (workspaceId) => {
                if (failingQueues.has(workspaceId)) throw new Error(`queue for ${workspaceId} is unavailable`);
                return queues[workspaceId] ?? { running: [], queued: [] };
            },
        };
    });

    afterEach(() => {
        store.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    async function addChat(id: string, workspaceId: string, minute: number, extra: Record<string, unknown> = {}) {
        const start = new Date(Date.UTC(2026, 0, 1, 0, minute));
        await store.addProcess({
            id,
            type: 'chat' as any,
            promptPreview: `prompt ${id}`,
            fullPrompt: `prompt ${id}`,
            status: 'completed' as any,
            title: `title ${id}`,
            startTime: start,
            endTime: new Date(start.getTime() + 1000),
            ...extra,
            metadata: { type: 'chat' as any, workspaceId },
        } as any);
    }

    const members = [member(A), member(B)];

    it('includes group-owned and every member chat, each tagged with its owner, in global activity order', async () => {
        await addChat('g1', GROUP, 5);
        await addChat('a1', A, 10);
        await addChat('b1', B, 1);
        await addChat('a2', A, 3);

        const feed = await buildRepoGroupChatFeed(deps, GROUP, members, query());

        expect(feed.history.map(row => [row.id, row.ownerWorkspaceId])).toEqual([
            ['a1', A], ['g1', GROUP], ['a2', A], ['b1', B],
        ]);
        expect(feed.sources.map(source => [source.workspaceId, source.role])).toEqual([
            [GROUP, 'group'], [A, 'member'], [B, 'member'],
        ]);
        expect(feed.counts).toMatchObject({ total: 4, history: 4, running: 0, queued: 0, partial: false });
        expect(feed.counts.byOwner).toEqual({ [GROUP]: 1, [A]: 2, [B]: 1 });
        expect(feed.hasMore).toBe(false);
        expect(feed.nextCursor).toBeUndefined();
    });

    it('keeps equal ids from different owners distinct', async () => {
        // A process id is unique per store, so colliding ids across owners can
        // only come from distinct queue tasks; history ids stay owner-tagged.
        queues[A] = { running: [{ id: 'task-1', processId: 'queue_task-1', type: 'chat', displayName: 'Same title' }], queued: [] };
        queues[B] = { running: [{ id: 'task-1', processId: 'queue_task-1', type: 'chat', displayName: 'Same title' }], queued: [] };

        const feed = await buildRepoGroupChatFeed(deps, GROUP, members, query());

        expect(feed.running.map(row => [row.id, row.ownerWorkspaceId])).toEqual([['task-1', A], ['task-1', B]]);
        expect(feed.counts.running).toBe(2);
    });

    it('pages through every chat once with stable global order (no omissions or duplicates)', async () => {
        const expected: string[] = [];
        for (let i = 0; i < 17; i++) {
            const owner = [GROUP, A, B][i % 3];
            await addChat(`c${i}`, owner, i);
            expected.unshift(`c${i}`);
        }
        const seen: string[] = [];
        let cursor: string | undefined;
        let pages = 0;
        do {
            const feed = await buildRepoGroupChatFeed(deps, GROUP, members, query({ limit: '4', ...(cursor ? { cursor } : {}) }));
            seen.push(...feed.history.map(row => row.id));
            expect(feed.counts.total).toBe(17);
            cursor = feed.nextCursor;
            pages++;
        } while (cursor && pages < 10);

        expect(pages).toBe(5);
        expect(seen).toEqual(expected);
    });

    it('searches body text across owners, orders by activity, counts every unique chat and respects archives', async () => {
        await addChat('older-a', A, 1);
        await addChat('newer-b', B, 5);
        await addChat('archived-a', A, 10, { archived: true });
        await addChat('not-match', GROUP, 20);
        for (const id of ['older-a', 'newer-b', 'archived-a']) {
            await store.appendConversationTurn(id, turnIndex => ({ turnIndex, role: 'user', content: 'A rare cobalt capacitor body term', timestamp: new Date('2026-01-01T02:00:00Z') }));
            await store.appendConversationTurn(id, turnIndex => ({ turnIndex, role: 'assistant', content: 'The cobalt capacitor was fixed', timestamp: new Date(id === 'older-a' ? '2026-01-01T02:01:00Z' : '2026-01-01T02:02:00Z') }));
        }
        const feed = await buildRepoGroupChatFeed(deps, GROUP, members, query({ q: 'cobalt capacitor', limit: '1' }));
        expect(feed.history.map(row => row.id)).toEqual(['newer-b']);
        expect(feed.counts.total).toBe(2);
        expect(feed.snippets?.[B]['newer-b']).toContain('cobalt capacitor');
        expect(feed.snippets?.[A]['archived-a']).toBeUndefined();
        const next = await buildRepoGroupChatFeed(deps, GROUP, members, query({ q: 'cobalt capacitor', limit: '1', cursor: feed.nextCursor! }));
        expect(next.history.map(row => row.id)).toEqual(['older-a']);
        expect(next.hasMore).toBe(false);
        const archived = await buildRepoGroupChatFeed(deps, GROUP, members, query({ q: 'cobalt capacitor', archived: 'only' }));
        expect(archived.history.map(row => row.id)).toEqual(['archived-a']);
        expect(archived.counts.total).toBe(1);
    });

    it('breaks equal-activity ties within an owner across page boundaries and rejects changed snapshots', async () => {
        for (const id of ['z', 'a', 'm']) await addChat(id, A, 1);
        const first = await buildRepoGroupChatFeed(deps, GROUP, members, query({ limit: '1' }));
        expect(first.history[0].id).toBe('a');
        const next = await buildRepoGroupChatFeed(deps, GROUP, members, query({ limit: '1', cursor: first.nextCursor! }));
        expect(next.history[0].id).toBe('m');
        await addChat('new', B, 4);
        await expect(buildRepoGroupChatFeed(deps, GROUP, members, query({ limit: '1', cursor: next.nextCursor! })))
            .rejects.toBeInstanceOf(StaleRepoGroupCursorError);
    });

    it('returns old pins on page one without duplicating them in global history pages', async () => {
        await addChat('old-pin', A, 1, { pinnedAt: '2026-01-01T01:00:00Z' });
        await addChat('recent', B, 10);
        await addChat('middle', GROUP, 5);
        const first = await buildRepoGroupChatFeed(deps, GROUP, members, query({ limit: '1' }));
        expect(first.history.map(row => row.id)).toEqual(['old-pin', 'recent']);
        expect(first.counts.total).toBe(3);
        const next = await buildRepoGroupChatFeed(deps, GROUP, members, query({ limit: '1', cursor: first.nextCursor! }));
        expect(next.history.map(row => row.id)).toEqual(['middle']);
        expect(next.hasMore).toBe(false);
    });

    it('shows a re-queued follow-up only in its active section, never also as history', async () => {
        await addChat('a1', A, 1);
        await addChat('a2', A, 2);
        queues[A] = { running: [{ id: 'a1-task', processId: 'a1', type: 'chat' }], queued: [{ kind: 'pause-marker', id: 'm1' }] };

        const feed = await buildRepoGroupChatFeed(deps, GROUP, members, query());

        expect(feed.running.map(row => row.processId)).toEqual(['a1']);
        expect(feed.queued).toEqual([]);
        expect(feed.history.map(row => row.id)).toEqual(['a2']);
        expect(feed.counts).toMatchObject({ total: 2, running: 1, history: 1 });
    });

    it('applies owner, status and archive filters identically to rows and counts', async () => {
        await addChat('g1', GROUP, 1);
        await addChat('a1', A, 2);
        await addChat('a-archived', A, 3, { archived: true });
        await addChat('b-failed', B, 4, { status: 'failed' });
        queues[B] = { running: [], queued: [{ id: 'q1', type: 'chat' }] };

        const owners = await buildRepoGroupChatFeed(deps, GROUP, members, query({ owners: `${GROUP},${B}` }));
        expect(owners.history.map(row => row.id)).toEqual(['b-failed', 'g1']);
        expect(owners.queued.map(row => row.id)).toEqual(['q1']);
        expect(owners.counts).toMatchObject({ total: 3, byOwner: { [GROUP]: 1, [B]: 2 } });

        const failed = await buildRepoGroupChatFeed(deps, GROUP, members, query({ statuses: 'failed' }));
        expect(failed.history.map(row => row.id)).toEqual(['b-failed']);
        expect(failed.queued).toEqual([]);
        expect(failed.counts.total).toBe(1);

        const archived = await buildRepoGroupChatFeed(deps, GROUP, members, query({ archived: 'only' }));
        expect(archived.history.map(row => row.id)).toEqual(['a-archived']);
        expect(archived.queued).toEqual([]);
        expect(archived.counts.total).toBe(1);

        const all = await buildRepoGroupChatFeed(deps, GROUP, members, query({ archived: 'include' }));
        expect(all.counts.history).toBe(4);
    });

    it('counts unique unread chats across the group and members from each owner\'s read state', async () => {
        await addChat('g1', GROUP, 1);
        await addChat('a1', A, 2);
        await addChat('b1', B, 3);
        // Seen means seen_at matches the chat's end time (the per-repo badge rule).
        store.markSeen('a1', new Date(Date.UTC(2026, 0, 1, 0, 2) + 1000).toISOString());

        const feed = await buildRepoGroupChatFeed(deps, GROUP, members, query({ owners: A }));

        expect(feed.counts.unread).toBe(2);
        expect(feed.history[0].seenAt).toBeDefined();
    });

    it('marks an unreadable source unavailable and counts as partial instead of failing the feed', async () => {
        await addChat('a1', A, 1);
        await addChat('b1', B, 2);
        failingQueues.add(B);

        const feed = await buildRepoGroupChatFeed(deps, GROUP, members, query());

        expect(feed.history.map(row => row.id)).toEqual(['a1']);
        expect(feed.sources.find(source => source.workspaceId === B)).toMatchObject({ available: false, error: expect.stringContaining('unavailable') });
        expect(feed.counts.partial).toBe(true);
    });

    it('keeps stale members readable and flags them', async () => {
        await addChat('b1', B, 1);

        const feed = await buildRepoGroupChatFeed(deps, GROUP, [member(A), member(B, { stale: true, staleReason: 'path-missing' })], query());

        expect(feed.history.map(row => row.id)).toEqual(['b1']);
        expect(feed.sources.find(source => source.workspaceId === B)).toMatchObject({ stale: true, staleReason: 'path-missing', available: true });
    });

    it('rejects a cursor from another membership or filter set', async () => {
        for (let i = 0; i < 3; i++) await addChat(`a${i}`, A, i);
        const first = await buildRepoGroupChatFeed(deps, GROUP, members, query({ limit: '1' }));
        expect(first.nextCursor).toBeDefined();

        await expect(buildRepoGroupChatFeed(deps, GROUP, [member(A)], query({ limit: '1', cursor: first.nextCursor! })))
            .rejects.toBeInstanceOf(StaleRepoGroupCursorError);
        await expect(buildRepoGroupChatFeed(deps, GROUP, members, query({ limit: '1', archived: 'only', cursor: first.nextCursor! })))
            .rejects.toBeInstanceOf(StaleRepoGroupCursorError);
        await expect(buildRepoGroupChatFeed(deps, GROUP, members, query({ cursor: 'not-a-cursor' })))
            .rejects.toBeInstanceOf(InvalidRepoGroupChatQueryError);
    });

    it('returns active rows on the first page only', async () => {
        await addChat('a1', A, 1);
        await addChat('a2', A, 2);
        queues[A] = { running: [{ id: 't', processId: 'p-run', type: 'chat' }], queued: [] };

        const first = await buildRepoGroupChatFeed(deps, GROUP, members, query({ limit: '1' }));
        const second = await buildRepoGroupChatFeed(deps, GROUP, members, query({ limit: '1', cursor: first.nextCursor! }));

        expect(first.running).toHaveLength(1);
        expect(second.running).toEqual([]);
        expect(second.history.map(row => row.id)).toEqual(['a1']);
    });

    it('validates query parameters', () => {
        expect(() => query({ limit: '0' })).toThrow(InvalidRepoGroupChatQueryError);
        expect(() => query({ statuses: 'paused' })).toThrow(InvalidRepoGroupChatQueryError);
        expect(() => query({ archived: 'maybe' })).toThrow(InvalidRepoGroupChatQueryError);
        expect(query({ limit: '9999' }).limit).toBe(200);
    });
});

describe('GET /api/repo-groups/:id/chats', () => {
    let dataDir: string;
    let store: SqliteProcessStore;
    let server: http.Server;
    let baseUrl: string;
    const readQueueCalls: string[] = [];

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-group-chat-route-'));
        store = new SqliteProcessStore({ dbPath: path.join(dataDir, 'test.db') });
        for (const id of [A, B]) {
            const rootPath = path.join(dataDir, 'checkouts', id);
            fs.mkdirSync(rootPath, { recursive: true });
            await store.registerWorkspace({ id, name: id, rootPath });
        }
        readQueueCalls.length = 0;
        const routes: Route[] = [];
        registerRepoGroupRoutes(routes, store, dataDir, {
            readQueue: async (workspaceId) => {
                readQueueCalls.push(workspaceId);
                return { running: [], queued: [] };
            },
        });
        server = http.createServer(createRequestHandler({ routes, spaHtml: () => '<html></html>' }));
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    });

    afterEach(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
        store.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function call(method: string, url: string, body?: unknown) {
        const res = await fetch(`${baseUrl}${url}`, {
            method,
            ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
        });
        return { status: res.status, body: await res.json() as any };
    }

    it('serves the owning registry\'s membership and reads each source\'s own queue', async () => {
        const created = await call('POST', '/api/repo-groups', { name: 'Platform', members: [A, B] });
        expect(created.status).toBe(201);
        const groupId = created.body.workspace.id as string;

        const res = await call('GET', `/api/repo-groups/${groupId}/chats`);

        expect(res.status).toBe(200);
        expect(res.body.sources.map((source: any) => source.workspaceId)).toEqual([groupId, A, B]);
        expect(readQueueCalls.sort()).toEqual([A, B, groupId].sort());
        expect(res.body.counts).toMatchObject({ total: 0, partial: false });
    });

    it('returns 404 for an unknown group, 400 for bad filters and 409 STALE_CURSOR after membership changes', async () => {
        expect((await call('GET', '/api/repo-groups/group-missing/chats')).status).toBe(404);
        const created = await call('POST', '/api/repo-groups', { name: 'Platform', members: [A, B] });
        const groupId = created.body.workspace.id as string;
        expect((await call('GET', `/api/repo-groups/${groupId}/chats?statuses=nope`)).status).toBe(400);

        for (let i = 0; i < 3; i++) {
            await store.addProcess({
                id: `a${i}`, type: 'chat' as any, promptPreview: 'p', fullPrompt: 'p', status: 'completed' as any,
                startTime: new Date(Date.UTC(2026, 0, 1, 0, i)), metadata: { type: 'chat' as any, workspaceId: A },
            } as any);
        }
        const first = await call('GET', `/api/repo-groups/${groupId}/chats?limit=1`);
        expect(first.body.nextCursor).toBeDefined();
        expect((await call('PATCH', `/api/repo-groups/${groupId}`, { members: [A] })).status).toBe(200);

        const stale = await call('GET', `/api/repo-groups/${groupId}/chats?limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`);
        expect(stale.status).toBe(409);
        expect(stale.body.code).toBe('STALE_CURSOR');
    });
});
