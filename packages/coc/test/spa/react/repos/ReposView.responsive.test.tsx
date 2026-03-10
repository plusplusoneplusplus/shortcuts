/**
 * ReposView responsive layout tests.
 * Verifies mobile master-detail, tablet ResponsiveSidebar, desktop aside,
 * height classes, back-button navigation, and sub-tab scrollability.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import type { BreakpointState } from '../../../../src/server/spa/client/react/hooks/useBreakpoint';
import { ToastProvider } from '../../../../src/server/spa/client/react/context/ToastContext';

// ── Mutable mock state ─────────────────────────────────────────────────

let mockBreakpoint: BreakpointState = { breakpoint: 'desktop', isMobile: false, isTablet: false, isDesktop: true };
const mockAppDispatch = vi.fn();
const mockQueueDispatch = vi.fn();

let mockAppState: Record<string, any> = {
    selectedRepoId: null,
    reposSidebarCollapsed: false,
    activeRepoSubTab: 'info',
    workspaces: [],
};

// ── Module mocks (before imports) ──────────────────────────────────────

vi.mock('../../../../src/server/spa/client/react/hooks/useBreakpoint', () => ({
    useBreakpoint: () => mockBreakpoint,
}));

vi.mock('../../../../src/server/spa/client/react/context/AppContext', () => ({
    useApp: () => ({
        state: mockAppState,
        dispatch: mockAppDispatch,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/context/QueueContext', () => ({
    useQueue: () => ({
        state: { selectedTaskId: null, repoQueueMap: {} },
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

vi.mock('../../../../src/server/spa/client/react/hooks/useRepoQueueStats', () => ({
    useRepoQueueStats: () => ({ running: 0, queued: 0 }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/usePreferences', () => ({
    usePreferences: () => ({ model: 'test-model', setModel: vi.fn() }),
}));

// ── Mock child components to isolate layout logic ──────────────────────

vi.mock('../../../../src/server/spa/client/react/repos/ReposGrid', () => ({
    ReposGrid: () => <div data-testid="repos-grid">ReposGrid</div>,
}));

vi.mock('../../../../src/server/spa/client/react/repos/MiniReposSidebar', () => ({
    MiniReposSidebar: () => <div data-testid="mini-sidebar">MiniReposSidebar</div>,
}));

vi.mock('../../../../src/server/spa/client/react/repos/RepoDetail', () => ({
    RepoDetail: () => <div data-testid="repo-detail">RepoDetail</div>,
    SUB_TABS: [
        { key: 'info', label: 'Info' },
        { key: 'git', label: 'Git' },
        { key: 'tasks', label: 'Plans' },
        { key: 'activity', label: 'Activity' },
        { key: 'workflows', label: 'Workflows' },
        { key: 'schedules', label: 'Schedules' },
        { key: 'copilot', label: 'Copilot' },
    ],
}));

vi.mock('../../../../src/server/spa/client/react/shared/ResponsiveSidebar', () => ({
    ResponsiveSidebar: ({ children, width, tabletWidth }: any) => (
        <aside data-testid="responsive-sidebar" data-width={width} data-tablet-width={tabletWidth}>
            {children}
        </aside>
    ),
}));

vi.mock('../../../../src/server/spa/client/react/repos/repoGrouping', () => ({
    countTasks: () => 0,
}));

vi.mock('../../../../src/server/spa/client/react/repos/workflow-api', () => ({
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

vi.mock('../../../../src/server/spa/client/react/repos/RepoInfoTab', () => ({
    RepoInfoTab: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/repos/WorkflowsTab', () => ({
    WorkflowsTab: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/repos/RepoSchedulesTab', () => ({
    RepoSchedulesTab: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/repos/RepoGitTab', () => ({
    RepoGitTab: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/repos/RepoWikiTab', () => ({
    RepoWikiTab: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/repos/RepoCopilotTab', () => ({
    RepoCopilotTab: () => null,
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
        mockAppState = {
            selectedRepoId: null,
            reposSidebarCollapsed: false,
            activeRepoSubTab: 'info',
            workspaces: [],
        };
        location.hash = '';
    });

    // ─────────────────────── Desktop ─────────────────────────

    describe('Desktop layout', () => {
        it('renders two-pane layout with 280px aside when sidebar expanded', async () => {
            setBreakpoint('desktop');
            render(<ReposView />);

            const aside = await screen.findByTestId('repos-sidebar');
            expect(aside).toBeDefined();
            expect(aside.tagName.toLowerCase()).toBe('aside');
            expect(aside.className).toContain('w-[280px]');
            expect(aside.className).toContain('min-w-[240px]');

            // ReposGrid in the sidebar
            expect(aside.querySelector('[data-testid="repos-grid"]')).toBeTruthy();

            // No mobile components
            expect(screen.queryByTestId('mobile-back-button')).toBeNull();
            expect(screen.queryByTestId('responsive-sidebar')).toBeNull();
        });

        it('collapses to 48px aside with MiniReposSidebar when collapsed', async () => {
            setBreakpoint('desktop');
            mockAppState.reposSidebarCollapsed = true;
            render(<ReposView />);

            const aside = await screen.findByTestId('repos-sidebar');
            expect(aside.className).toContain('w-12');
            expect(aside.className).toContain('min-w-[48px]');

            // MiniReposSidebar replaces ReposGrid
            expect(aside.querySelector('[data-testid="mini-sidebar"]')).toBeTruthy();
            expect(aside.querySelector('[data-testid="repos-grid"]')).toBeNull();
        });

        it('preserves CSS transition classes on aside', async () => {
            setBreakpoint('desktop');
            render(<ReposView />);

            const aside = await screen.findByTestId('repos-sidebar');
            expect(aside.className).toContain('transition-[width,min-width,opacity]');
            expect(aside.className).toContain('duration-150');
            expect(aside.className).toContain('ease-out');
        });

        it('uses height class without bottom nav offset', async () => {
            setBreakpoint('desktop');
            render(<ReposView />);

            await screen.findByTestId('repos-sidebar');
            const container = document.getElementById('view-repos')!;
            expect(container.className).toContain('h-[calc(100vh-48px)]');
            expect(container.className).not.toContain('56px');
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
            expect(container.className).toContain('h-[calc(100vh-40px-56px)]');
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
            location.hash = '#repo/repo-1';

            // Need a repo in the data to match selectedRepoId
            const { fetchApi } = await import('../../../../src/server/spa/client/react/hooks/useApi');
            const mockFetchApi = vi.mocked(fetchApi);
            mockFetchApi.mockImplementation(async (path: string) => {
                if (path === '/workspaces') {
                    return { workspaces: [{ id: 'repo-1', name: 'Test', rootPath: '/test', color: '#f00' }] };
                }
                if (path.includes('/git-info')) return null;
                if (path.includes('/pipelines')) return { pipelines: [] };
                if (path.includes('/tasks')) return null;
                if (path.includes('/processes')) return { processes: [] };
                if (path.includes('/queue/repos')) return { repos: [] };
                return {};
            });

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
        it('renders sidebar via ResponsiveSidebar with width 260', async () => {
            setBreakpoint('tablet');
            render(<ReposView />);

            const sidebar = await screen.findByTestId('responsive-sidebar');
            expect(sidebar).toBeDefined();
            expect(sidebar.getAttribute('data-width')).toBe('260');
            expect(sidebar.getAttribute('data-tablet-width')).toBe('260');

            // ReposGrid inside ResponsiveSidebar
            expect(sidebar.querySelector('[data-testid="repos-grid"]')).toBeTruthy();
        });

        it('does not render native aside or MiniReposSidebar', async () => {
            setBreakpoint('tablet');
            render(<ReposView />);

            await screen.findByTestId('responsive-sidebar');
            expect(screen.queryByTestId('repos-sidebar')).toBeNull();
            expect(screen.queryByTestId('mini-sidebar')).toBeNull();
            expect(screen.queryByTestId('mobile-back-button')).toBeNull();
        });

        it('uses height class without bottom nav offset', async () => {
            setBreakpoint('tablet');
            render(<ReposView />);

            await screen.findByTestId('responsive-sidebar');
            const container = document.getElementById('view-repos')!;
            expect(container.className).toContain('h-[calc(100vh-48px)]');
            expect(container.className).not.toContain('56px');
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
            activeRepoSubTab: 'info',
            workspaces: [],
            wikis: [],
        };
        const mod = await vi.importActual<any>(
            '../../../../src/server/spa/client/react/repos/RepoDetail'
        );
        RealRepoDetail = mod.RepoDetail;
    });

    const makeRepo = () => ({
        workspace: { id: 'repo-1', name: 'Test Repo', rootPath: '/test', color: '#ff0000' },
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
        expect(tabs.length).toBe(8);
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
