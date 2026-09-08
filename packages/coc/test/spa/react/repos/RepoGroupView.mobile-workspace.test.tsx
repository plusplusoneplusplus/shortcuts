/**
 * AC-06 — repo-group parity for the mobile Workspace panel.
 *
 * A repo group used to keep Chats and Git as two separate mobile tabs. On a
 * phone (with the `splitWorkspacePanel` flag) it now renders the SAME
 * `SplitWorkspacePanel` shell a repo does: one `Chats | Git` segmented control,
 * one list pane at a time, and a full-screen detail push with a back control.
 * The shell here is REAL — only the two leaf tabs are stubbed — so these
 * assertions prove the group inherits the single shared implementation rather
 * than a copy of it.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, act, fireEvent } from '@testing-library/react';

const mockDispatch = vi.fn();
let mockAppState: any = {};
let mockBreakpoint = 'mobile';
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
    useQueue: () => ({ state: { selectedTaskIdByRepo: {} } }),
    useQueueOptional: () => ({ state: { selectedTaskIdByRepo: {} } }),
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
}));

// The two leaf tabs. Each exposes a button that opens the shared detail the way
// the real tabs do — through the mobile pane context the shell provides.
vi.mock('../../../../src/server/spa/client/react/features/chat/RepoChatTab', async () => {
    const { useMobileWorkspacePane } = await import(
        '../../../../src/server/spa/client/react/features/repo-detail/mobileWorkspacePane'
    );
    return {
        RepoChatTab: ({ workspaceId }: { workspaceId: string }) => {
            const pane = useMobileWorkspacePane();
            return (
                <div data-testid="stub-chat-tab" data-workspace={workspaceId}>
                    <button data-testid="stub-open-chat" onClick={() => pane?.setDetailOpen(true)}>open chat</button>
                </div>
            );
        },
    };
});
vi.mock('../../../../src/server/spa/client/react/repos/RepoGroupGitTab', async () => {
    const { useMobileWorkspacePane } = await import(
        '../../../../src/server/spa/client/react/features/repo-detail/mobileWorkspacePane'
    );
    return {
        RepoGroupGitTab: ({ workspaceId, layout, headerToolbarContainer }: {
            workspaceId: string; layout?: string; headerToolbarContainer?: HTMLElement | null;
        }) => {
            const pane = useMobileWorkspacePane();
            return (
                <div
                    data-testid="stub-group-git-tab"
                    data-workspace={workspaceId}
                    data-layout={layout ?? ''}
                    data-header-hoisted={headerToolbarContainer ? 'true' : 'false'}
                >
                    <button data-testid="stub-open-commit" onClick={() => pane?.setDetailOpen(true)}>open commit</button>
                </div>
            );
        },
    };
});
vi.mock('../../../../src/server/spa/client/react/features/notes/NotesView', () => ({
    NotesView: () => <div data-testid="stub-notes-view" />,
}));
vi.mock('../../../../src/server/spa/client/react/repos/RepoGroupSettingsTab', () => ({
    RepoGroupSettingsTab: () => <div data-testid="stub-group-settings" />,
}));

import { RepoGroupView } from '../../../../src/server/spa/client/react/repos/RepoGroupView';
import { splitWorkspaceMobilePaneStorageKey } from '../../../../src/server/spa/client/react/features/repo-detail/mobileWorkspacePane';

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
    mockBreakpoint = 'mobile';
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

/** Visible = rendered without the shell's `hidden` keep-alive class. */
function paneVisible(testId: string): boolean {
    const node = screen.queryByTestId(testId);
    return !!node && !node.className.split(/\s+/).includes('hidden');
}

describe('RepoGroupView — mobile Workspace panel (AC-06)', () => {
    it('renders the shared split shell with a Chats | Git switcher, one pane at a time', () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);

        expect(screen.getByTestId('split-workspace-panel').dataset.narrow).toBe('true');
        expect(screen.getByTestId('split-workspace-mobile-switcher')).toBeTruthy();
        // Both panes stay mounted (keep-alive); only the chat one is visible.
        expect(screen.getByTestId('stub-chat-tab')).toBeTruthy();
        expect(screen.getByTestId('stub-group-git-tab')).toBeTruthy();
        expect(paneVisible('split-workspace-chat')).toBe(true);
        expect(paneVisible('split-workspace-git')).toBe(false);

        click('split-workspace-mobile-pane-git');
        expect(paneVisible('split-workspace-chat')).toBe(false);
        expect(paneVisible('split-workspace-git')).toBe(true);
    });

    it('hoists the group git toolbar so the compact header is used (AC-04)', () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        const git = screen.getByTestId('stub-group-git-tab');
        expect(git.dataset.layout).toBe('split-workspace');
        // The portal target exists, which is exactly what makes `headerHoisted`
        // true inside RepoGitTab — one compact toolbar row, not two headers.
        expect(git.dataset.headerHoisted).toBe('true');
        expect(screen.getAllByTestId('split-workspace-git-header-extra')).toHaveLength(1);
    });

    it('pushes the detail full-screen from either pane and pops back to that pane (AC-02)', () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);

        click('stub-open-chat');
        expect(screen.getByTestId('split-workspace-panel').dataset.mobileDetail).toBe('true');
        expect(screen.queryByTestId('split-workspace-mobile-switcher')).toBeNull();
        expect(paneVisible('split-workspace-chat')).toBe(false);

        click('split-workspace-mobile-back');
        expect(paneVisible('split-workspace-chat')).toBe(true);

        click('split-workspace-mobile-pane-git');
        click('stub-open-commit');
        expect(screen.getByTestId('split-workspace-panel').dataset.mobileDetail).toBe('true');
        click('split-workspace-mobile-back');
        // Back lands on the segment it was pushed from, not on Chats.
        expect(paneVisible('split-workspace-git')).toBe(true);
    });

    it('restores the last segment for that group on reload (AC-03)', () => {
        localStorage.setItem(splitWorkspaceMobilePaneStorageKey(GROUP_ID), 'git');
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect(paneVisible('split-workspace-git')).toBe(true);

        cleanup();
        localStorage.setItem(splitWorkspaceMobilePaneStorageKey(GROUP_ID), 'nonsense');
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect(paneVisible('split-workspace-chat')).toBe(true);
    });

    it('drops the standalone Git tab on the merged mobile path, and keeps it on desktop', () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect(screen.queryByTestId('repo-group-tab-git')).toBeNull();

        cleanup();
        mockBreakpoint = 'desktop';
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        // Desktop keeps the two separate tabs and never mounts the mobile shell.
        expect(screen.queryByTestId('split-workspace-panel')).toBeNull();
        expect(screen.getByTestId('repo-group-tab-git')).toBeTruthy();
    });

    it('falls back to the plain chat tab when the split flag is off', () => {
        mockSplitPanelEnabled = false;
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        expect(screen.queryByTestId('split-workspace-panel')).toBeNull();
        expect(screen.getByTestId('stub-chat-tab')).toBeTruthy();
    });
});
