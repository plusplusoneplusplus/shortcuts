/**
 * Tests for BottomNav — mobile bottom navigation bar.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { mockViewport } from '../../helpers/viewport-mock';
import { BottomNav } from '../../../../src/server/spa/client/react/layout/BottomNav';

// ── Mock ResizeObserver (not available in jsdom) ──────────────────────

vi.stubGlobal('ResizeObserver', vi.fn().mockImplementation(function () { return ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
}); }));

// ── Mock config ───────────────────────────────────────────────────────

let mockServersEnabled = false;
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isServersEnabled: () => mockServersEnabled,
    isRalphEnabled: () => false,
}));

// ── Mock AppContext ────────────────────────────────────────────────────

const mockDispatch = vi.fn();
let mockActiveTab = 'repos';
let mockSelectedRepoId: string | null = null;
let mockActiveRepoSubTab = 'info';

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', function () { return ({
    useApp: function () { return ({
        state: {
            activeTab: mockActiveTab,
            selectedRepoId: mockSelectedRepoId,
            activeRepoSubTab: mockActiveRepoSubTab,
        },
        dispatch: mockDispatch,
    }); },
    AppProvider: ({ children }: { children: React.ReactNode }) => children,
}); });

describe('BottomNav', () => {
    let viewportCleanup: (() => void) | undefined;

    beforeEach(() => {
        mockDispatch.mockClear();
        mockActiveTab = 'repos';
        mockSelectedRepoId = null;
        mockActiveRepoSubTab = 'info';
        mockServersEnabled = false;
    });

    afterEach(() => {
        viewportCleanup?.();
        viewportCleanup = undefined;
    });

    it('renders on mobile viewport', () => {
        viewportCleanup = mockViewport(375);
        render(<BottomNav />);
        expect(screen.getByTestId('bottom-nav')).toBeTruthy();
        const buttons = screen.getAllByRole('button');
        expect(buttons).toHaveLength(4); // skills, memory, stats, logs (servers disabled by default)
    });

    it('hidden on desktop viewport', () => {
        viewportCleanup = mockViewport(1024);
        const { container } = render(<BottomNav />);
        expect(container.innerHTML).toBe('');
    });

    it('hidden on tablet viewport', () => {
        viewportCleanup = mockViewport(768);
        const { container } = render(<BottomNav />);
        expect(container.innerHTML).toBe('');
    });

    it('highlights active skills tab on mobile (repos has no bottom nav button)', () => {
        viewportCleanup = mockViewport(375);
        mockActiveTab = 'skills';
        render(<BottomNav />);
        const skillsBtn = screen.getByText('Skills').closest('button')!;
        expect(skillsBtn.className).toContain('text-[#0078d4]');
        // Repos has no button in BottomNav — it is the implicit default
        expect(screen.queryByText('Repos')).toBeNull();
        // Processes tab removed from BottomNav
        expect(screen.queryByText('Processes')).toBeNull();
    });

    it('highlights active memory tab', () => {
        viewportCleanup = mockViewport(375);
        mockActiveTab = 'memory';
        render(<BottomNav />);
        const memoryBtn = screen.getByText('Memory').closest('button')!;
        expect(memoryBtn.className).toContain('text-[#0078d4]');
    });

    it('dispatches SET_ACTIVE_TAB on click', () => {
        viewportCleanup = mockViewport(375);
        render(<BottomNav />);
        fireEvent.click(screen.getByText('Skills').closest('button')!);
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_ACTIVE_TAB', tab: 'skills' });
    });

    it('updates location hash on click', () => {
        viewportCleanup = mockViewport(375);
        render(<BottomNav />);
        fireEvent.click(screen.getByText('Memory').closest('button')!);
        expect(location.hash).toBe('#memory');
    });

    it('sets aria-current="page" on active tab only', () => {
        viewportCleanup = mockViewport(375);
        mockActiveTab = 'skills';
        render(<BottomNav />);
        const skillsBtn = screen.getByText('Skills').closest('button')!;
        expect(skillsBtn.getAttribute('aria-current')).toBe('page');
        const memoryBtn = screen.getByText('Memory').closest('button')!;
        expect(memoryBtn.getAttribute('aria-current')).toBeNull();
        // repos has no bottom nav button
        expect(screen.queryByText('Repos')).toBeNull();
        // processes removed from bottom nav
        expect(screen.queryByText('Processes')).toBeNull();
    });

    it('is positioned at the top below the TopBar', () => {
        viewportCleanup = mockViewport(375);
        render(<BottomNav />);
        const nav = screen.getByTestId('bottom-nav');
        expect(nav.tagName).toBe('NAV');
        expect(nav.className).toContain('fixed');
        expect(nav.className).toContain('top-10');
    });

    it('has z-[8000] class', () => {
        viewportCleanup = mockViewport(375);
        render(<BottomNav />);
        const nav = screen.getByTestId('bottom-nav');
        expect(nav.className).toContain('z-[8000]');
    });

    it('active tab has background tint', () => {
        viewportCleanup = mockViewport(375);
        mockActiveTab = 'skills';
        render(<BottomNav />);
        const skillsBtn = screen.getByText('Skills').closest('button')!;
        expect(skillsBtn.className).toContain('bg-[#0078d4]/10');
        expect(skillsBtn.className).toContain('rounded-lg');
    });

    it('inactive tab has no background tint', () => {
        viewportCleanup = mockViewport(375);
        mockActiveTab = 'skills';
        render(<BottomNav />);
        const memoryBtn = screen.getByText('Memory').closest('button')!;
        expect(memoryBtn.className).not.toContain('bg-[#0078d4]/10');
    });

    it('each button has data-tab attribute', () => {
        viewportCleanup = mockViewport(375);
        render(<BottomNav />);
        // repos is no longer in BottomNav — it is the implicit default view
        expect(screen.getByTestId('bottom-nav').querySelector('[data-tab="repos"]')).toBeNull();
        // processes removed from BottomNav
        expect(screen.getByTestId('bottom-nav').querySelector('[data-tab="processes"]')).toBeNull();
        expect(screen.getByTestId('bottom-nav').querySelector('[data-tab="skills"]')).toBeTruthy();
        expect(screen.getByTestId('bottom-nav').querySelector('[data-tab="memory"]')).toBeTruthy();
    });

    // ── Models and Servers tabs (responsive additions) ───────────────

    it('does not include Models tab on mobile (moved to Agent Provider)', () => {
        viewportCleanup = mockViewport(375);
        render(<BottomNav />);
        expect(screen.queryByText('Models')).toBeNull();
    });

    it('hides Servers tab when servers are disabled', () => {
        viewportCleanup = mockViewport(375);
        mockServersEnabled = false;
        render(<BottomNav />);
        expect(screen.queryByText('Servers')).toBeNull();
    });

    it('shows Servers tab when servers are enabled', () => {
        viewportCleanup = mockViewport(375);
        mockServersEnabled = true;
        render(<BottomNav />);
        expect(screen.getByText('Servers')).toBeTruthy();
        expect(screen.getByTestId('bottom-nav').querySelector('[data-tab="servers"]')).toBeTruthy();
    });

    it('renders 6 buttons when servers are enabled', () => {
        viewportCleanup = mockViewport(375);
        mockServersEnabled = true;
        render(<BottomNav />);
        const buttons = screen.getAllByRole('button');
        expect(buttons).toHaveLength(5); // skills, memory, stats, servers, logs
    });

    it('highlights active servers tab', () => {
        viewportCleanup = mockViewport(375);
        mockServersEnabled = true;
        mockActiveTab = 'servers';
        render(<BottomNav />);
        const serversBtn = screen.getByText('Servers').closest('button')!;
        expect(serversBtn.className).toContain('text-[#0078d4]');
    });

    it('nav has overflow-x-auto for scrollable mobile layout', () => {
        viewportCleanup = mockViewport(375);
        mockServersEnabled = true;
        render(<BottomNav />);
        const nav = screen.getByTestId('bottom-nav');
        expect(nav.className).toContain('overflow-x-auto');
    });

    // ── Contextual repo nav ────────────────────────────────────────────

    describe('when a repo is selected', () => {
        beforeEach(() => {
            mockSelectedRepoId = 'my-repo';
            mockActiveRepoSubTab = 'info';
        });

        it('returns null (MobileTabBar in RepoDetail handles repo navigation)', () => {
            viewportCleanup = mockViewport(375);
            const { container } = render(<BottomNav />);
            expect(container.innerHTML).toBe('');
        });

        it('is hidden on desktop even when repo is selected', () => {
            viewportCleanup = mockViewport(1024);
            const { container } = render(<BottomNav />);
            expect(container.innerHTML).toBe('');
        });
    });
});

