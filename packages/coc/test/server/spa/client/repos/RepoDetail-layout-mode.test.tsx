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
let mockDreamsEnabled = false;

vi.mock('../../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: {
            activeRepoSubTab: mockActiveRepoSubTab,
            repoTabState: {},
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
    useBreakpoint: () => ({ isMobile: false, isTablet: false }),
}));

vi.mock('../../../../../src/server/spa/client/react/queue/hooks/useRepoQueueStats', () => ({
    useRepoQueueStats: () => ({ running: 0, queued: 0 }),
}));

vi.mock('../../../../../src/server/spa/client/react/features/git/hooks/useGitInfo', () => ({
    useGitInfo: () => ({ ahead: 0, behind: 0 }),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/feature-flags/useTerminalEnabled', () => ({
    useTerminalEnabled: () => false,
}));

vi.mock('../../../../../src/server/spa/client/react/features/notes/hooks/useNotesEnabled', () => ({
    useNotesEnabled: () => false,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/feature-flags/useWorkflowsEnabled', () => ({
    useWorkflowsEnabled: () => false,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/feature-flags/usePullRequestsEnabled', () => ({
    usePullRequestsEnabled: () => false,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/feature-flags/useDreamsEnabled', () => ({
    useDreamsEnabled: () => mockDreamsEnabled,
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
    MobileTabBar: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
    isRalphEnabled: () => false,
    isTerminalEnabled: () => false,
    isSessionContextAttachmentsEnabled: () => false,
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
vi.mock('../../../../../src/server/spa/client/react/features/dreams/DreamsPanel', () => ({
    DreamsPanel: (props: any) => <div data-testid="dreams-panel" data-workspace-id={props.workspaceId} />,
}));
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

// ── Tests ───────────────────────────────────────────────────────────────────

describe('RepoDetail — layout mode chat tab mounting', () => {
    beforeEach(() => {
        mockDispatch.mockClear();
        mockQueueDispatch.mockClear();
        mockDreamsEnabled = false;
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

    it('dev-workflow mode: Work Items tab button is present in the tab strip', () => {
        mockUiLayoutMode = 'dev-workflow';
        mockActiveRepoSubTab = 'chats';
        const { container } = renderDetail();

        const workItemsTab = container.querySelector('[data-subtab="work-items"]');
        expect(workItemsTab).toBeTruthy();
    });

    it('hides the Dreams tab when the feature is disabled', () => {
        mockUiLayoutMode = 'dev-workflow';
        mockActiveRepoSubTab = 'chats';
        mockDreamsEnabled = false;
        const { container } = renderDetail();

        expect(container.querySelector('[data-subtab="dreams"]')).toBeNull();
        expect(screen.queryByTestId('dreams-panel')).toBeNull();
    });

    it('shows the Dreams tab when the feature is enabled', () => {
        mockUiLayoutMode = 'dev-workflow';
        mockActiveRepoSubTab = 'chats';
        mockDreamsEnabled = true;
        const { container } = renderDetail();

        expect(container.querySelector('[data-subtab="dreams"]')).toBeTruthy();
    });

    it('does not mount DreamsPanel when the feature is disabled and dreams is active', () => {
        mockUiLayoutMode = 'dev-workflow';
        mockActiveRepoSubTab = 'dreams';
        mockDreamsEnabled = false;
        const { container } = renderDetail();

        expect(container.querySelector('[data-subtab="dreams"]')).toBeNull();
        expect(screen.queryByTestId('dreams-panel')).toBeNull();
    });

    it('mounts DreamsPanel when the feature is enabled and dreams is active', () => {
        mockUiLayoutMode = 'dev-workflow';
        mockActiveRepoSubTab = 'dreams';
        mockDreamsEnabled = true;
        const { container } = renderDetail();

        expect(container.querySelector('[data-subtab="dreams"]')).toBeTruthy();
        expect(screen.getByTestId('dreams-panel')).toBeTruthy();
    });
});

describe('RepoDetail — header action buttons by layout mode', () => {
    beforeEach(() => {
        mockDispatch.mockClear();
        mockQueueDispatch.mockClear();
        mockDreamsEnabled = false;
        location.hash = '';
    });

    it('classic mode: Queue Task and Ask buttons are rendered; Generate Plan is not', () => {
        mockUiLayoutMode = 'classic';
        mockActiveRepoSubTab = 'chats';
        renderDetail();

        expect(screen.getByTestId('repo-queue-task-btn')).toBeTruthy();
        expect(screen.getByTestId('repo-ask-btn')).toBeTruthy();
        expect(screen.queryByTestId('repo-generate-btn')).toBeNull();
    });

    it('dev-workflow mode: Queue Task and Ask buttons are NOT rendered', () => {
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

    it('classic mode: Ask button background matches ask-mode yellow', () => {
        mockUiLayoutMode = 'classic';
        mockActiveRepoSubTab = 'chats';
        renderDetail();

        const askBtn = screen.getByTestId('repo-ask-btn');
        const cls = askBtn.className;
        // Yellow background tracks MODE_BORDER_COLORS.ask (yellow-500 / yellow-400)
        expect(cls).toMatch(/!bg-yellow-500\b/);
        expect(cls).toMatch(/dark:!bg-yellow-400\b/);
        expect(cls).toMatch(/hover:!bg-yellow-600\b/);
        // Yellow needs a dark text colour for AA contrast.
        expect(cls).toMatch(/!text-\[#1e1e1e\]/);
        // No leftover grey surface from the previous neutral styling.
        expect(cls).not.toMatch(/!bg-\[#f6f8fa\]/);
    });

    it('classic mode: Queue Task button keeps the success (green) variant — no ask-mode overrides', () => {
        mockUiLayoutMode = 'classic';
        mockActiveRepoSubTab = 'chats';
        renderDetail();

        const queueBtn = screen.getByTestId('repo-queue-task-btn');
        const cls = queueBtn.className;
        // Queue Task inherits the success variant from Button (#1f883d / #238636).
        // Make sure ask-mode colour overrides did not leak into it.
        expect(cls).not.toMatch(/!bg-yellow-/);
        expect(cls).not.toMatch(/!bg-blue-/);
    });
});
