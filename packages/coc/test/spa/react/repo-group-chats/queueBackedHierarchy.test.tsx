/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteProcessStore, type AIProcess, type QueuedTask } from '@plusplusoneplusplus/forge';
import { buildRepoGroupChatFeed, parseRepoGroupChatFeedQuery } from '../../../../src/server/workspaces/repo-group-chat-feed';
import { serializeTaskSummary } from '../../../../src/server/routes/queue-shared';
import { buildRepoGroupChatFeedModel } from '../../../../src/server/spa/client/react/repos/repoGroupChatFeed';
import { RepoGroupChatList } from '../../../../src/server/spa/client/react/repos/RepoGroupChatList';

const api = vi.hoisted(() => ({ client: vi.fn(), pins: vi.fn(), each: vi.fn(), reduce: vi.fn(), groups: vi.fn() }));
vi.mock('../../../../src/server/spa/client/react/api/cocClient', async original => ({
    ...await original<typeof import('../../../../src/server/spa/client/react/api/cocClient')>(),
    getCocClientFor: api.client,
}));

describe('production queue-backed hierarchy', () => {
    let tmpDir: string;
    let store: SqliteProcessStore;
    let queues: Record<string, { running: Record<string, unknown>[]; queued: Record<string, unknown>[] }>;
    const members = ['a', 'b'].map(workspaceId => ({ workspaceId, name: workspaceId, stale: false, readOnly: false }));

    beforeEach(async () => {
        vi.clearAllMocks();
        api.pins.mockResolvedValue({ pins: [] });
        api.each.mockResolvedValue([]);
        api.reduce.mockResolvedValue([]);
        api.groups.mockResolvedValue([]);
        api.client.mockReturnValue({
            processes: { listGroupPins: api.pins }, forEach: { list: api.each },
            mapReduce: { list: api.reduce }, taskGroups: { list: api.groups },
        });
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'group-queue-hierarchy-'));
        store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
        for (const id of ['group-ai', 'a', 'b']) {
            await store.registerWorkspace({ id, name: id, rootPath: path.join(tmpDir, id) });
        }
        queues = {};
    });

    afterEach(() => {
        cleanup();
        store.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    async function addProcess(id: string, owner: string, extra: Partial<AIProcess> = {}) {
        await store.addProcess({
            id, type: 'chat', status: 'running', title: id, promptPreview: id,
            fullPrompt: id, startTime: new Date('2026-01-01T00:00:00Z'), ...extra,
            metadata: { type: 'chat', ...extra.metadata, workspaceId: owner },
        });
    }

    function queueTask(id: string, owner: string, status: 'running' | 'queued' = 'running', extra: Partial<QueuedTask> = {}) {
        const task = serializeTaskSummary({
            id: `${id}-task`, processId: id, repoId: owner, type: 'chat', priority: 'normal', status,
            createdAt: Date.parse('2026-01-01T01:00:00Z'), payload: { prompt: id }, config: {},
            ...extra,
        });
        const queue = queues[owner] ??= { running: [], queued: [] };
        queue[status].push(task);
        return task;
    }

    function getFeed() {
        return buildRepoGroupChatFeed({
            store, readQueue: async owner => queues[owner] ?? { running: [], queued: [] },
        }, 'group-ai', members, parseRepoGroupChatFeedQuery(new URLSearchParams()));
    }

    function renderFeed(feed: Awaited<ReturnType<typeof getFeed>>) {
        const model = buildRepoGroupChatFeedModel(feed, 'server-one');
        const onSelect = vi.fn();
        render(<RepoGroupChatList feed={{ model, status: 'ready', loadingMore: false, loadMore: vi.fn() }}
            serverLabel="Server" selectedKey={null} onSelect={onSelect}
            baseUrl="https://owner.example" groupSelectionId="remote:server-one:group-ai" />);
        return { model, onSelect };
    }

    it('projects durable parent and run metadata without replacing serialized queue identity or payload', async () => {
        const metadata = {
            type: 'chat',
            ralph: { sessionId: 'session', phase: 'executing', currentIteration: 2 },
            forEach: { runId: 'each', workspaceId: 'a', itemId: 'item', childMode: 'ask' },
            mapReduce: { runId: 'reduce', workspaceId: 'a', itemId: 'item' },
            taskGroup: { groupId: 'custom', groupType: 'custom', role: 'item', workspaceId: 'a' },
        };
        await addProcess('parent', 'b', { status: 'completed' });
        await addProcess('child', 'a', { parentProcessId: 'parent', metadata });
        await addProcess('follow', 'a', { status: 'completed', parentProcessId: 'parent', metadata });
        const child = queueTask('child', 'a', 'running', { admitted: true, frozen: true });
        const follow = queueTask('follow', 'a', 'queued');
        const wrongOwner = queueTask('child', 'b');
        const missing = queueTask('missing', 'a');
        expect(child.parentProcessId).toBeUndefined();
        expect(child.ralph).toBeUndefined();
        const before = JSON.stringify(queues);
        const changes = () => (store.getDatabase().prepare('SELECT total_changes() AS n').get() as { n: number }).n;
        const initialChanges = changes();
        const feed = await getFeed();
        for (const [id, task, rows] of [['child', child, feed.running], ['follow', follow, feed.queued]] as const) {
            const row = rows.find(row => row.processId === id && row.ownerWorkspaceId === 'a');
            expect(row).toMatchObject({
                ...task, ralph: metadata.ralph, forEach: metadata.forEach, mapReduce: metadata.mapReduce,
                taskGroup: metadata.taskGroup, parentProcessId: 'parent', parentOwnerWorkspaceId: 'b',
                groupWorkspaceId: 'group-ai', queueTaskId: `${id}-task`, ownerWorkspaceId: 'a',
            });
            expect(row?.payload).toEqual(task.payload);
            expect(row?.id).toBe(task.id);
        }
        for (const task of [wrongOwner, missing]) {
            const row = feed.running.find(row => row.id === task.id && row.ownerWorkspaceId === task.repoId);
            expect(row?.parentProcessId).toBeUndefined();
            expect(row?.ralph).toBeUndefined();
            expect(row?.taskGroup).toBeUndefined();
        }
        expect(JSON.stringify(queues)).toBe(before);
        expect(changes()).toBe(initialChanges);
    });

    it('renders serialized running descendants as an owner-local tree and cross-owner delegation as a link', async () => {
        await addProcess('root', 'a');
        await addProcess('child', 'a', { parentProcessId: 'root' });
        await addProcess('grandchild', 'a', { parentProcessId: 'child' });
        await addProcess('delegated', 'b', { parentProcessId: 'root' });
        for (const id of ['root', 'child', 'grandchild']) queueTask(id, 'a');
        queueTask('delegated', 'b');
        queueTask('root', 'b');
        const { model, onSelect } = renderFeed(await getFeed());
        await waitFor(() => expect(api.pins).toHaveBeenCalledTimes(3));
        const tree = screen.getByTestId('spawned-tree-row');
        expect(within(tree).getAllByTestId('spawned-tree-node').map(node => node.getAttribute('data-depth'))).toEqual(['0', '1', '2']);
        const children = within(tree).getAllByTestId('repo-group-chat-row');
        expect(children.map(row => row.getAttribute('data-owner'))).toEqual(['a', 'a', 'a']);
        fireEvent.click(children[1]);
        expect(onSelect).toHaveBeenCalledWith(model.running.find(row => row.canonicalId === 'child'));
        const delegated = screen.getAllByTestId('repo-group-chat-row')
            .find(row => row.getAttribute('data-chat-key') === 'server-one|b|delegated')!;
        expect(within(delegated).getByRole('link', { name: 'Delegated from' }).getAttribute('href'))
            .toBe('#repos/remote%3Aserver-one%3Agroup-ai/chats/member/a/root');
        expect(within(tree).queryByRole('link', { name: 'Delegated from' })).toBeNull();
        expect(screen.getAllByTestId('repo-group-chat-row')).toHaveLength(5);
        expect(model.running.every(row => row.queueTaskId === `${row.canonicalId}-task`)).toBe(true);
    });

    it.each([
        { field: 'ralph', context: { sessionId: 'same', phase: 'executing' }, prefix: 'ralph-session' },
        { field: 'forEach', context: { runId: 'same', workspaceId: 'a', itemId: 'item', childMode: 'ask' }, prefix: 'for-each-run' },
        { field: 'mapReduce', context: { runId: 'same', workspaceId: 'a', itemId: 'item' }, prefix: 'map-reduce-run' },
        { field: 'taskGroup', context: { groupId: 'same', groupType: 'custom', role: 'item', workspaceId: 'a' }, prefix: 'task-group-run' },
    ])('renders persisted $field from serialized queue rows without nesting across owners', async ({ field, context, prefix }) => {
        for (const owner of ['a', 'b']) {
            const id = `${owner}-child`;
            await addProcess(id, owner, { metadata: { type: 'chat', [field]: { ...context, workspaceId: owner } } });
            queueTask(id, owner);
        }
        const { model } = renderFeed(await getFeed());
        await waitFor(() => expect(api.pins).toHaveBeenCalledTimes(3));
        const parents = screen.getAllByTestId(`${prefix}-row`);
        expect(parents).toHaveLength(2);
        for (const parent of parents) fireEvent.click(within(parent).getByTestId(`${prefix}-chevron`));
        expect(parents.map(parent => within(parent).getAllByTestId('repo-group-chat-row').map(row => row.getAttribute('data-owner'))))
            .toEqual([['a'], ['b']]);
        expect(model.running.map(row => row.queueTaskId)).toEqual(['a-child-task', 'b-child-task']);
    });
});
