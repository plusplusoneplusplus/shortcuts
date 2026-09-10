/**
 * RepoGroupView's right panel.
 *
 * A repo group gets the same unified right panel a repo gets, gated on
 * `splitWorkspacePanel` + desktop and nothing else — there is no longer a second
 * dock to swap against. The panel's state scopes to the GROUP; its terminal and
 * file tree point at a member repo picked from the open menu's repo select,
 * listed from `GET /api/repo-groups/:id`, while notes stay on the group. The real
 * panel is rendered here (only its heavy leaf views are stubbed) so the target
 * assertions are genuine.
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
    useAppOptional: () => ({ state: mockAppState, dispatch: mockDispatch }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useReposOptional: () => ({ remoteGroupWorkspaces: mockRemoteGroupWorkspaces }),
}));
let mockSelectedTaskIdByRepo: Record<string, string | null> = {};
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { selectedTaskIdByRepo: mockSelectedTaskIdByRepo } }),
    useQueueOptional: () => ({ state: { selectedTaskIdByRepo: mockSelectedTaskIdByRepo } }),
}));
vi.mock('../../../../src/server/spa/client/react/layout/Router', async () => {
    const routes = await import('../../../../src/server/spa/client/react/layout/dashboardRoutes');
    return { buildWorkspaceSubTabSuffix: routes.buildWorkspaceSubTabSuffix };
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
    REPO_GROUP_DESCRIPTION_MAX_LENGTH: 280,
}));
vi.mock('../../../../src/server/spa/client/react/repos/RepoGroupGitTab', () => ({
    RepoGroupGitTab: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="stub-group-git">git:{workspaceId}</div>
    ),
}));
vi.mock('../../../../src/server/spa/client/react/repos/RepoGroupSettingsTab', () => ({
    RepoGroupSettingsTab: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="stub-group-settings">settings:{workspaceId}</div>
    ),
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
    ExplorerPanel: ({ workspaceId, deepLink }: { workspaceId: string; deepLink?: boolean }) => (
        <div data-testid="mock-explorer" data-deeplink={String(deepLink === true)}>explorer:{workspaceId}</div>
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/dock/DockNotesPanel', () => ({
    DockNotesPanel: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="mock-notes">notes:{workspaceId}</div>
    ),
}));

import { RepoGroupView, repoGroupDockTargets, REPO_GROUP_ROOT_TARGET_LABEL } from '../../../../src/server/spa/client/react/repos/RepoGroupView';
import { workspaceDockOpenStorageKey } from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceDockToggle';
import { openUnifiedPanelTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpen';
import { unifiedTabId } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';

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
    mockSelectedTaskIdByRepo = {};
    mockAppState = {
        activeRepoSubTab: 'chats',
        selectedNotePath: null,
        workspaces: [{ id: GROUP_ID, name: 'AI Repos', rootPath: `/data/repos/${GROUP_ID}` }],
    };
});

/**
 * The target select lives in the panel's open menu now, so every picker
 * assertion has to open the menu first. Rendering the panel open is the caller's
 * job (the open bit is read from storage at mount).
 */
function openMenu(): void {
    act(() => { fireEvent.click(screen.getByTestId('unified-panel-open-menu')); });
}

function picker(): HTMLSelectElement {
    return screen.getByTestId('unified-panel-open-menu-repo') as HTMLSelectElement;
}

/** Render the group with its panel already open, the way a returning user sees it. */
function renderOpen() {
    localStorage.setItem(workspaceDockOpenStorageKey(GROUP_ID), '1');
    return render(<RepoGroupView workspaceId={GROUP_ID} />);
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

describe('RepoGroupView right panel', () => {
    // The unified panel owns this slot outright: `dockAvailable` is the whole
    // gate, so there is no second component that a config could bring back.
    it('renders the unified panel on desktop, and nothing else in the slot', async () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect(screen.getByTestId('unified-right-panel')).toBeTruthy();
        await waitFor(() => expect(mockGetRepoGroup).toHaveBeenCalledWith(GROUP_ID, undefined));
    });

    it.each(['chats', 'git', 'notes', 'settings'])(
        'owns Ctrl+P from the %s sub-tab while the panel is closed',
        async activeTab => {
            mockAppState.activeRepoSubTab = activeTab;
            render(<RepoGroupView workspaceId={GROUP_ID} />);
            await waitFor(() => expect(mockGetRepoGroup).toHaveBeenCalled());

            const event = new KeyboardEvent('keydown', {
                key: 'p',
                ctrlKey: true,
                bubbles: true,
                cancelable: true,
            });
            act(() => document.dispatchEvent(event));

            expect(event.defaultPrevented).toBe(true);
            expect(screen.getByTestId('quick-open-dialog')).toBeTruthy();
            expect(screen.getByTestId('unified-right-panel').dataset.open).toBe('false');
        },
    );

    // The group's selected chat is what owns the panel's chat-scoped tabs, so a
    // file opened from a chat has to land in that chat's set rather than under
    // the workspace. The panel reads the selection from the queue store — the
    // chat list never hands it up — so this pins the read.
    it('scopes the unified panel to the group\'s selected chat', () => {
        mockSelectedTaskIdByRepo = { [GROUP_ID]: 'chat-7' };
        renderOpen();

        act(() => { openUnifiedPanelTab(GROUP_ID, {
            kind: 'file', ownerWorkspaceId: 'r1', chatId: 'chat-7', resourceId: 'src/app.ts', label: 'app.ts',
        }); });

        expect(screen.getByTestId(`unified-panel-tab-${unifiedTabId({
            kind: 'file', ownerWorkspaceId: 'r1', chatId: 'chat-7', resourceId: 'src/app.ts',
        })}`)).toBeTruthy();
    });

    it('leaves the panel unscoped when the group has no selected chat', () => {
        renderOpen();

        // Filed under chat-7 while nothing is selected: invisible here.
        act(() => { openUnifiedPanelTab(GROUP_ID, {
            kind: 'file', ownerWorkspaceId: 'r1', chatId: 'chat-7', resourceId: 'src/app.ts', label: 'app.ts',
        }); });

        expect(screen.queryAllByRole('tab', { hidden: true })).toHaveLength(0);
    });

    // Mobile has no right panel — but it does mount the merged Workspace panel,
    // whose git half is hosted against a member repo, so the members read still
    // happens there. Only the panel is gone.
    it('omits the panel on mobile', () => {
        mockBreakpoint = 'mobile';
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect(screen.queryByTestId('unified-right-panel')).toBeNull();
    });

    it('omits the panel when the split-workspace flag is off', () => {
        mockSplitPanelEnabled = false;
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect(screen.queryByTestId('unified-right-panel')).toBeNull();
        expect(mockGetRepoGroup).not.toHaveBeenCalled();
    });

    it('lists the group root plus every member and defaults to the first member', async () => {
        renderOpen();
        // Wait on the resolved target, not just the picker: the members land one
        // render before the effect that moves the target off the group root, so a
        // slow runner can observe all three options with the root still selected.
        openMenu();
        await waitFor(() => expect(picker().value).toBe('r1'));

        expect(Array.from(picker().options).map(o => o.text))
            .toEqual([REPO_GROUP_ROOT_TARGET_LABEL, 'shortcuts', 'docs']);
    });

    it('opens a terminal against the picked member and notes against the group', async () => {
        renderOpen();
        openMenu();
        await waitFor(() => expect(picker().value).toBe('r1'));

        act(() => { fireEvent.click(screen.getByTestId('unified-panel-open-terminal')); });
        expect(screen.getByTestId(`unified-panel-tab-${unifiedTabId({
            kind: 'terminal', ownerWorkspaceId: 'r1', chatId: null, resourceId: 'terminal',
        })}`)).toBeTruthy();

        // Retarget, then open again: the second terminal is owned by r2, so the
        // two members' terminals coexist rather than one replacing the other.
        openMenu();
        act(() => { fireEvent.change(picker(), { target: { value: 'r2' } }); });
        act(() => { fireEvent.click(screen.getByTestId('unified-panel-open-terminal')); });
        expect(screen.getByTestId(`unified-panel-tab-${unifiedTabId({
            kind: 'terminal', ownerWorkspaceId: 'r2', chatId: null, resourceId: 'terminal',
        })}`)).toBeTruthy();

        // Notes are group-level whatever the target is.
        openMenu();
        act(() => { fireEvent.click(screen.getByTestId('unified-panel-open-notes')); });
        expect(screen.getByTestId(`unified-panel-tab-${unifiedTabId({
            kind: 'notes', ownerWorkspaceId: GROUP_ID, chatId: null, resourceId: 'notes',
        })}`)).toBeTruthy();
    });

    it('points the file-tree column at the picked member, without a deep link', async () => {
        renderOpen();
        openMenu();
        await waitFor(() => expect(picker().value).toBe('r1'));

        // The menu's Explorer entry toggles the tree column rather than opening a tab.
        act(() => { fireEvent.click(screen.getByTestId('unified-panel-open-explorer')); });
        expect(screen.getByTestId('mock-explorer').textContent).toBe('explorer:r1');
        // A group member's tree must never write the explorer deep-link hash, or
        // a file click would navigate out of the group.
        expect(screen.getByTestId('mock-explorer').dataset.deeplink).toBe('false');

        openMenu();
        act(() => { fireEvent.change(picker(), { target: { value: 'r2' } }); });
        expect(screen.getByTestId('mock-explorer').textContent).toBe('explorer:r2');
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
        renderOpen();
        openMenu();
        await waitFor(() => expect(picker().value).toBe('r2'));

        // The panel's select keeps every member selectable and marks the
        // unavailable one in its label instead; picking it gates the actions
        // rather than the option.
        const stale = Array.from(picker().options).find(o => o.value === 'r1')!;
        expect(stale.text).toBe('shortcuts (path missing) (unavailable)');

        act(() => { fireEvent.change(picker(), { target: { value: 'r1' } }); });
        expect((screen.getByTestId('unified-panel-open-terminal') as HTMLButtonElement).disabled).toBe(true);
    });

    it('reads a remote group from its own server base URL', async () => {
        mockRemoteGroupWorkspaces = [{ id: GROUP_ID, name: 'AI Repos', baseUrl: 'http://remote:3000' }];
        mockAppState.workspaces = [];
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        await waitFor(() => expect(mockGetRepoGroup).toHaveBeenCalledWith(GROUP_ID, 'http://remote:3000'));
    });

    it('shows no repo picker when the group detail request fails', async () => {
        mockGetRepoGroup.mockRejectedValue(new Error('offline'));
        renderOpen();
        await waitFor(() => expect(mockGetRepoGroup).toHaveBeenCalled());
        openMenu();
        expect(screen.queryByTestId('unified-panel-open-menu-repo')).toBeNull();
    });
});
