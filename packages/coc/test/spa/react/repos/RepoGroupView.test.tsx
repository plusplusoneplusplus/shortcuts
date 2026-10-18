/**
 * RepoGroupView — repo-group virtual workspace landing view (AC-02).
 *
 * The group shows only its Workspace split (chat + member Git); Notes and
 * Settings open as right-panel tabs, never as group pages. The heavy bodies are
 * stubbed.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { buildRemoteCloneKey } from '../../../../src/server/spa/client/react/repos/cloneIdentity';

const mockDispatch = vi.fn();
let mockAppState: any = {};
let mockBreakpoint = 'desktop';
let mockRemoteGroupWorkspaces: any[] = [];
let mockMembers: any[] | undefined = [{ workspaceId: 'r1', name: 'shortcuts', rootPath: '/r/r1' }];
const mockMemberLookup = vi.fn();

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: mockAppState, dispatch: mockDispatch }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useReposOptional: () => ({ remoteGroupWorkspaces: mockRemoteGroupWorkspaces }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { selectedTaskIdByRepo: {}, repoQueueMap: {} } }),
    useQueueOptional: () => ({ state: { selectedTaskIdByRepo: {}, repoQueueMap: {} } }),
}));
vi.mock('../../../../src/server/spa/client/react/layout/Router', async () => {
    const routes = await import('../../../../src/server/spa/client/react/layout/dashboardRoutes');
    return { buildWorkspaceSubTabSuffix: routes.buildWorkspaceSubTabSuffix };
});
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useSchedulesInScheduledSlideEnabled', () => ({
    useSchedulesInScheduledSlideEnabled: () => false,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({
        breakpoint: mockBreakpoint,
        isMobile: mockBreakpoint === 'mobile',
        isTablet: false,
        isDesktop: mockBreakpoint === 'desktop',
    }),
}));
vi.mock('../../../../src/server/spa/client/react/ui', () => ({
    cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));
vi.mock('../../../../src/server/spa/client/react/features/chat/RepoChatTab', () => ({
    RepoChatTab: ({ workspaceId, dockStatusFooter }: { workspaceId: string; dockStatusFooter?: boolean }) => (
        <div data-testid="stub-chat-tab" data-workspace={workspaceId} data-dock-footer={String(!!dockStatusFooter)} />
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/NotesView', () => ({
    NotesView: () => <div data-testid="stub-notes-view" />,
}));
// The Git tab hosts the real single-repo git panel; stub the host so this file
// stays a tab-shell test and never drags in the git hook tree.
vi.mock('../../../../src/server/spa/client/react/repos/RepoGroupGitTab', () => ({
    RepoGroupGitTab: ({ workspaceId, members }: { workspaceId: string; members: unknown[] | undefined }) => (
        <div data-testid="stub-group-git" data-workspace={workspaceId} data-members={members === undefined ? 'loading' : String(members.length)} />
    ),
}));
vi.mock('../../../../src/server/spa/client/react/repos/useRepoGroupMembers', () => ({
    useRepoGroupMembers: (id: string, baseUrl: string | undefined, enabled: boolean) => {
        mockMemberLookup(id, baseUrl, enabled);
        return enabled ? mockMembers : undefined;
    },
}));
vi.mock('../../../../src/server/spa/client/react/repos/RepoGroupSettingsTab', () => ({
    RepoGroupSettingsTab: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="stub-group-settings" data-workspace={workspaceId} />
    ),
}));

vi.mock('../../../../src/server/spa/client/react/features/repo-detail/SplitWorkspacePanel', () => ({
    SplitWorkspacePanel: ({ chatList, gitList, detail }: any) => (
        <div data-testid="split-workspace-panel">{chatList}{gitList}{detail}</div>
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel', () => ({
    UnifiedRightPanel: () => null,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/content-search/ContentSearchOverlayHost', () => ({
    ContentSearchOverlayHost: () => null,
}));

import { getRepoGroupHeaderConfig, RepoGroupView } from '../../../../src/server/spa/client/react/repos/RepoGroupView';

const GROUP_ID = 'group-frontend';

beforeEach(() => {
    cleanup();
    mockDispatch.mockReset();
    mockMemberLookup.mockReset();
    mockBreakpoint = 'desktop';
    mockRemoteGroupWorkspaces = [];
    mockMembers = [{ workspaceId: 'r1', name: 'shortcuts', rootPath: '/r/r1' }];
    mockAppState = {
        activeRepoSubTab: 'chats',
        selectedNotePath: null,
        workspaces: [
            { id: 'r1', name: 'shortcuts', rootPath: '/r/r1' },
            { id: GROUP_ID, name: 'Frontend', rootPath: `/data/repos/${GROUP_ID}` },
        ],
    };
});

describe('getRepoGroupHeaderConfig', () => {
    it('declares no sub-tabs: the Workspace split is the only group view', () => {
        const config = getRepoGroupHeaderConfig(GROUP_ID, 'Frontend');
        expect(config.tabs).toEqual([]);
    });

    it('lands on the Workspace, has no header actions, and carries the group identity', () => {
        const config = getRepoGroupHeaderConfig(GROUP_ID, 'Frontend');
        expect(config.defaultTab).toBe('chats');
        expect(config.actions).toEqual([]);
        expect(config.workspaceId).toBe(GROUP_ID);
        expect(config.label).toBe('Frontend');
        expect(config.testIdPrefix).toBe('repo-group');
    });
});

describe('RepoGroupView', () => {
    it.each(['chats', 'notes', 'settings', 'pull-requests', 'git'])('always shows the Workspace and no Notes/Settings page (sub-tab %s)', tab => {
        mockAppState.activeRepoSubTab = tab;
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        const chat = screen.getByTestId('stub-chat-tab');
        expect(chat.getAttribute('data-workspace')).toBe(GROUP_ID);
        expect(chat.closest('[style*="display: none"]')).toBeNull();
        expect(screen.queryByTestId('stub-notes-view')).toBeNull();
        // Settings mounts only once its panel tab opens.
        expect(screen.queryByTestId('stub-group-settings')).toBeNull();
    });

    it('no longer renders the inline Member repos strip on the Workspace', () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect(screen.queryByTestId('repo-group-members-toggle')).toBeNull();
        expect(screen.queryByTestId('repo-group-members-panel')).toBeNull();
    });

    it('selects the right owner when a local and two remote groups share the id', () => {
        mockRemoteGroupWorkspaces = ['box-a', 'box-b'].map(serverId => ({
            id: GROUP_ID, name: 'Frontend',
            baseUrl: `http://${serverId}:4000`,
            remote: { serverId, serverLabel: serverId },
        }));
        const selectionId = buildRemoteCloneKey('box-b', GROUP_ID);
        mockAppState.activeRepoSubTab = 'git';
        render(<RepoGroupView workspaceId={GROUP_ID} selectionId={selectionId} />);
        expect(mockMemberLookup).toHaveBeenCalledWith(GROUP_ID, 'http://box-b:4000', true);
    });

    it('omits the inline header in the remote-first desktop shell (header lives in the TopBar)', () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect(screen.queryByTestId('repo-group-header')).toBeNull();
    });

    it('renders the mobile header with a back affordance and no tabs', () => {
        mockBreakpoint = 'mobile';
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect(screen.queryByTestId('repo-group-header')).toBeNull();
        expect(screen.getByTestId('repo-group-mobile-header')).toBeTruthy();
        expect(screen.getByTestId('repo-group-name-back')).toBeTruthy();
        expect(screen.getByTestId('mobile-tab-bar').querySelectorAll('button[data-tab]')).toHaveLength(0);
    });

    it('clears the selection and returns to the scope list from the back button', () => {
        mockBreakpoint = 'mobile';
        location.hash = '#repos/' + GROUP_ID;
        render(<RepoGroupView workspaceId={GROUP_ID} />);

        fireEvent.click(screen.getByTestId('repo-group-name-back'));
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_REPO', id: null });
        expect(location.hash).toBe('');
    });

    it('docks the status footer inside the Workspace split', () => {
        // The group chat owns its own left column, so GlobalStatusDock stands
        // down for it — the cluster has to be pinned here or it disappears.
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect(screen.getByTestId('stub-chat-tab').closest('[data-testid="split-workspace-panel"]')).toBeTruthy();
    });
});
