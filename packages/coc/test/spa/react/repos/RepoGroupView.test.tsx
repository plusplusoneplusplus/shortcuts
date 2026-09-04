/**
 * RepoGroupView — repo-group virtual workspace landing view (AC-02).
 *
 * The group workspace exposes the Workspace (chat), Git, Notes and Settings tabs
 * — every OTHER git-dependent tab is absent by construction. Renders the real
 * VirtualWorkspaceInlineHeader (classic shell) so the tab strip assertions are
 * genuine, with the heavy tab bodies (chat, notes, settings) stubbed.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const mockDispatch = vi.fn();
let mockAppState: any = {};
let mockRemoteShellEnabled = false;
let mockBreakpoint = 'desktop';
let mockRemoteGroupWorkspaces: any[] = [];
let mockMembers: any[] | undefined = [{ workspaceId: 'r1', name: 'shortcuts', rootPath: '/r/r1' }];

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: mockAppState, dispatch: mockDispatch }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useReposOptional: () => ({ remoteGroupWorkspaces: mockRemoteGroupWorkspaces }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { selectedTaskIdByRepo: {} } }),
}));
vi.mock('../../../../src/server/spa/client/react/layout/Router', async () => {
    const routes = await import('../../../../src/server/spa/client/react/layout/dashboardRoutes');
    return { buildWorkspaceSubTabSuffix: routes.buildWorkspaceSubTabSuffix };
});
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useSchedulesInScheduledSlideEnabled', () => ({
    useSchedulesInScheduledSlideEnabled: () => false,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useRemoteShellEnabled', () => ({
    useRemoteShellEnabled: () => mockRemoteShellEnabled,
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
    NotesView: ({ workspaceId, active, dockStatusFooter }: { workspaceId: string; active: boolean; dockStatusFooter?: boolean }) => (
        <div data-testid="stub-notes-view" data-workspace={workspaceId} data-active={String(active)} data-dock-footer={String(!!dockStatusFooter)} />
    ),
}));
// The Git tab hosts the real single-repo git panel; stub the host so this file
// stays a tab-shell test and never drags in the git hook tree.
vi.mock('../../../../src/server/spa/client/react/repos/RepoGroupGitTab', () => ({
    RepoGroupGitTab: ({ workspaceId, members }: { workspaceId: string; members: unknown[] | undefined }) => (
        <div data-testid="stub-group-git" data-workspace={workspaceId} data-members={members === undefined ? 'loading' : String(members.length)} />
    ),
}));
vi.mock('../../../../src/server/spa/client/react/repos/useRepoGroupMembers', () => ({
    useRepoGroupMembers: (_id: string, _baseUrl: string | undefined, enabled: boolean) =>
        (enabled ? mockMembers : undefined),
}));
vi.mock('../../../../src/server/spa/client/react/repos/RepoGroupSettingsTab', () => ({
    RepoGroupSettingsTab: ({ workspaceId, active }: { workspaceId: string; active: boolean }) => (
        <div data-testid="stub-group-settings" data-workspace={workspaceId} data-active={String(active)} />
    ),
}));

import { getRepoGroupHeaderConfig, RepoGroupView } from '../../../../src/server/spa/client/react/repos/RepoGroupView';

const GROUP_ID = 'group-frontend';

beforeEach(() => {
    cleanup();
    mockDispatch.mockReset();
    mockRemoteShellEnabled = false;
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

describe('getRepoGroupHeaderConfig (AC-02 tab gating)', () => {
    // Git is the ONE git-dependent tab a group exposes (AC-01): it hosts the
    // single-repo panel for a member, never for the group root itself. Every
    // other git-dependent tab (PRs, work items, branches, …) stays hidden.
    it('declares exactly the Workspace (chats), Git, Notes and Settings tabs', () => {
        const config = getRepoGroupHeaderConfig(GROUP_ID, 'Frontend');
        expect(config.tabs.map(t => t.key)).toEqual(['chats', 'git', 'notes', 'settings']);
        expect(config.tabs.map(t => t.label)).toEqual(['Workspace', 'Git', 'Notes', 'Settings']);
        expect(config.tabs.map(t => t.key)).not.toContain('pull-requests');
        expect(config.tabs.map(t => t.key)).not.toContain('work-items');
    });

    it('puts Settings last and gives it the repo settings shortcut', () => {
        const config = getRepoGroupHeaderConfig(GROUP_ID, 'Frontend');
        expect(config.tabs.at(-1)).toEqual({ key: 'settings', label: 'Settings', shortcut: 'Alt+C' });
    });

    it('lands on the Workspace tab, has no header actions, and carries the group identity', () => {
        const config = getRepoGroupHeaderConfig(GROUP_ID, 'Frontend');
        expect(config.defaultTab).toBe('chats');
        expect(config.actions).toEqual([]);
        expect(config.workspaceId).toBe(GROUP_ID);
        expect(config.label).toBe('Frontend');
        expect(config.testIdPrefix).toBe('repo-group');
    });
});

describe('RepoGroupView', () => {
    it('renders only Workspace, Git, Notes and Settings tab buttons in the inline header', () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect(screen.getByTestId('repo-group-tab-chats')).toBeTruthy();
        expect(screen.getByTestId('repo-group-tab-git')).toBeTruthy();
        expect(screen.getByTestId('repo-group-tab-notes')).toBeTruthy();
        expect(screen.getByTestId('repo-group-tab-settings')).toBeTruthy();
        const strip = screen.getByTestId('repo-group-header-tabs');
        expect(strip.querySelectorAll('button[data-subtab]')).toHaveLength(4);
    });

    // AC-01: the Git tab round-trips through the hash route like any other tab,
    // so `#repos/group-<slug>/git` survives a reload.
    it('deep-links Git to #repos/<groupId>/git', () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        fireEvent.click(screen.getByTestId('repo-group-tab-git'));
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_REPO_SUB_TAB', tab: 'git' });
        expect(location.hash).toBe('#repos/' + GROUP_ID + '/git');
    });

    it('shows the Git pane (and hides chat/notes/settings) when Git is active', () => {
        mockAppState.activeRepoSubTab = 'git';
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        const git = screen.getByTestId('stub-group-git');
        // The HOST gets the group id; it is what resolves a member for the panel.
        expect(git.getAttribute('data-workspace')).toBe(GROUP_ID);
        expect(git.getAttribute('data-members')).toBe('1');
        expect((git.parentElement as HTMLElement).style.display).not.toBe('none');
        expect((screen.getByTestId('stub-chat-tab').parentElement as HTMLElement).style.display).toBe('none');
        expect((screen.getByTestId('stub-notes-view').parentElement as HTMLElement).style.display).toBe('none');
        expect((screen.getByTestId('stub-group-settings').parentElement as HTMLElement).style.display).toBe('none');
    });

    // The panel is expensive to build; it must not mount before the user asks
    // for it (mirrors RepoDetail's `wasVisited('git')` gate).
    it('does not mount the git host before the Git tab is visited', () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect(screen.queryByTestId('stub-group-git')).toBeNull();
    });

    it('deep-links Settings to a bare #repos/<groupId>/settings, with no section suffix', () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        fireEvent.click(screen.getByTestId('repo-group-tab-settings'));
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_REPO_SUB_TAB', tab: 'settings' });
        expect(location.hash).toBe('#repos/' + GROUP_ID + '/settings');
    });

    it('shows the Settings pane (and hides chat/notes) when Settings is active', () => {
        mockAppState.activeRepoSubTab = 'settings';
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        const settings = screen.getByTestId('stub-group-settings');
        expect(settings.getAttribute('data-workspace')).toBe(GROUP_ID);
        expect(settings.getAttribute('data-active')).toBe('true');
        expect((settings.parentElement as HTMLElement).style.display).not.toBe('none');
        expect((screen.getByTestId('stub-chat-tab').parentElement as HTMLElement).style.display).toBe('none');
        expect((screen.getByTestId('stub-notes-view').parentElement as HTMLElement).style.display).toBe('none');
    });

    it('no longer renders the inline Member repos strip on the Workspace tab', () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect(screen.queryByTestId('repo-group-members-toggle')).toBeNull();
        expect(screen.queryByTestId('repo-group-members-panel')).toBeNull();
    });

    it('shows the group name from the workspace registry in the header', () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect(screen.getByTestId('repo-group-header').textContent).toContain('Frontend');
    });

    it('labels a remote group from the aggregated remote groups, not its raw id', () => {
        mockAppState.workspaces = [{ id: 'r1', name: 'shortcuts', rootPath: '/r/r1' }];
        mockRemoteGroupWorkspaces = [{ id: 'group-svc', name: 'Services', remote: { serverLabel: 'Devbox' } }];
        render(<RepoGroupView workspaceId="group-svc" />);
        const header = screen.getByTestId('repo-group-header').textContent ?? '';
        expect(header).toContain('Services');
        expect(header).not.toContain('group-svc');
    });

    it('falls back to the workspace id while the group is not in the registry yet', () => {
        mockAppState.workspaces = [];
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect(screen.getByTestId('repo-group-header').textContent).toContain(GROUP_ID);
    });

    it('shows the chat tab (and hides notes) on the default Workspace tab', () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        const chat = screen.getByTestId('stub-chat-tab');
        const notes = screen.getByTestId('stub-notes-view');
        expect(chat.getAttribute('data-workspace')).toBe(GROUP_ID);
        expect((chat.parentElement as HTMLElement).style.display).not.toBe('none');
        expect((notes.parentElement as HTMLElement).style.display).toBe('none');
        expect((screen.getByTestId('stub-group-settings').parentElement as HTMLElement).style.display).toBe('none');
    });

    it('shows the notes tab targeting the group workspace when Notes is active', () => {
        mockAppState.activeRepoSubTab = 'notes';
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        const notes = screen.getByTestId('stub-notes-view');
        expect(notes.getAttribute('data-workspace')).toBe(GROUP_ID);
        expect(notes.getAttribute('data-active')).toBe('true');
        expect((notes.parentElement as HTMLElement).style.display).not.toBe('none');
        expect((screen.getByTestId('stub-chat-tab').parentElement as HTMLElement).style.display).toBe('none');
    });

    it('falls back to the Workspace tab when arriving from a git-dependent sub-tab', () => {
        mockAppState.activeRepoSubTab = 'pull-requests';
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect((screen.getByTestId('stub-chat-tab').parentElement as HTMLElement).style.display).not.toBe('none');
        expect((screen.getByTestId('stub-notes-view').parentElement as HTMLElement).style.display).toBe('none');
    });

    it('omits the inline header in the remote-first desktop shell (header lives in the TopBar)', () => {
        mockRemoteShellEnabled = true;
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect(screen.queryByTestId('repo-group-header')).toBeNull();
    });

    it('keeps the inline header on mobile even in the remote-first shell', () => {
        mockRemoteShellEnabled = true;
        mockBreakpoint = 'mobile';
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect(screen.getByTestId('repo-group-header')).toBeTruthy();
    });

    it('docks the status footer inside both the Workspace and Notes tabs', () => {
        // The group chat tab owns its own left column, so GlobalStatusDock stands
        // down for it — the cluster has to be pinned here or it disappears.
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect(screen.getByTestId('stub-chat-tab').getAttribute('data-dock-footer')).toBe('true');
        expect(screen.getByTestId('stub-notes-view').getAttribute('data-dock-footer')).toBe('true');
    });
});
