/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RepoGroupChatList } from '../../../../src/server/spa/client/react/repos/RepoGroupChatList';
import { buildRepoGroupChatFeedModel } from '../../../../src/server/spa/client/react/repos/repoGroupChatFeed';

const api = vi.hoisted(() => ({
    client: vi.fn(), pins: vi.fn(), each: vi.fn(), reduce: vi.fn(), groups: vi.fn(), pin: vi.fn(),
}));
vi.mock('../../../../src/server/spa/client/react/api/cocClient', async original => ({
    ...await original<typeof import('../../../../src/server/spa/client/react/api/cocClient')>(),
    getCocClientFor: api.client,
}));

function chat(id: string, ownerWorkspaceId: string, extra = {}) {
    return { id, ownerWorkspaceId, status: 'completed', type: 'chat', customTitle: `Chat ${id}`,
        endTime: '2026-10-10T00:00:00Z', ...extra };
}
function feed(history: any[], serverKey = 'local', sources = [
    { workspaceId: 'a', role: 'member' as const, name: 'Alpha', available: true },
    { workspaceId: 'b', role: 'member' as const, name: 'Beta', available: true },
]) {
    return buildRepoGroupChatFeedModel({
        groupId: 'group', membershipKey: 'members', sources, running: [], queued: [], history,
        hasMore: false, counts: { total: history.length, running: 0, queued: 0, history: history.length, byOwner: {}, partial: false },
    }, serverKey);
}
function props(model: ReturnType<typeof feed>, baseUrl?: string) {
    return { feed: { model, status: 'ready' as const, loadingMore: false, loadMore: vi.fn() },
        serverLabel: 'Server', selectedKey: null, onSelect: vi.fn(), baseUrl };
}
function run(runId = 'same', extra = {}) {
    return { runId, workspaceId: 'a', status: 'completed', originalRequest: 'Run request',
        createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-10T00:00:00Z', itemCount: 2,
        itemStatusCounts: { completed: 2 }, ...extra };
}
beforeEach(() => {
    vi.clearAllMocks();
    api.pins.mockResolvedValue({ pins: [] });
    api.each.mockResolvedValue([]);
    api.reduce.mockResolvedValue([]);
    api.groups.mockResolvedValue([]);
    api.pin.mockResolvedValue({ pin: null });
    api.client.mockReturnValue({
        processes: { listGroupPins: api.pins, pinGroup: api.pin },
        forEach: { list: api.each }, mapReduce: { list: api.reduce }, taskGroups: { list: api.groups },
    });
});
afterEach(cleanup);

describe('rendered owner-local native hierarchy', () => {
    it('renders recursive depths, independent node expansion and cross-owner delegation links', async () => {
        const model = feed(['a', 'b'].flatMap(owner => [
            chat('root', owner),
            chat('child', owner, { parentProcessId: 'root' }),
            chat('grandchild', owner, { parentProcessId: 'child' }),
        ]).concat(chat('delegated', 'a', { parentProcessId: 'root', parentOwnerWorkspaceId: 'b' })));
        const options = props(model);
        render(<RepoGroupChatList {...options} groupSelectionId="group-ai" />);
        await waitFor(() => expect(api.pins).toHaveBeenCalledTimes(2));
        const trees = screen.getAllByTestId('spawned-tree-row');
        expect(trees).toHaveLength(2);
        expect(within(trees[0]).getAllByTestId('spawned-tree-node').map(node => node.getAttribute('data-depth')))
            .toEqual(['0', '1', '2']);
        expect(screen.getAllByTestId('repo-group-chat-row')).toHaveLength(7);
        const childRow = within(trees[0]).getAllByTestId('repo-group-chat-row')[1];
        expect(childRow.getAttribute('data-group-child')).toBe('true');
        fireEvent.click(childRow);
        expect(options.onSelect).toHaveBeenCalledWith(model.history[1]);
        fireEvent.click(within(trees[0]).getAllByTestId('spawned-tree-chevron')[1]);
        expect(within(trees[0]).getAllByTestId('spawned-tree-node').map(node => node.getAttribute('data-depth'))).toEqual(['0', '1']);
        expect(within(trees[1]).getAllByTestId('spawned-tree-node')).toHaveLength(3);
        const delegated = screen.getAllByTestId('repo-group-chat-row').find(row => row.getAttribute('data-chat-key') === 'local|a|delegated')!;
        expect(within(delegated).getByRole('link', { name: 'Delegated from' }).getAttribute('href')).toBe('#repos/group-ai/chats/member/b/root');
        fireEvent.click(within(trees[0]).getAllByTestId('spawned-tree-chevron')[1]);
        expect(screen.getAllByTestId('repo-group-chat-row')).toHaveLength(7);
    });

    it('uses native run summaries and owner pins, keeps individual pins separate and expands equal run ids independently', async () => {
        api.each.mockImplementation(async owner => [run('same', { workspaceId: owner, generationProcessId: 'generation' })]);
        api.reduce.mockResolvedValue([run('reduce', { reduceStatus: 'completed' })]);
        api.pins.mockImplementation(async owner => ({ pins: owner === 'a'
            ? [{ type: 'for-each-run', groupId: 'same', pinnedAt: '2026-10-11T00:00:00Z' }] : [] }));
        const model = feed([
            chat('generation', 'a'),
            chat('each', 'a', { forEach: { runId: 'same' } }),
            chat('individual', 'a', { forEach: { runId: 'same' }, pinnedAt: '2026-10-09T00:00:00Z' }),
            chat('each', 'b', { forEach: { runId: 'same' } }),
            chat('reduce', 'a', { mapReduce: { runId: 'reduce' } }),
            chat('ralph', 'a', { ralph: { sessionId: 'r', phase: 'complete' } }),
            chat('custom', 'b', { taskGroup: { groupId: 'custom', groupType: 'custom' } }),
        ]);
        render(<RepoGroupChatList {...props(model)} />);
        await waitFor(() => expect(screen.getAllByTestId('for-each-run-status-summary')).toHaveLength(2));
        const pinned = screen.getByRole('group', { name: 'Pinned' });
        const parents = screen.getAllByTestId('for-each-run-row');
        expect(within(pinned).getByTestId('for-each-run-row')).toBe(parents[0]);
        expect(parents[0].getAttribute('data-pinned')).toBe('true');
        expect(parents[1].getAttribute('data-pinned')).toBeNull();
        expect(within(pinned).getByTestId('repo-group-chat-row').getAttribute('data-chat-key')).toBe('local|a|individual');
        expect(screen.getAllByTestId('repo-group-chat-row')).toHaveLength(1);
        expect(within(parents[0]).getByTestId('for-each-run-status-summary').textContent).toBe('2 completed');
        fireEvent.click(within(parents[0]).getByTestId('for-each-run-chevron'));
        expect(within(parents[0]).getAllByTestId('repo-group-chat-row').map(row => row.getAttribute('data-chat-key')))
            .toEqual(['local|a|generation', 'local|a|each']);
        expect(within(parents[1]).queryByTestId('repo-group-chat-row')).toBeNull();
        fireEvent.click(within(parents[1]).getByTestId('for-each-run-chevron'));
        fireEvent.click(screen.getByTestId('map-reduce-run-chevron'));
        fireEvent.click(screen.getByTestId('ralph-session-chevron'));
        fireEvent.click(screen.getByTestId('task-group-run-chevron'));
        const rows = screen.getAllByTestId('repo-group-chat-row');
        expect(rows).toHaveLength(7);
        expect(new Set(rows.map(row => row.getAttribute('data-chat-key'))).size).toBe(7);
    });

    it('routes parent pins and Open in owner to the concrete remote source, never child pins', async () => {
        const endpoint = 'https://remote.example';
        api.each.mockResolvedValue([run()]);
        api.pin.mockResolvedValue({ pin: { type: 'for-each-run', groupId: 'same', pinnedAt: '2026-10-11T00:00:00Z' } });
        render(<RepoGroupChatList {...props(feed([chat('child', 'a', { forEach: { runId: 'same' } })], 'server-one'), endpoint)} />);
        await waitFor(() => expect(screen.getByTestId('for-each-run-status-summary').textContent).toBe('2 completed'));
        await act(async () => fireEvent.click(screen.getByTestId('for-each-run-pin')));
        expect(api.client).toHaveBeenCalledWith(endpoint);
        expect(api.pin).toHaveBeenCalledWith('a', 'for-each-run', 'same', true);
        expect(screen.getByTestId('for-each-run-row').getAttribute('data-pinned')).toBe('true');
        fireEvent.click(screen.getByTestId('for-each-run-more'));
        expect(window.location.hash).toBe('#repos/remote%3Aserver-one%3Aa/chats/for-each/same');
        fireEvent.click(screen.getByTestId('for-each-run-chevron'));
        expect(screen.getByTestId('repo-group-chat-row').className).not.toContain('border-l-amber-400');
    });

    it('keeps active pinned run parents under Running and selects collapsed parents as their owner-local children', async () => {
        api.each.mockResolvedValue([run('same', { status: 'running' })]);
        api.pins.mockResolvedValue({ pins: [{ type: 'for-each-run', groupId: 'same', pinnedAt: '2026-10-11T00:00:00Z' }] });
        render(<RepoGroupChatList {...props(feed([
            chat('one', 'a', { forEach: { runId: 'same' } }),
            chat('two', 'a', { forEach: { runId: 'same' } }),
        ]))} />);
        await waitFor(() => expect(within(screen.getByRole('group', { name: 'Running' })).getByTestId('for-each-run-row')).toBeTruthy());
        fireEvent.click(screen.getByText('Select chats'));
        fireEvent.click(screen.getByTestId('for-each-run-body'));
        expect(screen.getByText('2 selected')).toBeTruthy();
        fireEvent.click(screen.getByTestId('for-each-run-chevron'));
        expect(screen.getAllByTestId('repo-group-chat-row').every(row => row.getAttribute('aria-selected') === 'true')).toBe(true);
    });

    it.each([
        { type: 'ralph-session', prefix: 'ralph-session', context: { ralph: { sessionId: 'same', phase: 'complete' } } },
        { type: 'map-reduce-run', prefix: 'map-reduce-run', context: { mapReduce: { runId: 'same' } } },
        { type: 'custom', prefix: 'task-group-run', context: { taskGroup: { groupId: 'same', groupType: 'custom' } } },
    ])('keeps $type group pins and parent controls independent across owners', async ({ type, prefix, context }) => {
        api.reduce.mockResolvedValue([run('same', { reduceStatus: 'completed' })]);
        api.pins.mockImplementation(async owner => ({ pins: owner === 'a'
            ? [{ type, groupId: 'same', pinnedAt: '2026-10-11T00:00:00Z' }] : [] }));
        render(<RepoGroupChatList {...props(feed([chat('child', 'a', context), chat('child', 'b', context)]))} />);
        await waitFor(() => expect(within(screen.getByRole('group', { name: 'Pinned' })).getByTestId(`${prefix}-row`)).toBeTruthy());
        const pinned = within(screen.getByRole('group', { name: 'Pinned' })).getByTestId(`${prefix}-row`);
        await act(async () => fireEvent.click(within(pinned).getByTestId(`${prefix}-pin`)));
        expect(api.pin).toHaveBeenCalledWith('a', type, 'same', false);
        expect(screen.getAllByTestId(`${prefix}-row`).every(parent => parent.getAttribute('data-pinned') === null)).toBe(true);
    });
});

describe('owner summary request lifecycle', () => {
    it('preserves expansion through pin-section moves and delayed native summaries without reverting newer pins', async () => {
        let resolveEach!: (runs: any[]) => void;
        api.each.mockImplementation(owner => owner === 'a' ? new Promise(resolve => { resolveEach = resolve; }) : Promise.resolve([]));
        api.pin.mockResolvedValue({ pin: { type: 'for-each-run', groupId: 'same', pinnedAt: '2026-10-11T00:00:00Z' } });
        render(<RepoGroupChatList {...props(feed([chat('child', 'a', { forEach: { runId: 'same' } })]))} />);
        fireEvent.click(screen.getByTestId('for-each-run-chevron'));
        expect(screen.getByTestId('repo-group-chat-row')).toBeTruthy();
        await act(async () => fireEvent.click(screen.getByTestId('for-each-run-pin')));
        expect(within(screen.getByRole('group', { name: 'Pinned' })).getByTestId('repo-group-chat-row')).toBeTruthy();
        await act(async () => resolveEach([run()]));
        expect(screen.getByTestId('for-each-run-status-summary').textContent).toBe('2 completed');
        expect(within(screen.getByRole('group', { name: 'Pinned' })).getByTestId('repo-group-chat-row')).toBeTruthy();
        expect(screen.getByTestId('for-each-run-chevron').getAttribute('aria-expanded')).toBe('true');
    });

    it('rejects unavailable-owner responses immediately and disables parent pin actions with a retained endpoint', async () => {
        let resolveEach!: (runs: any[]) => void;
        api.each.mockImplementation(owner => owner === 'a' ? new Promise(resolve => { resolveEach = resolve; }) : Promise.resolve([]));
        const model = feed([chat('child', 'a', { forEach: { runId: 'same' } })], 'remote-server');
        const options = props(model, 'https://remote.example');
        const view = render(<RepoGroupChatList {...options} />);
        expect(screen.getByTestId('for-each-run-pin')).toBeTruthy();
        const offline = { ...model, sources: model.sources.map(source => ({ ...source, available: false })) };
        view.rerender(<RepoGroupChatList {...options} feed={{ ...options.feed, model: offline }} />);
        expect(screen.queryByTestId('for-each-run-pin')).toBeNull();
        await act(async () => resolveEach([run('same', { originalRequest: 'Late unavailable summary' })]));
        expect(screen.queryByText('Late unavailable summary')).toBeNull();
        expect(api.each).toHaveBeenCalledTimes(2);
        expect(api.pin).not.toHaveBeenCalled();
    });

    it('does not read run metadata during flat search or fall through unresolved remote owners locally', () => {
        const model = feed([chat('child', 'a', { ralph: { sessionId: 'same' } })]);
        const view = render(<RepoGroupChatList {...props(model)} filters={{ q: 'match' }} />);
        expect(screen.getAllByTestId('repo-group-chat-row')).toHaveLength(1);
        expect(screen.queryByTestId('ralph-session-row')).toBeNull();
        view.rerender(<RepoGroupChatList {...props({ ...model, serverKey: 'remote-server' })} />);
        expect(api.client).not.toHaveBeenCalled();
    });

    it('discards late responses after a server change even for colliding owner and run ids', async () => {
        let resolveEach!: (runs: any[]) => void;
        api.each.mockImplementation(owner => owner === 'a' ? new Promise(resolve => { resolveEach = resolve; }) : Promise.resolve([]));
        const history = [chat('child', 'a', { forEach: { runId: 'same' } })];
        const options = props(feed(history, 'server-one'), 'https://one.example');
        const view = render(<RepoGroupChatList {...options} />);
        api.each.mockResolvedValue([]);
        view.rerender(<RepoGroupChatList {...props(feed(history, 'server-two'), 'https://two.example')} />);
        await act(async () => resolveEach([run('same', { originalRequest: 'Wrong server summary' })]));
        expect(screen.queryByText('Wrong server summary')).toBeNull();
        expect(api.client).toHaveBeenCalledWith('https://two.example');
    });

    it('retains owner run summaries and pins during partial read failure and offline snapshots', async () => {
        api.each.mockResolvedValue([run()]);
        api.pins.mockResolvedValue({ pins: [{ type: 'for-each-run', groupId: 'same', pinnedAt: '2026-10-11T00:00:00Z' }] });
        const model = feed([chat('child', 'a', { forEach: { runId: 'same' } })]);
        const options = props(model);
        const view = render(<RepoGroupChatList {...options} />);
        await waitFor(() => expect(screen.getByTestId('for-each-run-status-summary').textContent).toBe('2 completed'));
        api.each.mockRejectedValue(new Error('Summary unavailable'));
        api.pins.mockRejectedValue(new Error('Pins unavailable'));
        view.rerender(<RepoGroupChatList {...options} feed={{ ...options.feed, model: { ...model } }} />);
        await waitFor(() => expect(screen.getByText('Some owner run details could not be loaded.')).toBeTruthy());
        expect(screen.getByTestId('for-each-run-row').getAttribute('data-pinned')).toBe('true');
        expect(screen.getByTestId('for-each-run-status-summary').textContent).toBe('2 completed');
        view.rerender(<RepoGroupChatList {...options} feed={{ ...options.feed,
            model: { ...model, sources: model.sources.map(source => ({ ...source, available: false })) } }} />);
        expect(screen.getByTestId('for-each-run-row').getAttribute('data-pinned')).toBe('true');
        expect(screen.queryByTestId('for-each-run-pin')).toBeNull();
    });
});
