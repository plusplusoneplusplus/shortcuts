/**
 * @vitest-environment jsdom
 *
 * Tests for TopBar macOS desktop layout:
 *   - drag-region class is always present (no-op in browsers, enables window drag in Electron)
 *   - data-mac-desktop attribute and left-padding inset are applied when
 *     window.cocDesktop.platform === 'darwin'
 *   - no inset is applied on other platforms or in a plain browser
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { TopBar } from '../../../../src/server/spa/client/react/layout/TopBar';

// ── Shared mocks (same as TopBar.test.tsx) ────────────────────────────

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
    useTheme: () => ({ theme: 'auto', toggleTheme: vi.fn() }),
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

vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useMyWorkEnabled', () => ({
    useMyWorkEnabled: () => false,
}));

vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useMyLifeEnabled', () => ({
    useMyLifeEnabled: () => false,
}));

vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useRemoteShellEnabled', () => ({
    useRemoteShellEnabled: () => false,
}));

// ── Helpers ───────────────────────────────────────────────────────────

function getHeader(container: HTMLElement): HTMLElement {
    return container.querySelector('header[data-react]') as HTMLElement;
}

function setCocDesktop(opts: { isDesktop?: boolean; platform?: string } | null) {
    if (opts === null) {
        delete (window as any).cocDesktop;
    } else {
        (window as any).cocDesktop = opts;
    }
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('TopBar — macOS desktop layout', () => {
    afterEach(() => {
        delete (window as any).cocDesktop;
    });

    it('always has the drag-region class (enables window drag in Electron, no-op in browser)', () => {
        setCocDesktop(null);
        const { container } = render(<TopBar />);
        expect(getHeader(container).classList.contains('drag-region')).toBe(true);
    });

    it('applies left-padding inset and data-mac-desktop when isDesktop + platform=darwin', () => {
        setCocDesktop({ isDesktop: true, platform: 'darwin' });
        const { container } = render(<TopBar />);
        const header = getHeader(container);
        expect(header.getAttribute('data-mac-desktop')).toBe('true');
        expect(header.style.paddingLeft).toBe('88px');
    });

    it('applies inset via navigator.platform fallback when cocDesktop.platform is absent', () => {
        // Simulate older preload build: isDesktop but no platform field
        setCocDesktop({ isDesktop: true });
        // jsdom reports navigator.platform as '' by default; stub it to MacIntel
        const orig = navigator.platform;
        Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
        const { container } = render(<TopBar />);
        Object.defineProperty(navigator, 'platform', { value: orig, configurable: true });
        const header = getHeader(container);
        expect(header.getAttribute('data-mac-desktop')).toBe('true');
        expect(header.style.paddingLeft).toBe('88px');
    });

    it('does not apply inset on win32 desktop', () => {
        setCocDesktop({ isDesktop: true, platform: 'win32' });
        const { container } = render(<TopBar />);
        const header = getHeader(container);
        expect(header.getAttribute('data-mac-desktop')).toBeNull();
        expect(header.style.paddingLeft).toBe('');
    });

    it('does not apply inset on linux desktop', () => {
        setCocDesktop({ isDesktop: true, platform: 'linux' });
        const { container } = render(<TopBar />);
        const header = getHeader(container);
        expect(header.getAttribute('data-mac-desktop')).toBeNull();
        expect(header.style.paddingLeft).toBe('');
    });

    it('does not apply inset in a plain browser (no cocDesktop)', () => {
        setCocDesktop(null);
        const { container } = render(<TopBar />);
        const header = getHeader(container);
        expect(header.getAttribute('data-mac-desktop')).toBeNull();
        expect(header.style.paddingLeft).toBe('');
    });
});
