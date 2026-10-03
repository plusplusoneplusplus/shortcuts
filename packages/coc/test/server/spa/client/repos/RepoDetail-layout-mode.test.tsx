/**
 * @vitest-environment jsdom
 *
 * Workspace aliases mount one chat list, avoiding duplicate subscriptions.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { useState } from 'react';

// jsdom doesn't implement scrollIntoView
beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
});

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockDispatch = vi.fn();
let mockActiveRepoSubTab = 'chats';
let mockDreamsEnabled = false;
let mockIsMobile = false;

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

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: mockIsMobile, isTablet: false }),
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

// fetchApi is still used elsewhere in RepoDetail (e.g. /chat/launch-terminal).
vi.mock('../../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn().mockResolvedValue(null),
}));

// The queue seed/resume and the work-items badge go through the clone-routed client.
vi.mock('../../../../../src/server/spa/client/react/repos/cloneRegistry', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../../src/server/spa/client/react/repos/cloneRegistry')>()),
    getCocClientForWorkspace: () => ({
        queue: {
            list: vi.fn().mockResolvedValue(null),
            resume: vi.fn().mockResolvedValue(null),
        },
        workItems: {
            listForOrigin: vi.fn().mockResolvedValue(null),
        },
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/ui', () => ({
    cn: (...args: any[]) => args.filter(Boolean).join(' '),
    Button: (props: any) => <button {...props} />,
    // Used by RepoDetail's own sub-tab chrome.
    SegmentedControl: ({ options, value, onChange, ...rest }: any) => (
        <div data-testid={rest['data-testid']}>
            {options?.map((o: any) => (
                <button key={o.value} data-testid={o.testId} aria-pressed={value === o.value} onClick={() => onChange?.(o.value)}>
                    {o.label}
                </button>
            ))}
        </div>
    ),
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

    isSchedulesInScheduledSlideEnabled: () => false,
    getScratchpadLayout: () => 'horizontal',
    isFeatureEnabled: () => false,
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
        const [view, setView] = useState('none');
        if (props.layout !== 'split-workspace') return null;
        const select = (next: any, key: string) => {
            props.onActivateDetail?.();
            setView(key);
            props.onViewChange?.(next);
        };
        return (
            <div
                data-testid="repo-git-tab-split"
                data-detail-open={String(props.detailOpen)}
                data-restore-view={JSON.stringify(props.restoreView ?? null)}
            >
                {/* What RepoGitTab does once a restored commit is refetched. */}
                <button
                    data-testid="split-git-restore"
                    onClick={() => {
                        setView(props.restoreView.hash);
                        props.onViewChange?.({ type: 'commit', commit: { hash: props.restoreView.hash } });
                    }}
                />
                <button data-testid="split-git-list-item" onClick={() => select({ type: 'branch-range' }, 'branch-range')} />
                <button data-testid="split-git-commit-a" onClick={() => select({ type: 'commit', commit: { hash: 'aaa' } }, 'aaa')} />
                <button data-testid="split-git-commit-b" onClick={() => select({ type: 'commit', commit: { hash: 'bbb' } }, 'bbb')} />
                {props.detailActive && props.detailContainer
                    ? createPortal(<div data-testid="git-detail-marker" data-view={view} />, props.detailContainer)
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
import { openUnifiedPanelTab } from '../../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpen';
import { activeTab, findTab } from '../../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import { readUnifiedPanelState } from '../../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { setWorkspaceDockOpen } from '../../../../../src/server/spa/client/react/features/repo-detail/WorkspaceDockToggle';

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

        location.hash = '';
    });

    it('classic mode: mounts Activity RepoChatTab, does NOT mount Chats RepoChatTab', () => {

        mockActiveRepoSubTab = 'activity';
        renderDetail();

        expect(screen.getByTestId('repo-chat-tab-activity')).toBeTruthy();
        expect(screen.queryByTestId('repo-chat-tab-chats')).toBeNull();
    });

    it('classic mode with non-activity sub-tab still mounts Activity (display:none pattern)', () => {

        mockActiveRepoSubTab = 'settings';
        renderDetail();

        // Activity should be mounted (kept alive via display:none)
        const activityEl = screen.getByTestId('repo-chat-tab-activity');
        expect(activityEl).toBeTruthy();
        const container = activityEl.closest('[style*="display: none"]') as HTMLElement;
        expect(container.style.display).toBe('none');

        // Chats should NOT be mounted at all
        expect(screen.queryByTestId('repo-chat-tab-chats')).toBeNull();
    });

    it('classic mode: Tasks (Plans) tab renders TasksPanel (miller columns), not RepoChatTab', () => {

        mockActiveRepoSubTab = 'tasks';
        renderDetail();

        expect(screen.getByTestId('tasks-panel')).toBeTruthy();
        // RepoChatTab with mode="tasks" should NOT be mounted in classic mode
        expect(screen.queryByTestId('repo-chat-tab-tasks')).toBeNull();
    });

    it('classic mode: switching to classic does NOT redirect away from tasks sub-tab', () => {

        mockActiveRepoSubTab = 'tasks';
        renderDetail();

        // Should NOT have dispatched a redirect to 'activity'
        const redirectCalls = mockDispatch.mock.calls.filter(
            (c: any[]) => c[0]?.type === 'SET_REPO_SUB_TAB' && c[0]?.tab === 'activity'
        );
        expect(redirectCalls.length).toBe(0);
    });

    it('classic mode: switching to classic does NOT redirect away from work-items', () => {

        mockActiveRepoSubTab = 'work-items';
        renderDetail();

        // Work Items tab is now visible in classic mode — should NOT redirect
        const redirectCalls = mockDispatch.mock.calls.filter(
            (c: any[]) => c[0]?.type === 'SET_REPO_SUB_TAB' && c[0]?.tab === 'activity'
        );
        expect(redirectCalls.length).toBe(0);
    });

    it('classic mode: Work Items tab button is present in the tab strip', () => {

        mockActiveRepoSubTab = 'activity';
        const { container } = renderDetail();

        const workItemsTab = container.querySelector('[data-subtab="work-items"]');
        expect(workItemsTab).toBeTruthy();
    });
});

describe('RepoDetail — git tab redirect does not clobber a remembered git tab (AC-01)', () => {
    beforeEach(() => {
        mockDispatch.mockClear();
        mockQueueDispatch.mockClear();
        mockDreamsEnabled = false;

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

    it('displays Workspace for a retired git sub-tab while preserving route memory)', () => {
        mockActiveRepoSubTab = 'git';
        const repo = {
            workspace: { id: 'ws-1', rootPath: '/repo', name: 'test-repo', color: '#ccc', remoteUrl: null },
            gitInfo: { isGitRepo: true },
            gitInfoLoading: false,
            taskCount: 0,
        } as any;
        renderDetail(repo);

        expect(gitTabRedirectCalls().length).toBeGreaterThan(0);
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

        location.hash = '';
    });

    it('classic mode: Queue Task and Ask buttons are rendered; Generate Plan is not', () => {

        mockActiveRepoSubTab = 'chats';
        renderDetail();

        expect(screen.getByTestId('repo-queue-task-btn')).toBeTruthy();
        expect(screen.getByTestId('repo-ask-btn')).toBeTruthy();
        expect(screen.queryByTestId('repo-generate-btn')).toBeNull();
    });

    it('classic mode: Ask button background matches ask-mode yellow', () => {

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
        mockIsMobile = false;
        mockDispatch.mockClear();
        mockQueueDispatch.mockClear();
        mockDreamsEnabled = false;

        location.hash = '';
    });

    it('flag ON in classic mode: the chat list mounts as the activity variant', () => {

        mockActiveRepoSubTab = 'activity';
        renderDetail();

        const chatSlot = screen.getByTestId('split-workspace-chat');
        expect(chatSlot.querySelector('[data-testid="repo-chat-tab-activity"]')).toBeTruthy();
    });
});
