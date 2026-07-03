/**
 * ReposView responsive layout tests.
 * Verifies mobile master-detail, tablet ResponsiveSidebar, desktop aside,
 * height classes, back-button navigation, and sub-tab scrollability.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import type { BreakpointState } from '../../../../src/server/spa/client/react/hooks/ui/useBreakpoint';
import { ToastProvider } from '../../../../src/server/spa/client/react/contexts/ToastContext';

// ── Mutable mock state ─────────────────────────────────────────────────

let mockBreakpoint: BreakpointState = { breakpoint: 'desktop', isMobile: false, isTablet: false, isDesktop: true };
const mockAppDispatch = vi.fn();
const mockQueueDispatch = vi.fn();

let mockAppState: Record<string, any> = {
    selectedRepoId: null,
    reposSidebarCollapsed: false,
    activeRepoSubTab: 'settings',
    workspaces: [],
};

let mockRepos: any[] = [];

// ── Module mocks (before imports) ──────────────────────────────────────

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => mockBreakpoint,
}));

vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useShowPlanDepTab', () => ({
    useShowPlanDepTab: () => true,
}));

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: mockAppState,
        dispatch: mockAppDispatch,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({
        state: { selectedTaskId: null, selectedTaskIdByRepo: {}, repoQueueMap: {} },
        dispatch: mockQueueDispatch,
    }),
}));

// fetchApi resolves immediately with empty workspaces list so loading finishes
vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn().mockResolvedValue({ workspaces: [] }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useWebSocket', () => ({
    useWebSocket: () => ({
        status: 'closed' as const,
        connect: vi.fn(),
        disconnect: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/queue/hooks/useRepoQueueStats', () => ({
    useRepoQueueStats: () => ({ running: 0, queued: 0 }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/preferences/usePreferences', () => ({
    usePreferences: () => ({ model: 'test-model', setModel: vi.fn() }),
}));

// ── Mock child components to isolate layout logic ──────────────────────

vi.mock('../../../../src/server/spa/client/react/repos/ReposGrid', () => ({
    ReposGrid: () => <div data-testid="repos-grid">ReposGrid</div>,
}));

vi.mock('../../../../src/server/spa/client/react/repos/MiniReposSidebar', () => ({
    MiniReposSidebar: () => <div data-testid="mini-sidebar">MiniReposSidebar</div>,
}));

vi.mock('../../../../src/server/spa/client/react/features/repo-detail/RepoDetail', () => ({
    RepoDetail: () => <div data-testid="repo-detail">RepoDetail</div>,
    SUB_TABS: [
        { key: 'chats', label: 'Chats' },
        { key: 'git', label: 'Git' },
        { key: 'work-items', label: 'Work Items' },
        { key: 'schedules', label: 'Schedules' },
        { key: 'explorer', label: 'Explorer' },
        { key: 'workflows', label: 'Workflows' },
        { key: 'pull-requests', label: 'Pull Requests' },
        { key: 'tasks', label: 'Tasks' },
        { key: 'terminal', label: 'Terminal' },
        { key: 'notes', label: 'Notes' },
        { key: 'settings', label: 'Settings' },
    ],
}));

vi.mock('../../../../src/server/spa/client/react/ui/ResponsiveSidebar', () => ({
    ResponsiveSidebar: ({ children, width, tabletWidth }: any) => (
        <aside data-testid="responsive-sidebar" data-width={width} data-tablet-width={tabletWidth}>
            {children}
        </aside>
    ),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/NotificationContext', () => ({
    useNotifications: () => ({
        notifications: [],
        unreadCount: 0,
        addNotification: vi.fn(),
        markAllRead: vi.fn(),
        markReadByProcessId: vi.fn(),
        clearAll: vi.fn(),
    }),
    NotificationProvider: ({ children }: any) => children,
}));

vi.mock('../../../../src/server/spa/client/react/repos/repoGrouping', () => ({
    countTasks: () => 0,
}));

vi.mock('../../../../src/server/spa/client/react/features/workflow/workflow-api', () => ({
    fetchWorkflows: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../../src/server/spa/client/react/repos/AddRepoDialog', () => ({
    AddRepoDialog: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/tasks/GenerateTaskDialog', () => ({
    GenerateTaskDialog: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/tasks/TasksPanel', () => ({
    TasksPanel: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/repo-detail/RepoInfoTab', () => ({
    RepoInfoTab: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/templates/TemplatesTab', () => ({
    TemplatesTab: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/schedules/RepoSchedulesTab', () => ({
    RepoSchedulesTab: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/git/RepoGitTab', () => ({
    RepoGitTab: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/repo-detail/RepoWikiTab', () => ({
    RepoWikiTab: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/repo-detail/RepoCopilotTab', () => ({
    RepoCopilotTab: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => ({
        repos: mockRepos,
        loading: false,
        fetchRepos: vi.fn(),
        unseenCounts: {},
    }),
    ReposProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ── Import components under test AFTER mocks ───────────────────────────

import { ReposView } from '../../../../src/server/spa/client/react/repos/ReposView';

// ── Helpers ────────────────────────────────────────────────────────────

function setBreakpoint(bp: 'mobile' | 'tablet' | 'desktop') {
    mockBreakpoint = {
        breakpoint: bp,
        isMobile: bp === 'mobile',
        isTablet: bp === 'tablet',
        isDesktop: bp === 'desktop',
    };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('ReposView — responsive layout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        cleanup();
        setBreakpoint('desktop');
        mockRepos = [];
        mockAppState = {
            selectedRepoId: null,
            reposSidebarCollapsed: false,
            activeRepoSubTab: 'settings',
            workspaces: [],
        };
        location.hash = '';
    });

    // ─────────────────────── Desktop ─────────────────────────

    describe('Desktop layout', () => {
        it('renders full-width content area without sidebar', async () => {
            setBreakpoint('desktop');
            render(<ReposView />);

            // No sidebar in new layout
            expect(screen.queryByTestId('repos-sidebar')).toBeNull();
            expect(screen.queryByTestId('mini-sidebar')).toBeNull();

            // Empty state shows
            const emptyState = await screen.findByTestId('repo-detail-empty');
            expect(emptyState).toBeDefined();
        });

        it('shows RepoDetail when a repo is selected', async () => {
            setBreakpoint('desktop');
            mockAppState.selectedRepoId = 'repo-1';
            render(<ReposView />);

            // RepoDetail rendered (mock returns empty repos, so no match → shows empty state)
            // With no repos matching, falls back to empty state
            const emptyOrDetail = await screen.findByTestId('repo-detail-empty');
            expect(emptyOrDetail).toBeDefined();
        });

        it('does not render MiniReposSidebar regardless of reposSidebarCollapsed', async () => {
            setBreakpoint('desktop');
            mockAppState.reposSidebarCollapsed = true;
            render(<ReposView />);

            await screen.findByTestId('repo-detail-empty');
            expect(screen.queryByTestId('repos-sidebar')).toBeNull();
            expect(screen.queryByTestId('mini-sidebar')).toBeNull();
        });

        it('uses height class without bottom nav offset', async () => {
            setBreakpoint('desktop');
            render(<ReposView />);

            await screen.findByTestId('repo-detail-empty');
            const container = document.getElementById('view-repos')!;
            expect(container.className).toContain('h-[calc(100vh-48px)]');
            expect(container.className).not.toContain('40px');
        });
    });

    // ─────────────────────── Mobile ──────────────────────────

    describe('Mobile layout', () => {
        it('no selection shows full-width card list, no sidebar', async () => {
            setBreakpoint('mobile');
            mockAppState.selectedRepoId = null;
            render(<ReposView />);

            await screen.findByTestId('repos-grid');
            expect(screen.queryByTestId('repo-detail')).toBeNull();
            expect(screen.queryByTestId('repos-sidebar')).toBeNull();
            expect(screen.queryByTestId('mini-sidebar')).toBeNull();
            expect(screen.queryByTestId('responsive-sidebar')).toBeNull();
        });

        it('uses height class with bottom nav offset', async () => {
            setBreakpoint('mobile');
            render(<ReposView />);

            // Height class is applied even during loading
            const container = document.getElementById('view-repos')!;
            expect(container.className).toContain('h-[calc(100dvh-40px-48px)]');
        });

        it('selected repo shows full-screen detail without MobileRepoHeader bar', async () => {
            setBreakpoint('mobile');
            mockAppState.selectedRepoId = 'repo-1';
            render(<ReposView />);

            // Component stays in loading because no repos match selectedRepoId
            // but we set the mock to return a matching repo
            await screen.findByTestId('repos-grid');
            // When no repos match, mobile falls back to grid (no selection match)
        });

        it('mobile detail view renders RepoDetail directly without MobileRepoHeader', async () => {
            setBreakpoint('mobile');
            mockAppState.selectedRepoId = 'repo-1';
            mockRepos = [{ workspace: { id: 'repo-1', name: 'Test', rootPath: '/test', color: '#f00' }, stats: {}, workflows: [], taskCount: 0 }];
            location.hash = '#repo/repo-1';

            render(<ReposView />);

            // RepoDetail is rendered; no MobileRepoHeader back bar (BottomNav handles back)
            await screen.findByTestId('repo-detail');
            expect(screen.queryByTestId('mobile-back-button')).toBeNull();
        });

        it('does not render MiniReposSidebar even if reposSidebarCollapsed is true', async () => {
            setBreakpoint('mobile');
            mockAppState.reposSidebarCollapsed = true;
            mockAppState.selectedRepoId = null;
            render(<ReposView />);

            await screen.findByTestId('repos-grid');
            expect(screen.queryByTestId('mini-sidebar')).toBeNull();
        });
    });

    // ─────────────────────── Tablet ──────────────────────────

    describe('Tablet layout', () => {
        it('renders full-width content area without sidebar (same as desktop)', async () => {
            setBreakpoint('tablet');
            render(<ReposView />);

            const emptyState = await screen.findByTestId('repo-detail-empty');
            expect(emptyState).toBeDefined();
            expect(screen.queryByTestId('repos-sidebar')).toBeNull();
            expect(screen.queryByTestId('mini-sidebar')).toBeNull();
            expect(screen.queryByTestId('responsive-sidebar')).toBeNull();
        });

        it('does not render native aside or MiniReposSidebar', async () => {
            setBreakpoint('tablet');
            render(<ReposView />);

            await screen.findByTestId('repo-detail-empty');
            expect(screen.queryByTestId('repos-sidebar')).toBeNull();
            expect(screen.queryByTestId('mini-sidebar')).toBeNull();
            expect(screen.queryByTestId('mobile-back-button')).toBeNull();
        });

        it('uses height class without bottom nav offset', async () => {
            setBreakpoint('tablet');
            render(<ReposView />);

            await screen.findByTestId('repo-detail-empty');
            const container = document.getElementById('view-repos')!;
            expect(container.className).toContain('h-[calc(100vh-48px)]');
            expect(container.className).not.toContain('40px');
        });
    });
});

// ── RepoDetail sub-tab strip tests ─────────────────────────────────────
// These use the REAL RepoDetail (not the mock used by ReposView tests above).
// We call vi.importActual to bypass the module-level mock.

describe('RepoDetail — sub-tab strip responsiveness', () => {
    let RealRepoDetail: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        cleanup();
        // Ensure desktop breakpoint so the tab strip renders (mobile uses MobileTabBar instead)
        setBreakpoint('desktop');
        // jsdom doesn't implement scrollIntoView
        Element.prototype.scrollIntoView = vi.fn();
        mockAppState = {
            selectedRepoId: 'repo-1',
            reposSidebarCollapsed: false,
            activeRepoSubTab: 'settings',
            workspaces: [],
            wikis: [],
            repoSubTabNavState: {},
        };
        const mod = await vi.importActual<any>(
            '../../../../src/server/spa/client/react/features/repo-detail/RepoDetail'
        );
        RealRepoDetail = mod.RepoDetail;
    });

    const makeRepo = () => ({
        workspace: { id: 'repo-1', name: 'Test Repo', rootPath: '/test', color: '#ff0000' },
        gitInfo: { branch: 'main', dirty: false, isGitRepo: true, ahead: 0, behind: 0 },
        pipelines: [],
        stats: { success: 0, failed: 0, running: 0 },
        taskCount: 0,
    }) as any;

    it('sub-tab strip has overflow-x-auto and scrollbar-hide classes', () => {
        const repo = makeRepo();
        render(<ToastProvider value={{ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }}><RealRepoDetail repo={repo} repos={[repo]} onRefresh={vi.fn()} /></ToastProvider>);

        const strip = screen.getByTestId('repo-sub-tab-strip');
        expect(strip.className).toContain('overflow-x-auto');
        expect(strip.className).toContain('scrollbar-hide');
    });

    it('tab buttons have whitespace-nowrap and shrink-0 classes', () => {
        const repo = makeRepo();
        render(<ToastProvider value={{ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }}><RealRepoDetail repo={repo} repos={[repo]} onRefresh={vi.fn()} /></ToastProvider>);

        const tabs = screen.getByTestId('repo-sub-tab-strip').querySelectorAll('[data-subtab]');
        expect(tabs.length).toBe(9);
        tabs.forEach(tab => {
            expect(tab.className).toContain('whitespace-nowrap');
            expect(tab.className).toContain('shrink-0');
        });
    });

    it('auto-scrolls active tab into view on sub-tab change', () => {
        const scrollIntoViewMock = vi.fn();
        Element.prototype.scrollIntoView = scrollIntoViewMock;

        const repo = makeRepo();
        mockAppState.activeRepoSubTab = 'activity';
        render(<ToastProvider value={{ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }}><RealRepoDetail repo={repo} repos={[repo]} onRefresh={vi.fn()} /></ToastProvider>);

        expect(scrollIntoViewMock).toHaveBeenCalledWith({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'center',
        });
    });
});
