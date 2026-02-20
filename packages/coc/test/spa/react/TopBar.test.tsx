import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AppProvider, appReducer } from '../../../src/server/spa/client/react/context/AppContext';
import { ThemeProvider } from '../../../src/server/spa/client/react/layout/ThemeProvider';
import { TopBar, TABS } from '../../../src/server/spa/client/react/layout/TopBar';
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
            <ThemeProvider>
                <TopBar />
            </ThemeProvider>
        </AppProvider>
    );
}

// ─── TABS constant ──────────────────────────────────────────────

describe('TABS constant', () => {
    it('contains Repos, Processes, and Wiki', () => {
        const labels = TABS.map(t => t.label);
        expect(labels).toContain('Repos');
        expect(labels).toContain('Processes');
        expect(labels).toContain('Wiki');
    });

    it('has matching tab identifiers', () => {
        const tabs = TABS.map(t => t.tab);
        expect(tabs).toContain('repos');
        expect(tabs).toContain('processes');
        expect(tabs).toContain('wiki');
    });

    it('has exactly 3 entries', () => {
        expect(TABS).toHaveLength(3);
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
        expect(screen.getByText('AI Execution Dashboard')).toBeDefined();
    });

    it('renders hamburger button', () => {
        renderTopBar();
        expect(screen.getByLabelText('Toggle sidebar')).toBeDefined();
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

    it('sets hash to #wiki when Wiki tab is clicked', () => {
        renderTopBar();
        act(() => {
            fireEvent.click(screen.getByText('Wiki'));
        });
        expect(location.hash).toBe('#wiki');
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
        act(() => { fireEvent.click(screen.getByText('Wiki')); });
        expect(location.hash).toBe('#wiki');

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
            fireEvent.click(screen.getByText('Wiki'));
        });
        const wikiBtn = screen.getByText('Wiki');
        expect(wikiBtn.className).toContain('bg-[#0078d4]');
        expect(wikiBtn.className).toContain('text-white');
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
        selectedWikiId: null,
        selectedWikiComponentId: null,
        wikiView: 'list' as const,
        wikiDetailInitialTab: null,
        wikiDetailInitialAdminTab: null,
        wikis: [],
        repos: [],
        processes: [],
        repoFilter: '',
    };

    it('switches to processes', () => {
        const result = appReducer(baseState, { type: 'SET_ACTIVE_TAB', tab: 'processes' });
        expect(result.activeTab).toBe('processes');
    });

    it('switches to wiki', () => {
        const result = appReducer(baseState, { type: 'SET_ACTIVE_TAB', tab: 'wiki' });
        expect(result.activeTab).toBe('wiki');
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
