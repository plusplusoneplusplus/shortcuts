/**
 * Tests for TopBar — responsive behavior (mobile title, tab bar visibility).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { mockViewport } from '../../helpers/viewport-mock';
import { TopBar } from '../../../../src/server/spa/client/react/layout/TopBar';

// ── Mock AppContext ────────────────────────────────────────────────────

const mockDispatch = vi.fn();

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: {
            activeTab: 'repos',
            reposSidebarCollapsed: false,
            wsStatus: 'open',
        },
        dispatch: mockDispatch,
    }),
    AppProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => ({ repos: [], unseenCounts: {}, fetchRepos: vi.fn(), loading: false }),
    ReposProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    useTheme: () => ({
        theme: 'auto',
        toggleTheme: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/shared/NotificationBell', () => ({
    NotificationBell: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/shared/AgentProviderQuotaIndicator', () => ({
    agentProviderQuotaIndicator: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    QueueProvider: ({ children }: any) => children,
    useQueue: () => ({ state: { repoQueueMap: {}, queued: [], running: [], history: [] }, dispatch: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ breakpoint: 'desktop', isMobile: false, isTablet: false, isDesktop: true }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn().mockResolvedValue({ gitGroupOrder: [] }),
}));

let mockMyWorkEnabled = false;
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useMyWorkEnabled', () => ({
    useMyWorkEnabled: () => mockMyWorkEnabled,
}));

let mockMyLifeEnabled = false;
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useMyLifeEnabled', () => ({
    useMyLifeEnabled: () => mockMyLifeEnabled,
}));

describe('TopBar responsive behavior', () => {
    let viewportCleanup: (() => void) | undefined;

    beforeEach(() => {
        mockDispatch.mockClear();
        mockMyWorkEnabled = false;
        mockMyLifeEnabled = false;
    });

    afterEach(() => {
        viewportCleanup?.();
        viewportCleanup = undefined;
        delete (window as any).__DASHBOARD_CONFIG__;
    });

    it('tab bar is not rendered when TABS is empty (repos is implicit default, wiki hidden)', () => {
        viewportCleanup = mockViewport(1024);
        render(<TopBar />);
        // With repos removed from ALL_TABS and wiki hidden by SHOW_WIKI_TAB flag,
        // TABS is empty and the <nav id="tab-bar"> is not rendered
        const tabBar = document.getElementById('tab-bar');
        expect(tabBar).toBeNull();
    });

    it('mobile title "CoC" is visible with md:hidden class', () => {
        viewportCleanup = mockViewport(375);
        render(<TopBar />);
        const mobileTitle = document.querySelector('[data-tab-mobile="repos"]') as HTMLAnchorElement;
        expect(mobileTitle).toBeTruthy();
        expect(mobileTitle.tagName).toBe('A');
        expect(mobileTitle.href).toContain('#');
        expect(mobileTitle.className).toContain('md:hidden');
    });

    it('mobile title truncates instead of forcing narrow topbar overflow', () => {
        (window as any).__DASHBOARD_CONFIG__ = {
            apiBasePath: '/api',
            wsPath: '/ws',
            hostname: 'very-long-hostname-for-mobile.example',
        };
        mockMyLifeEnabled = true;
        viewportCleanup = mockViewport(375);
        render(<TopBar />);

        const mobileTitle = document.querySelector('[data-tab-mobile="repos"]') as HTMLAnchorElement;
        expect(mobileTitle.textContent).toBe('CoC @ very-long-hostname-for-mobile.example');
        expect(mobileTitle.title).toBe('Copilot of Copilot @ very-long-hostname-for-mobile.example');
        expect(mobileTitle.className).toContain('truncate');
        expect(mobileTitle.className).toContain('min-w-0');
        expect(mobileTitle.className).toContain('shrink');
        expect(mobileTitle.className).toContain('px-1');
        expect(mobileTitle.className).not.toContain('flex-shrink-0');
        expect(document.getElementById('my-life-toggle')).toBeTruthy();
    });

    it('desktop CoC link shows short label with tooltip', () => {
        viewportCleanup = mockViewport(1024);
        render(<TopBar />);
        const desktopTitle = document.querySelector('[data-tab="repos"]') as HTMLAnchorElement;
        expect(desktopTitle).toBeTruthy();
        expect(desktopTitle.textContent).toBe('CoC');
        expect(desktopTitle.tagName).toBe('A');
        expect(desktopTitle.href).toContain('#');
        expect(desktopTitle.className).toContain('hidden');
        expect(desktopTitle.className).toContain('md:inline');
        expect(desktopTitle.title).toBe('Copilot of Copilot');
    });

    it('admin link is always present', () => {
        viewportCleanup = mockViewport(375);
        render(<TopBar />);
        expect(document.getElementById('admin-toggle')).toBeTruthy();
    });

    it('WS status indicator is always present', () => {
        viewportCleanup = mockViewport(375);
        render(<TopBar />);
        expect(screen.getByTestId('ws-status-indicator')).toBeTruthy();
    });

    it('theme toggle is always present', () => {
        viewportCleanup = mockViewport(375);
        render(<TopBar />);
        expect(document.getElementById('theme-toggle')).toBeTruthy();
    });

    it('does not render the legacy Tools dropdown trigger or items', () => {
        viewportCleanup = mockViewport(1024);
        render(<TopBar />);
        expect(document.getElementById('tools-toggle')).toBeNull();
        expect(document.getElementById('tools-popover')).toBeNull();
        // Tools were migrated to the Admin page sidebar; the topbar no longer
        // surfaces Skills/Logs/Stats/Models/Servers buttons directly.
        expect(document.getElementById('skills-toggle')).toBeNull();
        expect(document.getElementById('logs-toggle')).toBeNull();
        expect(document.getElementById('stats-toggle')).toBeNull();
        expect(document.getElementById('models-toggle')).toBeNull();
        expect(document.getElementById('servers-toggle')).toBeNull();
        expect(document.getElementById('memory-toggle')).toBeNull();
    });

    it('admin button does NOT have hidden class (always visible)', () => {
        viewportCleanup = mockViewport(375);
        render(<TopBar />);
        const btn = document.getElementById('admin-toggle')!;
        expect(btn.className).not.toContain('hidden');
        expect(btn.className).toContain('inline-flex');
    });

    it('active tab uses bottom-border style instead of solid background fill', () => {
        viewportCleanup = mockViewport(1024);
        render(<TopBar />);
        // repos is the active tab in these tests
        const desktopLink = document.querySelector('[data-tab="repos"]') as HTMLAnchorElement;
        expect(desktopLink.className).toContain('active');
        expect(desktopLink.className).toContain('border-b-2');
        expect(desktopLink.className).toContain('border-[#0078d4]');
        expect(desktopLink.className).not.toContain('bg-[#0078d4]');
        expect(desktopLink.className).not.toContain('text-white');
    });

});

describe('TopBar — My Work icon button', () => {
    let viewportCleanup: (() => void) | undefined;

    beforeEach(() => {
        mockDispatch.mockClear();
    });

    afterEach(() => {
        viewportCleanup?.();
        viewportCleanup = undefined;
    });

    it('does not render my-work-toggle when myWorkEnabled is false', () => {
        mockMyWorkEnabled = false;
        viewportCleanup = mockViewport(1024);
        render(<TopBar />);
        expect(document.getElementById('my-work-toggle')).toBeNull();
    });

    it('renders my-work-toggle when myWorkEnabled is true', () => {
        mockMyWorkEnabled = true;
        viewportCleanup = mockViewport(1024);
        render(<TopBar />);
        const btn = document.getElementById('my-work-toggle');
        expect(btn).toBeTruthy();
        expect(btn!.getAttribute('aria-label')).toBe('My Work');
        expect(btn!.getAttribute('title')).toBe('My Work');
    });

    it('my-work-toggle is visible on mobile when enabled', () => {
        mockMyWorkEnabled = true;
        viewportCleanup = mockViewport(375);
        render(<TopBar />);
        const btn = document.getElementById('my-work-toggle');
        expect(btn).toBeTruthy();
        expect(btn!.className).not.toContain('hidden');
    });

    it('my-work-toggle has touch-target class', () => {
        mockMyWorkEnabled = true;
        viewportCleanup = mockViewport(1024);
        render(<TopBar />);
        const btn = document.getElementById('my-work-toggle')!;
        expect(btn.className).toContain('touch-target');
    });

    it('my-work-toggle is not active when My Work workspace is not selected', () => {
        mockMyWorkEnabled = true;
        viewportCleanup = mockViewport(1024);
        render(<TopBar />);
        const btn = document.getElementById('my-work-toggle')!;
        expect(btn.className).not.toContain('bg-[#0078d4]');
        expect(btn.className).not.toContain('text-white');
    });

    it('contains 💼 emoji', () => {
        mockMyWorkEnabled = true;
        viewportCleanup = mockViewport(1024);
        render(<TopBar />);
        const btn = document.getElementById('my-work-toggle')!;
        expect(btn.textContent).toContain('💼');
    });
});
