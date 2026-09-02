/**
 * RepoGroupView's right dock (AC-05).
 *
 * A repo group gets the same Terminal / Explorer / Notes dock a repo gets, gated
 * on `splitWorkspacePanel` + desktop. The dock's state scopes to the GROUP; its
 * terminal and explorer point at a member repo picked in the dock header, listed
 * from `GET /api/repo-groups/:id`. The real dock is rendered here (only its three
 * heavy leaf views are stubbed) so the picker assertions are genuine.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, act, fireEvent } from '@testing-library/react';

const mockDispatch = vi.fn();
let mockAppState: any = {};
let mockBreakpoint = 'desktop';
let mockRemoteGroupWorkspaces: any[] = [];
let mockSplitPanelEnabled = true;
const mockGetRepoGroup = vi.fn();

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
    return { buildRepoSubTabSuffix: routes.buildRepoSubTabSuffix };
});
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useSchedulesInScheduledSlideEnabled', () => ({
    useSchedulesInScheduledSlideEnabled: () => false,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useRemoteShellEnabled', () => ({
    useRemoteShellEnabled: () => false,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useSplitWorkspacePanelEnabled', () => ({
    useSplitWorkspacePanelEnabled: () => mockSplitPanelEnabled,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({
        breakpoint: mockBreakpoint,
        isMobile: mockBreakpoint === 'mobile',
        isTablet: false,
        isDesktop: mockBreakpoint === 'desktop',
    }),
}));
vi.mock('../../../../src/server/spa/client/react/repos/repoGroupService', () => ({
    getRepoGroup: (...args: unknown[]) => mockGetRepoGroup(...args),
}));
vi.mock('../../../../src/server/spa/client/react/features/chat/RepoChatTab', () => ({
    RepoChatTab: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="stub-chat-tab" data-workspace={workspaceId} />
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/NotesView', () => ({
    NotesView: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="stub-notes-view" data-workspace={workspaceId} />
    ),
}));
// The dock itself is real; only its three heavy leaf views are stubbed.
vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({
    TerminalView: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="mock-terminal">terminal:{workspaceId}</div>
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({
    ExplorerPanel: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="mock-explorer">explorer:{workspaceId}</div>
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/dock/DockNotesPanel', () => ({
    DockNotesPanel: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="mock-notes">notes:{workspaceId}</div>
    ),
}));

import { RepoGroupView, repoGroupDockTargets, REPO_GROUP_ROOT_TARGET_LABEL } from '../../../../src/server/spa/client/react/repos/RepoGroupView';
import { workspaceDockOpenStorageKey } from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceRightDock';

const GROUP_ID = 'group-ai-repos';

const MEMBERS = [
    { workspaceId: 'r1', stale: false, name: 'shortcuts', rootPath: '/r/r1' },
    { workspaceId: 'r2', stale: false, name: 'docs', rootPath: '/r/r2' },
];

beforeEach(() => {
    cleanup();
    localStorage.clear();
    mockDispatch.mockReset();
    mockGetRepoGroup.mockReset();
    mockGetRepoGroup.mockResolvedValue({ id: GROUP_ID, name: 'AI Repos', members: MEMBERS });
    mockBreakpoint = 'desktop';
    mockSplitPanelEnabled = true;
    mockRemoteGroupWorkspaces = [];
    mockAppState = {
        activeRepoSubTab: 'chats',
        selectedNotePath: null,
        workspaces: [{ id: GROUP_ID, name: 'AI Repos', rootPath: `/data/repos/${GROUP_ID}` }],
    };
});

function picker(): HTMLSelectElement {
    return screen.getByTestId('workspace-dock-target-picker') as HTMLSelectElement;
}

describe('repoGroupDockTargets', () => {
    it('puts the group root first, deprioritized, then the members', () => {
        expect(repoGroupDockTargets(GROUP_ID, MEMBERS)).toEqual([
            { workspaceId: GROUP_ID, label: REPO_GROUP_ROOT_TARGET_LABEL, deprioritized: true },
            { workspaceId: 'r1', label: 'shortcuts', disabled: undefined },
            { workspaceId: 'r2', label: 'docs', disabled: undefined },
        ]);
    });

    it('disables a stale member and names the reason in its label', () => {
        const targets = repoGroupDockTargets(GROUP_ID, [
            { workspaceId: 'r1', stale: true, staleReason: 'workspace-removed' as const },
            { workspaceId: 'r2', stale: true, staleReason: 'path-missing' as const, name: 'docs' },
        ]);
        expect(targets.slice(1)).toEqual([
            { workspaceId: 'r1', label: 'r1 (removed)', disabled: true },
            { workspaceId: 'r2', label: 'docs (path missing)', disabled: true },
        ]);
    });
});

describe('RepoGroupView right dock (AC-05)', () => {
    it('renders the dock on desktop with the flag on', async () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect(screen.getByTestId('workspace-right-dock')).toBeTruthy();
        await waitFor(() => expect(mockGetRepoGroup).toHaveBeenCalledWith(GROUP_ID, undefined));
    });

    it('omits the dock on mobile', () => {
        mockBreakpoint = 'mobile';
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect(screen.queryByTestId('workspace-right-dock')).toBeNull();
        expect(mockGetRepoGroup).not.toHaveBeenCalled();
    });

    it('omits the dock when the split-workspace flag is off', () => {
        mockSplitPanelEnabled = false;
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect(screen.queryByTestId('workspace-right-dock')).toBeNull();
        expect(mockGetRepoGroup).not.toHaveBeenCalled();
    });

    it('lists the group root plus every member and defaults to the first member', async () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        // Wait on the resolved target, not just the picker: the members land one
        // render before the effect that moves the target off the group root, so a
        // slow runner can observe all three options with the root still selected.
        await waitFor(() => expect(picker().value).toBe('r1'));

        expect(Array.from(picker().options).map(o => o.text))
            .toEqual([REPO_GROUP_ROOT_TARGET_LABEL, 'shortcuts', 'docs']);
    });

    it('points terminal and explorer at the picked member, notes at the group', async () => {
        // The open flag is read at mount (its toggle lives in the TopBar, not here).
        localStorage.setItem(workspaceDockOpenStorageKey(GROUP_ID), '1');
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        await waitFor(() => expect(picker().value).toBe('r1'));

        expect(screen.getByTestId('mock-terminal').textContent).toBe('terminal:r1');
        expect(screen.getByTestId('mock-explorer').textContent).toBe('explorer:r1');
        expect(screen.getByTestId('mock-notes').textContent).toBe(`notes:${GROUP_ID}`);

        act(() => {
            fireEvent.change(picker(), { target: { value: 'r2' } });
        });
        expect(screen.getByTestId('mock-terminal').textContent).toBe('terminal:r2');
        expect(screen.getByTestId('mock-explorer').textContent).toBe('explorer:r2');
        expect(screen.getByTestId('mock-notes').textContent).toBe(`notes:${GROUP_ID}`);
    });

    it('lists a stale member as disabled and never defaults to it', async () => {
        mockGetRepoGroup.mockResolvedValue({
            id: GROUP_ID,
            name: 'AI Repos',
            members: [
                { workspaceId: 'r1', stale: true, staleReason: 'path-missing', name: 'shortcuts' },
                { workspaceId: 'r2', stale: false, name: 'docs', rootPath: '/r/r2' },
            ],
        });
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        await waitFor(() => expect(picker().value).toBe('r2'));

        const stale = Array.from(picker().options).find(o => o.value === 'r1')!;
        expect(stale.disabled).toBe(true);
        expect(stale.text).toBe('shortcuts (path missing)');
    });

    it('reads a remote group from its own server base URL', async () => {
        mockRemoteGroupWorkspaces = [{ id: GROUP_ID, name: 'AI Repos', baseUrl: 'http://remote:3000' }];
        mockAppState.workspaces = [];
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        await waitFor(() => expect(mockGetRepoGroup).toHaveBeenCalledWith(GROUP_ID, 'http://remote:3000'));
    });

    it('shows no picker when the group detail request fails', async () => {
        mockGetRepoGroup.mockRejectedValue(new Error('offline'));
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        await waitFor(() => expect(mockGetRepoGroup).toHaveBeenCalled());
        expect(screen.queryByTestId('workspace-dock-target-picker')).toBeNull();
    });
});
