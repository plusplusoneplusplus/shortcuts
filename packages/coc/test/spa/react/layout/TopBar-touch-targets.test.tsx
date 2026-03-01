/**
 * Tests for TopBar touch-target classes on interactive elements.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { mockViewport } from '../../helpers/viewport-mock';
import { TopBar } from '../../../../src/server/spa/client/react/layout/TopBar';

// ── Mock AppContext ────────────────────────────────────────────────────
vi.mock('../../../../src/server/spa/client/react/context/AppContext', () => ({
    useApp: () => ({
        state: {
            activeTab: 'repos',
            reposSidebarCollapsed: false,
            wsStatus: 'open',
        },
        dispatch: vi.fn(),
    }),
    AppProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    useTheme: () => ({
        theme: 'auto',
        toggleTheme: vi.fn(),
    }),
}));

describe('TopBar touch targets', () => {
    let viewportCleanup: (() => void) | undefined;

    afterEach(() => {
        viewportCleanup?.();
        viewportCleanup = undefined;
    });

    it('hamburger button has touch-target class', () => {
        viewportCleanup = mockViewport(375);
        render(<TopBar />);
        const btn = document.getElementById('hamburger-btn')!;
        expect(btn.className).toContain('touch-target');
    });

    it('theme toggle button has touch-target class', () => {
        viewportCleanup = mockViewport(375);
        render(<TopBar />);
        const btn = document.getElementById('theme-toggle')!;
        expect(btn.className).toContain('touch-target');
    });

    it('admin link has touch-target class', () => {
        viewportCleanup = mockViewport(375);
        render(<TopBar />);
        const link = document.getElementById('admin-toggle')!;
        expect(link.className).toContain('touch-target');
    });
});
