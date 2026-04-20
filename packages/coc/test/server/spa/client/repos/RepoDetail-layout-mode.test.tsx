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

vi.mock('../../../../../src/server/spa/client/react/context/AppContext', () => ({
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
vi.mock('../../../../../src/server/spa/client/react/context/QueueContext', () => ({
    useQueue: () => ({
        state: {
            repoQueueMap: {},
            isTaskSubmitting: false,
        },
        dispatch: mockQueueDispatch,
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/context/WorkItemContext', () => ({
    useWorkItems: () => ({
        state: { workItemsByRepo: {}, unseenByRepo: {} },
        dispatch: vi.fn(),
    }),
    loadUnseenWorkItemIds: () => [],
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useUiLayoutMode', () => ({
    useUiLayoutMode: () => [mockUiLayoutMode, vi.fn()],
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false }),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useRepoQueueStats', () => ({
    useRepoQueueStats: () => ({ running: 0, queued: 0 }),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useGitInfo', () => ({
    useGitInfo: () => ({ ahead: 0, behind: 0 }),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useTerminalEnabled', () => ({
    useTerminalEnabled: () => false,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useNotesEnabled', () => ({
    useNotesEnabled: () => false,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useNotesAutoCommit', () => ({
    useNotesAutoCommit: () => false,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../../../src/server/spa/client/react/shared', () => ({
    cn: (...args: any[]) => args.filter(Boolean).join(' '),
    Button: (props: any) => <button {...props} />,
}));

vi.mock('../../../../../src/server/spa/client/react/shared/ErrorBoundary', () => ({
    ErrorBoundary: ({ children }: any) => <>{children}</>,
}));

vi.mock('../../../../../src/server/spa/client/react/layout/TopBar', () => ({
    SHOW_WIKI_TAB: false,
}));

vi.mock('../../../../../src/server/spa/client/react/layout/MobileTabBar', () => ({
    MobileTabBar: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '',
}));

// Stub RepoChatTab — render a marker div that captures mode prop
vi.mock('../../../../../src/server/spa/client/react/repos/RepoChatTab', () => ({
    RepoChatTab: (props: any) => (
        <div
            data-testid={`repo-chat-tab-${props.mode ?? 'activity'}`}
            data-workspace-id={props.workspaceId}
            data-mode={props.mode ?? 'activity'}
        />
    ),
}));

// Stub all other tab components
vi.mock('../../../../../src/server/spa/client/react/repos/RepoInfoTab', () => ({ RepoInfoTab: () => null }));
vi.mock('../../../../../src/server/spa/client/react/repos/TemplatesTab', () => ({ TemplatesTab: () => null }));
vi.mock('../../../../../src/server/spa/client/react/repos/RepoSchedulesTab', () => ({ RepoSchedulesTab: () => null }));
vi.mock('../../../../../src/server/spa/client/react/repos/RepoGitTab', () => ({ RepoGitTab: () => null }));
vi.mock('../../../../../src/server/spa/client/react/repos/RepoWikiTab', () => ({ RepoWikiTab: () => null }));
vi.mock('../../../../../src/server/spa/client/react/repos/RepoSettingsTab', () => ({ RepoSettingsTab: () => null }));
vi.mock('../../../../../src/server/spa/client/react/repos/explorer/ExplorerPanel', () => ({ ExplorerPanel: () => null }));
vi.mock('../../../../../src/server/spa/client/react/repos/pull-requests/PullRequestsTab', () => ({ PullRequestsTab: () => null }));
vi.mock('../../../../../src/server/spa/client/react/repos/WorkItemsTab', () => ({ WorkItemsTab: () => null }));
vi.mock('../../../../../src/server/spa/client/react/processes/dag', () => ({ WorkflowDetailView: () => null }));
vi.mock('../../../../../src/server/spa/client/react/repos/TerminalView', () => ({ TerminalView: () => null }));
vi.mock('../../../../../src/server/spa/client/react/repos/NotesView', () => ({ NotesView: () => null }));
vi.mock('../../../../../src/server/spa/client/react/repos/AddRepoDialog', () => ({ AddRepoDialog: () => null }));
vi.mock('../../../../../src/server/spa/client/react/tasks/GenerateTaskDialog', () => ({ GenerateTaskDialog: () => null }));
vi.mock('../../../../../src/server/spa/client/react/repos/repoGrouping', () => ({}));

import { RepoDetail } from '../../../../../src/server/spa/client/react/repos/RepoDetail';

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
});
