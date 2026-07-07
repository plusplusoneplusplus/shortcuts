/**
 * @vitest-environment jsdom
 *
 * Regression test: in classic mode, only the Activity RepoChatTab should mount;
 * in dev-workflow mode, only the Chats RepoChatTab should mount.
 * Previously the Chats instance was always mounted (via display:none) regardless
 * of layout mode, causing duplicate API calls and WebSocket listeners.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createPortal } from 'react-dom';

// jsdom doesn't implement scrollIntoView
beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
});

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockDispatch = vi.fn();
let mockActiveRepoSubTab = 'chats';
let mockUiLayoutMode = 'dev-workflow';
let mockDreamsEnabled = false;
let mockSplitWorkspacePanelEnabled = false;

vi.mock('../../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: {
            activeRepoSubTab: mockActiveRepoSubTab,
            repoTabState: {},
            repoRouteState: {},
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

// Keep the deprecated Plans/Tasks sub-tab visible for these layout-mode tests
// (they route to the `tasks` sub-tab directly), independent of the default-off flag.
vi.mock('../../../../../src/server/spa/client/react/hooks/feature-flags/useShowPlanDepTab', () => ({
    useShowPlanDepTab: () => true,
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
    isNativeCliSessionsEnabled: () => false,
    isSplitWorkspacePanelEnabled: () => mockSplitWorkspacePanelEnabled,
    isSchedulesInScheduledSlideEnabled: () => false,
    getScratchpadLayout: () => 'horizontal',
    DASHBOARD_CONFIG_UPDATED_EVENT: 'coc-dashboard-config-updated',
}));

// Stub RepoChatTab — render a marker div that captures mode prop.
// In split-workspace layout it is ALSO seam-aware (mirrors the real portal seam):
// a clickable list item fires onActivateDetail, and when detailActive it portals a
// `chat-detail-marker` into the shared detailContainer. This lets the last-selection
// routing be exercised behaviorally (AC-04) without pulling in the real ~56KB tab.
vi.mock('../../../../../src/server/spa/client/react/features/chat/RepoChatTab', () => ({
    RepoChatTab: (props: any) => {
        const isSplit = props.layout === 'split-workspace';
        return (
            <div
                data-testid={`repo-chat-tab-${props.mode ?? 'activity'}`}
                data-workspace-id={props.workspaceId}
                data-mode={props.mode ?? 'activity'}
            >
                {isSplit && (
                    <button
                        data-testid="split-chat-list-item"
                        onClick={() => props.onActivateDetail?.()}
                    />
                )}
                {isSplit && props.detailActive && props.detailContainer
                    ? createPortal(<div data-testid="chat-detail-marker" />, props.detailContainer)
                    : null}
            </div>
        );
    },
}));

// Stub all other tab components
vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/RepoInfoTab', () => ({ RepoInfoTab: () => null }));
vi.mock('../../../../../src/server/spa/client/react/features/templates/TemplatesTab', () => ({ TemplatesTab: () => null }));
vi.mock('../../../../../src/server/spa/client/react/features/schedules/RepoSchedulesTab', () => ({ RepoSchedulesTab: () => null }));
// Stub RepoGitTab — null on every non-split path (as before). In split-workspace
// layout it becomes seam-aware (mirror of the chat mock): a clickable list item
// fires onActivateDetail and, when detailActive, portals a `git-detail-marker` into
// the shared detailContainer — so last-selection-wins routing can be tested (AC-04).
vi.mock('../../../../../src/server/spa/client/react/features/git/RepoGitTab', () => ({
    RepoGitTab: (props: any) => {
        if (props.layout !== 'split-workspace') return null;
        return (
            <div data-testid="repo-git-tab-split">
                <button
                    data-testid="split-git-list-item"
                    onClick={() => props.onActivateDetail?.()}
                />
                {props.detailActive && props.detailContainer
                    ? createPortal(<div data-testid="git-detail-marker" />, props.detailContainer)
                    : null}
            </div>
        );
    },
}));
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

function gitTabRedirectCalls() {
    return mockDispatch.mock.calls.filter(
        (c: any[]) => c[0]?.type === 'SET_REPO_SUB_TAB' && c[0]?.tab === 'chats'
    );
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('RepoDetail — layout mode chat tab mounting', () => {
    beforeEach(() => {
        mockDispatch.mockClear();
        mockQueueDispatch.mockClear();
        mockDreamsEnabled = false;
        mockSplitWorkspacePanelEnabled = false;
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

describe('RepoDetail — git tab redirect does not clobber a remembered git tab (AC-01)', () => {
    beforeEach(() => {
        mockDispatch.mockClear();
        mockQueueDispatch.mockClear();
        mockDreamsEnabled = false;
        mockUiLayoutMode = 'dev-workflow';
        location.hash = '';
    });

    // Regression: while git info is still loading, the preliminary gitInfo can
    // report isGitRepo:false for a real git repo. The redirect must WAIT for the
    // load to finish, or it clobbers the restored 'git' tab back to 'chats' — the
    // flaky in-session reset this feature exists to fix.
    it('does NOT redirect away from git while git info is still loading', () => {
        mockActiveRepoSubTab = 'git';
        const repo = {
            workspace: { id: 'ws-1', rootPath: '/repo', name: 'test-repo', color: '#ccc', remoteUrl: null },
            gitInfo: { isGitRepo: false }, // preliminary/stale value during load
            gitInfoLoading: true,
            taskCount: 0,
        } as any;
        renderDetail(repo);

        expect(gitTabRedirectCalls().length).toBe(0);
    });

    it('does NOT redirect away from pull-requests while git info is still loading', () => {
        mockActiveRepoSubTab = 'pull-requests';
        const repo = {
            workspace: { id: 'ws-1', rootPath: '/repo', name: 'test-repo', color: '#ccc', remoteUrl: null },
            gitInfo: { isGitRepo: false },
            gitInfoLoading: true,
            taskCount: 0,
        } as any;
        renderDetail(repo);

        expect(gitTabRedirectCalls().length).toBe(0);
    });

    it('DOES redirect away from git once git info has loaded and the repo is not a git repo', () => {
        mockActiveRepoSubTab = 'git';
        const repo = {
            workspace: { id: 'ws-1', rootPath: '/repo', name: 'test-repo', color: '#ccc', remoteUrl: null },
            gitInfo: { isGitRepo: false },
            gitInfoLoading: false,
            taskCount: 0,
        } as any;
        renderDetail(repo);

        expect(gitTabRedirectCalls().length).toBeGreaterThan(0);
    });

    it('does NOT redirect away from git for a loaded git repo (remembered tab preserved)', () => {
        mockActiveRepoSubTab = 'git';
        const repo = {
            workspace: { id: 'ws-1', rootPath: '/repo', name: 'test-repo', color: '#ccc', remoteUrl: null },
            gitInfo: { isGitRepo: true },
            gitInfoLoading: false,
            taskCount: 0,
        } as any;
        renderDetail(repo);

        expect(gitTabRedirectCalls().length).toBe(0);
    });

    it('does NOT redirect away from a feature-gated tab while capabilities are still loading', () => {
        mockActiveRepoSubTab = 'notes';
        const repo = {
            workspace: { id: 'ws-1', rootPath: '/repo', name: 'test-repo', color: '#ccc', remoteUrl: null },
            gitInfo: { isGitRepo: false },
            gitInfoLoading: true,
            taskCount: 0,
        } as any;
        renderDetail(repo);

        expect(gitTabRedirectCalls().length).toBe(0);
    });

    it('redirects a genuinely unavailable feature-gated remembered tab after capabilities resolve', () => {
        mockActiveRepoSubTab = 'notes';
        const repo = {
            workspace: { id: 'ws-1', rootPath: '/repo', name: 'test-repo', color: '#ccc', remoteUrl: null },
            gitInfo: { isGitRepo: true },
            gitInfoLoading: false,
            taskCount: 0,
        } as any;
        renderDetail(repo);

        expect(gitTabRedirectCalls().length).toBeGreaterThan(0);
    });
});

describe('RepoDetail — header action buttons by layout mode', () => {
    beforeEach(() => {
        mockDispatch.mockClear();
        mockQueueDispatch.mockClear();
        mockDreamsEnabled = false;
        mockSplitWorkspacePanelEnabled = false;
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

// ── Split "Workspace" panel (feature flag `splitWorkspacePanel`) ──────────────
// AC-02 (flag-on replaces Activity, hides Git), AC-03 (split left panel),
// AC-04 (one shared detail pane, last-selection-wins). Flag off = today's behavior.
describe('RepoDetail — split workspace panel', () => {
    beforeEach(() => {
        mockDispatch.mockClear();
        mockQueueDispatch.mockClear();
        mockDreamsEnabled = false;
        mockSplitWorkspacePanelEnabled = false;
        location.hash = '';
    });

    it('flag OFF: renders the standalone chat tab, no split panel (AC-01 no-op)', () => {
        mockSplitWorkspacePanelEnabled = false;
        mockUiLayoutMode = 'dev-workflow';
        mockActiveRepoSubTab = 'chats';
        renderDetail();

        expect(screen.getByTestId('repo-chat-tab-chats')).toBeTruthy();
        expect(screen.queryByTestId('split-workspace-panel')).toBeNull();
    });

    it('flag ON: replaces the chat slot with the split panel (AC-02/03)', () => {
        mockSplitWorkspacePanelEnabled = true;
        mockUiLayoutMode = 'dev-workflow';
        mockActiveRepoSubTab = 'chats';
        renderDetail();

        // The split panel shell mounts, with both left halves and the detail slot.
        expect(screen.getByTestId('split-workspace-panel')).toBeTruthy();
        expect(screen.getByTestId('split-workspace-chat')).toBeTruthy();
        expect(screen.getByTestId('split-workspace-git')).toBeTruthy();
    });

    it('flag ON: exactly ONE shared detail region, fed by the RepoDetail host (AC-04)', () => {
        mockSplitWorkspacePanelEnabled = true;
        mockUiLayoutMode = 'dev-workflow';
        mockActiveRepoSubTab = 'chats';
        renderDetail();

        // Single shared detail pane — never two.
        expect(screen.getAllByTestId('split-workspace-detail')).toHaveLength(1);
        // The RepoDetail-owned host div (the portal target) lives inside it.
        const detail = screen.getByTestId('split-workspace-detail');
        expect(detail.querySelector('[data-testid="split-workspace-detail-host"]')).toBeTruthy();
    });

    it('flag ON: the chat list is mounted inside the panel (dev-workflow → mode="chats")', () => {
        mockSplitWorkspacePanelEnabled = true;
        mockUiLayoutMode = 'dev-workflow';
        mockActiveRepoSubTab = 'chats';
        renderDetail();

        const chatSlot = screen.getByTestId('split-workspace-chat');
        expect(chatSlot.querySelector('[data-testid="repo-chat-tab-chats"]')).toBeTruthy();
    });

    it('flag ON in classic mode: the chat list mounts as the activity variant', () => {
        mockSplitWorkspacePanelEnabled = true;
        mockUiLayoutMode = 'classic';
        mockActiveRepoSubTab = 'activity';
        renderDetail();

        const chatSlot = screen.getByTestId('split-workspace-chat');
        expect(chatSlot.querySelector('[data-testid="repo-chat-tab-activity"]')).toBeTruthy();
    });

    it('flag ON: the standalone git sub-tab button is hidden from the strip (AC-02)', () => {
        mockSplitWorkspacePanelEnabled = true;
        mockUiLayoutMode = 'dev-workflow';
        mockActiveRepoSubTab = 'chats';
        const { container } = renderDetail();

        // Git tab is filtered from visibleSubTabs — its functionality now lives in
        // the split panel — so no top-level git button remains.
        expect(container.querySelector('[data-subtab="git"]')).toBeNull();
    });

    it('flag OFF: the git sub-tab button is still present (toggling restores it)', () => {
        mockSplitWorkspacePanelEnabled = false;
        mockUiLayoutMode = 'dev-workflow';
        mockActiveRepoSubTab = 'chats';
        const { container } = renderDetail();

        expect(container.querySelector('[data-subtab="git"]')).toBeTruthy();
    });

    it('flag ON: the chat/git divider renders for the draggable split (AC-03)', () => {
        mockSplitWorkspacePanelEnabled = true;
        mockUiLayoutMode = 'dev-workflow';
        mockActiveRepoSubTab = 'chats';
        renderDetail();

        expect(screen.getByTestId('split-workspace-divider')).toBeTruthy();
        expect(screen.getByTestId('split-workspace-width-divider')).toBeTruthy();
    });

    // End-to-end AC-04: clicking a list item in one half routes THAT half's detail
    // into the single shared pane and evicts the other's — driven by RepoDetail's own
    // `splitLastClicked` state and the mirrored detailActive/onActivateDetail wiring.
    // Both tabs point at the SAME detail host, so the pane never shows chat + git at once.
    it('flag ON: last-selection-wins routes the clicked half into the ONE shared detail (AC-04)', () => {
        mockSplitWorkspacePanelEnabled = true;
        mockUiLayoutMode = 'dev-workflow';
        mockActiveRepoSubTab = 'chats';
        renderDetail();

        const host = screen.getByTestId('split-workspace-detail-host');

        // Default selection is 'chat' → the chat detail occupies the shared pane.
        expect(host.querySelector('[data-testid="chat-detail-marker"]')).toBeTruthy();
        expect(host.querySelector('[data-testid="git-detail-marker"]')).toBeNull();

        // Click a git list item → git detail takes over the shared pane; chat is evicted.
        fireEvent.click(screen.getByTestId('split-git-list-item'));
        expect(host.querySelector('[data-testid="git-detail-marker"]')).toBeTruthy();
        expect(host.querySelector('[data-testid="chat-detail-marker"]')).toBeNull();

        // Click a chat list item → chat detail returns; git is evicted (last-selection-wins).
        fireEvent.click(screen.getByTestId('split-chat-list-item'));
        expect(host.querySelector('[data-testid="chat-detail-marker"]')).toBeTruthy();
        expect(host.querySelector('[data-testid="git-detail-marker"]')).toBeNull();

        // The detail pane is always singular — exactly one shared region throughout.
        expect(screen.getAllByTestId('split-workspace-detail')).toHaveLength(1);
    });
});
