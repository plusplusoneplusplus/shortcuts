import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AppProvider, appReducer } from '../../../src/server/spa/client/react/contexts/AppContext';
import { NotificationProvider } from '../../../src/server/spa/client/react/contexts/NotificationContext';
import { ThemeProvider } from '../../../src/server/spa/client/react/layout/ThemeProvider';
import * as TopBarModule from '../../../src/server/spa/client/react/layout/TopBar';
import { TopBar, SHOW_MEMORY_TAB } from '../../../src/server/spa/client/react/layout/TopBar';
import type { DashboardTab } from '../../../src/server/spa/client/react/types/dashboard';

vi.mock('../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => ({ repos: [], unseenCounts: {}, fetchRepos: vi.fn(), loading: false }),
    ReposProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    QueueProvider: ({ children }: any) => children,
    useQueue: () => ({ state: { repoQueueMap: {}, queued: [], running: [], history: [] }, dispatch: vi.fn() }),
}));

vi.mock('../../../src/server/spa/client/react/shared/AgentProviderQuotaIndicator', () => ({
    agentProviderQuotaIndicator: () => null,
}));

vi.mock('../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ breakpoint: 'mobile', isMobile: true, isTablet: false, isDesktop: false }),
}));

let mockMyWorkEnabled = false;
vi.mock('../../../src/server/spa/client/react/hooks/feature-flags/useMyWorkEnabled', () => ({
    useMyWorkEnabled: () => mockMyWorkEnabled,
}));

let mockMyLifeEnabled = false;
vi.mock('../../../src/server/spa/client/react/hooks/feature-flags/useMyLifeEnabled', () => ({
    useMyLifeEnabled: () => mockMyLifeEnabled,
}));

beforeEach(() => {
    location.hash = '';
    mockMyWorkEnabled = false;
    mockMyLifeEnabled = false;
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    });
});

afterEach(() => {
    location.hash = '';
});

function renderTopBar() {
    return render(
        <AppProvider>
            <NotificationProvider>
                <ThemeProvider>
                    <TopBar />
                </ThemeProvider>
            </NotificationProvider>
        </AppProvider>
    );
}

// ─── Top-level tabs ─────────────────────────────────────────────

describe('TopBar top-level tabs', () => {
    it('exports no top-level text tab list', () => {
        expect(TopBarModule).not.toHaveProperty('TABS');
        expect(TopBarModule).not.toHaveProperty('ALL_TABS');
        expect(TopBarModule).not.toHaveProperty('SHOW_WIKI_TAB');
    });

    it('SHOW_MEMORY_TAB is false (memory view remains direct-route only)', () => {
        expect(SHOW_MEMORY_TAB).toBe(false);
    });
});

// ─── TopBar rendering ───────────────────────────────────────────

describe('TopBar', () => {

    it('renders the dashboard title as a link to the root page', () => {
        renderTopBar();
        const titles = screen.getAllByText('CoC');
        const anchorTitles = titles.filter(el => el.tagName === 'A');
        expect(anchorTitles.length).toBeGreaterThan(0);
        const title = anchorTitles[0];
        expect((title as HTMLAnchorElement).href).toContain('/');
        expect((title as HTMLAnchorElement).target).not.toBe('_blank');
    });

    it('renders hamburger button', () => {
        renderTopBar();
        expect(document.getElementById('hamburger-btn')).toBeDefined();
    });

    it('hamburger toggles popover open/closed on Repos tab (popover local state)', () => {
        renderTopBar();
        const btn = document.getElementById('hamburger-btn')!;
        // Initially on repos tab, popover is closed
        expect(btn.getAttribute('aria-pressed')).toBe('false');

        act(() => {
            fireEvent.click(btn);
        });
        expect(btn.getAttribute('aria-pressed')).toBe('true');

        act(() => {
            fireEvent.click(btn);
        });
        expect(btn.getAttribute('aria-pressed')).toBe('false');
    });

    it('renders theme toggle button', () => {
        renderTopBar();
        expect(screen.getByLabelText('Toggle theme')).toBeDefined();
    });

    it('renders admin link', () => {
        renderTopBar();
        expect(screen.getByLabelText('Admin')).toBeDefined();
    });

    it('does not render the legacy Tools dropdown trigger', () => {
        renderTopBar();
        expect(document.getElementById('tools-toggle')).toBeNull();
        expect(document.getElementById('tools-popover')).toBeNull();
    });

    it('does not render Skills/Logs/Stats/Models/Servers items directly in the topbar', () => {
        renderTopBar();
        // These rows now live in the Admin page's left-panel "Tools" group
        // (see AdminPanel.tsx). The topbar should not include them.
        expect(document.getElementById('skills-toggle')).toBeNull();
        expect(document.getElementById('logs-toggle')).toBeNull();
        expect(document.getElementById('stats-toggle')).toBeNull();
        expect(document.getElementById('models-toggle')).toBeNull();
        expect(document.getElementById('servers-toggle')).toBeNull();
    });
});

// ─── TopBar active tab styling ──────────────────────────────────

describe('TopBar — active tab styling', () => {
    it('renders no text tab bar', () => {
        renderTopBar();
        expect(document.getElementById('tab-bar')).toBeNull();
    });
});

// ─── AppContext reducer — SET_ACTIVE_TAB ─────────────────────────

describe('appReducer — SET_ACTIVE_TAB for top tabs', () => {
    const baseState = {
        activeTab: 'repos' as DashboardTab,
        selectedProcessId: null,
        selectedRepoId: null,
        repoSubTab: 'info' as const,
        reposSidebarCollapsed: false,
        repos: [],
        processes: [],
        repoFilter: '',
    };

    it('switches to processes', () => {
        const result = appReducer(baseState, { type: 'SET_ACTIVE_TAB', tab: 'processes' });
        expect(result.activeTab).toBe('processes');
    });

    it('switches to memory', () => {
        const result = appReducer(baseState, { type: 'SET_ACTIVE_TAB', tab: 'memory' });
        expect(result.activeTab).toBe('memory');
    });

    it('switches to repos', () => {
        const fromProcesses = { ...baseState, activeTab: 'processes' as DashboardTab };
        const result = appReducer(fromProcesses, { type: 'SET_ACTIVE_TAB', tab: 'repos' });
        expect(result.activeTab).toBe('repos');
    });

    it('switches to admin', () => {
        const result = appReducer(baseState, { type: 'SET_ACTIVE_TAB', tab: 'admin' });
        expect(result.activeTab).toBe('admin');
    });

    it('switches to reports', () => {
        const result = appReducer(baseState, { type: 'SET_ACTIVE_TAB', tab: 'reports' });
        expect(result.activeTab).toBe('reports');
    });
});

// ─── TopBar connection status indicator ─────────────────────────

describe('TopBar — connection status indicator', () => {
    it('renders the ws-status-indicator pill in the mobile topbar', () => {
        renderTopBar();
        expect(screen.getByTestId('ws-status-indicator')).toBeDefined();
    });

    it('shows "Disconnected" label by default (initial wsStatus is closed)', () => {
        renderTopBar();
        const indicator = screen.getByTestId('ws-status-indicator');
        // The tooltip headlines with the status label, then appends the backend
        // endpoint detail (host/API/WS), so match the leading label line.
        expect((indicator.getAttribute('title') ?? '').split('\n')[0]).toBe('Disconnected');
        expect(indicator.getAttribute('aria-label')).toBe('Connection: Disconnected');
        expect(indicator.getAttribute('data-ws-status')).toBe('closed');
    });

    it('renders the status label text inside the pill', () => {
        renderTopBar();
        const label = screen.getByTestId('ws-status-label');
        expect(label.textContent).toBe('Disconnected');
    });

    it('shows red dot class for closed status', () => {
        renderTopBar();
        const indicator = screen.getByTestId('ws-status-indicator');
        const dot = indicator.querySelector('span[aria-hidden="true"]');
        expect(dot?.className).toContain('bg-[#f14c4c]');
        expect(dot?.className).not.toContain('animate-pulse');
    });

    it('renders a compact dot variant for mobile (md:hidden)', () => {
        renderTopBar();
        const mobile = screen.getByTestId('ws-status-indicator-mobile');
        expect(mobile.className).toContain('md:hidden');
    });

    it('pill carries hidden md:inline-flex classes (mobile uses dot variant)', () => {
        renderTopBar();
        const indicator = screen.getByTestId('ws-status-indicator');
        expect(indicator.className).toContain('hidden');
        expect(indicator.className).toContain('md:inline-flex');
    });
});

// ─── TopBar connection status via reducer ───────────────────────

describe('TopBar — connection status via AppContext reducer', () => {
    const reducerState = {
        activeTab: 'repos' as DashboardTab,
        selectedProcessId: null,
        selectedRepoId: null,
        repoSubTab: 'info' as const,
        reposSidebarCollapsed: false,
        repos: [],
        processes: [],
        repoFilter: '',
        wsStatus: 'closed' as const,
    };

    it('SET_WS_STATUS open produces Connected label', () => {
        const result = appReducer(reducerState, { type: 'SET_WS_STATUS', status: 'open' });
        expect(result.wsStatus).toBe('open');
    });

    it('SET_WS_STATUS connecting produces Reconnecting label', () => {
        const result = appReducer(reducerState, { type: 'SET_WS_STATUS', status: 'connecting' });
        expect(result.wsStatus).toBe('connecting');
    });
});

// ─── TopBar tool routes (migrated to Admin sidebar) ───────────────

describe('TopBar — Tools dropdown is removed', () => {
    it('does not render Skills/Logs/Stats/Models/Memory rows inside the topbar', () => {
        renderTopBar();
        expect(document.getElementById('skills-toggle')).toBeNull();
        expect(document.getElementById('logs-toggle')).toBeNull();
        expect(document.getElementById('stats-toggle')).toBeNull();
        expect(document.getElementById('models-toggle')).toBeNull();
        expect(document.getElementById('memory-toggle')).toBeNull();
    });

    it('SHOW_MEMORY_TAB remains false (memory view is direct-route only)', () => {
        expect(SHOW_MEMORY_TAB).toBe(false);
    });

});

// ─── TopBar My Work icon button ──────────────────────────────────

describe('TopBar — My Work icon button', () => {
    it('does not render my-work-toggle when myWorkEnabled is false', () => {
        mockMyWorkEnabled = false;
        renderTopBar();
        expect(document.getElementById('my-work-toggle')).toBeNull();
    });

    it('renders my-work-toggle when myWorkEnabled is true', () => {
        mockMyWorkEnabled = true;
        renderTopBar();
        const btn = document.getElementById('my-work-toggle');
        expect(btn).toBeTruthy();
        expect(btn!.getAttribute('aria-label')).toBe('My Work');
        expect(btn!.getAttribute('title')).toBe('My Work');
    });

    it('my-work-toggle has touch-target class', () => {
        mockMyWorkEnabled = true;
        renderTopBar();
        const btn = document.getElementById('my-work-toggle')!;
        expect(btn.className).toContain('touch-target');
    });

    it('clicking my-work-toggle navigates to My Work', () => {
        mockMyWorkEnabled = true;
        renderTopBar();
        act(() => {
            fireEvent.click(document.getElementById('my-work-toggle')!);
        });
        expect(location.hash).toBe('#repos/my_work/notes');
    });

    it('my-work-toggle is not active by default (no repo selected)', () => {
        mockMyWorkEnabled = true;
        renderTopBar();
        const btn = document.getElementById('my-work-toggle')!;
        expect(btn.className).not.toContain('bg-[#0078d4]');
        expect(btn.className).not.toContain('text-white');
    });

    it('my-work-toggle becomes active after clicking it', () => {
        mockMyWorkEnabled = true;
        renderTopBar();
        act(() => {
            fireEvent.click(document.getElementById('my-work-toggle')!);
        });
        const btn = document.getElementById('my-work-toggle')!;
        expect(btn.className).toContain('bg-[#0078d4]');
        expect(btn.className).toContain('text-white');
    });

    it('contains 💼 emoji', () => {
        mockMyWorkEnabled = true;
        renderTopBar();
        const btn = document.getElementById('my-work-toggle')!;
        expect(btn.textContent).toContain('💼');
    });
});

// ─── TopBar My Life icon button ──────────────────────────────────

describe('TopBar — My Life icon button', () => {
    it('does not render my-life-toggle when myLifeEnabled is false', () => {
        mockMyLifeEnabled = false;
        renderTopBar();
        expect(document.getElementById('my-life-toggle')).toBeNull();
    });

    it('renders my-life-toggle when myLifeEnabled is true', () => {
        mockMyLifeEnabled = true;
        renderTopBar();
        const btn = document.getElementById('my-life-toggle');
        expect(btn).toBeTruthy();
        expect(btn!.getAttribute('aria-label')).toBe('My Life');
        expect(btn!.getAttribute('title')).toBe('My Life');
    });

    it('my-life-toggle has touch-target class', () => {
        mockMyLifeEnabled = true;
        renderTopBar();
        const btn = document.getElementById('my-life-toggle')!;
        expect(btn.className).toContain('touch-target');
    });

    it('clicking my-life-toggle navigates to My Life', () => {
        mockMyLifeEnabled = true;
        renderTopBar();
        act(() => {
            fireEvent.click(document.getElementById('my-life-toggle')!);
        });
        expect(location.hash).toBe('#repos/my_life/notes');
    });

    it('my-life-toggle is not active by default (no repo selected)', () => {
        mockMyLifeEnabled = true;
        renderTopBar();
        const btn = document.getElementById('my-life-toggle')!;
        expect(btn.className).not.toContain('bg-[#0078d4]');
        expect(btn.className).not.toContain('text-white');
    });

    it('my-life-toggle becomes active after clicking it', () => {
        mockMyLifeEnabled = true;
        renderTopBar();
        act(() => {
            fireEvent.click(document.getElementById('my-life-toggle')!);
        });
        const btn = document.getElementById('my-life-toggle')!;
        expect(btn.className).toContain('bg-[#0078d4]');
        expect(btn.className).toContain('text-white');
    });

    it('contains 🏠 emoji', () => {
        mockMyLifeEnabled = true;
        renderTopBar();
        const btn = document.getElementById('my-life-toggle')!;
        expect(btn.textContent).toContain('🏠');
    });
});

// ─── TopBar servers entry (migrated to Admin sidebar) ─────────────

describe('TopBar — servers row no longer rendered in topbar', () => {
    afterEach(() => {
        delete (window as any).__DASHBOARD_CONFIG__;
    });

    it('does not render servers-toggle in the topbar regardless of serversEnabled', () => {
        (window as any).__DASHBOARD_CONFIG__ = {
            apiBasePath: '/api',
            wsPath: '/ws',
            serversEnabled: true,
        };
        renderTopBar();
        expect(document.getElementById('servers-toggle')).toBeNull();
    });

    it('admin-toggle remains a top-level button', () => {
        (window as any).__DASHBOARD_CONFIG__ = {
            apiBasePath: '/api',
            wsPath: '/ws',
            serversEnabled: true,
        };
        renderTopBar();
        const admin = document.getElementById('admin-toggle')!;
        expect(admin).toBeTruthy();
    });
});

// ─── TopBar brand label behavior ─────────────────────────────────

describe('TopBar — brand label navigates to repos (not My Work)', () => {
    it('clicking brand label sets hash to #repos', () => {
        mockMyWorkEnabled = true;
        renderTopBar();
        const brandLink = document.querySelector('[data-tab="repos"]') as HTMLAnchorElement;
        act(() => {
            fireEvent.click(brandLink);
        });
        expect(location.hash).toBe('#repos');
    });

    it('clicking brand label does not navigate to My Work workspace', () => {
        mockMyWorkEnabled = true;
        renderTopBar();
        const brandLink = document.querySelector('[data-tab="repos"]') as HTMLAnchorElement;
        act(() => {
            fireEvent.click(brandLink);
        });
        expect(location.hash).not.toContain('my_work');
    });
});
