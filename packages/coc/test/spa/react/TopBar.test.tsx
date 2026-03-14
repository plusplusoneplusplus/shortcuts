import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AppProvider, appReducer } from '../../../src/server/spa/client/react/context/AppContext';
import { NotificationProvider } from '../../../src/server/spa/client/react/context/NotificationContext';
import { ThemeProvider } from '../../../src/server/spa/client/react/layout/ThemeProvider';
import { TopBar, TABS, ALL_TABS, SHOW_WIKI_TAB } from '../../../src/server/spa/client/react/layout/TopBar';
import type { DashboardTab } from '../../../src/server/spa/client/react/types/dashboard';

vi.mock('../../../src/server/spa/client/react/context/ReposContext', () => ({
    useRepos: () => ({ repos: [], unseenCounts: {}, fetchRepos: vi.fn(), loading: false }),
    ReposProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../../src/server/spa/client/react/context/QueueContext', () => ({
    QueueProvider: ({ children }: any) => children,
    useQueue: () => ({ state: { repoQueueMap: {}, queued: [], running: [], history: [] }, dispatch: vi.fn() }),
}));

vi.mock('../../../src/server/spa/client/react/hooks/useBreakpoint', () => ({
    useBreakpoint: () => ({ breakpoint: 'desktop', isMobile: false, isTablet: false, isDesktop: true }),
}));

beforeEach(() => {
    location.hash = '';
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

// ─── TABS constant ──────────────────────────────────────────────

describe('TABS constant', () => {
    it('contains only non-repos entries (repos is now implicit default)', () => {
        const labels = TABS.map(t => t.label);
        expect(labels).not.toContain('Repos');
        expect(labels).not.toContain('Memory');
    });

    it('has matching tab identifiers', () => {
        const tabs = TABS.map(t => t.tab);
        expect(tabs).not.toContain('repos');
        expect(tabs).not.toContain('memory');
    });

    it('has 0 entries (repos removed as implicit default, wiki hidden by flag)', () => {
        expect(TABS).toHaveLength(0);
    });

    it('SHOW_WIKI_TAB is false (wiki hidden but available in ALL_TABS)', () => {
        expect(SHOW_WIKI_TAB).toBe(false);
    });

    it('ALL_TABS includes wiki entry but not skills (skills moved to icon button)', () => {
        const tabs = ALL_TABS.map(t => t.tab);
        expect(tabs).toContain('wiki');
        expect(tabs).not.toContain('skills');
        expect(tabs).not.toContain('repos');
        expect(ALL_TABS).toHaveLength(1);
    });

    it('TABS excludes wiki when SHOW_WIKI_TAB is false', () => {
        const tabs = TABS.map(t => t.tab);
        expect(tabs).not.toContain('wiki');
    });
});

// ─── TopBar rendering ───────────────────────────────────────────

describe('TopBar', () => {
    it('renders all tab buttons', () => {
        renderTopBar();
        for (const { label } of TABS) {
            expect(screen.getByText(label)).toBeDefined();
        }
    });

    it('renders the dashboard title as a link to the GitHub repo', () => {
        renderTopBar();
        const title = screen.getByText('CoC (Copilot Of Copilot)');
        expect(title).toBeDefined();
        expect(title.tagName).toBe('A');
        expect((title as HTMLAnchorElement).href).toContain('github.com/plusplusoneplusplus/shortcuts');
        expect((title as HTMLAnchorElement).target).toBe('_blank');
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

    it('hamburger is noop outside Repos tab (aria-pressed stays false)', () => {
        renderTopBar();
        act(() => {
            fireEvent.click(document.getElementById('processes-toggle')!);
        });

        const btn = document.getElementById('hamburger-btn')!;
        expect(btn.getAttribute('aria-pressed')).toBe('false');

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

    it('each tab button has data-tab attribute', () => {
        renderTopBar();
        for (const { tab } of TABS) {
            const btn = screen.getByRole('button', { name: TABS.find(t => t.tab === tab)!.label });
            expect(btn.getAttribute('data-tab')).toBe(tab);
        }
    });
});

// ─── TopBar tab click → hash update ─────────────────────────────

describe('TopBar — tab click updates location.hash', () => {
    it('sets hash to #processes when Processes icon button is clicked', () => {
        renderTopBar();
        act(() => {
            fireEvent.click(document.getElementById('processes-toggle')!);
        });
        expect(location.hash).toBe('#processes');
    });

    it('sets hash to #repos is no longer applicable (repos is implicit default)', () => {
        // Repos has no tab button — navigating away from a detail page clears the hash
        expect(ALL_TABS.map(t => t.tab)).not.toContain('repos');
    });

    it('sets hash to #memory when Memory icon button is clicked', () => {
        renderTopBar();
        act(() => {
            fireEvent.click(document.getElementById('memory-toggle')!);
        });
        expect(location.hash).toBe('#memory');
    });

    it('clicking the same icon tab still sets the hash', () => {
        location.hash = '#processes';
        renderTopBar();
        act(() => {
            fireEvent.click(document.getElementById('processes-toggle')!);
        });
        expect(location.hash).toBe('#processes');
    });

    it('clicking icon tabs in sequence updates hash each time', () => {
        renderTopBar();
        act(() => { fireEvent.click(document.getElementById('skills-toggle')!); });
        expect(location.hash).toBe('#skills');

        act(() => { fireEvent.click(document.getElementById('processes-toggle')!); });
        expect(location.hash).toBe('#processes');

        act(() => { fireEvent.click(document.getElementById('memory-toggle')!); });
        expect(location.hash).toBe('#memory');
    });
});

// ─── TopBar active tab styling ──────────────────────────────────

describe('TopBar — active tab styling', () => {
    it('default active tab (repos) does not show active class on any text tab (repos has no button)', () => {
        renderTopBar();
        // Repos is the default tab but has no nav button; no text tab should be highlighted
        const tabBar = document.getElementById('tab-bar');
        expect(tabBar).toBeNull(); // nav is hidden when TABS is empty
    });

    it('non-active icon tabs do not have active class', () => {
        renderTopBar();
        const processesBtn = document.getElementById('processes-toggle')!;
        expect(processesBtn.className).not.toContain('bg-[#0078d4]');
    });

    it('memory icon button becomes active when clicked', () => {
        renderTopBar();
        act(() => {
            fireEvent.click(document.getElementById('memory-toggle')!);
        });
        const memoryBtn = document.getElementById('memory-toggle')!;
        expect(memoryBtn.className).toContain('bg-[#0078d4]');
        expect(memoryBtn.className).toContain('text-white');
    });

    it('active icon tab loses active class after clicking another icon', () => {
        renderTopBar();
        act(() => {
            fireEvent.click(document.getElementById('processes-toggle')!);
        });
        const memoryBtn = document.getElementById('memory-toggle')!;
        expect(memoryBtn.className).not.toContain('bg-[#0078d4]');
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
        selectedWikiId: null,
        selectedWikiComponentId: null,
        wikiView: 'list' as const,
        wikiDetailInitialTab: null,
        wikiDetailInitialAdminTab: null,
        wikiAutoGenerate: false,
        wikis: [],
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
    it('renders the ws-status-indicator element', () => {
        renderTopBar();
        expect(screen.getByTestId('ws-status-indicator')).toBeDefined();
    });

    it('shows "Disconnected" label by default (initial wsStatus is closed)', () => {
        renderTopBar();
        const indicator = screen.getByTestId('ws-status-indicator');
        expect(indicator.getAttribute('title')).toBe('Disconnected');
        expect(indicator.getAttribute('aria-label')).toBe('Connection: Disconnected');
    });

    it('shows red dot class for closed status', () => {
        renderTopBar();
        const indicator = screen.getByTestId('ws-status-indicator');
        const dot = indicator.querySelector('span');
        expect(dot?.className).toContain('bg-[#f14c4c]');
        expect(dot?.className).not.toContain('animate-pulse');
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
        selectedWikiId: null,
        selectedWikiComponentId: null,
        wikiView: 'list' as const,
        wikiDetailInitialTab: null,
        wikiDetailInitialAdminTab: null,
        wikiAutoGenerate: false,
        wikis: [],
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

// ─── tabFromHash round-trip with TopBar tabs ─────────────────────

describe('TopBar tab → hash → tabFromHash round-trip', () => {
    // Import tabFromHash to verify the hash values TopBar produces are parseable
    it('all TopBar tab hashes are recognized by tabFromHash', async () => {
        const { tabFromHash } = await import('../../../src/server/spa/client/react/layout/Router');
        for (const { tab } of TABS) {
            const hash = '#' + tab;
            expect(tabFromHash(hash)).toBe(tab);
        }
    });
});

// ─── TopBar logs icon button ─────────────────────────────────────

describe('TopBar — logs icon button', () => {
    it('renders a logs-toggle button', () => {
        renderTopBar();
        expect(document.getElementById('logs-toggle')).toBeTruthy();
    });

    it('logs-toggle has aria-label and title "Logs"', () => {
        renderTopBar();
        const btn = document.getElementById('logs-toggle')!;
        expect(btn.getAttribute('aria-label')).toBe('Logs');
        expect(btn.getAttribute('title')).toBe('Logs');
    });

    it('logs-toggle has touch-target class', () => {
        renderTopBar();
        const btn = document.getElementById('logs-toggle')!;
        expect(btn.className).toContain('touch-target');
    });

    it('clicking logs-toggle calls onLogsOpen prop', () => {
        const onLogsOpen = vi.fn();
        render(
            <AppProvider>
                <NotificationProvider>
                    <ThemeProvider>
                        <TopBar onLogsOpen={onLogsOpen} />
                    </ThemeProvider>
                </NotificationProvider>
            </AppProvider>
        );
        act(() => {
            fireEvent.click(document.getElementById('logs-toggle')!);
        });
        expect(onLogsOpen).toHaveBeenCalledOnce();
    });

    it('logs-toggle never shows active style (logs is now a dialog, not a tab)', () => {
        renderTopBar();
        const btn = document.getElementById('logs-toggle')!;
        expect(btn.className).not.toContain('bg-[#0078d4]');
        expect(btn.className).not.toContain('text-white');
    });

    it('logs-toggle does not show active style regardless of active tab', () => {
        renderTopBar();
        const btn = document.getElementById('logs-toggle')!;
        expect(btn.className).not.toContain('bg-[#0078d4]');
    });

    it('"Logs" text tab is not rendered in the main nav', () => {
        renderTopBar();
        const tabs = TABS.map(t => t.label);
        expect(tabs).not.toContain('Logs');
    });
});

// ─── TopBar skills icon button ───────────────────────────────────

describe('TopBar — skills icon button', () => {
    it('renders a skills-toggle button', () => {
        renderTopBar();
        expect(document.getElementById('skills-toggle')).toBeTruthy();
    });

    it('skills-toggle has aria-label and title "Skills"', () => {
        renderTopBar();
        const btn = document.getElementById('skills-toggle')!;
        expect(btn.getAttribute('aria-label')).toBe('Skills');
        expect(btn.getAttribute('title')).toBe('Skills');
    });

    it('skills-toggle has touch-target class', () => {
        renderTopBar();
        const btn = document.getElementById('skills-toggle')!;
        expect(btn.className).toContain('touch-target');
    });

    it('skills-toggle shows active style when activeTab is skills', () => {
        renderTopBar();
        act(() => {
            fireEvent.click(document.getElementById('skills-toggle')!);
        });
        const btn = document.getElementById('skills-toggle')!;
        expect(btn.className).toContain('bg-[#0078d4]');
        expect(btn.className).toContain('text-white');
    });

    it('skills-toggle does not show active style when another tab is active', () => {
        renderTopBar();
        const btn = document.getElementById('skills-toggle')!;
        expect(btn.className).not.toContain('bg-[#0078d4]');
    });

    it('"Skills" text tab is not rendered in the main nav', () => {
        renderTopBar();
        const tabs = TABS.map(t => t.label);
        expect(tabs).not.toContain('Skills');
    });

    it('clicking skills-toggle sets hash to #skills', () => {
        renderTopBar();
        act(() => {
            fireEvent.click(document.getElementById('skills-toggle')!);
        });
        expect(location.hash).toBe('#skills');
    });
});

describe('TopBar — memory icon button', () => {
    it('renders a memory-toggle button', () => {
        renderTopBar();
        expect(document.getElementById('memory-toggle')).toBeTruthy();
    });

    it('memory-toggle has aria-label and title "Memory"', () => {
        renderTopBar();
        const btn = document.getElementById('memory-toggle')!;
        expect(btn.getAttribute('aria-label')).toBe('Memory');
        expect(btn.getAttribute('title')).toBe('Memory');
    });

    it('memory-toggle has touch-target class', () => {
        renderTopBar();
        const btn = document.getElementById('memory-toggle')!;
        expect(btn.className).toContain('touch-target');
    });

    it('memory-toggle shows active style when activeTab is memory', () => {
        renderTopBar();
        act(() => {
            fireEvent.click(document.getElementById('memory-toggle')!);
        });
        const btn = document.getElementById('memory-toggle')!;
        expect(btn.className).toContain('bg-[#0078d4]');
        expect(btn.className).toContain('text-white');
    });

    it('memory-toggle does not show active style when another tab is active', () => {
        renderTopBar();
        const btn = document.getElementById('memory-toggle')!;
        expect(btn.className).not.toContain('bg-[#0078d4]');
    });

    it('"Memory" text tab is not rendered in the main nav', () => {
        renderTopBar();
        const tabs = TABS.map(t => t.label);
        expect(tabs).not.toContain('Memory');
    });
});
