import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AppProvider, appReducer } from '../../../src/server/spa/client/react/context/AppContext';
import { NotificationProvider } from '../../../src/server/spa/client/react/context/NotificationContext';
import { ThemeProvider } from '../../../src/server/spa/client/react/layout/ThemeProvider';
import { TopBar, TABS, ALL_TABS, SHOW_WIKI_TAB } from '../../../src/server/spa/client/react/layout/TopBar';
import type { DashboardTab } from '../../../src/server/spa/client/react/types/dashboard';

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
    it('contains Repos, Processes, and Memory', () => {
        const labels = TABS.map(t => t.label);
        expect(labels).toContain('Repos');
        expect(labels).toContain('Processes');
        expect(labels).toContain('Memory');
    });

    it('has matching tab identifiers', () => {
        const tabs = TABS.map(t => t.tab);
        expect(tabs).toContain('repos');
        expect(tabs).toContain('processes');
        expect(tabs).toContain('memory');
    });

    it('has exactly 4 entries (wiki hidden)', () => {
        expect(TABS).toHaveLength(4);
    });

    it('SHOW_WIKI_TAB is false (wiki hidden but available in ALL_TABS)', () => {
        expect(SHOW_WIKI_TAB).toBe(false);
    });

    it('ALL_TABS includes wiki and skills entries', () => {
        const tabs = ALL_TABS.map(t => t.tab);
        expect(tabs).toContain('wiki');
        expect(tabs).toContain('skills');
        expect(ALL_TABS).toHaveLength(5);
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

    it('renders the dashboard title', () => {
        renderTopBar();
        expect(screen.getByText('CoC (Copilot Of Copilot)')).toBeDefined();
    });

    it('renders hamburger button', () => {
        renderTopBar();
        expect(screen.getByLabelText('Toggle sidebar')).toBeDefined();
    });

    it('hamburger toggles repos sidebar pressed state in Repos tab', () => {
        renderTopBar();
        const btn = screen.getByLabelText('Toggle sidebar');
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

    it('hamburger does not toggle sidebar outside Repos tab', () => {
        renderTopBar();
        act(() => {
            fireEvent.click(screen.getByText('Processes'));
        });

        const btn = screen.getByLabelText('Toggle sidebar');
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
    it('sets hash to #processes when Processes tab is clicked', () => {
        renderTopBar();
        act(() => {
            fireEvent.click(screen.getByText('Processes'));
        });
        expect(location.hash).toBe('#processes');
    });

    it('sets hash to #repos when Repos tab is clicked', () => {
        location.hash = '#processes';
        renderTopBar();
        act(() => {
            fireEvent.click(screen.getByText('Repos'));
        });
        expect(location.hash).toBe('#repos');
    });

    it('sets hash to #memory when Memory tab is clicked', () => {
        renderTopBar();
        act(() => {
            fireEvent.click(screen.getByText('Memory'));
        });
        expect(location.hash).toBe('#memory');
    });

    it('clicking the same tab still sets the hash', () => {
        location.hash = '#repos';
        renderTopBar();
        act(() => {
            fireEvent.click(screen.getByText('Repos'));
        });
        expect(location.hash).toBe('#repos');
    });

    it('clicking tabs in sequence updates hash each time', () => {
        renderTopBar();
        act(() => { fireEvent.click(screen.getByText('Memory')); });
        expect(location.hash).toBe('#memory');

        act(() => { fireEvent.click(screen.getByText('Processes')); });
        expect(location.hash).toBe('#processes');

        act(() => { fireEvent.click(screen.getByText('Repos')); });
        expect(location.hash).toBe('#repos');
    });
});

// ─── TopBar active tab styling ──────────────────────────────────

describe('TopBar — active tab styling', () => {
    it('default active tab (repos) has active class', () => {
        renderTopBar();
        const reposBtn = screen.getByText('Repos');
        expect(reposBtn.className).toContain('bg-[#0078d4]');
        expect(reposBtn.className).toContain('text-white');
    });

    it('non-active tabs do not have active class', () => {
        renderTopBar();
        const processesBtn = screen.getByText('Processes');
        expect(processesBtn.className).not.toContain('bg-[#0078d4]');
    });

    it('clicked tab becomes active', () => {
        renderTopBar();
        act(() => {
            fireEvent.click(screen.getByText('Memory'));
        });
        const memoryBtn = screen.getByText('Memory');
        expect(memoryBtn.className).toContain('bg-[#0078d4]');
        expect(memoryBtn.className).toContain('text-white');
    });

    it('previously active tab loses active class after clicking another', () => {
        renderTopBar();
        act(() => {
            fireEvent.click(screen.getByText('Processes'));
        });
        const reposBtn = screen.getByText('Repos');
        expect(reposBtn.className).not.toContain('bg-[#0078d4]');
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
