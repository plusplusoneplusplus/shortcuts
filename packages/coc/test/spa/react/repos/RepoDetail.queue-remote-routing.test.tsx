/**
 * @vitest-environment jsdom
 *
 * Regression tests: RepoDetail's queue seed + Resume Queue must hit the clone's OWN
 * server, not the local origin.
 *
 * Bug: both went through the local-origin `fetchApi`. GET /queue?repoId= answers 200
 * with an EMPTY queue for an id the local server doesn't know, so a remote clone's
 * queue looked permanently idle; POST /queue/resume?repoId= 404'd.
 *
 * Fix: route both through getCocClientForWorkspace(ws.id). A local (unregistered) id
 * misses the registry and falls back to the local-origin singleton — unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
    registerCloneBaseUrls,
    resetCloneRegistryForTests,
} from '../../../../src/server/spa/client/react/repos/cloneRegistry';

const REMOTE_WS = 'ws-47v03z';
const REMOTE_BASE = 'http://127.0.0.1:4001';
const LOCAL_WS = 'ws-local';

beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
});

// ── Mocks: everything except the queue path under test ──────────────────────

const mockDispatch = vi.fn();
vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: {
            activeRepoSubTab: 'chats',
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

vi.mock('../../../../src/server/spa/client/react/contexts/WorkItemContext', () => ({
    useWorkItems: () => ({
        state: { workItemsByRepo: { [REMOTE_WS]: [], [LOCAL_WS]: [] }, unseenByRepo: {} },
        dispatch: vi.fn(),
    }),
    loadUnseenWorkItemIds: () => [],
}));

vi.mock('../../../../src/server/spa/client/react/hooks/preferences/useUiLayoutMode', () => ({
    useUiLayoutMode: () => ['dev-workflow', vi.fn()],
}));

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false }),
}));

vi.mock('../../../../src/server/spa/client/react/queue/hooks/useRepoQueueStats', () => ({
    useRepoQueueStats: () => ({ running: 0, queued: 0 }),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useGitInfo', () => ({
    useGitInfo: () => ({ ahead: 0, behind: 0 }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useTerminalEnabled', () => ({
    useTerminalEnabled: () => false,
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/hooks/useNotesEnabled', () => ({
    useNotesEnabled: () => false,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useWorkflowsEnabled', () => ({
    useWorkflowsEnabled: () => false,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/usePullRequestsEnabled', () => ({
    usePullRequestsEnabled: () => false,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useDreamsEnabled', () => ({
    useDreamsEnabled: () => false,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useShowPlanDepTab', () => ({
    useShowPlanDepTab: () => false,
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/hooks/useNotesAutoCommit', () => ({
    useNotesAutoCommit: () => false,
}));

// fetchApi stays mocked: RepoDetail still uses it for /chat/launch-terminal, which is
// deliberately NOT clone-routed. If a queue call ever regresses back to it, the fetch
// spy below sees nothing and the assertions fail.
vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../../src/server/spa/client/react/ui', () => ({
    cn: (...args: any[]) => args.filter(Boolean).join(' '),
    Button: (props: any) => <button {...props} />,
    SegmentedControl: () => null,
}));
vi.mock('../../../../src/server/spa/client/react/ui/ErrorBoundary', () => ({
    ErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../../../../src/server/spa/client/react/layout/TopBar', () => ({ SHOW_WIKI_TAB: false }));
vi.mock('../../../../src/server/spa/client/react/layout/MobileTabBar', () => ({ MobileTabBar: () => null }));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
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
    isSplitWorkspacePanelEnabled: () => false,
    isSchedulesInScheduledSlideEnabled: () => false,
    getScratchpadLayout: () => 'horizontal',
    DASHBOARD_CONFIG_UPDATED_EVENT: 'coc-dashboard-config-updated',
}));

// Heavy sub-tabs are irrelevant here.
vi.mock('../../../../src/server/spa/client/react/features/chat/RepoChatTab', () => ({ RepoChatTab: () => null }));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/RepoInfoTab', () => ({ RepoInfoTab: () => null }));
vi.mock('../../../../src/server/spa/client/react/features/templates/TemplatesTab', () => ({ TemplatesTab: () => null }));
vi.mock('../../../../src/server/spa/client/react/features/schedules/RepoSchedulesTab', () => ({ RepoSchedulesTab: () => null }));
vi.mock('../../../../src/server/spa/client/react/features/git/RepoGitTab', () => ({ RepoGitTab: () => null }));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/RepoWikiTab', () => ({ RepoWikiTab: () => null }));
vi.mock('../../../../src/server/spa/client/react/features/repo-settings/RepoSettingsTab', () => ({ RepoSettingsTab: () => null }));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({ ExplorerPanel: () => null }));
vi.mock('../../../../src/server/spa/client/react/features/pull-requests/PullRequestsTab', () => ({ PullRequestsTab: () => null }));
vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemsTab', () => ({ WorkItemsTab: () => null }));
vi.mock('../../../../src/server/spa/client/react/processes/dag', () => ({ WorkflowDetailView: () => null }));
vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({ TerminalView: () => null }));
vi.mock('../../../../src/server/spa/client/react/features/notes/NotesView', () => ({ NotesView: () => null }));
vi.mock('../../../../src/server/spa/client/react/features/dreams/DreamsPanel', () => ({ DreamsPanel: () => null }));
vi.mock('../../../../src/server/spa/client/react/repos/AddRepoDialog', () => ({ AddRepoDialog: () => null }));
vi.mock('../../../../src/server/spa/client/react/tasks/GenerateTaskDialog', () => ({ GenerateTaskDialog: () => null }));
vi.mock('../../../../src/server/spa/client/react/tasks/TasksPanel', () => ({ TasksPanel: () => null }));
vi.mock('../../../../src/server/spa/client/react/repos/repoGrouping', () => ({}));

import { RepoDetail } from '../../../../src/server/spa/client/react/features/repo-detail/RepoDetail';
import { QueueProvider } from '../../../../src/server/spa/client/react/contexts/QueueContext';

// ── Helpers ────────────────────────────────────────────────────────────────

function jsonResponse(data: unknown): Partial<Response> {
    return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => data,
        text: async () => JSON.stringify(data),
    };
}

// A PAUSED queue, so RepoDetail renders the "Resume Queue" action.
const PAUSED_QUEUE = { queued: [], running: [], stats: { isPaused: true } };

function renderDetail(wsId: string) {
    const repo = {
        workspace: { id: wsId, rootPath: '/repo', name: 'test-repo', color: '#ccc', remoteUrl: null },
        gitInfo: { isGitRepo: true },
        gitInfoLoading: false,
        taskCount: 0,
    } as any;
    return render(
        <QueueProvider>
            <RepoDetail repo={repo} repos={[repo]} onRefresh={vi.fn()} />
        </QueueProvider>,
    );
}

describe('RepoDetail queue — remote-clone request routing', () => {
    let urls: string[];

    beforeEach(() => {
        urls = [];
        resetCloneRegistryForTests();
        mockDispatch.mockClear();
        vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
            urls.push(String(input));
            return Promise.resolve(jsonResponse(PAUSED_QUEUE));
        }));
    });

    afterEach(() => {
        resetCloneRegistryForTests();
        vi.unstubAllGlobals();
    });

    const queueSeedUrls = (list: string[], wsId: string) =>
        list.filter(u => u.includes('/queue?') && u.includes(`repoId=${wsId}`));
    const resumeUrls = (list: string[], wsId: string) =>
        list.filter(u => u.includes('/queue/resume') && u.includes(`repoId=${wsId}`));

    it('regression: seeds the repo queue from the remote clone server, never the local one', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);
        renderDetail(REMOTE_WS);

        await waitFor(() => expect(queueSeedUrls(urls, REMOTE_WS).length).toBeGreaterThan(0));
        for (const u of queueSeedUrls(urls, REMOTE_WS)) {
            expect(u.startsWith(REMOTE_BASE)).toBe(true);
        }
    });

    it('seeds a local (unregistered) workspace from the local origin — unchanged', async () => {
        renderDetail(LOCAL_WS);

        await waitFor(() => expect(queueSeedUrls(urls, LOCAL_WS).length).toBeGreaterThan(0));
        for (const u of queueSeedUrls(urls, LOCAL_WS)) {
            expect(u.startsWith(REMOTE_BASE)).toBe(false);
            expect(u.startsWith('http')).toBe(false);
        }
    });

    it('regression: Resume Queue resumes on the remote clone server, never the local one', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);
        renderDetail(REMOTE_WS);

        // The Resume action only renders once the seeded stats report a paused queue.
        const btn = await screen.findByTestId('repo-header-resume-btn');
        fireEvent.click(btn);

        await waitFor(() => expect(resumeUrls(urls, REMOTE_WS).length).toBeGreaterThan(0));
        for (const u of resumeUrls(urls, REMOTE_WS)) {
            expect(u.startsWith(REMOTE_BASE)).toBe(true);
        }
    });

    it('Resume Queue for a local workspace stays on the local origin — unchanged', async () => {
        renderDetail(LOCAL_WS);

        const btn = await screen.findByTestId('repo-header-resume-btn');
        fireEvent.click(btn);

        await waitFor(() => expect(resumeUrls(urls, LOCAL_WS).length).toBeGreaterThan(0));
        for (const u of resumeUrls(urls, LOCAL_WS)) {
            expect(u.startsWith('http')).toBe(false);
        }
    });
});
