/**
 * RepoGroupView with `repoGroupAggregatedChats`: the group's Workspace chat list
 * becomes the aggregated list read from the group's owning server, while the
 * group's RepoChatTab keeps its selection and detail. Flag off keeps the native
 * list untouched.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockQueueDispatch = vi.fn();
const mockGetRepoGroup = vi.fn();
const mockGetRepoGroupChats = vi.fn();
const mockSelectTask = vi.fn();
let mockFlag = true;
let mockRemoteGroups: any[] = [];
let mockSelectedTaskId: string | null = null;
let mockMobile = false;

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: mockAppState, dispatch: vi.fn() }),
    useAppOptional: () => ({ state: mockAppState, dispatch: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useReposOptional: () => ({ remoteGroupWorkspaces: mockRemoteGroups }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { selectedTaskIdByRepo: {}, repoQueueMap: {} }, dispatch: mockQueueDispatch }),
    useQueueOptional: () => ({ state: { selectedTaskIdByRepo: {}, repoQueueMap: {} }, dispatch: mockQueueDispatch }),
}));
vi.mock('../../../../src/server/spa/client/react/layout/Router', async () => {
    const routes = await import('../../../../src/server/spa/client/react/layout/dashboardRoutes');
    return { buildWorkspaceSubTabSuffix: routes.buildWorkspaceSubTabSuffix };
});
vi.mock('../../../../src/server/spa/client/react/layout/StatusActions', () => ({ StatusActions: () => null }));
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ breakpoint: mockMobile ? 'mobile' : 'desktop', isMobile: mockMobile, isTablet: false, isDesktop: !mockMobile }),
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useRepoGroupAggregatedChatsEnabled', () => ({
    useRepoGroupAggregatedChatsEnabled: () => mockFlag,
}));
vi.mock('../../../../src/server/spa/client/react/repos/repoGroupService', () => ({
    getRepoGroup: (...args: unknown[]) => mockGetRepoGroup(...args),
    getRepoGroupChats: (...args: unknown[]) => mockGetRepoGroupChats(...args),
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel', () => ({
    UnifiedRightPanel: () => null,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/content-search/ContentSearchOverlayHost', () => ({
    ContentSearchOverlayHost: () => null,
}));
vi.mock('../../../../src/server/spa/client/react/features/chat/ChatDetailPane', () => ({
    ChatDetailPane: ({ workspaceId, sourceSelectionId, selectedTaskId }: any) => (
        <div data-testid="stub-member-chat-pane" data-owner={workspaceId} data-route={sourceSelectionId} data-process={selectedTaskId} />
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/chat/RepoChatTab', async () => {
    const { createPortal } = await import('react-dom');
    return {
    RepoChatTab: ({ workspaceId, renderList, detailOverride, detailContainer, detailActive }: any) => (
        <div data-testid="stub-chat-tab" data-workspace={workspaceId}>
            {renderList
                ? renderList({ selectedTaskId: mockSelectedTaskId, selectTask: mockSelectTask })
                : <div data-testid="native-chat-list" />}
            {detailContainer && detailActive && detailOverride ? createPortal(detailOverride, detailContainer) : null}
        </div>
    ),
    };
});
vi.mock('../../../../src/server/spa/client/react/repos/RepoGroupGitTab', () => ({ RepoGroupGitTab: () => null }));
vi.mock('../../../../src/server/spa/client/react/features/notes/NotesView', () => ({ NotesView: () => null }));
vi.mock('../../../../src/server/spa/client/react/repos/RepoGroupSettingsTab', () => ({ RepoGroupSettingsTab: () => null }));

import { RepoGroupView } from '../../../../src/server/spa/client/react/repos/RepoGroupView';

const GROUP_ID = 'group-ai';
let mockAppState: any = {};

function feedPage(groupId = GROUP_ID) {
    return {
        groupId,
        membershipKey: 'm1',
        sources: [
            { workspaceId: groupId, role: 'group', name: 'AI', available: true },
            { workspaceId: 'ws-a', role: 'member', name: 'connector', available: true },
            { workspaceId: 'ws-b', role: 'member', name: 'shortcuts', available: true },
        ],
        running: [],
        queued: [],
        history: [
            { id: 'queue_m1', ownerWorkspaceId: 'ws-a', type: 'chat', status: 'completed', customTitle: 'Fix relay receipt routing' },
            { id: 'queue_g1', ownerWorkspaceId: groupId, type: 'chat', status: 'completed', customTitle: 'Group plan' },
            { id: 'queue_m2', ownerWorkspaceId: 'ws-b', type: 'chat', status: 'completed', customTitle: 'Delegated job' },
        ],
        hasMore: false,
        counts: { total: 3, running: 0, queued: 0, history: 3, byOwner: {}, partial: false },
    };
}

beforeEach(() => {
    cleanup();
    location.hash = '';
    mockFlag = true;
    mockRemoteGroups = [];
    mockSelectedTaskId = null;
    mockMobile = false;
    mockQueueDispatch.mockReset();
    mockSelectTask.mockReset();
    mockGetRepoGroup.mockReset().mockResolvedValue({ id: GROUP_ID, name: 'AI', members: [] });
    mockGetRepoGroupChats.mockReset().mockResolvedValue(feedPage());
    mockAppState = {
        activeRepoSubTab: 'chats',
        selectedNotePath: null,
        workspaces: [{ id: GROUP_ID, name: 'AI', rootPath: `/data/repos/${GROUP_ID}` }],
    };
});

describe('RepoGroupView — aggregated chats', () => {
    it('keeps the native group list when the flag is off and never reads the feed', async () => {
        mockFlag = false;
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect(screen.getByTestId('native-chat-list')).toBeTruthy();
        expect(screen.queryByTestId('repo-group-chat-list')).toBeNull();
        await act(async () => {});
        expect(mockGetRepoGroupChats).not.toHaveBeenCalled();
    });

    it('lists group-owned and member chats from the local server with option B prefixes', async () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        await waitFor(() => expect(screen.getAllByTestId('repo-group-chat-row')).toHaveLength(3));
        expect(mockGetRepoGroupChats).toHaveBeenCalledWith(GROUP_ID, expect.any(Object), undefined, expect.any(AbortSignal));
        expect(screen.queryByTestId('native-chat-list')).toBeNull();
        const prefixes = screen.getAllByTestId('repo-group-chat-row')
            .map(row => row.querySelector('[data-testid="repo-group-chat-owner-prefix"]')?.textContent ?? null);
        expect(prefixes).toEqual(['connector /', null, 'shortcuts /']);
        expect(screen.getByTestId('repo-group-chat-server').textContent).toBe('This server');
        expect(screen.getAllByTestId('repo-group-chat-row')[0].getAttribute('data-chat-key')).toBe('local|ws-a|queue_m1');
    });

    it('reads a remote group from its own server and keys rows by that server', async () => {
        mockRemoteGroups = [{
            id: GROUP_ID, name: 'AI', baseUrl: 'http://remote:4000',
            remote: { serverId: 'srv-1', serverLabel: 'devbox', baseUrl: 'http://remote:4000', cloneKey: 'remote:srv-1:group-ai' },
        }];
        render(<RepoGroupView workspaceId={GROUP_ID} selectionId="remote:srv-1:group-ai" />);
        await waitFor(() => expect(screen.getAllByTestId('repo-group-chat-row')).toHaveLength(3));
        expect(mockGetRepoGroupChats).toHaveBeenCalledWith(GROUP_ID, expect.any(Object), 'http://remote:4000', expect.any(AbortSignal));
        expect(screen.getByTestId('repo-group-chat-server').textContent).toBe('devbox');
        expect(screen.getAllByTestId('repo-group-chat-row')[0].getAttribute('data-chat-key')).toBe('srv-1|ws-a|queue_m1');
    });

    it('selects group-owned chats through the group tab and highlights its current selection', async () => {
        mockSelectedTaskId = 'queue_g1';
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        await waitFor(() => expect(screen.getAllByTestId('repo-group-chat-row')).toHaveLength(3));
        const rows = screen.getAllByTestId('repo-group-chat-row');
        expect(rows[1].getAttribute('aria-selected')).toBe('true');
        fireEvent.click(rows[1]);
        expect(mockSelectTask).toHaveBeenCalledWith('queue_g1', expect.objectContaining({ ownerWorkspaceId: GROUP_ID }));
    });

    it('does not route member chats through the group tab selection', async () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        await waitFor(() => expect(screen.getAllByTestId('repo-group-chat-row')).toHaveLength(3));
        fireEvent.click(screen.getAllByTestId('repo-group-chat-row')[0]);
        expect(mockSelectTask).not.toHaveBeenCalled();
        expect(mockQueueDispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SELECT_QUEUE_TASK', repoId: GROUP_ID, id: 'queue_m1' }));
        expect(screen.getAllByTestId('repo-group-chat-row')[0].getAttribute('aria-selected')).toBe('true');
        expect(location.hash).toBe('#repos/group-ai/chats/member/ws-a/queue_m1');
        expect(screen.getByTestId('stub-member-chat-pane').dataset.owner).toBe('ws-a');
        expect(screen.getByTestId('stub-member-chat-pane').dataset.route).toBe('ws-a');
        expect(screen.getByTestId('repo-group-member-open-in-repo').getAttribute('href')).toBe('#repos/ws-a/chats/queue_m1');
    });

    it('restores member selection from a deep link and switches owners on browser history', async () => {
        location.hash = '#repos/group-ai/chats/member/ws-b/queue_m2';
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        await waitFor(() => expect(screen.getAllByTestId('repo-group-chat-row')).toHaveLength(3));
        expect(screen.getAllByTestId('repo-group-chat-row')[2].getAttribute('aria-selected')).toBe('true');
        expect(screen.getByTestId('stub-member-chat-pane').dataset.owner).toBe('ws-b');
        act(() => {
            location.hash = '#repos/group-ai/chats/member/ws-a/queue_m1';
            window.dispatchEvent(new HashChangeEvent('hashchange'));
        });
        expect(screen.getAllByTestId('repo-group-chat-row')[0].getAttribute('aria-selected')).toBe('true');
        expect(screen.getAllByTestId('repo-group-chat-row')[2].getAttribute('aria-selected')).toBe('false');
        expect(mockSelectTask).not.toHaveBeenCalled();
        expect(screen.getByTestId('stub-member-chat-pane').dataset.owner).toBe('ws-a');
    });

    it('New Chat clears the member selection and retains the remote group owner', async () => {
        const selectionId = 'remote:srv-1:group-ai';
        mockRemoteGroups = [{
            id: GROUP_ID, name: 'AI', baseUrl: 'http://remote:4000',
            remote: { serverId: 'srv-1', serverLabel: 'devbox', baseUrl: 'http://remote:4000', cloneKey: selectionId },
        }];
        render(<RepoGroupView workspaceId={GROUP_ID} selectionId={selectionId} />);
        await waitFor(() => expect(screen.getAllByTestId('repo-group-chat-row')).toHaveLength(3));
        fireEvent.click(screen.getAllByTestId('repo-group-chat-row')[0]);
        expect(location.hash).toBe('#repos/remote%3Asrv-1%3Agroup-ai/chats/member/ws-a/queue_m1');
        expect(screen.getByTestId('stub-member-chat-pane').dataset.route).toBe('remote:srv-1:ws-a');
        expect(screen.getByTestId('repo-group-member-owner').textContent).toBe('connector · devbox');
        fireEvent.click(screen.getByTestId('repo-group-split-new-chat'));
        expect(location.hash).toBe('#repos/remote%3Asrv-1%3Agroup-ai/chats');
        expect(mockQueueDispatch).toHaveBeenCalledWith({ type: 'SELECT_QUEUE_TASK', id: null, repoId: GROUP_ID });
        expect(screen.getAllByTestId('repo-group-chat-row')[0].getAttribute('aria-selected')).toBe('false');
        expect(screen.queryByTestId('stub-member-chat-pane')).toBeNull();
    });

    it('mobile keyboard selection opens owner detail and Back to group chats retains list scroll', async () => {
        mockMobile = true;
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        await waitFor(() => expect(screen.getAllByTestId('repo-group-chat-row')).toHaveLength(3));
        const list = screen.getByRole('listbox', { name: 'Group chats' });
        list.scrollTop = 123;
        const row = screen.getAllByTestId('repo-group-chat-row')[0];
        fireEvent.keyDown(row, { key: 'Enter' });
        await waitFor(() => expect(screen.getByTestId('split-workspace-panel').dataset.mobileDetail).toBe('true'));
        expect(screen.getByTestId('stub-member-chat-pane').dataset.owner).toBe('ws-a');
        fireEvent.click(screen.getByRole('button', { name: 'Back to group chats' }));
        expect(screen.getByTestId('split-workspace-panel').dataset.mobileDetail).toBe('false');
        expect(location.hash).toBe('#repos/group-ai/chats');
        expect(screen.getByRole('listbox', { name: 'Group chats' })).toBe(list);
        expect(list.scrollTop).toBe(123);
        expect(screen.queryByTestId('stub-member-chat-pane')).toBeNull();
        fireEvent.keyDown(row, { key: ' ' });
        await waitFor(() => expect(screen.getByTestId('split-workspace-panel').dataset.mobileDetail).toBe('true'));
    });

    it('restored mobile member links push conversation detail without waiting for a row click', async () => {
        mockMobile = true;
        location.hash = '#repos/group-ai/chats/member/ws-b/queue_m2';
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        await waitFor(() => expect(screen.getByTestId('split-workspace-panel').dataset.mobileDetail).toBe('true'));
        expect(screen.getByTestId('stub-member-chat-pane').dataset.owner).toBe('ws-b');
        expect(screen.getByRole('button', { name: 'Back to group chats' })).toBeTruthy();
    });

    it('does not mount a native group tab or read locally when a remote group route is unresolved', async () => {
        render(<RepoGroupView workspaceId={GROUP_ID} selectionId="remote:missing:group-ai" />);
        await waitFor(() => expect(screen.getByTestId('repo-group-chat-error')).toBeTruthy());
        expect(screen.queryByTestId('stub-chat-tab')).toBeNull();
        expect(mockGetRepoGroupChats).not.toHaveBeenCalled();
    });
});
