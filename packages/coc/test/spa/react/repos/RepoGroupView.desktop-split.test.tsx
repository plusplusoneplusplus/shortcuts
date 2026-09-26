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
import { cleanup, render, screen, act, fireEvent } from '@testing-library/react';
import { createPortal } from 'react-dom';

const mockDispatch = vi.fn();
let mockAppState: any = {};
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
    useQueue: () => ({ state: { selectedTaskIdByRepo: {} }, dispatch: vi.fn() }),
    useQueueOptional: () => ({ state: { selectedTaskIdByRepo: {} }, dispatch: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/layout/Router', async () => {
    const routes = await import('../../../../src/server/spa/client/react/layout/dashboardRoutes');
    return { buildWorkspaceSubTabSuffix: routes.buildWorkspaceSubTabSuffix };
});
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useRemoteShellEnabled', () => ({
    useRemoteShellEnabled: () => false,
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
        >
            <button data-testid="stub-git-row" onClick={() => onActivateDetail?.()}>commit</button>
            {detailContainer && detailActive && createPortal(<div data-testid="stub-git-detail" />, detailContainer)}
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
    mockDispatch.mockReset();
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
    });
});
