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

vi.mock('../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    useTheme: () => ({
        theme: 'auto',
        toggleTheme: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/shared/NotificationBell', () => ({
    NotificationBell: () => null,
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

    it('tab bar has hidden md:flex classes for responsive visibility', () => {
        viewportCleanup = mockViewport(1024);
        render(<TopBar />);
        const tabBar = document.getElementById('tab-bar')!;
        expect(tabBar).toBeTruthy();
        expect(tabBar.className).toContain('hidden');
        expect(tabBar.className).toContain('md:flex');
    });

    it('mobile title "CoC" is visible with md:hidden class', () => {
        viewportCleanup = mockViewport(375);
        render(<TopBar />);
        const mobileTitle = screen.getByText('CoC');
        expect(mobileTitle).toBeTruthy();
        expect(mobileTitle.className).toContain('md:hidden');
    });

    it('desktop title "CoC (Copilot Of Copilot)" has hidden md:inline classes', () => {
        viewportCleanup = mockViewport(1024);
        render(<TopBar />);
        const desktopTitle = screen.getByText('CoC (Copilot Of Copilot)');
        expect(desktopTitle).toBeTruthy();
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
