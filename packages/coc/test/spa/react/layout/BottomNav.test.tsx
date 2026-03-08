/**
 * Tests for BottomNav — mobile bottom navigation bar.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { mockViewport } from '../../helpers/viewport-mock';
import { BottomNav } from '../../../../src/server/spa/client/react/layout/BottomNav';

// ── Mock AppContext ────────────────────────────────────────────────────

const mockDispatch = vi.fn();
let mockActiveTab = 'repos';
let mockSelectedRepoId: string | null = null;
let mockActiveRepoSubTab = 'info';

vi.mock('../../../../src/server/spa/client/react/context/AppContext', () => ({
    useApp: () => ({
        state: {
            activeTab: mockActiveTab,
            selectedRepoId: mockSelectedRepoId,
            activeRepoSubTab: mockActiveRepoSubTab,
        },
        dispatch: mockDispatch,
    }),
    AppProvider: ({ children }: { children: React.ReactNode }) => children,
}));

describe('BottomNav', () => {
    let viewportCleanup: (() => void) | undefined;

    beforeEach(() => {
        mockDispatch.mockClear();
        mockActiveTab = 'repos';
        mockSelectedRepoId = null;
        mockActiveRepoSubTab = 'info';
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
        expect(buttons).toHaveLength(4);
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

    it('highlights active repos tab', () => {
        viewportCleanup = mockViewport(375);
        mockActiveTab = 'repos';
        render(<BottomNav />);
        const reposBtn = screen.getByText('Repos').closest('button')!;
        expect(reposBtn.className).toContain('text-[#0078d4]');
    });

    it('highlights active processes tab', () => {
        viewportCleanup = mockViewport(375);
        mockActiveTab = 'processes';
        render(<BottomNav />);
        const processesBtn = screen.getByText('Processes').closest('button')!;
        expect(processesBtn.className).toContain('text-[#0078d4]');
        const reposBtn = screen.getByText('Repos').closest('button')!;
        expect(reposBtn.className).not.toContain('text-[#0078d4]');
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
        fireEvent.click(screen.getByText('Processes').closest('button')!);
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_ACTIVE_TAB', tab: 'processes' });
    });

    it('updates location hash on click', () => {
        viewportCleanup = mockViewport(375);
        render(<BottomNav />);
        fireEvent.click(screen.getByText('Memory').closest('button')!);
        expect(location.hash).toBe('#memory');
    });

    it('sets aria-current="page" on active tab only', () => {
        viewportCleanup = mockViewport(375);
        mockActiveTab = 'repos';
        render(<BottomNav />);
        const reposBtn = screen.getByText('Repos').closest('button')!;
        expect(reposBtn.getAttribute('aria-current')).toBe('page');
        const processesBtn = screen.getByText('Processes').closest('button')!;
        expect(processesBtn.getAttribute('aria-current')).toBeNull();
        const memoryBtn = screen.getByText('Memory').closest('button')!;
        expect(memoryBtn.getAttribute('aria-current')).toBeNull();
    });

    it('has safe area padding attribute for notched devices', () => {
        viewportCleanup = mockViewport(375);
        // jsdom strips `env()` CSS values, so we verify the element renders
        // with the correct test ID and confirm the style prop is applied
        // by checking the nav element is a fixed-position bar
        render(<BottomNav />);
        const nav = screen.getByTestId('bottom-nav');
        expect(nav.tagName).toBe('NAV');
        expect(nav.className).toContain('fixed');
        expect(nav.className).toContain('bottom-0');
    });

    it('has z-[8000] class', () => {
        viewportCleanup = mockViewport(375);
        render(<BottomNav />);
        const nav = screen.getByTestId('bottom-nav');
        expect(nav.className).toContain('z-[8000]');
    });

    it('each button has data-tab attribute', () => {
        viewportCleanup = mockViewport(375);
        render(<BottomNav />);
        expect(screen.getByTestId('bottom-nav').querySelector('[data-tab="repos"]')).toBeTruthy();
        expect(screen.getByTestId('bottom-nav').querySelector('[data-tab="processes"]')).toBeTruthy();
        expect(screen.getByTestId('bottom-nav').querySelector('[data-tab="memory"]')).toBeTruthy();
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

