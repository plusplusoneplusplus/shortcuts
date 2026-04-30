/**
 * @vitest-environment jsdom
 *
 * Regression test: in classic mode, only the Activity RepoChatTab should mount;
 * in dev-workflow mode, only the Chats RepoChatTab should mount.
 * Previously the Chats instance was always mounted (via display:none) regardless
 * of layout mode, causing duplicate API calls and WebSocket listeners.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';

// jsdom doesn't implement scrollIntoView
beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
});

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockDispatch = vi.fn();
let mockActiveRepoSubTab = 'chats';
let mockUiLayoutMode = 'dev-workflow';
let mockRepoTabState: Record<string, string> = {};
let mockIsMobile = false;
let mockNotesEnabled = false;
let mockGitInfo = { ahead: 0, behind: 0 };
let lastMobileTabBarProps: any = null;

vi.mock('../../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: {
            activeRepoSubTab: mockActiveRepoSubTab,
            repoTabState: mockRepoTabState,
            wikis: [],
            settingsSection: 'info',
            selectedGitCommitHash: null,
            selectedGitFilePath: null,
            selectedNotePath: null,
            selectedRepoWikiId: null,
            repoWikiInitialTab: null,
            repoWikiInitialAdminTab: null,
            repoWikiInitialComponentId: null,
            selectedWorkflowProcessId: null,
        },
        dispatch: mockDispatch,
    }),
}));

const mockQueueDispatch = vi.fn();
vi.mock('../../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({
        state: {
            repoQueueMap: {},
            isTaskSubmitting: false,
        },
        dispatch: mockQueueDispatch,
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/contexts/WorkItemContext', () => ({
    useWorkItems: () => ({
        state: { workItemsByRepo: {}, unseenByRepo: {} },
        dispatch: vi.fn(),
    }),
    loadUnseenWorkItemIds: () => [],
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/preferences/useUiLayoutMode', () => ({
    useUiLayoutMode: () => [mockUiLayoutMode, vi.fn()],
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: mockIsMobile, isTablet: false }),
}));

vi.mock('../../../../../src/server/spa/client/react/queue/hooks/useRepoQueueStats', () => ({
    useRepoQueueStats: () => ({ running: 0, queued: 0 }),
}));

vi.mock('../../../../../src/server/spa/client/react/features/git/hooks/useGitInfo', () => ({
    useGitInfo: () => mockGitInfo,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/feature-flags/useTerminalEnabled', () => ({
    useTerminalEnabled: () => false,
}));

vi.mock('../../../../../src/server/spa/client/react/features/notes/hooks/useNotesEnabled', () => ({
    useNotesEnabled: () => mockNotesEnabled,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/feature-flags/useWorkflowsEnabled', () => ({
    useWorkflowsEnabled: () => false,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/feature-flags/usePullRequestsEnabled', () => ({
    usePullRequestsEnabled: () => false,
}));

vi.mock('../../../../../src/server/spa/client/react/features/notes/hooks/useNotesAutoCommit', () => ({
    useNotesAutoCommit: () => false,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../../../src/server/spa/client/react/ui', () => ({
    cn: (...args: any[]) => args.filter(Boolean).join(' '),
    Button: (props: any) => <button {...props} />,
}));

vi.mock('../../../../../src/server/spa/client/react/ui/ErrorBoundary', () => ({
    ErrorBoundary: ({ children }: any) => <>{children}</>,
}));

vi.mock('../../../../../src/server/spa/client/react/layout/TopBar', () => ({
    SHOW_WIKI_TAB: false,
}));

vi.mock('../../../../../src/server/spa/client/react/layout/MobileTabBar', () => ({
    MobileTabBar: (props: any) => {
        lastMobileTabBarProps = props;
        return <div data-testid="mobile-tab-bar" />;
    },
}));

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '',
    isTerminalEnabled: () => false,
    isNotesEnabled: () => false,
    isMyWorkEnabled: () => false,
    isMyLifeEnabled: () => false,
    isScratchpadEnabled: () => false,
    isWorkflowsEnabled: () => false,
    isPullRequestsEnabled: () => false,
    getScratchpadLayout: () => 'horizontal',
}));

// Stub RepoChatTab — render a marker div that captures mode prop
vi.mock('../../../../../src/server/spa/client/react/features/chat/RepoChatTab', () => ({
    RepoChatTab: (props: any) => (
        <div
            data-testid={`repo-chat-tab-${props.mode ?? 'activity'}`}
            data-workspace-id={props.workspaceId}
            data-mode={props.mode ?? 'activity'}
        />
    ),
}));

// Stub all other tab components
vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/RepoInfoTab', () => ({ RepoInfoTab: () => null }));
vi.mock('../../../../../src/server/spa/client/react/features/templates/TemplatesTab', () => ({ TemplatesTab: () => null }));
vi.mock('../../../../../src/server/spa/client/react/features/schedules/RepoSchedulesTab', () => ({ RepoSchedulesTab: () => null }));
vi.mock('../../../../../src/server/spa/client/react/features/git/RepoGitTab', () => ({ RepoGitTab: () => null }));
vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/RepoWikiTab', () => ({ RepoWikiTab: () => null }));
vi.mock('../../../../../src/server/spa/client/react/features/repo-settings/RepoSettingsTab', () => ({ RepoSettingsTab: () => null }));
vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({ ExplorerPanel: () => null }));
vi.mock('../../../../../src/server/spa/client/react/features/pull-requests/PullRequestsTab', () => ({ PullRequestsTab: () => null }));
vi.mock('../../../../../src/server/spa/client/react/features/work-items/WorkItemsTab', () => ({ WorkItemsTab: () => null }));
vi.mock('../../../../../src/server/spa/client/react/processes/dag', () => ({ WorkflowDetailView: () => null }));
vi.mock('../../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({ TerminalView: () => null }));
vi.mock('../../../../../src/server/spa/client/react/features/notes/NotesView', () => ({ NotesView: () => null }));
vi.mock('../../../../../src/server/spa/client/react/repos/AddRepoDialog', () => ({ AddRepoDialog: () => null }));
vi.mock('../../../../../src/server/spa/client/react/tasks/GenerateTaskDialog', () => ({ GenerateTaskDialog: () => null }));
vi.mock('../../../../../src/server/spa/client/react/tasks/TasksPanel', () => ({
    TasksPanel: (props: any) => (
        <div data-testid="tasks-panel" data-workspace-id={props.wsId} />
    ),
}));
vi.mock('../../../../../src/server/spa/client/react/repos/repoGrouping', () => ({}));

import { RepoDetail } from '../../../../../src/server/spa/client/react/features/repo-detail/RepoDetail';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRepo(id = 'ws-1') {
    return {
        workspace: { id, rootPath: '/repo', name: 'test-repo', color: '#ccc', remoteUrl: null },
        gitInfo: { isGitRepo: true },
        taskCount: 0,
    } as any;
}

function renderDetail(repo = makeRepo()) {
    return render(<RepoDetail repo={repo} repos={[repo]} onRefresh={vi.fn()} />);
}

function expectClassTokens(element: Element, tokens: string[]) {
    for (const token of tokens) {
        expect(element.classList.contains(token)).toBe(true);
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('RepoDetail — layout mode chat tab mounting', () => {
    beforeEach(() => {
        mockDispatch.mockClear();
        mockQueueDispatch.mockClear();
        mockRepoTabState = {};
        mockIsMobile = false;
        mockNotesEnabled = false;
        mockGitInfo = { ahead: 0, behind: 0 };
        lastMobileTabBarProps = null;
        location.hash = '';
    });

    it('classic mode: mounts Activity RepoChatTab, does NOT mount Chats RepoChatTab', () => {
        mockUiLayoutMode = 'classic';
        mockActiveRepoSubTab = 'activity';
        renderDetail();

        expect(screen.getByTestId('repo-chat-tab-activity')).toBeTruthy();
        expect(screen.queryByTestId('repo-chat-tab-chats')).toBeNull();
    });

    it('dev-workflow mode: mounts Chats RepoChatTab, does NOT mount Activity RepoChatTab', () => {
        mockUiLayoutMode = 'dev-workflow';
        mockActiveRepoSubTab = 'chats';
        renderDetail();

        expect(screen.getByTestId('repo-chat-tab-chats')).toBeTruthy();
        expect(screen.queryByTestId('repo-chat-tab-activity')).toBeNull();
    });

    it('dev-workflow mode: Tasks tab mounts its own RepoChatTab with mode="tasks"', () => {
        mockUiLayoutMode = 'dev-workflow';
        mockActiveRepoSubTab = 'tasks';
        renderDetail();

        expect(screen.getByTestId('repo-chat-tab-tasks')).toBeTruthy();
        expect(screen.queryByTestId('repo-chat-tab-activity')).toBeNull();
        expect(screen.queryByTestId('repo-chat-tab-chats')).toBeNull();
    });

    it('classic mode with non-activity sub-tab still mounts Activity (display:none pattern)', () => {
        mockUiLayoutMode = 'classic';
        mockActiveRepoSubTab = 'settings';
        renderDetail();

        // Activity should be mounted (kept alive via display:none)
        const activityEl = screen.getByTestId('repo-chat-tab-activity');
        expect(activityEl).toBeTruthy();
        const container = activityEl.parentElement!;
        expect(container.style.display).toBe('none');

        // Chats should NOT be mounted at all
        expect(screen.queryByTestId('repo-chat-tab-chats')).toBeNull();
    });

    it('dev-workflow mode with non-chats sub-tab still mounts Chats (display:none pattern)', () => {
        mockUiLayoutMode = 'dev-workflow';
        mockActiveRepoSubTab = 'settings';
        renderDetail();

        // Chats should be mounted (kept alive via display:none)
        const chatsEl = screen.getByTestId('repo-chat-tab-chats');
        expect(chatsEl).toBeTruthy();
        const container = chatsEl.parentElement!;
        expect(container.style.display).toBe('none');

        // Activity should NOT be mounted at all
        expect(screen.queryByTestId('repo-chat-tab-activity')).toBeNull();
    });

    it('classic mode: Tasks (Plans) tab renders TasksPanel (miller columns), not RepoChatTab', () => {
        mockUiLayoutMode = 'classic';
        mockActiveRepoSubTab = 'tasks';
        renderDetail();

        expect(screen.getByTestId('tasks-panel')).toBeTruthy();
        // RepoChatTab with mode="tasks" should NOT be mounted in classic mode
        expect(screen.queryByTestId('repo-chat-tab-tasks')).toBeNull();
    });

    it('classic mode: switching to classic does NOT redirect away from tasks sub-tab', () => {
        mockUiLayoutMode = 'classic';
        mockActiveRepoSubTab = 'tasks';
        renderDetail();

        // Should NOT have dispatched a redirect to 'activity'
        const redirectCalls = mockDispatch.mock.calls.filter(
            (c: any[]) => c[0]?.type === 'SET_REPO_SUB_TAB' && c[0]?.tab === 'activity'
        );
        expect(redirectCalls.length).toBe(0);
    });

    it('classic mode: switching to classic does NOT redirect away from work-items', () => {
        mockUiLayoutMode = 'classic';
        mockActiveRepoSubTab = 'work-items';
        renderDetail();

        // Work Items tab is now visible in classic mode — should NOT redirect
        const redirectCalls = mockDispatch.mock.calls.filter(
            (c: any[]) => c[0]?.type === 'SET_REPO_SUB_TAB' && c[0]?.tab === 'activity'
        );
        expect(redirectCalls.length).toBe(0);
    });

    it('classic mode: Work Items tab button is present in the tab strip', () => {
        mockUiLayoutMode = 'classic';
        mockActiveRepoSubTab = 'activity';
        const { container } = renderDetail();

        const workItemsTab = container.querySelector('[data-subtab="work-items"]');
        expect(workItemsTab).toBeTruthy();
    });

    it('mobile classic Activity tab keeps a flex height chain through display-toggled wrappers', () => {
        mockUiLayoutMode = 'classic';
        mockActiveRepoSubTab = 'activity';
        mockIsMobile = true;
        const { container } = renderDetail();

        const subTabContent = container.querySelector('#repo-sub-tab-content')!;
        expectClassTokens(subTabContent, ['flex', 'flex-col', 'flex-1', 'min-h-0', 'overflow-hidden']);

        const activityWrapper = screen.getByTestId('repo-chat-tab-activity').parentElement!;
        expect(activityWrapper.style.display).toBe('');
        expectClassTokens(activityWrapper, ['flex', 'flex-col', 'flex-1', 'min-h-0', 'overflow-hidden']);

        const branchWrapper = activityWrapper.parentElement!;
        expectClassTokens(branchWrapper, ['flex', 'flex-col', 'flex-1', 'min-h-0', 'overflow-hidden']);
    });

    it('mobile hidden Activity wrapper preserves flex sizing for later tab restore', () => {
        mockUiLayoutMode = 'classic';
        mockActiveRepoSubTab = 'settings';
        mockIsMobile = true;
        renderDetail();

        const activityWrapper = screen.getByTestId('repo-chat-tab-activity').parentElement!;
        expect(activityWrapper.style.display).toBe('none');
        expectClassTokens(activityWrapper, ['flex', 'flex-col', 'flex-1', 'min-h-0', 'overflow-hidden']);
    });

    it('mobile dev-workflow Tasks chat tab uses a flex-1 content wrapper', () => {
        mockUiLayoutMode = 'dev-workflow';
        mockActiveRepoSubTab = 'tasks';
        mockIsMobile = true;
        renderDetail();

        const tasksWrapper = screen.getByTestId('repo-chat-tab-tasks').parentElement!;
        expectClassTokens(tasksWrapper, ['flex', 'flex-col', 'flex-1', 'min-h-0', 'overflow-hidden']);
    });

    it('dev-workflow mode: Work Items tab button is present in the tab strip', () => {
        mockUiLayoutMode = 'dev-workflow';
        mockActiveRepoSubTab = 'chats';
        const { container } = renderDetail();

        const workItemsTab = container.querySelector('[data-subtab="work-items"]');
        expect(workItemsTab).toBeTruthy();
    });

    it('notes-centric mode: orders Notes, Git, and Work Items first when notes are enabled', () => {
        mockUiLayoutMode = 'notes-centric';
        mockActiveRepoSubTab = 'notes';
        mockNotesEnabled = true;
        const { container } = renderDetail();

        const keys = [...container.querySelectorAll('[data-subtab]')].map(el => el.getAttribute('data-subtab'));
        expect(keys.slice(0, 3)).toEqual(['notes', 'git', 'work-items']);
    });

    it('notes-centric mode: labels the chats-backed tab as Activity while keeping the chats key', () => {
        mockUiLayoutMode = 'notes-centric';
        mockActiveRepoSubTab = 'chats';
        mockNotesEnabled = true;
        const { container } = renderDetail();

        const chatsTab = container.querySelector('[data-subtab="chats"]');
        expect(chatsTab).toBeTruthy();
        expect(chatsTab?.textContent).toContain('Activity');
    });

    it('notes-centric mode: mounts Chats RepoChatTab and does NOT mount Activity RepoChatTab', () => {
        mockUiLayoutMode = 'notes-centric';
        mockActiveRepoSubTab = 'chats';
        mockNotesEnabled = true;
        renderDetail();

        expect(screen.getByTestId('repo-chat-tab-chats')).toBeTruthy();
        expect(screen.queryByTestId('repo-chat-tab-activity')).toBeNull();
    });

    it('notes-centric mode: Tasks tab mounts its own RepoChatTab with mode="tasks"', () => {
        mockUiLayoutMode = 'notes-centric';
        mockActiveRepoSubTab = 'tasks';
        mockNotesEnabled = true;
        renderDetail();

        expect(screen.getByTestId('repo-chat-tab-tasks')).toBeTruthy();
    });

    it('notes-centric mode: mobile pins Notes, Git, and Work Items and forwards git badge count', () => {
        mockUiLayoutMode = 'notes-centric';
        mockActiveRepoSubTab = 'notes';
        mockNotesEnabled = true;
        mockIsMobile = true;
        mockGitInfo = { ahead: 2, behind: 1 };
        renderDetail();

        expect(lastMobileTabBarProps.pinnedTabs).toEqual(['notes', 'git', 'work-items']);
        expect(lastMobileTabBarProps.gitPendingCount).toBe(3);
    });

    it('notes-centric mode: root repo hash lands on Notes when no saved tab exists', () => {
        mockUiLayoutMode = 'notes-centric';
        mockActiveRepoSubTab = 'chats';
        mockNotesEnabled = true;
        location.hash = '#repos/ws-1';
        renderDetail();

        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_REPO_SUB_TAB', tab: 'notes' });
    });

    it('notes-centric mode: falls back to Git when Notes are disabled', () => {
        mockUiLayoutMode = 'notes-centric';
        mockActiveRepoSubTab = 'chats';
        mockNotesEnabled = false;
        location.hash = '#repos/ws-1';
        renderDetail();

        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_REPO_SUB_TAB', tab: 'git' });
    });

    it('notes-centric mode: explicit Git deep link is not overridden', () => {
        mockUiLayoutMode = 'notes-centric';
        mockActiveRepoSubTab = 'git';
        mockNotesEnabled = true;
        location.hash = '#repos/ws-1/git';
        renderDetail();

        expect(mockDispatch).not.toHaveBeenCalledWith({ type: 'SET_REPO_SUB_TAB', tab: 'notes' });
    });

    it('notes-centric mode: saved per-repo tab state wins over default landing', () => {
        mockUiLayoutMode = 'notes-centric';
        mockActiveRepoSubTab = 'work-items';
        mockNotesEnabled = true;
        mockRepoTabState = { 'ws-1': 'work-items' };
        location.hash = '#repos/ws-1';
        renderDetail();

        expect(mockDispatch).not.toHaveBeenCalledWith({ type: 'SET_REPO_SUB_TAB', tab: 'notes' });
    });
});

describe('RepoDetail — header action buttons by layout mode', () => {
    beforeEach(() => {
        mockDispatch.mockClear();
        mockQueueDispatch.mockClear();
        mockRepoTabState = {};
        mockIsMobile = false;
        mockNotesEnabled = false;
        mockGitInfo = { ahead: 0, behind: 0 };
        lastMobileTabBarProps = null;
        location.hash = '';
    });

    it('classic mode: Queue Task, Ask, Generate Plan buttons are rendered', () => {
        mockUiLayoutMode = 'classic';
        mockActiveRepoSubTab = 'chats';
        renderDetail();

        expect(screen.getByTestId('repo-queue-task-btn')).toBeTruthy();
        expect(screen.getByTestId('repo-ask-btn')).toBeTruthy();
        expect(screen.getByTestId('repo-generate-btn')).toBeTruthy();
    });

    it('dev-workflow mode: Queue Task, Ask, Generate Plan buttons are NOT rendered', () => {
        mockUiLayoutMode = 'dev-workflow';
        mockActiveRepoSubTab = 'chats';
        renderDetail();

        expect(screen.queryByTestId('repo-queue-task-btn')).toBeNull();
        expect(screen.queryByTestId('repo-ask-btn')).toBeNull();
        expect(screen.queryByTestId('repo-generate-btn')).toBeNull();
    });

    it('dev-workflow mode: Run Script and Launch CLI buttons remain visible', () => {
        mockUiLayoutMode = 'dev-workflow';
        mockActiveRepoSubTab = 'chats';
        renderDetail();

        expect(screen.getByTestId('repo-run-script-btn')).toBeTruthy();
        expect(screen.getByTestId('repo-launch-cli-btn')).toBeTruthy();
    });
});
