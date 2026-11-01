/**
 * Repo group on desktop with the split Workspace panel: the Chats tab uses
 * the same `SplitWorkspacePanel` a single repo does — chat list on top, the
 * group git list below, the chat detail in the middle, and the Git detail in
 * the far-right panel. The leaf tabs are stubbed; the real Git-panel hook
 * exercises the shared desktop wiring.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { useSplitGitPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/useSplitGitPanel';
import { UnifiedGitTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedGitTab';
import { readUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { useUnifiedGitTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedGitTabHost';
import {
    resolveDashboardRoute,
    type RouteContext,
} from '../../../../src/server/spa/client/react/layout/dashboardRoutes';

const mockDispatch = vi.fn();
const mockQueueDispatch = vi.fn();
let mockAppState: any = {};
let mockQueueMap: Record<string, { running: any[]; queued: any[] }> = {};
const mockGetRepoGroup = vi.fn();
const mockSelectNativeChat = vi.fn();
const mockMarkGroupRead = vi.fn();
vi.mock('../../../../src/server/spa/client/react/features/chat/unreadMarkAllRead', async importOriginal => ({
    ...await importOriginal<object>(), markGroupUnreadRead: (...args: unknown[]) => mockMarkGroupRead(...args),
}));
let mockUnreadFeed: any = null;
let mockRemoteGroupWorkspaces: any[] = [];
vi.mock('../../../../src/server/spa/client/react/repos/useRepoGroupChatFeed', async importOriginal => {
    const original = await importOriginal<any>();
    return { ...original, useRepoGroupChatFeed: (options: any) => mockUnreadFeed ?? original.useRepoGroupChatFeed(options) };
});

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: mockAppState, dispatch: mockDispatch }),
    useAppOptional: () => ({ state: mockAppState, dispatch: mockDispatch }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useReposOptional: () => ({ remoteGroupWorkspaces: mockRemoteGroupWorkspaces }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { selectedTaskIdByRepo: {}, repoQueueMap: mockQueueMap }, dispatch: mockQueueDispatch }),
    useQueueOptional: () => ({ state: { selectedTaskIdByRepo: {}, repoQueueMap: mockQueueMap }, dispatch: mockQueueDispatch }),
}));
vi.mock('../../../../src/server/spa/client/react/layout/Router', async () => {
    const routes = await import('../../../../src/server/spa/client/react/layout/dashboardRoutes');
    return { buildWorkspaceSubTabSuffix: routes.buildWorkspaceSubTabSuffix };
});
vi.mock('../../../../src/server/spa/client/react/layout/StatusActions', () => ({
    StatusActions: ({ variant }: { variant: string }) => <div data-testid="stub-status-actions" data-variant={variant} />,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ breakpoint: 'desktop', isMobile: false, isTablet: false, isDesktop: true }),
}));
vi.mock('../../../../src/server/spa/client/react/repos/repoGroupService', () => ({
    getRepoGroup: (...args: unknown[]) => mockGetRepoGroup(...args),
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel', () => ({
    UnifiedRightPanel: ({ workspaceId }: { workspaceId: string }) =>
        <div data-testid="stub-right-panel"><StubGitTabSurface workspaceId={workspaceId} /></div>,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/content-search/ContentSearchOverlayHost', () => ({
    ContentSearchOverlayHost: () => null,
}));

interface LeafProps {
    workspaceId: string;
    layout?: string;
    detailContainer?: HTMLElement | null;
    detailActive?: boolean;
    onActivateDetail?: () => void;
    headerToolbarContainer?: HTMLElement | null;
    active?: boolean;
    members?: unknown;
    rightPanel?: { chatId: string | null; ownerRoutingRef: string | null };
    railShortcutContainer?: HTMLElement | null;
    renderUnreadRail?: (context: any) => React.ReactNode;
}

vi.mock('../../../../src/server/spa/client/react/features/chat/RepoChatTab', () => ({
    RepoChatTab: ({ workspaceId, layout, detailContainer, detailActive, onActivateDetail, railShortcutContainer, renderUnreadRail }: LeafProps) => (
        <div data-testid="stub-chat-tab" data-workspace={workspaceId} data-layout={layout ?? ''}>
            <button data-testid="stub-chat-row" onClick={() => onActivateDetail?.()}>chat</button>
            {detailContainer && detailActive && createPortal(<div data-testid="stub-chat-detail" />, detailContainer)}
            {railShortcutContainer && renderUnreadRail && createPortal(renderUnreadRail({ selectedTaskId: null, selectTask: mockSelectNativeChat }), railShortcutContainer)}
        </div>
    ),
}));
vi.mock('../../../../src/server/spa/client/react/repos/RepoGroupGitTab', () => ({
    RepoGroupGitTab: (props: LeafProps) => <StubGroupGitTab {...props} />,
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/NotesView', () => ({
    NotesView: () => <div data-testid="stub-notes-view" />,
}));
vi.mock('../../../../src/server/spa/client/react/repos/RepoGroupSettingsTab', () => ({
    RepoGroupSettingsTab: () => <div data-testid="stub-group-settings" />,
}));

import { _resetRuntimeConfig, applyRuntimeConfigPatch } from '../../../../src/server/spa/client/react/utils/config';
import { splitWorkspaceLeftCollapsedStorageKey } from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceLeftCollapse';

import { RepoGroupView } from '../../../../src/server/spa/client/react/repos/RepoGroupView';

const GROUP_ID = 'group-ai-repos';
function StubGitTabSurface({ workspaceId }: { workspaceId: string }) {
    const tab = useUnifiedGitTab(workspaceId, { ownerWorkspaceId: workspaceId, ownerRoutingRef: null });
    return tab ? <UnifiedGitTab scopeWorkspaceId={workspaceId} /> : null;
}
function StubGroupGitTab({
    workspaceId, layout, detailContainer, detailActive, onActivateDetail, headerToolbarContainer, active, rightPanel,
}: LeafProps) {
    const memberId = mockAppState.gitRouteScope?.workspaceId ?? 'r1';
    const panel = useSplitGitPanel({
        scopeWorkspaceId: workspaceId,
        ownerRoutingRef: rightPanel?.ownerRoutingRef,
        chatId: rightPanel?.chatId ?? null,
        memberId,
        enabled: !!rightPanel,
    });
    const container = rightPanel ? panel.detailContainer : detailContainer;
    return (
        <div data-testid="stub-group-git-tab" data-workspace={workspaceId}
            data-layout={layout ?? ''} data-active={String(!!active)}
            data-header-hoisted={headerToolbarContainer ? 'true' : 'false'} data-member={memberId}>
            <button data-testid="stub-git-row" onClick={() => {
                onActivateDetail?.();
                panel.onViewChange?.({ type: 'commit', commit: {
                    hash: 'abc1234', shortHash: 'abc1234', subject: 'Example',
                    author: 'Test', date: '2026-01-01', parentHashes: [],
                } });
            }}>commit</button>
            {container && (rightPanel ? panel.detailActive : detailActive) && createPortal(
                <div data-testid="stub-git-detail" data-commit={mockAppState.selectedGitCommitHash ?? 'abc1234'} />,
                container,
            )}
        </div>
    );
}

beforeEach(() => {
    cleanup();
    localStorage.clear();
    _resetRuntimeConfig();
    location.hash = '';
    mockDispatch.mockReset();
    mockQueueDispatch.mockReset();
    mockQueueMap = {};
    mockUnreadFeed = null;
    mockRemoteGroupWorkspaces = [];
    mockSelectNativeChat.mockReset();
    mockMarkGroupRead.mockReset().mockResolvedValue(undefined);
    mockGetRepoGroup.mockReset();
    mockGetRepoGroup.mockResolvedValue({
        id: GROUP_ID,
        name: 'AI Repos',
        members: [{ workspaceId: 'r1', stale: false, name: 'shortcuts', rootPath: '/r/r1' }],
    });
    mockAppState = {
        activeRepoSubTab: 'chats',
        selectedNotePath: null,
        workspaces: [{ id: GROUP_ID, name: 'AI Repos', rootPath: `/data/repos/${GROUP_ID}` }],
    };
});

function click(testId: string): void {
    act(() => { fireEvent.click(screen.getByTestId(testId)); });
}

afterEach(() => { cleanup(); _resetRuntimeConfig(); });

describe('RepoGroupView — desktop split Workspace panel', () => {
    it.each([false, true])('opens unread group/member rows through their existing navigation (remote=%s)', async remote => {
        applyRuntimeConfigPatch({ repoGroupAggregatedChatsEnabled: true });
        window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
        const selectionId = remote ? `remote:server-remote:${GROUP_ID}` : GROUP_ID;
        if (remote) mockRemoteGroupWorkspaces = [{
            id: GROUP_ID, name: 'Remote group', baseUrl: 'http://remote:3000',
            remote: { serverId: 'server-remote', cloneKey: selectionId },
        }];
        localStorage.setItem(splitWorkspaceLeftCollapsedStorageKey(GROUP_ID), '1');
        localStorage.setItem(`coc.group-chat-filters:${selectionId}`, JSON.stringify({ owners: ['r1'], q: 'answer' }));
        const row = (ownerWorkspaceId: string, title: string) => ({
            key: `${ownerWorkspaceId}|queue_same`, ownerWorkspaceId, canonicalId: 'queue_same',
            section: 'history', ownerName: ownerWorkspaceId,
            item: { id: 'queue_same', type: 'chat', customTitle: title, status: 'completed', endTime: '2026-10-21T00:00:00Z' },
        });
        const groupRow = row(GROUP_ID, 'Group unread');
        const memberRow = row('r1', 'Member unread');
        mockUnreadFeed = { status: 'ready', refresh: vi.fn(), loadMore: vi.fn(), model: {
            history: [groupRow, memberRow, { ...row('r2', 'Read answer'), item: { ...memberRow.item, seenAt: memberRow.item.endTime } }],
            membershipKey: 'members-a', running: [], queued: [], sources: [], counts: { unread: 2, total: 3, partial: false }, hasMore: false,
        } };
        const { rerender } = render(<RepoGroupView workspaceId={GROUP_ID} selectionId={selectionId} />);
        const unread = await screen.findByTestId('split-workspace-left-unread');
        expect(unread).toHaveAccessibleName('2 unread conversations');
        fireEvent.click(unread);
        expect(mockMarkGroupRead).not.toHaveBeenCalled();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark all read' })); });
        expect(mockMarkGroupRead).toHaveBeenCalledWith({
            groupId: GROUP_ID, baseUrl: remote ? 'http://remote:3000' : undefined,
            serverKey: remote ? 'server-remote' : 'local', membershipKey: 'members-a', signal: expect.any(AbortSignal),
        });
        expect(mockUnreadFeed.refresh).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('link', { name: /Read answer/ })).toBeNull();
        const groupLink = screen.getByRole('link', { name: /Group unread/ });
        expect(groupLink.getAttribute('href')).toBe(`#repos/${encodeURIComponent(selectionId)}/chats/queue_same`);
        fireEvent.click(groupLink);
        expect(mockSelectNativeChat).toHaveBeenCalledWith('queue_same', groupRow.item);
        fireEvent.click(unread);
        const memberLink = screen.getByRole('link', { name: /Member unread/ });
        expect(memberLink.getAttribute('href')).toBe(`#repos/${encodeURIComponent(selectionId)}/chats/member/r1/queue_same`);
        fireEvent.click(memberLink);
        expect(location.hash).toBe(`#repos/${encodeURIComponent(selectionId)}/chats/member/r1/queue_same`);
        expect(mockSelectNativeChat).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(splitWorkspaceLeftCollapsedStorageKey(GROUP_ID))).toBe('1');
        mockUnreadFeed = { ...mockUnreadFeed, model: { ...mockUnreadFeed.model, counts: { unread: 2, partial: true } } };
        rerender(<RepoGroupView workspaceId={GROUP_ID} selectionId={selectionId} />);
        fireEvent.click(unread);
        expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
        expect(mockMarkGroupRead).toHaveBeenCalledTimes(1);
        mockUnreadFeed = { ...mockUnreadFeed, model: { ...mockUnreadFeed.model, history: [], counts: { unread: 0, partial: false } } };
        rerender(<RepoGroupView workspaceId={GROUP_ID} selectionId={selectionId} />);
        expect(unread).toHaveAccessibleName('0 unread conversations');
        fireEvent.click(unread);
        expect(screen.getByText('No unread conversations.')).toBeTruthy();
    });

    it.each([undefined, false, true])('shows live-member Git tiles with obsolete runtime flag %s', async saved => {
        localStorage.setItem(splitWorkspaceLeftCollapsedStorageKey(GROUP_ID), '1');
        if (saved !== undefined) applyRuntimeConfigPatch({ railGitSummaryEnabled: saved });
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        await waitFor(() => expect(screen.getByTestId('split-workspace-left-git-branch')).toHaveTextContent('1 repo'));
        expect(screen.getByTestId('split-workspace-left-git-changes')).toBeTruthy();
        expect(screen.getByTestId('split-workspace-left-git-sync')).toBeTruthy();
        expect(screen.getByTestId('split-workspace-left-git-branch')).toBeTruthy();
        act(() => applyRuntimeConfigPatch({ railGitSummaryEnabled: false }));
        expect(screen.getByTestId('split-workspace-left-git-sync')).toBeTruthy();
    });

    it.each([
        ['empty', []],
        ['all-stale', [{ workspaceId: 'r1', stale: true, name: 'shortcuts', rootPath: '/r/r1' }]],
    ])('hides the Git half for an %s group and lets chats fill the left column', async (_label, members) => {
        localStorage.setItem(splitWorkspaceLeftCollapsedStorageKey(GROUP_ID), '1');
        mockGetRepoGroup.mockResolvedValue({ id: GROUP_ID, name: 'AI Repos', members });
        render(<RepoGroupView workspaceId={GROUP_ID} />);

        await waitFor(() => expect(screen.queryByTestId('split-workspace-git')).toBeNull());
        expect(screen.queryByTestId('stub-group-git-tab')).toBeNull();
        expect(screen.queryByTestId('split-workspace-left-git-sync')).toBeNull();
        expect(screen.queryByTestId('split-workspace-divider')).toBeNull();
        expect(screen.getByTestId('split-workspace-chat').className).toContain('flex-1');
        expect(screen.getByTestId('split-workspace-chat').style.height).toBe('');
        expect(screen.getByTestId('split-workspace-detail-host')
            .querySelector('[data-testid="stub-chat-detail"]')).toBeTruthy();
    });

    it('keeps chat detail if the Git list disappears after membership loads', async () => {
        let resolveGroup!: (group: { id: string; name: string; members: [] }) => void;
        mockGetRepoGroup.mockReturnValue(new Promise(resolve => { resolveGroup = resolve; }));
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        click('stub-git-row');
        expect(screen.getByTestId('split-workspace-detail-host')
            .querySelector('[data-testid="stub-chat-detail"]')).toBeTruthy();

        await act(async () => { resolveGroup({ id: GROUP_ID, name: 'AI Repos', members: [] }); });
        expect(screen.queryByTestId('split-workspace-git')).toBeNull();
        expect(screen.getByTestId('split-workspace-detail-host')
            .querySelector('[data-testid="stub-chat-detail"]')).toBeTruthy();
    });

    it('shows the group running/queued counts and starts a new group chat from the collapsed rail', () => {
        mockQueueMap = {
            [GROUP_ID]: {
                running: [{ type: 'chat' }, { type: 'chat', payload: { processId: 'followup' } }],
                queued: [{ type: 'chat' }, { type: 'chat' }],
            },
            other: { running: [{ type: 'chat' }], queued: [{ type: 'chat' }] },
        };
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        click('stub-git-row');
        expect(screen.getByTestId('split-workspace-chat-header-extra')
            .querySelector('[data-testid="repo-group-split-new-chat"]')).toBeTruthy();
        click('repo-group-split-new-chat');
        expect(mockQueueDispatch).toHaveBeenCalledWith({ type: 'SELECT_QUEUE_TASK', id: null, repoId: GROUP_ID });
        expect(location.hash).toBe(`#repos/${GROUP_ID}/chats`);
        expect(screen.getByTestId('split-workspace-detail-host')
            .querySelector('[data-testid="stub-chat-detail"]')).toBeTruthy();

        click('stub-git-row');
        click('split-workspace-left-collapse');

        expect(screen.getByTestId('split-workspace-left-running').getAttribute('aria-label')).toBe('1 running job');
        expect(screen.getByTestId('split-workspace-left-queued').getAttribute('aria-label')).toBe('2 queued jobs');
        click('split-workspace-left-new-chat');
        expect(mockQueueDispatch).toHaveBeenCalledTimes(2);
        expect(screen.getByTestId('split-workspace-detail-host')
            .querySelector('[data-testid="stub-chat-detail"]')).toBeTruthy();
    });

    it('pins status actions to the split sidebar on desktop', () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect(screen.getByTestId('split-workspace-footer')
            .querySelector('[data-testid="stub-status-actions"]')?.getAttribute('data-variant')).toBe('sidebar');
    });

    it('removes the desktop Git header tab and leaves only the embedded Git host', () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);

        expect(screen.queryByTestId('repo-group-tab-git')).toBeNull();
        expect(screen.queryByTestId('repo-group-header-tabs')).toBeNull();
        expect(screen.getAllByTestId('stub-group-git-tab')).toHaveLength(1);
    });

    it('routes a member commit deep link to Chats without replacing chat detail', () => {
        const hash = `#repos/${GROUP_ID}/git/member/r1/abc1234`;
        location.hash = hash;
        const ctx: RouteContext = {
            queueState: { selectedTaskIdByRepo: {} } as RouteContext['queueState'],
            selectedRepoId: GROUP_ID,
            repoRouteState: {},
            repoTabState: {},
            isSchedulesInSlide: () => false,
        };
        const { effects } = resolveDashboardRoute(hash, ctx);
        for (const effect of effects) {
            if (effect.kind !== 'app') continue;
            if (effect.action.type === 'SET_REPO_SUB_TAB') {
                mockAppState.activeRepoSubTab = effect.action.tab;
            } else if (effect.action.type === 'SET_GIT_ROUTE') {
                mockAppState.gitRouteScope = {
                    routeWorkspaceId: effect.action.routeWorkspaceId,
                    workspaceId: effect.action.workspaceId,
                };
                mockAppState.selectedGitCommitHash = effect.action.commitHash;
            }
        }
        expect(mockAppState.activeRepoSubTab).toBe('activity');
        expect(mockAppState.gitRouteScope).toEqual({ routeWorkspaceId: GROUP_ID, workspaceId: 'r1' });
        render(<RepoGroupView workspaceId={GROUP_ID} />);

        expect(screen.queryByTestId('repo-group-tab-git')).toBeNull();
        expect(screen.getByTestId('stub-chat-tab').parentElement?.style.display).not.toBe('none');
        expect(screen.getByTestId('stub-group-git-tab').dataset.member).toBe('r1');
        expect(screen.getByTestId('split-workspace-detail-host')
            .querySelector('[data-testid="stub-chat-detail"]')).toBeTruthy();
        click('stub-chat-row');
        expect(screen.getByTestId('split-workspace-detail-host')
            .querySelector('[data-testid="stub-chat-detail"]')).toBeTruthy();
    });

    it('renders the two-column split with the chat list, the group git list and one shared detail host', () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);

        const panel = screen.getByTestId('split-workspace-panel');
        expect(panel.dataset.narrow).not.toBe('true');
        expect(screen.getAllByTestId('split-workspace-detail-host')).toHaveLength(1);

        const chat = screen.getByTestId('stub-chat-tab');
        expect(chat.dataset.workspace).toBe(GROUP_ID);
        expect(chat.dataset.layout).toBe('split-workspace');

        const git = screen.getAllByTestId('stub-group-git-tab')
            .find(node => node.dataset.layout === 'split-workspace');
        expect(git).toBeTruthy();
        expect(git!.dataset.workspace).toBe(GROUP_ID);
        expect(git!.dataset.active).toBe('true');
        expect(git!.dataset.headerHoisted).toBe('true');
    });

    it('opens Git in the far-right panel while leaving the chat detail in place', () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        const host = screen.getByTestId('split-workspace-detail-host');
        expect(host.querySelector('[data-testid="stub-chat-detail"]')).toBeTruthy();

        click('stub-git-row');
        expect(host.querySelector('[data-testid="stub-chat-detail"]')).toBeTruthy();
        expect(host.querySelector('[data-testid="stub-git-detail"]')).toBeNull();
        expect(screen.getByTestId('unified-git-tab').querySelector('[data-testid="stub-git-detail"]')).toBeTruthy();
        expect(readUnifiedPanelState(GROUP_ID).chatTabs['@workspace']?.find(tab => tab.kind === 'git'))
            .toMatchObject({ gitMemberId: 'r1', gitView: { type: 'commit', hash: 'abc1234' } });

        click('stub-chat-row');
        expect(host.querySelector('[data-testid="stub-chat-detail"]')).toBeTruthy();
        expect(screen.getByTestId('unified-git-tab').querySelector('[data-testid="stub-git-detail"]')).toBeTruthy();
    });
});
