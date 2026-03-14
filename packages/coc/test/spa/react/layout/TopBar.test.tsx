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
        const mobileTitle = screen.getByText('CoC');
        expect(mobileTitle).toBeTruthy();
        expect(mobileTitle.tagName).toBe('A');
        expect((mobileTitle as HTMLAnchorElement).href).toContain('/');
        expect(mobileTitle.className).toContain('md:hidden');
    });

    it('desktop title "CoC (Copilot Of Copilot)" has hidden md:inline classes', () => {
        viewportCleanup = mockViewport(1024);
        render(<TopBar />);
        const desktopTitle = screen.getByText('CoC (Copilot Of Copilot)');
        expect(desktopTitle).toBeTruthy();
        expect(desktopTitle.tagName).toBe('A');
        expect((desktopTitle as HTMLAnchorElement).href).toContain('/');
        expect(desktopTitle.className).toContain('hidden');
        expect(desktopTitle.className).toContain('md:inline');
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
});
