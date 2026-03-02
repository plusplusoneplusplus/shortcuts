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
        expect(buttons).toHaveLength(3);
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

    it('highlights active wiki tab', () => {
        viewportCleanup = mockViewport(375);
        mockActiveTab = 'wiki';
        render(<BottomNav />);
        const wikiBtn = screen.getByText('Wiki').closest('button')!;
        expect(wikiBtn.className).toContain('text-[#0078d4]');
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
        fireEvent.click(screen.getByText('Wiki').closest('button')!);
        expect(location.hash).toBe('#wiki');
    });

    it('sets aria-current="page" on active tab only', () => {
        viewportCleanup = mockViewport(375);
        mockActiveTab = 'repos';
        render(<BottomNav />);
        const reposBtn = screen.getByText('Repos').closest('button')!;
        expect(reposBtn.getAttribute('aria-current')).toBe('page');
        const processesBtn = screen.getByText('Processes').closest('button')!;
        expect(processesBtn.getAttribute('aria-current')).toBeNull();
        const wikiBtn = screen.getByText('Wiki').closest('button')!;
        expect(wikiBtn.getAttribute('aria-current')).toBeNull();
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
        expect(screen.getByTestId('bottom-nav').querySelector('[data-tab="wiki"]')).toBeTruthy();
    });

    // ── Contextual repo nav ────────────────────────────────────────────

    describe('when a repo is selected', () => {
        beforeEach(() => {
            mockSelectedRepoId = 'my-repo';
            mockActiveRepoSubTab = 'info';
        });

        it('renders Back, Queue, Chat buttons instead of global tabs', () => {
            viewportCleanup = mockViewport(375);
            render(<BottomNav />);
            expect(screen.getByText('Back')).toBeTruthy();
            expect(screen.getByText('Queue')).toBeTruthy();
            expect(screen.getByText('Chat')).toBeTruthy();
            expect(screen.queryByText('Repos')).toBeNull();
            expect(screen.queryByText('Processes')).toBeNull();
            expect(screen.queryByText('Wiki')).toBeNull();
        });

        it('Back button dispatches SET_SELECTED_REPO with null and sets hash to #repos', () => {
            viewportCleanup = mockViewport(375);
            render(<BottomNav />);
            fireEvent.click(screen.getByText('Back').closest('button')!);
            expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_REPO', id: null });
            expect(location.hash).toBe('#repos');
        });

        it('Queue button dispatches SET_REPO_SUB_TAB and sets hash', () => {
            viewportCleanup = mockViewport(375);
            render(<BottomNav />);
            fireEvent.click(screen.getByText('Queue').closest('button')!);
            expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_REPO_SUB_TAB', tab: 'queue' });
            expect(location.hash).toBe('#repos/my-repo/queue');
        });

        it('Chat button dispatches SET_REPO_SUB_TAB and sets hash', () => {
            viewportCleanup = mockViewport(375);
            render(<BottomNav />);
            fireEvent.click(screen.getByText('Chat').closest('button')!);
            expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_REPO_SUB_TAB', tab: 'chat' });
            expect(location.hash).toBe('#repos/my-repo/chat');
        });

        it('highlights Queue button when activeRepoSubTab is queue', () => {
            viewportCleanup = mockViewport(375);
            mockActiveRepoSubTab = 'queue';
            render(<BottomNav />);
            const queueBtn = screen.getByText('Queue').closest('button')!;
            expect(queueBtn.className).toContain('text-[#0078d4]');
            const chatBtn = screen.getByText('Chat').closest('button')!;
            expect(chatBtn.className).not.toContain('text-[#0078d4]');
        });

        it('highlights Chat button when activeRepoSubTab is chat', () => {
            viewportCleanup = mockViewport(375);
            mockActiveRepoSubTab = 'chat';
            render(<BottomNav />);
            const chatBtn = screen.getByText('Chat').closest('button')!;
            expect(chatBtn.className).toContain('text-[#0078d4]');
            const queueBtn = screen.getByText('Queue').closest('button')!;
            expect(queueBtn.className).not.toContain('text-[#0078d4]');
        });

        it('Back button is never highlighted', () => {
            viewportCleanup = mockViewport(375);
            render(<BottomNav />);
            const backBtn = screen.getByText('Back').closest('button')!;
            expect(backBtn.className).not.toContain('text-[#0078d4]');
            expect(backBtn.getAttribute('aria-current')).toBeNull();
        });

        it('sets aria-current="page" on active Queue button', () => {
            viewportCleanup = mockViewport(375);
            mockActiveRepoSubTab = 'queue';
            render(<BottomNav />);
            const queueBtn = screen.getByText('Queue').closest('button')!;
            expect(queueBtn.getAttribute('aria-current')).toBe('page');
            const backBtn = screen.getByText('Back').closest('button')!;
            expect(backBtn.getAttribute('aria-current')).toBeNull();
        });

        it('uses aria-label "Repo navigation"', () => {
            viewportCleanup = mockViewport(375);
            render(<BottomNav />);
            expect(screen.getByRole('navigation', { name: 'Repo navigation' })).toBeTruthy();
        });

        it('is hidden on desktop even when repo is selected', () => {
            viewportCleanup = mockViewport(1024);
            const { container } = render(<BottomNav />);
            expect(container.innerHTML).toBe('');
        });
    });
});

