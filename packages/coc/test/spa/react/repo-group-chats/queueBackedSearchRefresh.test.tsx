/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import type { RepoGroupChatFeedQuery, RepoGroupChatStatus } from '@plusplusoneplusplus/coc-client';
import { buildRepoGroupChatFeed, parseRepoGroupChatFeedQuery } from '../../../../src/server/workspaces/repo-group-chat-feed';
import { serializeTaskSummary } from '../../../../src/server/routes/queue-shared';
import { getCocClientFor } from '../../../../src/server/spa/client/react/api/cocClient';
import { patchSeenState } from '../../../../src/server/spa/client/react/hooks/preferences/seenStateApi';
import { allRepoGroupChatRows } from '../../../../src/server/spa/client/react/repos/repoGroupChatFeed';
import { resetRepoGroupChatFeedCacheForTests, useRepoGroupChatFeed } from '../../../../src/server/spa/client/react/repos/useRepoGroupChatFeed';

const api = vi.hoisted(() => ({ getRepoGroupChats: vi.fn() }));
vi.mock('../../../../src/server/spa/client/react/repos/repoGroupService', () => api);

describe('queue serializer -> feed -> hook search refresh', () => {
    let tmpDir: string;
    let store: SqliteProcessStore;
    let queues: Record<string, { running: Record<string, unknown>[]; queued: Record<string, unknown>[] }>;
    const members = ['a', 'b'].map(workspaceId => ({ workspaceId, stale: false, readOnly: false }));
    const start = Date.parse('2026-01-01T00:00:00Z');

    beforeEach(async () => {
        vi.clearAllMocks();
        resetRepoGroupChatFeedCacheForTests();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'group-search-refresh-'));
        store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
        queues = {};
        for (const id of ['group-ai', 'a', 'b']) {
            await store.registerWorkspace({ id, name: id, rootPath: path.join(tmpDir, id) });
        }
        api.getRepoGroupChats.mockImplementation(async (groupId: string, query: RepoGroupChatFeedQuery) => {
            const params = new URLSearchParams({ limit: String(query.limit ?? 50) });
            if (query.q) params.set('q', query.q);
            if (query.cursor) params.set('cursor', query.cursor);
            if (query.statuses) params.set('statuses', query.statuses.join(','));
            if (query.owners) params.set('owners', query.owners.join(','));
            return buildRepoGroupChatFeed({
                store, readQueue: async owner => queues[owner] ?? { running: [], queued: [] },
            }, groupId, members, parseRepoGroupChatFeedQuery(params));
        });
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        store.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    async function seed(statuses: RepoGroupChatStatus[], count = 7, durable = true) {
        for (let i = 0; i < count; i++) {
            const status = statuses[i % statuses.length];
            const owner = i % 2 ? 'b' : 'a';
            const id = `chat-${i}`;
            const activity = start + (count - i) * 60_000;
            const terminal = status !== 'running' && status !== 'queued';
            if (durable) {
                await store.addProcess({
                    id, type: 'chat', status, title: id, fullPrompt: 'cobalt', promptPreview: 'cobalt',
                    startTime: new Date(start), ...(terminal ? { endTime: new Date(activity) } : {}),
                    lastEventAt: new Date(activity), metadata: { type: 'chat', workspaceId: owner },
                });
                if (terminal) {
                    await store.appendConversationTurn(id, turnIndex => ({
                        turnIndex, role: 'user', content: 'cobalt', timestamp: new Date(activity), timeline: [],
                    }));
                    store.getDatabase().prepare('UPDATE processes SET last_event_at = ? WHERE id = ?')
                        .run(new Date(activity).toISOString(), id);
                }
            }
            if (status !== 'running' && status !== 'queued') continue;
            const queue = queues[owner] ??= { running: [], queued: [] };
            queue[status].push(serializeTaskSummary({
                id: `${id}-task`, processId: id, repoId: owner, type: 'chat', priority: 'normal', status,
                createdAt: durable ? start : activity, payload: { prompt: 'cobalt' }, config: {},
            }));
        }
    }

    it.each([
        { statuses: ['queued'] as RepoGroupChatStatus[], baseUrl: undefined },
        { statuses: ['running'] as RepoGroupChatStatus[], baseUrl: undefined },
        { statuses: ['running', 'queued', 'completed', 'failed', 'cancelled'] as RepoGroupChatStatus[], baseUrl: undefined },
        { statuses: ['queued'] as RepoGroupChatStatus[], baseUrl: 'https://owner.example' },
        { statuses: ['running', 'queued', 'completed', 'failed', 'cancelled'] as RepoGroupChatStatus[], baseUrl: 'https://owner.example' },
    ])('retains three loaded $statuses pages on live and committed read-state refresh at $baseUrl', async ({ statuses, baseUrl }) => {
        await seed(statuses);
        const seen = vi.spyOn(getCocClientFor(baseUrl).seenState, 'updateMany').mockImplementation(async (owner, entries) => {
            for (const entry of entries) store.markSeen(entry.processId, entry.seenAt);
            return store.getSeenMap(owner);
        });
        const { result } = renderHook(() => useRepoGroupChatFeed({
            groupId: 'group-ai', serverKey: baseUrl ? 'server-one' : 'local', baseUrl,
            enabled: true, pageSize: 2, filters: { q: 'cobalt', statuses },
        }));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        const rows = () => allRepoGroupChatRows(result.current.model!).sort((a, b) =>
            b.item.lastActivityAt - a.item.lastActivityAt || a.key.localeCompare(b.key));
        for (const size of [4, 6]) {
            await act(async () => { await result.current.loadMore(); });
            expect(rows().map(row => row.canonicalId)).toEqual(Array.from({ length: size }, (_, i) => `chat-${i}`));
        }
        expect(api.getRepoGroupChats.mock.calls.map(call => call[1].limit)).toEqual([2, 2, 2]);
        expect(result.current.model?.hasMore).toBe(true);
        const loadedKeys = rows().map(row => row.key);
        const cursor = result.current.model?.nextCursor;
        const before = JSON.stringify(queues);
        const unread = result.current.model?.counts.unread;
        await act(async () => {
            await patchSeenState('a', [{ processId: 'chat-2', seenAt: new Date(start + 5 * 60_000).toISOString() }], { baseUrl });
        });
        await waitFor(() => expect(api.getRepoGroupChats).toHaveBeenCalledTimes(4));
        await act(async () => { await api.getRepoGroupChats.mock.results[3].value; });
        await waitFor(() => expect(rows()).toHaveLength(6));
        expect(rows().map(row => row.key)).toEqual(loadedKeys);
        expect(api.getRepoGroupChats.mock.calls[3][1]).toEqual({ q: 'cobalt', statuses, limit: 6 });
        expect(seen).toHaveBeenCalledWith('a', expect.any(Array), { signal: undefined });
        expect(result.current.model?.counts.unread).toBe(unread! - (statuses.includes('completed') ? 1 : 0));
        expect(result.current.model?.nextCursor).toBe(cursor);

        store.getDatabase().prepare('UPDATE processes SET last_event_at = ? WHERE id = ?')
            .run(new Date(start + 20 * 60_000).toISOString(), 'chat-5');
        act(() => {
            const message = { type: 'process-updated', process: { id: 'chat-5', workspaceId: 'b' } };
            window.dispatchEvent(new CustomEvent(baseUrl ? 'coc-remote-ws-message' : 'coc-local-ws-message', {
                detail: baseUrl ? { baseUrl, message } : message,
            }));
        });
        await waitFor(() => expect(api.getRepoGroupChats).toHaveBeenCalledTimes(5));
        await waitFor(() => expect(rows()[0].canonicalId).toBe('chat-5'));
        expect(rows().map(row => row.canonicalId)).toEqual(['chat-5', 'chat-0', 'chat-1', 'chat-2', 'chat-3', 'chat-4']);
        expect(api.getRepoGroupChats.mock.calls[4][1]).toEqual({ q: 'cobalt', statuses, limit: 6 });
        expect(new Set(rows().map(row => row.key)).size).toBe(6);
        expect(result.current.model?.nextCursor).not.toBe(cursor);
        expect(rows().filter(row => row.section !== 'history').every(row => row.queueTaskId === `${row.canonicalId}-task`)).toBe(true);
        await act(async () => { await result.current.loadMore(); });
        expect(rows()).toHaveLength(7);
        expect(result.current.model?.hasMore).toBe(false);
        expect(JSON.stringify(queues)).toBe(before);
        expect(api.getRepoGroupChats.mock.calls.every(call => call[2] === baseUrl)).toBe(true);
    });

    it('caps retained active search depth at the server maximum and continues from the refreshed cursor', async () => {
        await seed(['queued'], 205, false);
        const { result } = renderHook(() => useRepoGroupChatFeed({
            groupId: 'group-ai', serverKey: 'local', enabled: true, pageSize: 100, filters: { q: 'cobalt' },
        }));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        await act(async () => { await result.current.loadMore(); });
        await act(async () => { await result.current.loadMore(); });
        expect(result.current.model?.queued).toHaveLength(205);
        await act(async () => { await result.current.refresh(); });
        expect(api.getRepoGroupChats.mock.calls[3][1]).toEqual({ q: 'cobalt', limit: 200 });
        expect(result.current.model?.queued).toHaveLength(200);
        expect(result.current.model?.hasMore).toBe(true);
        await act(async () => { await result.current.loadMore(); });
        expect(result.current.model?.queued).toHaveLength(205);
    });

    it.each([undefined, '  '])('retains non-search history depth without including the unpaginated active section for query %s', async q => {
        await seed(['queued'], 12);
        for (let i = 0; i < 5; i++) {
            await store.addProcess({
                id: `history-${i}`, type: 'chat', status: 'completed', title: 'history', promptPreview: 'history',
                fullPrompt: 'history', startTime: new Date(start), metadata: { type: 'chat', workspaceId: 'a' },
            });
        }
        const { result } = renderHook(() => useRepoGroupChatFeed({
            groupId: 'group-ai', serverKey: 'local', enabled: true, pageSize: 2, filters: { q },
        }));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        await act(async () => { await result.current.loadMore(); });
        expect(result.current.model?.history).toHaveLength(4);
        expect(result.current.model?.queued).toHaveLength(12);
        await act(async () => { await result.current.refresh(); });
        expect(api.getRepoGroupChats.mock.calls[2][1]).toEqual({ q, limit: 4 });
        expect(result.current.model?.history).toHaveLength(4);
        expect(result.current.model?.queued).toHaveLength(12);
    });
});
