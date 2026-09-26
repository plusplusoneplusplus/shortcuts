/**
 * Repo group on desktop with the `splitWorkspacePanel` flag: the Chats tab uses
 * the same `SplitWorkspacePanel` a single repo does — chat list on top, the
 * group git list (member picker host) below, ONE shared detail pane on the
 * right. The shell is real; only the two leaf tabs are stubbed. Each stub
 * portals its detail into `detailContainer` while `detailActive`, and calls
 * `onActivateDetail` on click, exactly like the real tabs — so these tests
 * prove last-clicked-wins in the shared host.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { createPortal } from 'react-dom';
import {
    resolveDashboardRoute,
    type RouteContext,
} from '../../../../src/server/spa/client/react/layout/dashboardRoutes';

const mockDispatch = vi.fn();
const mockQueueDispatch = vi.fn();
let mockAppState: any = {};
let mockQueueMap: Record<string, { running: any[]; queued: any[] }> = {};
let mockRemoteShellEnabled = false;
let mockSplitPanelEnabled = true;
const mockGetRepoGroup = vi.fn();

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: mockAppState, dispatch: mockDispatch }),
    useAppOptional: () => ({ state: mockAppState, dispatch: mockDispatch }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useReposOptional: () => ({ remoteGroupWorkspaces: [] }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { selectedTaskIdByRepo: {}, repoQueueMap: mockQueueMap }, dispatch: mockQueueDispatch }),
    useQueueOptional: () => ({ state: { selectedTaskIdByRepo: {}, repoQueueMap: mockQueueMap }, dispatch: mockQueueDispatch }),
}));
vi.mock('../../../../src/server/spa/client/react/layout/Router', async () => {
    const routes = await import('../../../../src/server/spa/client/react/layout/dashboardRoutes');
    return { buildWorkspaceSubTabSuffix: routes.buildWorkspaceSubTabSuffix };
});
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useRemoteShellEnabled', () => ({
    useRemoteShellEnabled: () => mockRemoteShellEnabled,
}));
vi.mock('../../../../src/server/spa/client/react/layout/StatusActions', () => ({
    StatusActions: ({ variant }: { variant: string }) => <div data-testid="stub-status-actions" data-variant={variant} />,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useSplitWorkspacePanelEnabled', () => ({
    useSplitWorkspacePanelEnabled: () => mockSplitPanelEnabled,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ breakpoint: 'desktop', isMobile: false, isTablet: false, isDesktop: true }),
}));
vi.mock('../../../../src/server/spa/client/react/repos/repoGroupService', () => ({
    getRepoGroup: (...args: unknown[]) => mockGetRepoGroup(...args),
}));
// The right dock is out of scope here; keep it inert.
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel', () => ({
    UnifiedRightPanel: () => <div data-testid="stub-right-panel" />,
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
}

vi.mock('../../../../src/server/spa/client/react/features/chat/RepoChatTab', () => ({
    RepoChatTab: ({ workspaceId, layout, detailContainer, detailActive, onActivateDetail }: LeafProps) => (
        <div data-testid="stub-chat-tab" data-workspace={workspaceId} data-layout={layout ?? ''}>
            <button data-testid="stub-chat-row" onClick={() => onActivateDetail?.()}>chat</button>
            {detailContainer && detailActive && createPortal(<div data-testid="stub-chat-detail" />, detailContainer)}
        </div>
    ),
}));
vi.mock('../../../../src/server/spa/client/react/repos/RepoGroupGitTab', () => ({
    RepoGroupGitTab: ({ workspaceId, layout, detailContainer, detailActive, onActivateDetail, headerToolbarContainer, active }: LeafProps) => (
        <div
            data-testid="stub-group-git-tab"
            data-workspace={workspaceId}
            data-layout={layout ?? ''}
            data-active={String(!!active)}
            data-header-hoisted={headerToolbarContainer ? 'true' : 'false'}
            data-member={mockAppState.gitRouteScope?.workspaceId ?? ''}
        >
            <button data-testid="stub-git-row" onClick={() => onActivateDetail?.()}>commit</button>
            {detailContainer && detailActive && createPortal(
                <div data-testid="stub-git-detail" data-commit={mockAppState.selectedGitCommitHash ?? ''} />,
                detailContainer,
            )}
        </div>
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/NotesView', () => ({
    NotesView: () => <div data-testid="stub-notes-view" />,
}));
vi.mock('../../../../src/server/spa/client/react/repos/RepoGroupSettingsTab', () => ({
    RepoGroupSettingsTab: () => <div data-testid="stub-group-settings" />,
}));

import { RepoGroupView } from '../../../../src/server/spa/client/react/repos/RepoGroupView';

const GROUP_ID = 'group-ai-repos';

beforeEach(() => {
    cleanup();
    localStorage.clear();
    location.hash = '';
    mockDispatch.mockReset();
    mockQueueDispatch.mockReset();
    mockQueueMap = {};
    mockRemoteShellEnabled = false;
    mockGetRepoGroup.mockReset();
    mockGetRepoGroup.mockResolvedValue({
        id: GROUP_ID,
        name: 'AI Repos',
        members: [{ workspaceId: 'r1', stale: false, name: 'shortcuts', rootPath: '/r/r1' }],
    });
    mockSplitPanelEnabled = true;
    mockAppState = {
        activeRepoSubTab: 'chats',
        selectedNotePath: null,
        workspaces: [{ id: GROUP_ID, name: 'AI Repos', rootPath: `/data/repos/${GROUP_ID}` }],
    };
});

function click(testId: string): void {
    act(() => { fireEvent.click(screen.getByTestId(testId)); });
}

describe('RepoGroupView — desktop split Workspace panel', () => {
    it.each([
        ['empty', []],
        ['all-stale', [{ workspaceId: 'r1', stale: true, name: 'shortcuts', rootPath: '/r/r1' }]],
    ])('hides the Git half for an %s group and lets chats fill the left column', async (_label, members) => {
        mockGetRepoGroup.mockResolvedValue({ id: GROUP_ID, name: 'AI Repos', members });
        render(<RepoGroupView workspaceId={GROUP_ID} />);

        await waitFor(() => expect(screen.queryByTestId('split-workspace-git')).toBeNull());
        expect(screen.queryByTestId('stub-group-git-tab')).toBeNull();
        expect(screen.queryByTestId('split-workspace-divider')).toBeNull();
        expect(screen.getByTestId('split-workspace-chat').className).toContain('flex-1');
        expect(screen.getByTestId('split-workspace-chat').style.height).toBe('');
        expect(screen.getByTestId('split-workspace-detail-host')
            .querySelector('[data-testid="stub-chat-detail"]')).toBeTruthy();
    });

    it('restores chat detail if the Git list disappears after membership loads', async () => {
        let resolveGroup!: (group: { id: string; name: string; members: [] }) => void;
        mockGetRepoGroup.mockReturnValue(new Promise(resolve => { resolveGroup = resolve; }));
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        click('stub-git-row');
        expect(screen.getByTestId('split-workspace-detail-host')
            .querySelector('[data-testid="stub-git-detail"]')).toBeTruthy();

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

    it('pins status actions to the split sidebar only in the remote desktop shell', () => {
        mockRemoteShellEnabled = true;
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect(screen.getByTestId('split-workspace-footer')
            .querySelector('[data-testid="stub-status-actions"]')?.getAttribute('data-variant')).toBe('sidebar');

        cleanup();
        mockRemoteShellEnabled = false;
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect(screen.queryByTestId('split-workspace-footer')).toBeNull();
    });

    it('removes the desktop Git header tab and leaves only the embedded Git host', () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);

        expect(screen.queryByTestId('repo-group-tab-git')).toBeNull();
        expect(Array.from(screen.getByTestId('repo-group-header-tabs').querySelectorAll('[data-subtab]'))
            .map(tab => tab.getAttribute('data-subtab'))).toEqual(['chats', 'notes', 'settings']);
        expect(screen.getAllByTestId('stub-group-git-tab')).toHaveLength(1);
    });

    it('routes a member commit deep link to Chats and opens it in the shared detail host', () => {
        const hash = `#repos/${GROUP_ID}/git/member/r1/abc1234`;
        location.hash = hash;
        const ctx: RouteContext = {
            queueState: { selectedTaskIdByRepo: {} } as RouteContext['queueState'],
            selectedRepoId: GROUP_ID,
            repoRouteState: {},
            repoTabState: {},
            getUiLayoutMode: () => 'classic',
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
        expect(mockAppState.activeRepoSubTab).toBe('git');
        expect(mockAppState.gitRouteScope).toEqual({ routeWorkspaceId: GROUP_ID, workspaceId: 'r1' });
        render(<RepoGroupView workspaceId={GROUP_ID} />);

        expect(screen.queryByTestId('repo-group-tab-git')).toBeNull();
        expect(screen.getByTestId('repo-group-tab-chats').querySelector('span')).toBeTruthy();
        expect(screen.getByTestId('stub-chat-tab').parentElement?.style.display).not.toBe('none');
        expect(screen.getByTestId('stub-group-git-tab').dataset.member).toBe('r1');
        expect(screen.getByTestId('split-workspace-detail-host')
            .querySelector('[data-testid="stub-git-detail"]')?.getAttribute('data-commit')).toBe('abc1234');
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

    it('shows the chat detail first, then whichever list was clicked last', () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        const host = screen.getByTestId('split-workspace-detail-host');
        expect(host.querySelector('[data-testid="stub-chat-detail"]')).toBeTruthy();

        click('stub-git-row');
        expect(host.querySelector('[data-testid="stub-git-detail"]')).toBeTruthy();
        expect(host.querySelector('[data-testid="stub-chat-detail"]')).toBeNull();

        click('stub-chat-row');
        expect(host.querySelector('[data-testid="stub-chat-detail"]')).toBeTruthy();
        expect(host.querySelector('[data-testid="stub-git-detail"]')).toBeNull();
    });

    it('keeps the plain chat tab when the flag is off', () => {
        mockSplitPanelEnabled = false;
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect(screen.queryByTestId('split-workspace-panel')).toBeNull();
        expect(screen.getByTestId('stub-chat-tab').dataset.layout).toBe('');
        expect(screen.getByTestId('repo-group-tab-git')).toBeTruthy();
    });
});
