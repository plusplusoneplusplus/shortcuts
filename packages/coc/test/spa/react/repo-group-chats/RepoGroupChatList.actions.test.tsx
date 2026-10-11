/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RepoGroupChatList } from '../../../../src/server/spa/client/react/repos/RepoGroupChatList';
import { buildRepoGroupChatFeedModel } from '../../../../src/server/spa/client/react/repos/repoGroupChatFeed';

const action = vi.hoisted(() => vi.fn());
vi.mock('../../../../src/server/spa/client/react/repos/useRepoGroupChatHierarchy', () => ({
    useRepoGroupChatHierarchy: () => ({ owners: {}, error: null, togglePin: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/repos/repoGroupChatActions', async original => ({
    ...await original<typeof import('../../../../src/server/spa/client/react/repos/repoGroupChatActions')>(),
    applyRepoGroupChatAction: action,
}));
afterEach(() => { cleanup(); action.mockReset(); });

function renderList(grouped = false, unavailable = false) {
    const model = buildRepoGroupChatFeedModel({
        groupId: 'group-ai', membershipKey: 'm1',
        sources: [
            { workspaceId: 'a', role: 'member', name: 'Repo A', available: true },
            { workspaceId: 'b', role: 'member', name: 'Repo B', available: !unavailable },
        ],
        running: [], queued: [],
        history: [
            { id: 'same', ownerWorkspaceId: 'a', type: 'chat', status: 'completed', title: 'First', ...(grouped ? { ralph: { sessionId: 'r' } } : {}) },
            { id: 'same', ownerWorkspaceId: 'b', type: 'chat', status: 'completed', title: 'Second' },
            ...(grouped ? [{ id: 'child', ownerWorkspaceId: 'a', type: 'chat', status: 'completed', title: 'Child', ralph: { sessionId: 'r' } }] : []),
        ],
        hasMore: false, counts: { total: 2, running: 0, queued: 0, history: 2, byOwner: {}, partial: false },
    }, 'local');
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<RepoGroupChatList feed={{ model, status: 'ready', loadingMore: false, loadMore: vi.fn() }}
        serverLabel="Local" selectedKey={null} onSelect={vi.fn()} refresh={refresh} />);
    return refresh;
}
describe('group list bulk actions', () => {
    it('lets healthy owners succeed in a mixed unavailable selection without enabling an unavailable-only action', async () => {
        renderList(false, true);
        fireEvent.click(screen.getByText('Select chats'));
        const rows = screen.getAllByTestId('repo-group-chat-row');
        fireEvent.click(rows[1]);
        expect(screen.getByText('archive').hasAttribute('disabled')).toBe(true);
        fireEvent.click(rows[0]);
        expect(screen.getByText('archive').hasAttribute('disabled')).toBe(false);
        action.mockResolvedValueOnce({ succeeded: ['local|a|same'], failed: [{ key: 'local|b|same', ownerWorkspaceId: 'b', error: 'unavailable' }] });
        await act(async () => { fireEvent.click(screen.getByText('archive')); });
        expect(rows[0].getAttribute('aria-selected')).toBe('false');
        expect(rows[1].getAttribute('aria-selected')).toBe('true');
    });
    it('preserves successful changes and selects only failed owner rows for retry', async () => {
        const refresh = renderList();
        action.mockResolvedValueOnce({ succeeded: ['local|a|same'], failed: [{ key: 'local|b|same', ownerWorkspaceId: 'b', error: 'denied' }] });
        fireEvent.click(screen.getByText('Select chats'));
        const rows = screen.getAllByTestId('repo-group-chat-row');
        rows.forEach(row => fireEvent.click(row));
        await act(async () => { fireEvent.click(screen.getByText('archive')); });
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(rows[0].getAttribute('aria-selected')).toBe('false');
        expect(rows[1].getAttribute('aria-selected')).toBe('true');
        expect(screen.getByRole('status').textContent).toContain('1 succeeded. Repo B: denied');
        action.mockResolvedValueOnce({ succeeded: ['local|b|same'], failed: [] });
        await act(async () => { fireEvent.click(screen.getByText('archive')); });
        expect(action.mock.calls[1][0].map((row: { key: string }) => row.key)).toEqual(['local|b|same']);
    });

    it('requires explicit delete confirmation and retains expandable owner-local trees without duplicates', async () => {
        renderList(true);
        const toggle = screen.getByTestId('ralph-session-chevron');
        expect(screen.getAllByTestId('repo-group-chat-row')).toHaveLength(1);
        fireEvent.click(toggle);
        expect(screen.getAllByTestId('repo-group-chat-row')).toHaveLength(3);
        fireEvent.click(toggle);
        expect(screen.getAllByTestId('repo-group-chat-row')).toHaveLength(1);
        fireEvent.click(toggle);
        fireEvent.click(screen.getByText('Select chats'));
        fireEvent.click(screen.getAllByTestId('repo-group-chat-row')[0]);
        fireEvent.click(screen.getByText('delete'));
        expect(action).not.toHaveBeenCalled();
        action.mockResolvedValueOnce({ succeeded: ['local|a|same'], failed: [] });
        await act(async () => { fireEvent.click(screen.getByText('Confirm')); });
        expect(action).toHaveBeenCalledTimes(1);
    });
});
