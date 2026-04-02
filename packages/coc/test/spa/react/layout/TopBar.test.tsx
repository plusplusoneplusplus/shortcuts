/**
 * Tests for TopBar — responsive behavior (mobile title, tab bar visibility).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { mockViewport } from '../../helpers/viewport-mock';
import { TopBar } from '../../../../src/server/spa/client/react/layout/TopBar';

// ── Mock AppContext ────────────────────────────────────────────────────

const mockDispatch = vi.fn();

vi.mock('../../../../src/server/spa/client/react/context/AppContext', () => ({
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

vi.mock('../../../../src/server/spa/client/react/context/ReposContext', () => ({
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

vi.mock('../../../../src/server/spa/client/react/context/QueueContext', () => ({
    QueueProvider: ({ children }: any) => children,
    useQueue: () => ({ state: { repoQueueMap: {}, queued: [], running: [], history: [] }, dispatch: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useBreakpoint', () => ({
    useBreakpoint: () => ({ breakpoint: 'desktop', isMobile: false, isTablet: false, isDesktop: true }),
}));

describe('TopBar responsive behavior', () => {
    let viewportCleanup: (() => void) | undefined;

    beforeEach(() => {
        mockDispatch.mockClear();
    });

    afterEach(() => {
        viewportCleanup?.();
        viewportCleanup = undefined;
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

    it('processes button has hidden md:inline-flex classes (hidden on mobile)', () => {
        viewportCleanup = mockViewport(375);
        render(<TopBar />);
        const btn = document.getElementById('processes-toggle')!;
        expect(btn.className).toContain('hidden');
        expect(btn.className).toContain('md:inline-flex');
    });

    it('skills button has hidden md:inline-flex classes (hidden on mobile)', () => {
        viewportCleanup = mockViewport(375);
        render(<TopBar />);
        const btn = document.getElementById('skills-toggle')!;
        expect(btn.className).toContain('hidden');
        expect(btn.className).toContain('md:inline-flex');
    });

    it('logs button has hidden md:inline-flex classes (hidden on mobile)', () => {
        viewportCleanup = mockViewport(375);
        render(<TopBar />);
        const btn = document.getElementById('logs-toggle')!;
        expect(btn.className).toContain('hidden');
        expect(btn.className).toContain('md:inline-flex');
    });

    it('memory button has hidden md:inline-flex classes (hidden on mobile)', () => {
        viewportCleanup = mockViewport(375);
        render(<TopBar />);
        const btn = document.getElementById('memory-toggle')!;
        expect(btn.className).toContain('hidden');
        expect(btn.className).toContain('md:inline-flex');
    });

    it('models button renders atom symbol icon', () => {
        render(<TopBar />);
        const btn = document.getElementById('models-toggle')!;
        expect(btn.textContent).toContain('⚛');
    });

    it('models button has hidden md:inline-flex classes (hidden on mobile)', () => {
        viewportCleanup = mockViewport(375);
        render(<TopBar />);
        const btn = document.getElementById('models-toggle')!;
        expect(btn.className).toContain('hidden');
        expect(btn.className).toContain('md:inline-flex');
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

    it('inactive icon buttons do not have active border class', () => {
        viewportCleanup = mockViewport(1024);
        render(<TopBar />);
        // processes is not active (activeTab is 'repos')
        const btn = document.getElementById('processes-toggle')!;
        expect(btn.className).not.toContain('active');
        expect(btn.className).not.toContain('border-b-2');
    });
});
